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
import { sendConfirmationEmail, emailConfigured } from './services/email.js';

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
app.get('/api/my-registrations', (req, res) => {
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const q = digits(req.query.phone);
  if (q.length < 8) return res.status(400).json({ error: 'กรุณากรอกเบอร์โทรให้ถูกต้อง (อย่างน้อย 8 หลัก)' });
  const matched = db.listRegistrations().filter((r) => digits(r.phone) === q);
  const out = matched.map((r) => {
    const ws = db.getWorkshop(r.workshopId);
    const round = ws && ws.rounds.find((x) => x.id === r.roundId);
    return {
      id: r.id,
      name: r.name,
      workshopTitle: ws ? ws.title : '(เวิร์กช็อปถูกลบแล้ว)',
      location: ws ? ws.location : '',
      round: round ? { date: round.date, time: round.time } : null,
      people: r.people,
      addons: r.addons || [],
      amount: r.amount,
      status: r.status,
      createdAt: r.createdAt
    };
  });
  res.json({ count: out.length, registrations: out });
});

// ---------- public: workshops ----------
app.get('/api/workshops', (req, res) => {
  res.json(db.listWorkshops({ onlyActive: true }).map(publicWorkshop));
});

app.get('/api/workshops/:id', (req, res) => {
  const ws = db.getWorkshop(req.params.id);
  if (!ws || !ws.active) return res.status(404).json({ error: 'not found' });
  res.json(publicWorkshop(ws));
});

// ---------- public: register ----------
app.post('/api/register', (req, res) => {
  const { workshopId, roundId, name, phone, email } = req.body || {};
  if (!workshopId || !roundId || !name || !phone) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อ เบอร์โทร และเลือกรอบให้ครบถ้วน' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return res.status(400).json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' });
  }
  if (!email && !String(req.body.lineId || '').trim()) {
    return res.status(400).json({ error: 'กรุณากรอกอีเมล หรือ LINE ID อย่างน้อย 1 ช่อง (เพื่อรับการยืนยันการสมัคร)' });
  }
  const ws = db.getWorkshop(workshopId);
  const round = roundOf(ws, roundId);
  if (!ws || !round) return res.status(404).json({ error: 'ไม่พบเวิร์กช็อปหรือรอบที่เลือก' });

  db.expireStale();
  const people = Number(req.body.people) || 1;
  const remaining = round.seats - db.seatsTaken(workshopId, roundId);
  if (people > remaining) {
    return res.status(400).json({ error: `ที่นั่งเหลือ ${remaining} ที่ ไม่พอสำหรับ ${people} ท่าน` });
  }

  // validate selected add-ons against the workshop's defined add-ons (prevent tampering)
  const addonIds = Array.isArray(req.body.addonIds) ? req.body.addonIds : [];
  const selectedAddons = (ws.addons || []).filter((a) => addonIds.includes(a.id));
  const addonsTotal = selectedAddons.reduce((s, a) => s + (Number(a.price) || 0), 0);

  const reg = db.createRegistration({
    workshopId,
    roundId,
    name,
    phone,
    email: req.body.email,
    lineId: req.body.lineId,
    people,
    allergy: req.body.allergy,
    medical: req.body.medical,
    addons: selectedAddons.map((a) => ({ name: a.name, price: a.price })),
    note: req.body.note,
    amount: round.price * people + addonsTotal
  });
  res.json({ registration: reg, workshop: { title: ws.title, location: ws.location }, round });
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
    return { ...r, workshopTitle: ws ? ws.title : '(ลบแล้ว)', round };
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

// admin toggles attendance (check-in on event day)
app.post('/api/admin/registrations/:id/attend', requireAdmin, (req, res) => {
  const reg = db.getRegistration(req.params.id);
  if (!reg) return res.status(404).json({ error: 'not found' });
  const updated = db.updateRegistration(reg.id, { attended: !reg.attended });
  res.json(updated);
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
    allergy: b.allergy ?? reg.allergy,
    medical: b.medical ?? reg.medical,
    note: b.note ?? reg.note,
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
