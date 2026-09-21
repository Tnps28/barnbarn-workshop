// server.js — BARNBARN Workshop backend
// Express server: public API, admin API, payment (Omise) and LINE OA confirmation.
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import * as db from './db.js';
import {
  createPromptPayCharge,
  createCardCharge,
  getChargeStatus,
  paymentConfigured
} from './services/payment.js';
import * as LINE from './services/line.js';
import { qrPng } from './services/qr.js';
import { pushMessage, buildConfirmationMessage, lineConfigured } from './services/line.js';
import { sendConfirmationEmail, emailConfigured, sendOtpEmail } from './services/email.js';
import { mountNuad } from './nuad/routes.js';

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
const LINE_OA_ID = process.env.LINE_OA_ID || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

// ---------- โหมดทดสอบ ----------
// กรอกชื่อนี้ในหน้าสมัคร = ข้ามการตรวจช่องอื่นทั้งหมด ใบที่ได้จะถูกทำเครื่องหมายว่าเป็นใบทดสอบ
const TEST_NAME = process.env.TEST_REG_NAME || 'Bell2355';
const isTestName = (name) => String(name || '').trim().toLowerCase() === TEST_NAME.toLowerCase();

// ค่าเริ่มต้นที่เติมให้ใบทดสอบ เพื่อให้ข้อมูลครบเหมือนใบจริง
const TEST_DEFAULTS = {
  phone: '0900000000',
  province: 'กรุงเทพมหานคร',
  source: 'ทดสอบระบบ',
  nickname: 'เทสต์',
  lineId: 'ทดสอบระบบ',
  age: '30',
  emergencyName: 'ผู้ติดต่อทดสอบ',
  emergencyPhone: '0900000000',
  emergencyRelation: 'ทดสอบ'
};

// ลิงก์รูป QR บัตรเข้างาน (ต้องเป็น https สาธารณะ LINE ถึงจะดึงรูปได้)
function ticketQrUrl(regId, req) {
  const base = PUBLIC_BASE_URL || (req ? `${req.protocol}://${req.get('host')}` : '');
  return base ? `${base}/api/qr/${encodeURIComponent(regId)}.png` : '';
}

// ส่งข้อความ + รูป QR บัตรเข้างานในครั้งเดียว (2 ข้อความ)
// send = LINE.reply (ฟรี) หรือ LINE.pushMessage (กินโควตา)
async function sendWithTicket(send, target, regId, req, text) {
  const url = ticketQrUrl(regId, req);
  return send(target, url ? [text, LINE.imageMessage(url)] : [text]);
}
const OMISE_PUBLIC_KEY = process.env.OMISE_PUBLIC_KEY || '';

const app = express();
// เก็บ raw body ไว้ตรวจลายเซ็น LINE webhook (ระบบจองนวดใช้)
app.use(express.json({ limit: '10mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
// ---------- จองคิวนวดพี่หนึ่ง (/nuad) — โค้ดทั้งหมดอยู่ในโฟลเดอร์ nuad/ ----------
mountNuad(app, { listWorkshops: db.listWorkshops });
app.use(express.static(path.join(__dirname, 'public')));

// ---------- ปลุกเว็บ: ให้ cron ยิงที่นี่ ตอบไวที่สุด ไม่แตะฐานข้อมูล ----------
// แล้วค่อยเช็คงานตามเวลา (รายงานเข้าไลน์) เบื้องหลัง ไม่ให้ cron ต้องรอ
app.get('/healthz', (req, res) => {
  res.type('text/plain').send('ok');
  setImmediate(() => runDueJobs().catch(() => {}));
});

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

// ---------- รูป QR บัตรเข้างาน (สาธารณะ — ตัวรหัสอ้างอิงเองคือกุญแจ) ----------
app.get('/api/qr/:id.png', (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!db.getRegistration(id)) return res.status(404).end();
  try {
    const png = qrPng(id, { scale: 10, quiet: 4 });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(png);
  } catch (e) {
    console.error('QR:', e.message);
    res.status(500).end();
  }
});

// ---------- public config ----------
app.get('/api/config', (req, res) => {
  db.expireStale(); // runs on every keep-awake ping too (releases unpaid seats)
  res.json({
    paymentConfigured: paymentConfigured(),
    lineConfigured: lineConfigured(),
    emailConfigured: emailConfigured(),
    omisePublicKey: OMISE_PUBLIC_KEY,
    lineAddFriendUrl: LINE_ADD_FRIEND_URL,
    lineOaId: LINE_OA_ID,
    lineVerified: LINE.canVerify(),
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
  const b0 = req.body || {};
  // โหมดทดสอบ: กรอกแค่ชื่อ TEST_NAME ก็พอ ระบบเติมช่องที่เหลือให้เอง แล้วข้ามการตรวจทั้งหมด
  const TEST = isTestName(b0.name);
  if (TEST) {
    for (const [k, v] of Object.entries(TEST_DEFAULTS)) {
      if (!String(b0[k] || '').trim()) b0[k] = v;
    }
    b0.pdpaConsent = true;
    const need = Math.max(0, (Number(b0.people) || 1) - 1);
    const mem = Array.isArray(b0.members) ? b0.members : [];
    b0.members = Array.from({ length: need }, (_, i) =>
      (mem[i] && String(mem[i].name || '').trim()) ? mem[i] : { name: `ผู้ร่วมทดสอบ ${i + 2}`, age: '30' });
  }

  const { workshopId, roundId, name, phone, email } = b0;
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
  if (dup && !TEST) {
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
    isTest: TEST,
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
    out = db.updateRegistration(reg.id, { status: 'confirmed', paidAt: new Date().toISOString(), paidNote: 'กิจกรรมฟรี (ไม่มีค่าใช้จ่าย)' }) || reg;
    sendConfirmationEmail(out, ws, round).catch(() => {});
  }
  res.json({ registration: out, workshop: { title: ws.title, location: ws.location }, round, free: isFree });

  if (!TEST) notifyOwner(() => LINE.buildOwnerNewReg(out, ws, round));
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

  // ถ้าลูกค้าผูกไลน์ไว้แล้ว ส่งข้อความรับสลิปให้ทันที (ไม่ต้องรอแอดมิน)
  if (updated && updated.lineUserId && lineConfigured()) {
    const ws0 = db.getWorkshop(updated.workshopId);
    pushMessage(updated.lineUserId, LINE.buildSlipReceivedMessage(updated, ws0, roundOf(ws0, updated.roundId)))
      .catch((e) => console.error('LINE slip ack:', e.message));
  }
  if (updated && !updated.isTest) {
    const ws1 = db.getWorkshop(updated.workshopId);
    notifyOwner(() => LINE.buildOwnerSlip(updated, ws1, roundOf(ws1, updated.roundId)));
  }
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
  if (charge.paid) db.updateRegistration(reg.id, { status: 'paid', paidAt: new Date().toISOString() });
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
  const reg = db.updateRegistration(req.params.id, { status: 'paid', paidAt: new Date().toISOString() });
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

  const target = reg.lineUserId || '';
  const result = target
    ? await sendWithTicket(pushMessage, target, reg.id, req, message)
    : { sent: false, demo: true };
  db.updateRegistration(reg.id, {
    status: 'confirmed',
    paidAt: new Date().toISOString(),
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
  // ส่ง { undo: true } มา = ย้อนการเช็คอินของวันนั้น (เผลอกดหรือสแกนผิดคน)
  const undo = Boolean(req.body && req.body.undo);
  if (undo) days = days.filter((d) => d !== target.id);
  else if (!already) days.push(target.id);
  const updated = db.updateRegistration(reg.id, { attendedDays: days, attended: days.length > 0 });
  res.json({
    ok: true,
    undone: undo,
    already: undo ? false : already,
    name: updated.name,
    dayLabel: `${target.date} ${target.time}`,
    workshopTitle: ws ? ws.title : ''
  });
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

// ---------- LINE webhook ของ OA บ้าน-บ้าน สุขพอดี ----------
// ลูกค้าส่ง "รหัสอ้างอิง" (reg_xxxx) เข้ามาในแชท -> ผูก userId เข้ากับใบสมัคร
// แล้วระบบจะ push ใบยืนยันมาที่แชทนี้ได้ตอนแอดมินกดยืนยัน
async function handleLineEvent(ev, req) {
  const userId = ev.source && ev.source.userId;
  if (!userId) return;

  if (ev.type === 'follow') {
    return LINE.reply(ev.replyToken, LINE.buildWelcomeMessage());
  }
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;

  const text = String(ev.message.text || '');

  // แอดมินผูกบัญชีตัวเองเพื่อรับรายงาน: พิมพ์  ผูกแอดมิน <รหัสลับ>
  const OWNER_CODE = process.env.BB_OWNER_CODE || '';
  const om = text.match(/^\s*ผูกแอดมิน\s+(\S+)\s*$/);
  if (om) {
    if (!OWNER_CODE || om[1] !== OWNER_CODE) return;   // รหัสผิด = เงียบ ไม่บอกใบ้
    db.saveSettings({ ownerUserId: userId });
    return LINE.reply(ev.replyToken, LINE.buildOwnerLinkedMessage());
  }

  const m = text.match(/reg_[a-z0-9]+/i);
  if (!m) return; // ข้อความอื่น ๆ ปล่อยให้แอดมินตอบเองในแอป LINE OA

  const id = m[0].toLowerCase();
  const reg = db.getRegistration(id);
  if (!reg) return LINE.reply(ev.replyToken, LINE.buildNotFoundMessage());

  const linked = db.updateRegistration(reg.id, { lineUserId: userId }) || reg;
  const ws = db.getWorkshop(linked.workshopId);
  const round = roundOf(ws, linked.roundId);
  // reply ไม่กินโควตา จึงส่งบัตร QR ให้เลยตั้งแต่ตอนผูกบัญชี
  return sendWithTicket(LINE.reply, ev.replyToken, linked.id, req, LINE.buildLinkedMessage(linked, ws, round));
}

app.post('/api/line/webhook', (req, res) => {
  res.status(200).end(); // ตอบ LINE ให้ไวที่สุด แล้วค่อยทำงานต่อเบื้องหลัง
  // ถ้าตั้ง LINE_CHANNEL_SECRET ไว้ ต้องผ่านการตรวจลายเซ็นก่อนเสมอ
  if (LINE.canVerify() && !LINE.verify(req.rawBody, req.get('x-line-signature'))) {
    console.warn('LINE webhook: ลายเซ็นไม่ถูกต้อง — ข้ามคำขอนี้');
    return;
  }
  if (!LINE.canVerify()) {
    console.warn('LINE webhook: ยังไม่ได้ตั้ง LINE_CHANNEL_SECRET — ยังไม่ได้ตรวจลายเซ็น');
  }
  const events = (req.body && req.body.events) || [];
  for (const ev of events) {
    handleLineEvent(ev, req).catch((e) => console.error('LINE webhook:', e.message));
  }
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

// ---------- admin: รายงานเข้าไลน์ ----------
app.get('/api/admin/report-settings', requireAdmin, (req, res) => {
  const s = db.getSettings();
  res.json({
    dailyReportOn: s.dailyReportOn !== false,
    notifyOwnerOn: s.notifyOwnerOn !== false,
    reportHour: Number.isFinite(Number(s.reportHour)) ? Number(s.reportHour) : 20,
    ownerLinked: !!s.ownerUserId,
    ownerCodeSet: !!process.env.BB_OWNER_CODE,
    lineReady: lineConfigured(),
    lastReportDate: s.lastReportDate || null
  });
});
app.post('/api/admin/report-settings', requireAdmin, (req, res) => {
  const b = req.body || {}, patch = {};
  if (typeof b.dailyReportOn === 'boolean') patch.dailyReportOn = b.dailyReportOn;
  if (typeof b.notifyOwnerOn === 'boolean') patch.notifyOwnerOn = b.notifyOwnerOn;
  if (b.reportHour != null) patch.reportHour = Math.min(23, Math.max(0, Number(b.reportHour) || 20));
  if (b.unlinkOwner === true) patch.ownerUserId = '';
  db.saveSettings(patch);
  res.json({ ok: true });
});
// ส่งรายงานทดสอบทันที
app.post('/api/admin/report-now', requireAdmin, async (req, res) => {
  const s = db.getSettings();
  if (!s.ownerUserId) return res.status(400).json({ error: 'ยังไม่ได้ผูกบัญชีไลน์แอดมิน' });
  const ok = await LINE.pushMessage(s.ownerUserId, LINE.buildDailyReport(todayReport()));
  res.json({ ok });
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

// ================= CLASSROOM (ห้องเรียน) — เข้าด้วยเบอร์โทรที่ลงทะเบียนไว้ [1] =================
const CLASSROOM_SECRET = process.env.CLASSROOM_SECRET || process.env.ADMIN_PASSWORD || 'bookly-classroom-secret';
const _clsHits = new Map();  // ip -> [timestamps] (กันสุ่มเบอร์)

function clsEligibleReg(phone) {
  const p = String(phone || '').replace(/\D/g, '');
  if (p.length < 8) return null;
  return db.listRegistrations().find((r) =>
    String(r.phone || '').replace(/\D/g, '') === p && ['paid', 'confirmed'].includes(r.status)) || null;
}
function clsSignToken(phone) {
  const payload = Buffer.from(JSON.stringify({ p: String(phone).replace(/\D/g, ''), x: Date.now() + 30 * 24 * 3600 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', CLASSROOM_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function clsVerifyToken(tok) {
  if (!tok || tok.indexOf('.') < 0) return null;
  const [payload, sig] = tok.split('.');
  const expect = crypto.createHmac('sha256', CLASSROOM_SECRET).update(payload).digest('base64url');
  if (sig !== expect) return null;
  try { const p = JSON.parse(Buffer.from(payload, 'base64url').toString()); return (Date.now() > p.x) ? null : p.p; } catch { return null; }
}
function readCookie(req, name) {
  const h = req.headers.cookie || '';
  const hit = h.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}
const clsIsHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';
// middleware ใช้ในขั้น [2] — ปฏิเสธถ้าไม่มี token ที่ถูกต้อง
function requireClassroom(req, res, next) {
  const phone = clsVerifyToken(readCookie(req, 'cls'));
  if (!phone) return res.status(401).json({ error: 'unauthorized' });
  req.classroomPhone = phone;
  next();
}

app.get('/classroom', (req, res) => res.sendFile(path.join(__dirname, 'public', 'classroom.html')));

// สถานะล็อกอิน (สำหรับกรณีเปิดเบราว์เซอร์ใหม่ — cookie ยังใช้ได้ไหม)
app.get('/api/classroom/me', (req, res) => {
  const phone = clsVerifyToken(readCookie(req, 'cls'));
  res.json({ loggedIn: !!phone });
});

// เข้าห้องเรียนด้วยเบอร์โทรที่ลงทะเบียน+ยืนยันการชำระเงินแล้ว (ไม่ต้องใช้อีเมล/รหัส)
app.post('/api/classroom/login', (req, res) => {
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  const now = Date.now();
  const arr = (_clsHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  arr.push(now); _clsHits.set(ip, arr);
  if (arr.length > 20) return res.status(429).json({ error: 'พยายามเข้าถี่เกินไป กรุณารอสักครู่แล้วลองใหม่ค่ะ' });
  const phone = String(req.body && req.body.phone || '').replace(/\D/g, '');
  if (phone.length < 8) return res.status(400).json({ error: 'กรุณากรอกเบอร์โทรให้ถูกต้อง' });
  const reg = clsEligibleReg(phone);
  if (!reg) return res.status(404).json({ error: 'ไม่พบข้อมูลการสมัครที่ยืนยันการชำระเงินด้วยเบอร์นี้ กรุณาตรวจเบอร์อีกครั้ง หรือทักผู้จัดทาง LINE' });
  res.cookie('cls', clsSignToken(phone), { httpOnly: true, sameSite: 'lax', secure: clsIsHttps(req), maxAge: 30 * 24 * 3600 * 1000, path: '/' });
  res.json({ ok: true, name: reg.name });
});

app.post('/api/classroom/logout', (req, res) => { res.clearCookie('cls', { path: '/' }); res.json({ ok: true }); });

// ---------- CLASSROOM [2]: เนื้อหา/ไฟล์จากโฟลเดอร์ materials/ (นอก public/ — ต้องล็อกอินเท่านั้น) ----------
const MATERIALS_DIR = path.join(__dirname, 'materials');
function listMaterials() {
  let files = [];
  try { files = fs.readdirSync(MATERIALS_DIR); } catch { files = []; }
  return files.filter((f) => /\.(md|zip)$/i.test(f)).map((f) => {
    const ext = f.split('.').pop().toLowerCase();
    const base = f.replace(/\.(md|zip)$/i, '');
    const m = base.match(/^(\d+)\s*[-–·]?\s*(.*)$/);
    const num = (m && m[1]) ? m[1] : '';
    let title = (m ? m[2] : base).replace(/-/g, ' ').trim() || base;
    return { file: f, title, num, type: ext };
  }).sort((a, b) => {
    const na = a.num === '' ? 999 : parseInt(a.num, 10);
    const nb = b.num === '' ? 999 : parseInt(b.num, 10);
    return na - nb || a.file.localeCompare(b.file);
  });
}
// อนุญาตเฉพาะไฟล์ที่อยู่ในรายการจริง (กัน path traversal เด็ดขาด)
function safeMaterial(name, ext) {
  const item = listMaterials().find((x) => x.file === name && x.type === ext);
  return item ? path.join(MATERIALS_DIR, name) : null;
}

app.get('/api/classroom/materials', requireClassroom, (req, res) => {
  res.json({ items: listMaterials() });
});
app.get('/api/classroom/read', requireClassroom, (req, res) => {
  const p = safeMaterial(String(req.query.file || ''), 'md');
  if (!p) return res.status(404).json({ error: 'ไม่พบไฟล์' });
  try { res.json({ content: fs.readFileSync(p, 'utf-8') }); } catch { res.status(500).json({ error: 'อ่านไฟล์ไม่สำเร็จ' }); }
});
app.get('/classroom/download', requireClassroom, (req, res) => {
  const name = String(req.query.file || '');
  const p = safeMaterial(name, 'zip');
  if (!p) return res.status(404).send('ไม่พบไฟล์');
  res.download(p, name);
});

// SPA-ish routes
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/workshop', (req, res) => res.sendFile(path.join(__dirname, 'public', 'workshop.html')));
app.get('/my', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pricing.html')));

// ---------- แจ้งเตือนแอดมินทางไลน์ ----------
function notifyOwner(build) {
  try {
    const s = db.getSettings();
    if (s.notifyOwnerOn === false || !s.ownerUserId || !lineConfigured()) return;
    LINE.pushMessage(s.ownerUserId, build()).catch((e) => console.error('แจ้งเตือนแอดมิน:', e.message));
  } catch (e) { console.error('แจ้งเตือนแอดมิน:', e.message); }
}

// ---------- รายงานสรุปรายวัน ----------
const bkkNow = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) % 24 };
};
const bkkDateOf = (iso) => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); }
  catch { return ''; }
};

function todayReport() {
  db.expireStale();
  const { date } = bkkNow();
  const regs = db.listRegistrations().filter((r) => !r.isTest && r.status !== 'expired');
  const todays = regs.filter((r) => bkkDateOf(r.createdAt) === date);
  const paidToday = regs.filter((r) => (r.status === 'paid' || r.status === 'confirmed') && bkkDateOf(r.paidAt || r.confirmedAt || r.createdAt) === date);
  const upcoming = [];
  for (const w of db.listWorkshops({ onlyActive: true })) {
    for (const r of (w.rounds || [])) {
      if (String(r.date) < date) continue;
      const taken = db.seatsTaken(w.id, r.id);
      const cap = Number(r.seats || 0);
      upcoming.push({ title: w.title, date: r.date, time: r.time || '', left: cap ? Math.max(0, cap - taken) : null });
    }
  }
  upcoming.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return {
    date,
    newRegs: todays.length,
    people: todays.reduce((n, r) => n + (Number(r.people) || 1), 0),
    revenue: paidToday.reduce((n, r) => n + (Number(r.amount) || 0), 0),
    pending: regs.filter((r) => r.status === 'pending_payment').length,
    awaiting: regs.filter((r) => r.status === 'awaiting_verification').length,
    confirmed: regs.filter((r) => r.status === 'confirmed').length,
    upcoming: upcoming.slice(0, 3)
  };
}

// เว็บบน Render ฟรีหลับได้ จึงไม่ยึดนาทีเป๊ะ ๆ — ตื่นเมื่อไหร่หลังเวลาที่ตั้ง ถ้ายังไม่ส่งของวันนี้ก็ส่งเลย
let _jobRunning = false;
async function runDueJobs() {
  if (_jobRunning) return;
  _jobRunning = true;
  try {
    const s = db.getSettings();
    if (s.dailyReportOn === false || !s.ownerUserId || !lineConfigured()) return;
    const { date, hour } = bkkNow();
    const at = Number.isFinite(Number(s.reportHour)) ? Number(s.reportHour) : 20;
    if (hour < at || s.lastReportDate === date) return;
    db.saveSettings({ lastReportDate: date });          // กันส่งซ้ำก่อน แล้วค่อยส่ง
    await LINE.pushMessage(s.ownerUserId, LINE.buildDailyReport(todayReport()));
    console.log('ส่งรายงานประจำวันเข้าไลน์แล้ว ' + date);
  } catch (e) {
    console.error('รายงานประจำวัน:', e.message);
  } finally {
    _jobRunning = false;
  }
}
setInterval(() => { runDueJobs().catch(() => {}); }, 60e3);

db.init()
  .catch((e) => console.error('DB init error:', e.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`\n🌿 BARNBARN Workshop running:`);
      console.log(`   หน้าผู้สมัคร (public):  http://localhost:${PORT}`);
      console.log(`   หน้าผู้ดูแล (admin):    http://localhost:${PORT}/admin`);
      console.log(`   LINE OA push:    ${lineConfigured() ? 'ready ✓' : 'manual mode (no token)'}`);
      console.log(`   LINE webhook:    ${LINE.canVerify() ? 'signature verified ✓' : 'no LINE_CHANNEL_SECRET (unverified)'}`);
      console.log(`   ปลุกเว็บ (cron):  /healthz`);
      runDueJobs().catch(() => {});
    });
  });
