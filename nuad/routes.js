// nuad/routes.js — ระบบจองคิวนวดพี่หนึ่ง ภายในเว็บ BARNBARN
// หน้าลูกค้า /nuad (บัตรคิวหน้าร้าน /nuad?walk=1) · หน้าพี่หนึ่ง /nuad/admin
// LINE OA ของพี่หนึ่งแยกต่างหาก (webhook: /api/nuad/line/webhook) · หน้าเว็บชวนลูกค้าไปดูกิจกรรม/แอด LINE BARNBARN
import path from 'path';
import { fileURLToPath } from 'url';
import * as store from './store.js';
import * as L from './logic.js';
import * as line from './line.js';
import { TEMPLATES, REPLY, OWNER } from '../public/nuad/messages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES = path.join(__dirname, '..', 'public', 'nuad');
const env = (k) => process.env[k] || '';
const S = () => ({ ...store.data().settings, siteUrl: env('PUBLIC_BASE_URL').replace(/\/$/, '') });
const notifyOwner = (text) => { const s = store.data().settings; return s.notifyOwner && s.ownerUserId ? line.push(s.ownerUserId, text) : Promise.resolve(false); };

// ---------------------------------------------------------------- LINE webhook ของ OA พี่หนึ่ง
async function handleLineWebhook(req) {
  if (!store.data()) return;
  // ต้องตรวจลายเซ็นก่อนเสมอ กันคนปลอมข้อความมาผูกคิวคนอื่น
  if (!line.verify(req.rawBody, req.get('x-line-signature'))) return;
  for (const ev of req.body?.events || []) await handleEvent(ev).catch((e) => console.error('จองนวด webhook:', e.message));
}

async function handleEvent(ev) {
  const uid = ev.source?.userId;
  if (!uid || ev.type !== 'message') return;
  const d = store.data(), s = S(), m = ev.message;
  L.expireHolds();

  if (m.type === 'text') {
    const txt = m.text.trim(); let r;
    if ((r = /^ผูกหมอนวด\s+(\S+)/.exec(txt))) {
      if (!env('NUAD_OWNER_CODE') || r[1] !== env('NUAD_OWNER_CODE')) return;
      d.settings.ownerUserId = uid; store.save();
      return line.reply(ev.replyToken, `ตั้งบัญชีนี้เป็นของ${s.name}แล้วค่ะ จะแจ้งนัดใหม่และสลิปใหม่ที่นี่`);
    }
    if ((r = /นัดนวด\s*([A-Z0-9]{5})\b/i.exec(txt))) {
      const b = d.bookings.find((x) => x.id === r[1].toUpperCase());
      if (!b) return line.reply(ev.replyToken, REPLY.notFound());
      b.lineUserId = uid; store.save();
      return line.reply(ev.replyToken, REPLY.linkBooking(s, b));
    }
    if ((r = /บัตรคิวนวด\s*(\d+)/.exec(txt))) {
      const q = L.todayQueue().find((x) => x.no === Number(r[1]));
      if (!q) return line.reply(ev.replyToken, REPLY.notFound());
      q.lineUserId = uid; store.save();
      return line.reply(ev.replyToken, REPLY.linkQueue(s, q, L.ticketInfo(q).ahead));
    }
    return; // ข้อความอื่น พี่หนึ่งตอบเองในแอป LINE OA
  }

  if (m.type === 'image') {
    // รูปจากคนที่มีนัดนวดค้างจ่าย = สลิปนวด
    const b = d.bookings.filter((x) => x.lineUserId === uid && ['hold', 'expired'].includes(x.status) && Date.now() - x.createdAt < 2 * 864e5)
      .sort((a, z) => z.createdAt - a.createdAt)[0];
    if (b) {
      if (b.status === 'expired' && !L.isFree(b.date, b.time, b.id)) {
        await line.reply(ev.replyToken, REPLY.slipLate(s, b));
        return notifyOwner(OWNER.slip(b) + ' (หมดเวลากันคิว และมีคนจองเวลานี้แทนแล้ว)');
      }
      b.status = 'slip'; b.slipAt = Date.now(); store.save();
      await line.reply(ev.replyToken, REPLY.slip(s, b));
      return notifyOwner(OWNER.slip(b));
    }
    const q = L.todayQueue().filter((x) => x.lineUserId === uid && !x.paid && !x.slipAt).pop();
    if (q) {
      q.slipAt = Date.now(); store.save();
      await line.reply(ev.replyToken, REPLY.slip(s, q));
      return notifyOwner(OWNER.slip(q));
    }
  }
}

// ---------------------------------------------------------------- ติดตั้งเข้า app
export function mountNuad(app, { listWorkshops } = {}) {
  const ready = store.init();
  app.use('/api/nuad', (req, res, next) => ready.then(() => next(), next));
  app.post('/api/nuad/line/webhook', (req, res) => {
    res.status(200).end();
    handleLineWebhook(req).catch((e) => console.error('จองนวด webhook:', e.message));
  });

  async function tick() {
    L.expireHolds();
    const s = S(), n = L.nowBKK();
    if (s.autoRemind && line.enabled() && n.min >= 18 * 60) {
      const tomorrow = L.addDays(n.date, 1);
      for (const b of store.data().bookings) {
        if (b.date === tomorrow && ['paid', 'slip'].includes(b.status) && b.lineUserId && !b.remindedAt) {
          b.remindedAt = Date.now(); store.save();
          await line.push(b.lineUserId, TEMPLATES.remind.text(s, b));
        }
      }
    }
  }
  setInterval(() => tick().catch(() => {}), 60_000);

  // ---------- หน้าเว็บ
  app.get('/nuad', (req, res) => res.sendFile(path.join(PAGES, 'index.html')));
  app.get('/nuad/admin', (req, res) => res.sendFile(path.join(PAGES, 'admin.html')));

  // ---------- public API
  const lineInfo = () => ({ on: line.enabled() && line.canVerify(), oaId: env('NUAD_LINE_OA_ID'), addFriend: env('NUAD_LINE_ADD_FRIEND_URL'), bbFriend: env('LINE_ADD_FRIEND_URL') });
  app.get('/api/nuad/public', (req, res) => {
    L.expireHolds();
    const s = S(), n = L.nowBKK();
    const days = Array.from({ length: 14 }, (_, i) => { const date = L.addDays(n.date, i); return { date, wd: L.weekday(date), closed: s.closedDays.includes(L.weekday(date)) }; });
    const q = L.todayQueue(), sv = q.find((x) => x.status === 'serving');
    res.json({
      settings: { shopName: s.shopName, name: s.name, place: s.place, pp: s.pp, open: s.open, close: s.close, breakStart: s.breakStart, breakEnd: s.breakEnd, closedDays: s.closedDays, slotMin: L.slotLen(), holdMin: s.holdMin },
      line: lineInfo(), today: n.date, days,
      live: { serving: sv ? sv.no : null, waiting: q.filter((x) => x.status === 'waiting').length, open: !s.closedDays.includes(L.weekday(n.date)) && n.min >= L.toMin(s.open) - 60 && n.min < L.toMin(s.close) },
    });
  });

  // กิจกรรม BARNBARN ที่กำลังจะมา (โชว์ระหว่างรอคิว)
  app.get('/api/nuad/barnbarn', (req, res) => {
    try {
      const today = L.nowBKK().date, out = [];
      for (const w of (listWorkshops ? listWorkshops({ onlyActive: true }) : [])) {
        const r = (w.rounds || []).filter((x) => String(x.date) >= today).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
        if (r) out.push({ id: w.id, title: w.title, date: r.date, time: r.time, price: r.price });
      }
      res.json(out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3));
    } catch { res.json([]); }
  });

  app.get('/api/nuad/slots', (req, res) => {
    L.expireHolds();
    const date = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'วันที่ไม่ถูกต้อง' });
    res.json(L.slots(date));
  });

  const pub = (b) => ({ id: b.id, date: b.date, time: b.time, status: b.status, holdUntil: b.holdUntil, linked: !!b.lineUserId });
  const recent = new Map(); // กันกดรัว: เบอร์เดียวจองค้างจ่ายได้ทีละ 1 นัด
  app.post('/api/nuad/bookings', (req, res) => {
    L.expireHolds();
    const { date, time, name, phone, consent } = req.body || {};
    const t = Number(time), nm = String(name || '').trim().slice(0, 40), ph = String(phone || '').replace(/[^\d]/g, '').slice(0, 12);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(t)) return res.status(400).json({ error: 'เลือกวันและเวลาก่อนนะคะ' });
    if (!nm || ph.length < 9) return res.status(400).json({ error: 'กรอกชื่อและเบอร์โทรให้ครบก่อนนะคะ' });
    if (!consent) return res.status(400).json({ error: 'ติ๊กช่องยินยอมก่อนกดยืนยันค่ะ' });
    const pending = store.data().bookings.find((b) => b.phone === ph && b.status === 'hold');
    if (pending) return res.status(409).json({ error: `เบอร์นี้มีนัดรอโอนอยู่ (รหัส ${pending.id}) โอนหรือรอหมดเวลาก่อนนะคะ`, booking: pub(pending) });
    const n = L.nowBKK();
    if (date < n.date || !L.slots(date).some((x) => x.t === t && x.ok)) return res.status(409).json({ error: 'เวลานี้ไม่ว่างแล้ว เลือกเวลาอื่นนะคะ' });
    const b = { id: L.newCode(), date, time: t, len: L.slotLen(), name: nm, phone: ph, status: 'hold',
      holdUntil: Date.now() + (Number(S().holdMin) || 15) * 60e3, createdAt: Date.now() };
    store.data().bookings.push(b); store.save();
    notifyOwner(OWNER.booking(b));
    res.json(pub(b));
  });

  app.get('/api/nuad/bookings/:id', (req, res) => {
    L.expireHolds();
    const b = store.data().bookings.find((x) => x.id === String(req.params.id).toUpperCase());
    if (!b) return res.status(404).json({ error: 'ไม่พบนัดนี้' });
    res.json(pub(b));
  });

  // ค้นนัดของฉันด้วยเบอร์
  app.post('/api/nuad/my', (req, res) => {
    L.expireHolds();
    const ph = String(req.body?.phone || '').replace(/\D/g, '');
    if (ph.length < 9) return res.status(400).json({ error: 'ใส่เบอร์โทรให้ครบนะคะ' });
    const today = L.nowBKK().date;
    res.json(store.data().bookings.filter((b) => b.phone === ph && b.date >= today && ['hold', 'slip', 'paid'].includes(b.status))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map(pub));
  });

  // ปุ่ม "ส่งสลิปแล้ว" (กรณีไม่ได้ต่อ LINE OA)
  app.post('/api/nuad/bookings/:id/slip', (req, res) => {
    L.expireHolds();
    const b = store.data().bookings.find((x) => x.id === String(req.params.id).toUpperCase());
    if (!b) return res.status(404).json({ error: 'ไม่พบนัดนี้' });
    if (b.status === 'hold') { b.status = 'slip'; b.slipAt = Date.now(); store.save(); notifyOwner(OWNER.slip(b)); }
    res.json(pub(b));
  });

  app.post('/api/nuad/queue', (req, res) => {
    const nm = String(req.body?.name || '').trim().slice(0, 40);
    if (!nm) return res.status(400).json({ error: 'ใส่ชื่อที่ให้เรียกด้วยนะคะ' });
    const n = L.nowBKK(), list = L.todayQueue();
    if (list.filter((x) => x.status === 'waiting').length >= 30) return res.status(409).json({ error: 'คิววันนี้เต็มแล้วค่ะ' });
    const q = { no: list.reduce((m, x) => Math.max(m, x.no), 0) + 1, date: n.date, name: nm, status: 'waiting',
      order: list.reduce((m, x) => Math.max(m, x.order), 0) + 1, createdAt: Date.now() };
    store.data().queue.push(q); store.save();
    res.json(L.ticketInfo(q));
  });

  app.get('/api/nuad/queue/:no', (req, res) => {
    const q = L.todayQueue().find((x) => x.no === Number(req.params.no));
    if (!q) return res.status(404).json({ error: 'ไม่พบบัตรคิวนี้ของวันนี้' });
    res.json(L.ticketInfo(q));
  });

  // ---------- หน้าพี่หนึ่ง (รหัสแยกจากหลังบ้าน BARNBARN)
  const adminPass = () => env('NUAD_ADMIN_PASSWORD');
  function requireNuad(req, res, next) {
    if (!adminPass()) return res.status(500).json({ error: 'ยังไม่ได้ตั้ง NUAD_ADMIN_PASSWORD' });
    if ((req.get('x-nuad-password') || '') !== adminPass()) return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
    next();
  }
  app.post('/api/nuad/admin/login', (req, res) => {
    if (!adminPass()) return res.status(500).json({ error: 'ยังไม่ได้ตั้ง NUAD_ADMIN_PASSWORD' });
    if ((req.body?.password || '') !== adminPass()) return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
    res.json({ ok: true });
  });

  function target(key) {
    const [k, v] = String(key || '').split(':');
    if (k === 'q') { const q = L.todayQueue().find((x) => x.no === Number(v)); return q && { kind: 'q', rec: q }; }
    if (k === 'b') { const b = store.data().bookings.find((x) => x.id === v); return b && { kind: b.date === L.nowBKK().date ? 'b' : 'bt', rec: b }; }
    return null;
  }
  async function sendTemplate(key, kind) {
    const t = target(key), tpl = TEMPLATES[kind];
    if (!t || !tpl) return { key, kind, ok: false };
    const text = tpl.text(S(), t.rec);
    const sent = t.rec.lineUserId ? await line.push(t.rec.lineUserId, text) : false;
    return { key, kind, name: t.rec.name, sent, text };
  }

  app.get('/api/nuad/admin/today', requireNuad, (req, res) => {
    L.expireHolds();
    const n = L.nowBKK(), tomorrow = L.addDays(n.date, 1), est = L.estimate(), d = store.data();
    const strip = (x) => { const { lineUserId, ...r } = x; return { ...r, linked: !!lineUserId }; };
    const { ownerUserId, ...settings } = S();
    res.json({
      now: n, settings: { ...settings, slotMin: L.slotLen(), ownerLinked: !!ownerUserId },
      line: { ...lineInfo(), ownerCodeSet: !!env('NUAD_OWNER_CODE') }, storage: store.storageMode(),
      today: d.bookings.filter((b) => b.date === n.date).sort((a, b) => a.time - b.time).map(strip),
      tomorrow: d.bookings.filter((b) => b.date === tomorrow && !['expired', 'noshow', 'cancelled'].includes(b.status)).sort((a, b) => a.time - b.time).map(strip),
      upcoming: d.bookings.filter((b) => b.date > tomorrow && ['hold', 'slip', 'paid'].includes(b.status)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 40).map(strip),
      queue: L.todayQueue().map((q) => ({ ...strip(q), est: est[q.no] ?? null })),
    });
  });

  app.post('/api/nuad/admin/call-next', requireNuad, async (req, res) => {
    const list = L.todayQueue(), n = L.nowBKK(), results = [];
    const sv = list.find((x) => x.status === 'serving');
    if (sv) { sv.status = 'done'; sv.doneAt = Date.now(); }
    const waiting = list.filter((x) => x.status === 'waiting');
    if (waiting[0]) { waiting[0].status = 'serving'; waiting[0].startedMin = n.min; }
    store.save();
    if (waiting[0]) results.push(await sendTemplate('q:' + waiting[0].no, 'turn'));
    if (waiting[1]) results.push(await sendTemplate('q:' + waiting[1].no, 'next'));
    res.json({ results });
  });

  app.post('/api/nuad/admin/queue/:no/:action', requireNuad, async (req, res) => {
    const q = L.todayQueue().find((x) => x.no === Number(req.params.no));
    if (!q) return res.status(404).json({ error: 'ไม่พบบัตรคิว' });
    const a = req.params.action, results = [];
    if (a === 'done') { q.status = 'done'; q.doneAt = Date.now(); }
    else if (a === 'noshow') q.status = 'noshow';
    else if (a === 'back') q.status = 'waiting';
    else if (a === 'skip') q.order = L.todayQueue().reduce((m, x) => Math.max(m, x.order), 0) + 1;
    else if (a === 'paid') q.paid = true;
    else return res.status(400).json({ error: 'คำสั่งไม่ถูกต้อง' });
    store.save();
    if (a === 'paid') results.push(await sendTemplate('q:' + q.no, 'paid'));
    res.json({ results });
  });

  app.post('/api/nuad/admin/bookings/:id/:action', requireNuad, async (req, res) => {
    const b = store.data().bookings.find((x) => x.id === req.params.id);
    if (!b) return res.status(404).json({ error: 'ไม่พบนัด' });
    const a = req.params.action, results = [];
    if (a === 'paid') {
      if (b.status === 'expired' && !L.isFree(b.date, b.time, b.id)) return res.status(409).json({ error: 'เวลานี้มีคนจองแทนแล้ว ต้องนัดเวลาใหม่กับลูกค้าในแชท' });
      b.status = 'paid'; b.paidAt = Date.now(); store.save();
      results.push(await sendTemplate('b:' + b.id, 'paid'));
    } else if (['done', 'noshow', 'cancelled'].includes(a)) { b.status = a; store.save(); }
    else return res.status(400).json({ error: 'คำสั่งไม่ถูกต้อง' });
    res.json({ results });
  });

  app.post('/api/nuad/admin/send', requireNuad, async (req, res) => {
    res.json({ results: [await sendTemplate(req.body?.target, req.body?.kind)] });
  });

  const TIME = /^\d{2}:\d{2}$/;
  app.put('/api/nuad/admin/settings', requireNuad, (req, res) => {
    const p = req.body || {}, s = store.data().settings;
    for (const k of ['shopName', 'name', 'place', 'pp']) if (typeof p[k] === 'string') s[k] = p[k].trim().slice(0, 60);
    for (const k of ['open', 'close', 'breakStart', 'breakEnd']) if (typeof p[k] === 'string' && (p[k] === '' || TIME.test(p[k]))) s[k] = p[k];
    if (Array.isArray(p.closedDays)) s.closedDays = p.closedDays.map(Number).filter((x) => x >= 0 && x <= 6);
    if (p.slotMin != null) s.slotMin = Math.min(240, Math.max(15, Number(p.slotMin) || 60));
    if (p.holdMin != null) s.holdMin = Math.min(180, Math.max(5, Number(p.holdMin) || 15));
    for (const k of ['notifyOwner', 'autoRemind']) if (typeof p[k] === 'boolean') s[k] = p[k];
    store.save();
    res.json({ ok: true });
  });

  console.log('   จองนวดพี่หนึ่ง:   /nuad  ·  /nuad/admin' + (line.enabled() && line.canVerify() ? '  (LINE อัตโนมัติ ✓)' : '  (LINE แบบกดส่งเอง — ตั้ง NUAD_LINE_* เพื่อเปิดอัตโนมัติ)'));
}
