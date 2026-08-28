// server.js — BARNBARN Workshop backend
// Express server: public API, admin API, payment (Omise) and LINE OA confirmation.
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import * as db from './db.js';
import {
  createPromptPayCharge,
  createCardCharge,
  getChargeStatus,
  paymentConfigured
} from './services/payment.js';
import { pushMessage, buildConfirmationMessage, lineConfigured } from './services/line.js';
import { sendConfirmationEmail, emailConfigured, sendOtpEmail } from './services/email.js';

// --- load .env (tiny parser, no dependency) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
})();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'barnbarn2026';
const LINE_ADD_FRIEND_URL = process.env.LINE_ADD_FRIEND_URL || '';
const OMISE_PUBLIC_KEY = process.env.OMISE_PUBLIC_KEY || '';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
function requireAdmin(req, res, next) {
  const pass = req.get('x-admin-password') || req.query.pw;
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function roundOf(ws, roundId) {
  return ws && ws.rounds.find((r) => r.id === roundId);
}

function publicWorkshop(ws) {
  // attach seats remaining per round
  return {
    ...ws,
    rounds: ws.rounds.map((r) => ({
      ...r,
      taken: db.seatsTaken(ws.id, r.id),
      remaining: Math.max(0, r.seats - db.seatsTaken(ws.id, r.id)),
      waitlist: db.waitlistCount(ws.id, r.id)
    }))
  };
}

// ---------- public config ----------
app.get('/api/config', (req, res) => {
  db.expireStale(); // runs on every keep-awake ping too (releases unpaid seats)
  res.json({
    paymentConfigured: paymentConfigured(),
    lineConfigured: lineConfigured(),
    emailConfigured: emailConfigured(),
    omisePublicKey: OMISE_PUBLIC_KEY,
    lineAddFriendUrl: LINE_ADD_FRIEND_URL,
    holdHours: db.holdHours()
  });
});

// ---------- public: payment info (bank QR + account details) ----------
app.get('/api/payment-info', (req, res) => {
  const s = db.getSettings();
  res.json({
    configured: Boolean(s.paymentQr || s.accountNumber),
    paymentQr: s.paymentQr || '',
    bankName: s.bankName || '',
    accountName: s.accountName || '',
    accountNumber: s.accountNumber || '',
    note: s.note || ''
  });
});

// ---------- public: look up my own registrations by phone ----------
const digitsOnly = (s) => String(s || '').replace(/\D/g, '');
function matchByPhone(phone) {
  const q = digitsOnly(phone);
  return db.listRegistrations().filter((r) => digitsOnly(r.phone) === q);
}
function toPublicRegs(matched) {
  return matched.map((r) => {
    const ws = db.getWorkshop(r.workshopId);
    const round = ws && ws.rounds.find((x) => x.id === r.roundId);
    const rids = (r.roundIds && r.roundIds.length) ? r.roundIds : [r.roundId];
    const rounds = ws ? rids.map((id) => ws.rounds.find((x) => x.id === id)).filter(Boolean).map((x) => ({ date: x.date, time: x.time })) : [];
    return {
      id: r.id, name: r.name,
      workshopTitle: ws ? ws.title : '(เวิร์กช็อปถูกลบแล้ว)',
      location: ws ? ws.location : '',
      round: round ? { date: round.date, time: round.time } : null,
      rounds,
      people: r.people, addons: r.addons || [], amount: r.amount,
      status: r.status, createdAt: r.createdAt
    };
  });
}

app.get('/api/my-registrations', (req, res) => {
  if (digitsOnly(req.query.phone).length < 8) return res.status(400).json({ error: 'กรุณากรอกเบอร์โทรให้ถูกต้อง (อย่างน้อย 8 หลัก)' });
  const matched = matchByPhone(req.query.phone);
  res.json({ count: matched.length, registrations: toPublicRegs(matched) });
});

// ---------- public: workshops ----------
app.get('/api/workshops', (req, res) => {
  res.json(db.listWorkshops({ onlyActive: true }).map(publicWorkshop));
});

// calendar feed: รวมกิจกรรมที่ผ่านไปแล้ว + ที่เปิดอยู่ (ซ่อน draft ที่ยังไม่เปิด = inactive+อนาคต)
app.get('/api/calendar', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  db.listWorkshops({}).forEach((ws) => {
    (ws.rounds || []).forEach((r) => {
      if (!r.date) return;
      const isPast = r.date < today;
      if (ws.active === false && !isPast) return; // ไม่โชว์ร่างที่ยังไม่เผยแพร่
      out.push({
        id: ws.id, title: ws.title, emoji: ws.emoji || '', category: ws.category || '', subtitle: ws.subtitle || '',
        date: r.date, time: r.time, price: r.price,
        remaining: Math.max(0, r.seats - db.seatsTaken(ws.id, r.id)),
        active: ws.active !== false, past: isPast
      });
    });
  });
  res.json(out);
});

app.get('/api/workshops/:id', (req, res) => {
  const ws = db.getWorkshop(req.params.id);
  if (!ws || !ws.active) return res.status(404).json({ error: 'not found' });
  res.json(publicWorkshop(ws));
});

// ---------- public: register ----------
// กันสแปม: จำกัดจำนวนครั้งสมัครต่อ IP ในช่วงเวลาหนึ่ง (in-memory)
const _regHits = new Map();
function registerRateLimited(ip) {
  const now = Date.now(), WINDOW = 10 * 60 * 1000, MAX = 15;
  const arr = (_regHits.get(ip) || []).filter((t) => now - t < WINDOW);
  arr.push(now); _regHits.set(ip, arr);
  return arr.length > MAX;
}

app.post('/api/register', (req, res) => {
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  if (registerRateLimited(ip)) {
    return res.status(429).json({ error: 'มีการสมัครถี่เกินไปจากอุปกรณ์นี้ กรุณารอสักครู่แล้วลองใหม่ค่ะ' });
  }
  const { workshopId, roundId, name, phone, email } = req.body || {};
  if (!workshopId || !roundId || !name || !phone) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อ เบอร์โทร และเลือกรอบให้ครบถ้วน' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return res.status(400).json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' });
  }
  if (!email && !String(req.body.lineId || '').trim()) {
    return res.status(400).json({ error: 'กรุณากรอกอีเมล หรือ ชื่อ LINE อย่างน้อย 1 อย่าง (เพื่อรับการยืนยันการสมัคร)' });
  }
  if (!String(req.body.province || '').trim()) {
    return res.status(400).json({ error: 'กรุณาเลือกจังหวัด' });
  }
  // ผู้ติดต่อฉุกเฉิน (จำเป็น)
  if (!String(req.body.emergencyName || '').trim() || !String(req.body.emergencyPhone || '').trim() || !String(req.body.emergencyRelation || '').trim()) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลผู้ติดต่อฉุกเฉินให้ครบ (ชื่อ เบอร์ และความสัมพันธ์)' });
  }
  // PDPA — ต้องยินยอมก่อนจึงจะสมัครได้
  if (req.body.pdpaConsent !== true) {
    return res.status(400).json({ error: 'กรุณายินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล (PDPA) ก่อนสมัคร' });
  }
  const ws = db.getWorkshop(workshopId);
  const round = roundOf(ws, roundId);
  if (!ws || !round) return res.status(404).json({ error: 'ไม่พบเวิร์กช็อปหรือรอบที่เลือก' });
  // โหมดหลายวัน: อาจเลือกได้หลายรอบ (roundIds) — ตรวจทุกวันที่เลือก
  const selRoundIds = (Array.isArray(req.body.roundIds) && req.body.roundIds.length) ? [...new Set(req.body.roundIds)] : [roundId];
  const selRounds = selRoundIds.map((rid) => roundOf(ws, rid));
  if (selRounds.some((r) => !r)) return res.status(404).json({ error: 'ไม่พบรอบที่เลือกบางรอบ' });

  db.expireStale();
  const people = Number(req.body.people) || 1;
  // ผู้เข้าร่วมคนที่ 2..N ต้องมีชื่อครบตามจำนวน
  const members = (Array.isArray(req.body.members) ? req.body.members : []).slice(0, Math.max(0, people - 1));
  if (members.length < people - 1 || members.some((m) => !String(m && m.name || '').trim())) {
    return res.status(400).json({ error: `กรุณากรอกชื่อผู้เข้าร่วมให้ครบทั้ง ${people} ท่าน` });
  }
  // กันสมัครซ้ำ: เบอร์เดิม + วันที่ทับกับที่เลือก ที่ยังไม่ถูกยกเลิก/หมดอายุ
  const phoneDigits = String(phone).replace(/\D/g, '');
  const dup = db.listRegistrations().find((r) => {
    if (r.workshopId !== workshopId || ['cancelled', 'expired'].includes(r.status)) return false;
    if (String(r.phone || '').replace(/\D/g, '') !== phoneDigits) return false;
    const rids = (r.roundIds && r.roundIds.length) ? r.roundIds : [r.roundId];
    return rids.some((id) => selRoundIds.includes(id));
  });
  if (dup) {
    return res.status(409).json({ error: 'เบอร์นี้สมัครรอบนี้ไว้แล้วค่ะ — ดูสถานะได้ที่ "ดูการสมัครของฉัน" หรือทักผู้จัดทาง LINE หากต้องการแก้ไข' });
  }
  // ตรวจที่นั่งให้พอทุกวันที่เลือก
  for (const r of selRounds) {
    const rem = r.seats - db.seatsTaken(workshopId, r.id);
    if (people > rem) {
      return res.status(400).json({ error: `รอบ ${r.date} ${r.time} เหลือ ${rem} ที่ ไม่พอสำหรับ ${people} ท่าน` });
    }
  }

  // validate selected add-ons against the workshop's defined add-ons (prevent tampering)
  const addonIds = Array.isArray(req.body.addonIds) ? req.body.addonIds : [];
  const selectedAddons = (ws.addons || []).filter((a) => addonIds.includes(a.id));
  const addonsTotal = selectedAddons.reduce((s, a) => s + (Number(a.price) || 0), 0);

  const reg = db.createRegistration({
    workshopId,
    roundId,
    roundIds: selRoundIds,
    name,
    phone,
    email: req.body.email,
    lineId: req.body.lineId,
    province: req.body.province,
    source: req.body.source,
    people,
    nickname: req.body.nickname,
    age: req.body.age,
    allergy: req.body.allergy,
    foodAvoid: req.body.foodAvoid,
    medical: req.body.medical,
    emergencyName: req.body.emergencyName,
    emergencyPhone: req.body.emergencyPhone,
    emergencyRelation: req.body.emergencyRelation,
    pdpaConsent: req.body.pdpaConsent === true,
    members,
    addons: selectedAddons.map((a) => ({ name: a.name, price: a.price })),
    note: req.body.note,
    amount: selRounds.reduce((s, r) => s + (Number(r.price) || 0), 0) * people + addonsTotal
  });

  // Free workshop (amount 0): no payment step — auto‑confirm the seat and email the participant.
  let out = reg;
  const isFree = (Number(reg.amount) || 0) <= 0;
  if (isFree) {
    out = db.updateRegistration(reg.id, { status: 'confirmed', paidNote: 'กิจกรรมฟรี (ไม่มีค่าใช้จ่าย)' }) || reg;
    sendConfirmationEmail(out, ws, round).catch(() => {});
  }
  res.json({ registration: out, workshop: { title: ws.title, location: ws.location }, round, free: isFree });
});

// ---------- public: join waitlist (when a round is full) ----------
app.post('/api/waitlist', (req, res) => {
  const { workshopId, roundId, name, phone } = req.body || {};
  if (!workshopId || !roundId || !name || !phone) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อและเบอร์โทร' });
  }
  const ws = db.getWorkshop(workshopId);
  const round = roundOf(ws, roundId);
  if (!ws || !round) return res.status(404).json({ error: 'ไม่พบรอบที่เลือก' });
  const w = db.addWaitlist({ workshopId, roundId, name, phone });
  res.json({ ok: true, waitlist: w });
});

// ---------- public: notify payment (upload slip) ----------
app.post('/api/register/:id/notify-paid', (req, res) => {
  const reg = db.getRegistration(req.params.id);
  if (!reg) return res.status(404).json({ error: 'ไม่พบใบสมัคร' });
  const patch = {
    status: 'awaiting_verification',
    notifiedAt: new Date().toISOString(),
    paidNote: (req.body && req.body.note) || ''
  };
  if (req.body && req.body.slipImage) patch.slipImage = req.body.slipImage;
  const updated = db.updateRegistration(reg.id, patch);
  res.json({ ok: true, registration: updated });
});

// ---------- public: pay ----------
app.post('/api/pay/promptpay', async (req, res) => {
  const reg = db.getRegistration(req.body.registrationId);
  if (!reg) return res.status(404).json({ error: 'ไม่พบใบสมัคร' });
  try {
    const charge = await createPromptPayCharge({
      amount: reg.amount,
      registrationId: reg.id,
      description: 'BARNBARN Workshop ' + reg.id
    });
    db.updateRegistration(reg.id, { paymentMethod: 'promptpay', paymentRef: charge.id });
    res.json(charge);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pay/card', async (req, res) => {
  const reg = db.getRegistration(req.body.registrationId);
  if (!reg) return res.status(404).json({ error: 'ไม่พบใบสมัคร' });
  try {
    const charge = await createCardCharge({
      amount: reg.amount,
      token: req.body.token,
      registrationId: reg.id,
      description: 'BARNBARN Workshop ' + reg.id
    });
    const patch = { paymentMethod: 'card', paymentRef: charge.id };
    if (charge.paid || charge.status === 'successful') patch.status = 'paid';
    db.updateRegistration(reg.id, patch);
    res.json(charge);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// poll payment status; if paid, mark registration paid
app.get('/api/pay/status/:registrationId', async (req, res) => {
  const reg = db.getRegistration(req.params.registrationId);
  if (!reg) return res.status(404).json({ error: 'ไม่พบใบสมัคร' });
  if (reg.status === 'paid' || reg.status === 'confirmed') {
    return res.json({ status: reg.status, paid: true });
  }
  if (!reg.paymentRef) return res.json({ status: reg.status, paid: false });
  const charge = await getChargeStatus(reg.paymentRef);
  if (charge.paid) db.updateRegistration(reg.id, { status: 'paid' });
  res.json({ status: charge.paid ? 'paid' : reg.status, paid: !!charge.paid });
});

// ---------- admin: auth check ----------
app.post('/api/admin/login', (req, res) => {
  if ((req.body || {}).password === ADMIN_PASSWORD) return res.json({ ok: true });
  res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
});

// ---------- admin: workshops CRUD ----------
app.get('/api/admin/workshops', requireAdmin, (req, res) => {
  res.json(db.listWorkshops().map(publicWorkshop));
});
app.post('/api/admin/workshops', requireAdmin, (req, res) => {
  res.json(db.createWorkshop(req.body || {}));
});
app.put('/api/admin/workshops/:id', requireAdmin, (req, res) => {
  const ws = db.updateWorkshop(req.params.id, req.body || {});
  if (!ws) return res.status(404).json({ error: 'not found' });
  res.json(ws);
});
app.delete('/api/admin/workshops/:id', requireAdmin, (req, res) => {
  db.deleteWorkshop(req.params.id);
  res.json({ ok: true });
});

// ---------- admin: registrations ----------
app.get('/api/admin/registrations', requireAdmin, (req, res) => {
  const regs = db.listRegistrations({ workshopId: req.query.workshopId, status: req.query.status });
  const enriched = regs.map((r) => {
    const ws = db.getWorkshop(r.workshopId);
    const round = roundOf(ws, r.roundId);
    const rids = (r.roundIds && r.roundIds.length) ? r.roundIds : [r.roundId];
    const rounds = ws ? rids.map((id) => roundOf(ws, id)).filter(Boolean) : [];
    return { ...r, workshopTitle: ws ? ws.title : '(ลบแล้ว)', round, rounds };
  });
  res.json(enriched);
});

// admin marks a registration as paid manually (e.g. bank transfer verified)
// -> auto-sends a confirmation email to the participant (if EMAIL_* configured & email present)
app.post('/api/admin/registrations/:id/mark-paid', requireAdmin, async (req, res) => {
  const reg = db.updateRegistration(req.params.id, { status: 'paid' });
  if (!reg) return res.status(404).json({ error: 'not found' });

  let emailResult = { sent: false };
  try {
    const ws = db.getWorkshop(reg.workshopId);
    const round = roundOf(ws, reg.roundId);
    emailResult = await sendConfirmationEmail(reg, ws, round);
    if (emailResult.sent) {
      db.updateRegistration(reg.id, {
        confirmationEmailSentAt: new Date().toISOString()
      });
    }
  } catch (e) {
    emailResult = { sent: false, error: String(e && e.message ? e.message : e) };
  }

  res.json({ ...reg, emailResult });
});

app.post('/api/admin/registrations/:id/cancel', requireAdmin, (req, res) => {
  const reg = db.updateRegistration(req.params.id, { status: 'cancelled' });
  if (!reg) return res.status(404).json({ error: 'not found' });
  res.json(reg);
});

// admin sends LINE confirmation (or gets the message to send manually)
app.post('/api/admin/registrations/:id/confirm', requireAdmin, async (req, res) => {
  const reg = db.getRegistration(req.params.id);
  if (!reg) return res.status(404).json({ error: 'not found' });
  const ws = db.getWorkshop(reg.workshopId);
  const round = roundOf(ws, reg.roundId);
  const message = buildConfirmationMessage(reg, ws, round);

  const result = await pushMessage(reg.lineUserId || reg.lineId, message);
  db.updateRegistration(reg.id, {
    status: 'confirmed',
    confirmed: true,
    confirmationMessage: message,
    confirmationSentAt: new Date().toISOString(),
    confirmationChannel: result.sent ? 'line_auto' : 'manual'
  });
  res.json({ sent: result.sent, demo: result.demo, message, error: result.error });
});

// helper: normalize attendedDays from a registration (backward compatible)
function attendedDaysOf(reg) {
  if (Array.isArray(reg.attendedDays)) return [...reg.attendedDays];
  return reg.attended ? [reg.roundId] : [];
}

// admin toggles attendance for a specific day (roundId). No roundId = toggle whole reg.
app.post('/api/admin/registrations/:id/attend', requireAdmin, (req, res) => {
  const reg = db.getRegistration(req.params.id);
  if (!reg) return res.status(404).json({ error: 'not found' });
  const rid = req.body && req.body.roundId;
  let days = attendedDaysOf(reg);
  if (rid) {
    days = days.includes(rid) ? days.filter((d) => d !== rid) : [...days, rid];
  } else {
    const all = (reg.roundIds && reg.roundIds.length) ? reg.roundIds : [reg.roundId];
    days = days.length ? [] : all;
  }
  const updated = db.updateRegistration(reg.id, { attendedDays: days, attended: days.length > 0 });
  res.json(updated);
});

// scan-to-check-in: mark the day matching TODAY (or the only day). Used by the QR scanner.
app.post('/api/admin/registrations/:id/checkin', requireAdmin, (req, res) => {
  const reg = db.getRegistration(String(req.params.id || '').trim());
  if (!reg) return res.status(404).json({ error: 'ไม่พบใบสมัครนี้' });
  const ws = db.getWorkshop(reg.workshopId);
  const rids = (reg.roundIds && reg.roundIds.length) ? reg.roundIds : [reg.roundId];
  const rounds = rids.map((id) => roundOf(ws, id)).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  const target = rounds.find((r) => r.date === today) || (rounds.length === 1 ? rounds[0] : null);
  if (!target) {
    return res.status(409).json({ error: 'วันนี้ไม่ตรงกับวันของกิจกรรมนี้ — กรุณาเช็คอินรายวันจากปุ่มในตาราง', name: reg.name });
  }
  let days = attendedDaysOf(reg);
  const already = days.includes(target.id);
  if (!already) days.push(target.id);
  const updated = db.updateRegistration(reg.id, { attendedDays: days, attended: days.length > 0 });
  res.json({ ok: true, already, name: updated.name, dayLabel: `${target.date} ${target.time}`, workshopTitle: ws ? ws.title : '' });
});

// admin edits a registration (name/phone/people/round/allergy/medical/note); recomputes amount
app.put('/api/admin/registrations/:id/edit', requireAdmin, (req, res) => {
  const reg = db.getRegistration(req.params.id);
  if (!reg) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const ws = db.getWorkshop(reg.workshopId);
  const patch = {
    name: b.name ?? reg.name,
    phone: b.phone ?? reg.phone,
    email: b.email ?? reg.email,
    lineId: b.lineId ?? reg.lineId,
    province: b.province ?? reg.province,
    allergy: b.allergy ?? reg.allergy,
    medical: b.medical ?? reg.medical,
    note: b.note ?? reg.note,
    adminNote: b.adminNote ?? reg.adminNote,
    people: Number(b.people) || reg.people,
    roundId: b.roundId ?? reg.roundId
  };
  // recompute amount from the (possibly new) round + existing add-ons
  const round = ws && ws.rounds.find((r) => r.id === patch.roundId);
  if (round) {
    const addonsTotal = (reg.addons || []).reduce((s, a) => s + (Number(a.price) || 0), 0);
    patch.amount = round.price * patch.people + addonsTotal;
  }
  const updated = db.updateRegistration(reg.id, patch);
  res.json(updated);
});

// admin permanently deletes a registration (e.g. cleaning up test sign-ups); frees the seat
app.delete('/api/admin/registrations/:id', requireAdmin, (req, res) => {
  const ok = db.deleteRegistration(String(req.params.id || '').trim());
  if (!ok) return res.status(404).json({ error: 'ไม่พบใบสมัครนี้' });
  res.json({ ok: true });
});

// admin one-click repair: re-link registrations that were orphaned from their round
app.post('/api/admin/repair-seats', requireAdmin, (req, res) => {
  res.json(db.repairOrphanRegistrations());
});

// ---------- admin: waitlist ----------
app.get('/api/admin/waitlist', requireAdmin, (req, res) => {
  const out = db.listWaitlist().map((w) => {
    const ws = db.getWorkshop(w.workshopId);
    const round = ws && ws.rounds.find((r) => r.id === w.roundId);
    return { ...w, workshopTitle: ws ? ws.title : '(ลบแล้ว)', round };
  });
  res.json(out);
});
app.delete('/api/admin/waitlist/:id', requireAdmin, (req, res) => {
  db.removeWaitlist(req.params.id);
  res.json({ ok: true });
});

// ---------- LINE webhook (captures userId when a participant messages your OA) ----------
app.post('/api/line/webhook', (req, res) => {
  try {
    const events = (req.body && req.body.events) || [];
    for (const ev of events) {
      const userId = ev.source && ev.source.userId;
      // Match by LINE display text "REG:<id>" if the user sends their ref code
      const text = ev.message && ev.message.text;
      if (userId && text) {
        const m = text.match(/reg_[a-z0-9]+/i);
        if (m) db.updateRegistration(m[0], { lineUserId: userId });
      }
    }
  } catch (e) {
    /* ignore */
  }
  res.json({ ok: true });
});

// ---------- admin: payment settings (bank QR + account) ----------
app.get('/api/admin/payment-settings', requireAdmin, (req, res) => {
  res.json(db.getSettings());
});
app.post('/api/admin/payment-settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  const saved = db.saveSettings({
    paymentQr: b.paymentQr ?? undefined,
    bankName: b.bankName ?? undefined,
    accountName: b.accountName ?? undefined,
    accountNumber: b.accountNumber ?? undefined,
    note: b.note ?? undefined
  });
  res.json(saved);
});

// admin dashboard summary
app.get('/api/admin/summary', requireAdmin, async (req, res) => {
  db.expireStale();
  const regs = db.listRegistrations();
  let storage = { available: false };
  try {
    storage = await db.getStorageStats();
  } catch (e) {
    /* ignore */
  }
  res.json({
    workshops: db.listWorkshops().length,
    totalRegistrations: regs.filter((r) => r.status !== 'expired').length,
    pendingPayment: regs.filter((r) => r.status === 'pending_payment').length,
    awaitingVerification: regs.filter((r) => r.status === 'awaiting_verification').length,
    paid: regs.filter((r) => r.status === 'paid').length,
    confirmed: regs.filter((r) => r.status === 'confirmed').length,
    attended: regs.filter((r) => r.attended).length,
    waitlist: db.listWaitlist().length,
    revenue: regs
      .filter((r) => r.status === 'paid' || r.status === 'confirmed')
      .reduce((s, r) => s + Number(r.amount || 0), 0),
    storage
  });
});

// SPA-ish routes
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/workshop', (req, res) => res.sendFile(path.join(__dirname, 'public', 'workshop.html')));
app.get('/my', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my.html')));

db.init()
  .catch((e) => console.error('DB init error:', e.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`\n🌿 BARNBARN Workshop running:`);
      console.log(`   หน้าผู้สมัคร (public):  http://localhost:${PORT}`);
      console.log(`   หน้าผู้ดูแล (admin):    http://localhost:${PORT}/admin`);
      console.log(`   LINE OA push:    ${lineConfigured() ? 'ready ✓' : 'manual mode (no token)'}`);
    });
  });
