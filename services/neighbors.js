// services/neighbors.js — "เพื่อนบ้าน บ้าน-บ้าน" (Barnbarn's Neighbors)
// กิจกรรมที่เพื่อนบ้านฝากประกาศผ่านไลน์ OA → แอดมินตรวจ → ขึ้นหน้าแรกใต้กิจกรรมของบ้าน-บ้าน
// ส่วนถามตอบในไลน์อยู่ที่ services/neighbor-chat.js
//
// ตั้งใจเก็บแยกจาก db.js: db.js เขียนข้อมูลทั้งก้อนทุกครั้งที่บันทึก ถ้ารูป/เสียงไปอยู่ในนั้น
// ทุกการกดปุ่มในเว็บจะต้องเขียนรูปทั้งหมดซ้ำ ที่นี่เขียนทีละรายการ และไม่แตะข้อมูลสมัคร/ชำระเงินเลย
//
// MongoDB  database "barnbarn"
//   neighbors        1 เอกสาร = 1 กิจกรรม (รวมฉบับร่างที่กำลังตอบคำถามในไลน์)
//   neighbor_media   รูป/เสียง 1 เอกสารต่อ 1 ไฟล์ เขียนครั้งเดียว ไม่แก้
// ไม่มี MONGODB_URI → data/neighbors.json + data/neighbor-media/ (ทดสอบในเครื่องเท่านั้น)
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'neighbors.json');
const MEDIA_DIR = path.join(DIR, 'neighbor-media');

export const STATUS = { DRAFT: 'draft', PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected', HIDDEN: 'hidden' };

const MAX_MEDIA_BYTES = 9 * 1024 * 1024;   // ไฟล์เดียวต้องไม่เกิน ~9MB (เอกสาร Mongo รับได้ 16MB)
export const MAX_PHOTOS = 3;

let items = [];                 // ทุกกิจกรรม ไม่มีตัวไฟล์รูป/เสียงอยู่ในนี้ มีแค่รหัสอ้างอิง
let col = null, mediaCol = null;
let chain = Promise.resolve();  // เขียนทีละคิว
let ready = false;

export const newId = (prefix) => prefix + '_' + crypto.randomBytes(9).toString('hex');
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------- วันที่ (เวลาไทยเสมอ)
export function bkkToday(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const addDays = (ymd, n) => {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// ---------------------------------------------------------------- โครงข้อมูล 1 กิจกรรม
export function blank(extra = {}) {
  return {
    id: newId('nb'),
    status: STATUS.DRAFT,
    source: 'line',            // line | admin
    title: '',
    emoji: '',
    date: '',                  // YYYY-MM-DD วันแรก (ถ้ารู้)
    endDate: '',               // วันสุดท้าย (ถ้าจัดหลายวัน — แอดมินใส่)
    repeatText: '',            // จัดเป็นประจำ เช่น "ทุกวันเสาร์"
    whenText: '',              // วันที่ที่อ่านเป็นปฏิทินไม่ได้ เช่น "วันพระ"
    timeText: '',              // "ช่วงเช้า" / "09:30 น." / "บ่ายสอง"
    placeName: '',
    placeAddress: '',
    lat: null,
    lng: null,
    mapUrl: '',
    price: null,               // ตัวเลข (บาท) หรือ null
    priceText: '',             // "ฟรี" / "ตามศรัทธา" / ข้อความอื่น
    details: '',
    hostName: '',
    phone: '',
    showPhone: true,
    photos: [],                // [{ id, size, type }]
    pendingPhotos: [],         // รหัสข้อความรูปในไลน์ที่ยังโหลดไม่สำเร็จ (ระบบลองใหม่เอง)
    voices: [],                // [{ id, size, type, duration, step, status, messageId }]
    lineUserId: '',
    lineDisplayName: '',
    chat: null,                // สถานะการถามตอบในไลน์ (เฉพาะฉบับร่าง)
    showUntil: '',             // แสดงบนเว็บถึงวันไหน (ว่าง = จนกว่าจะซ่อน)
    reviewNote: '',
    adminNote: '',
    consentAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    submittedAt: null,
    reviewedAt: null,
    notifiedAt: null,
    ...extra
  };
}

// ---------------------------------------------------------------- เริ่มระบบ
export async function init() {
  const URI = process.env.MONGODB_URI || '';
  if (URI) {
    try {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(URI, { serverSelectionTimeoutMS: 8000 });
      await client.connect();
      const database = client.db('barnbarn');
      col = database.collection('neighbors');
      mediaCol = database.collection('neighbor_media');
      const docs = await col.find({}).toArray();
      items = docs.map(({ _id, ...rest }) => rest);
      ready = true;
      console.log('   เพื่อนบ้าน:        MongoDB ✓ (' + items.length + ' รายการ)');
      setTimeout(() => cleanup().catch(() => {}), 30e3);
      return;
    } catch (e) {
      console.error('   เพื่อนบ้าน: ต่อ MongoDB ไม่ได้ —', e.message);
      col = mediaCol = null;
    }
  }
  try { items = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { items = []; }
  ready = true;
  console.log('   เพื่อนบ้าน:        ไฟล์ data/neighbors.json (ข้อมูลรีเซ็ตเมื่ออัปเดต)');
}
export const isReady = () => ready;
export const storageMode = () => (col ? 'mongodb' : 'file');

function saveFile() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(items, null, 1));
  } catch (e) { console.error('เพื่อนบ้าน: บันทึกไฟล์ไม่สำเร็จ', e.message); }
}

function persist(it) {
  it.updatedAt = new Date().toISOString();
  if (!col) { saveFile(); return Promise.resolve(); }
  const doc = { _id: it.id, ...clone(it) };
  chain = chain
    .then(() => col.replaceOne({ _id: it.id }, doc, { upsert: true }))
    .catch((e) => console.error('เพื่อนบ้าน: บันทึก Mongo ไม่สำเร็จ', e.message));
  return chain;
}

// ---------------------------------------------------------------- อ่าน/เขียนรายการ
export const all = () => items;
export const get = (id) => items.find((x) => x.id === id) || null;
export const draftOf = (userId) => items.find((x) => x.status === STATUS.DRAFT && x.lineUserId === userId) || null;
export const byUser = (userId) => items.filter((x) => x.lineUserId === userId);

export function create(fields = {}) {
  const it = blank(fields);
  items.push(it);
  persist(it);
  return it;
}

// patch ทับเฉพาะช่องที่ส่งมา
export function update(id, patch = {}) {
  const it = get(id);
  if (!it) return null;
  Object.assign(it, patch);
  persist(it);
  return it;
}

// ให้โค้ดที่แก้ object ตรง ๆ (เช่น push รูปเข้า array) สั่งบันทึกเอง
export function touch(it) {
  if (it && get(it.id)) persist(it);
  return it;
}

export async function remove(id) {
  const it = get(id);
  if (!it) return false;
  items = items.filter((x) => x.id !== id);
  const mediaIds = [...(it.photos || []), ...(it.voices || [])].map((m) => m.id).filter(Boolean);
  if (col) {
    chain = chain.then(() => col.deleteOne({ _id: id })).catch((e) => console.error('เพื่อนบ้าน: ลบไม่สำเร็จ', e.message));
  } else saveFile();
  await deleteMedia(mediaIds);
  return true;
}

// ---------------------------------------------------------------- รูป/เสียง
const cache = new Map();          // id → { kind, type, buf }  เก็บรูปที่เปิดบ่อยไว้ในหน่วยความจำ
let cacheBytes = 0;
const CACHE_CAP = 24 * 1024 * 1024;
function cachePut(id, v) {
  if (!v || !v.buf || v.buf.length > 4 * 1024 * 1024) return;
  if (cache.has(id)) return;
  cache.set(id, v); cacheBytes += v.buf.length;
  for (const [k, old] of cache) {           // ทิ้งตัวเก่าสุดก่อน
    if (cacheBytes <= CACHE_CAP) break;
    cache.delete(k); cacheBytes -= old.buf.length;
  }
}
function cacheDrop(id) {
  const v = cache.get(id);
  if (v) { cache.delete(id); cacheBytes -= v.buf.length; }
}
const toBuf = (x) => {
  if (!x) return null;
  if (Buffer.isBuffer(x)) return x;
  if (x.buffer instanceof Uint8Array) {                // mongodb Binary (bson 6): ใช้เฉพาะช่วงที่มีข้อมูลจริง
    const len = typeof x.position === 'number' ? x.position : x.buffer.length;
    return Buffer.from(x.buffer.buffer, x.buffer.byteOffset, len);
  }
  if (x instanceof Uint8Array) return Buffer.from(x.buffer, x.byteOffset, x.length);
  return null;
};
export const _toBufForTest = toBuf;

// เก็บไฟล์ใหม่ คืน { id, size, type }
export async function putMedia({ kind, type, buf, activityId, extra = {} }) {
  if (!buf || !buf.length) throw new Error('ไฟล์ว่าง');
  if (buf.length > MAX_MEDIA_BYTES) throw new Error('ไฟล์ใหญ่เกินไป');
  const id = newId(kind === 'audio' ? 'au' : 'im');
  const meta = { kind, type: type || 'application/octet-stream', size: buf.length, activityId: activityId || '', createdAt: new Date().toISOString(), ...extra };
  if (mediaCol) {
    await mediaCol.insertOne({ _id: id, ...meta, data: buf });
  } else {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    fs.writeFileSync(path.join(MEDIA_DIR, id), buf);
    fs.writeFileSync(path.join(MEDIA_DIR, id + '.json'), JSON.stringify(meta));
  }
  cachePut(id, { kind, type: meta.type, buf });
  return { id, size: buf.length, type: meta.type };
}

export async function getMedia(id) {
  if (!/^(im|au)_[a-f0-9]{18}$/.test(String(id || ''))) return null;
  if (cache.has(id)) return cache.get(id);
  let v = null;
  if (mediaCol) {
    const d = await mediaCol.findOne({ _id: id });
    if (d) v = { kind: d.kind, type: d.type, buf: toBuf(d.data) };
  } else {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(MEDIA_DIR, id + '.json'), 'utf8'));
      v = { kind: meta.kind, type: meta.type, buf: fs.readFileSync(path.join(MEDIA_DIR, id)) };
    } catch { v = null; }
  }
  if (v && v.buf) cachePut(id, v);
  return v && v.buf ? v : null;
}

export async function deleteMedia(ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return;
  list.forEach(cacheDrop);
  if (mediaCol) {
    try { await mediaCol.deleteMany({ _id: { $in: list } }); } catch (e) { console.error('เพื่อนบ้าน: ลบไฟล์ไม่สำเร็จ', e.message); }
  } else {
    for (const id of list) {
      for (const f of [id, id + '.json']) { try { fs.unlinkSync(path.join(MEDIA_DIR, f)); } catch { /* ไม่มีอยู่แล้ว */ } }
    }
  }
}

// ---------------------------------------------------------------- แสดงบนเว็บ
const bkkDateOf = (iso) => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); }
  catch { return ''; }
};
// วันสุดท้ายที่แสดงบนเว็บ — คิดสดทุกครั้ง แก้วันที่เมื่อไหร่ก็ตามทันที
//   แอดมินกำหนดเอง (showUntil) > วันสุดท้าย > วันจัด > จัดประจำ = ไม่หมดอายุ > ไม่รู้วัน = 30 วันหลังอนุมัติ
export function endOf(it) {
  if (isYmd(it.showUntil)) return it.showUntil;
  if (isYmd(it.endDate)) return it.endDate;
  if (isYmd(it.date)) return it.date;
  if (it.repeatText) return '';
  const from = it.reviewedAt || it.submittedAt || it.createdAt;
  return from ? addDays(bkkDateOf(from), 30) : '';
}
export function isEnded(it, today = bkkToday()) {
  const end = endOf(it);
  return !!(end && end < today);
}
export function isLive(it, today = bkkToday()) {
  return it.status === STATUS.APPROVED && !isEnded(it, today);
}

export function publicView(it) {
  return {
    id: it.id,
    title: it.title,
    emoji: it.emoji || '',
    date: it.date || '',
    endDate: it.endDate || '',
    repeatText: it.repeatText || '',
    whenText: it.whenText || '',
    timeText: it.timeText || '',
    placeName: it.placeName || '',
    placeAddress: it.placeAddress || '',
    lat: Number.isFinite(it.lat) ? it.lat : null,
    lng: Number.isFinite(it.lng) ? it.lng : null,
    mapUrl: it.mapUrl || '',
    price: Number.isFinite(it.price) ? it.price : null,
    priceText: it.priceText || '',
    details: it.details || '',
    hostName: it.hostName || '',
    phone: it.showPhone && it.phone ? it.phone : '',
    photos: (it.photos || []).map((p) => p.id),
    approvedAt: it.reviewedAt || it.submittedAt || it.createdAt
  };
}

export function publicList() {
  const today = bkkToday();
  const live = items.filter((it) => isLive(it, today) && it.title);
  const rank = (it) => {
    if (isYmd(it.date)) {
      const start = it.date < today ? today : it.date;   // จัดหลายวันและเริ่มไปแล้ว ถือว่า "วันนี้"
      return '0' + start;
    }
    if (it.repeatText) return '1';
    return '2' + (9e15 - new Date(it.reviewedAt || it.createdAt).getTime()).toString().padStart(16, '0');
  };
  return live.sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0)).map(publicView);
}

export function counts(today = bkkToday()) {
  const c = { pending: 0, live: 0, ended: 0, draft: 0, off: 0 };
  for (const it of items) {
    if (it.status === STATUS.PENDING) c.pending++;
    else if (it.status === STATUS.DRAFT) c.draft++;
    else if (it.status === STATUS.APPROVED) isEnded(it, today) ? c.ended++ : c.live++;
    else c.off++;
  }
  return c;
}

// ---------------------------------------------------------------- เก็บกวาด (กันฐานข้อมูลฟรี 512MB เต็ม)
// ฉบับร่างค้างเกิน 7 วัน → ลบ · ไม่ผ่านเกิน 14 วัน → ลบรูป/เสียง (60 วันลบทั้งรายการ)
// จบไปแล้วเกิน 30 วัน → ลบรูป/เสียง เก็บไว้แค่ข้อความ
let lastCleanup = 0;
export async function cleanup({ force = false } = {}) {
  if (!force && Date.now() - lastCleanup < 3600e3) return { skipped: true };
  lastCleanup = Date.now();
  const now = Date.now(), today = bkkToday();
  const ageDays = (iso) => (iso ? (now - new Date(iso).getTime()) / 864e5 : 0);
  let removed = 0, slimmed = 0;
  for (const it of [...items]) {
    const lastAt = (it.chat && it.chat.lastAt) || it.updatedAt || it.createdAt;
    if (it.status === STATUS.DRAFT && ageDays(lastAt) > 7) { await remove(it.id); removed++; continue; }
    if (it.status === STATUS.REJECTED && ageDays(it.reviewedAt) > 60) { await remove(it.id); removed++; continue; }
    const end = endOf(it);
    const oldEnded = it.status === STATUS.APPROVED && end && addDays(end, 30) < today;
    const oldRejected = it.status === STATUS.REJECTED && ageDays(it.reviewedAt) > 14;
    if ((oldEnded || oldRejected) && ((it.photos || []).length || (it.voices || []).length)) {
      const ids = [...(it.photos || []), ...(it.voices || [])].map((m) => m.id).filter(Boolean);
      it.photos = []; it.voices = [];
      persist(it);
      await deleteMedia(ids);
      slimmed++;
    }
  }
  if (removed || slimmed) console.log(`เพื่อนบ้าน: เก็บกวาดแล้ว ลบ ${removed} รายการ · ลบรูป/เสียงเก่า ${slimmed} รายการ`);
  return { removed, slimmed };
}
setInterval(() => { cleanup().catch(() => {}); }, 6 * 3600e3).unref?.();

// ---------------------------------------------------------------- ตรวจค่าที่แอดมินแก้
const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
export function cleanFields(b = {}) {
  const out = {};
  const S = { title: 120, emoji: 8, repeatText: 60, whenText: 80, timeText: 40, placeName: 120, placeAddress: 200,
    priceText: 40, hostName: 60, reviewNote: 300, adminNote: 500 };
  for (const [k, max] of Object.entries(S)) if (b[k] !== undefined) out[k] = str(b[k], max);
  if (b.details !== undefined) out.details = String(b.details || '').replace(/\r/g, '').trim().slice(0, 1500);
  for (const k of ['date', 'endDate', 'showUntil']) if (b[k] !== undefined) out[k] = isYmd(b[k]) ? b[k] : '';
  if (b.phone !== undefined) out.phone = String(b.phone || '').replace(/\D/g, '').slice(0, 10);
  if (b.showPhone !== undefined) out.showPhone = !!b.showPhone;
  if (b.price !== undefined) {
    const n = Number(String(b.price).replace(/[^\d.]/g, ''));
    out.price = b.price === '' || b.price === null || !Number.isFinite(n) ? null : Math.round(n);
  }
  if (b.mapUrl !== undefined) out.mapUrl = /^https:\/\/[^\s"'<>]+$/.test(String(b.mapUrl || '').trim()) ? String(b.mapUrl).trim().slice(0, 500) : '';
  if (b.lat !== undefined || b.lng !== undefined) {
    const lat = Number(b.lat), lng = Number(b.lng);
    const ok = b.lat !== '' && b.lng !== '' && b.lat !== null && b.lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    out.lat = ok ? lat : null; out.lng = ok ? lng : null;
  }
  if (out.endDate && out.date && out.endDate < out.date) out.endDate = '';
  return out;
}

// ---------------------------------------------------------------- เส้นทางเว็บ
// deps: { requireAdmin, isAdmin(req), notify(item, kind, opts) → Promise<{sent}>, refreshMedia(item) }
let DEPS = {};
export const deps = () => DEPS;

export function mountNeighbors(app, d) {
  DEPS = d || {};
  const { requireAdmin } = DEPS;

  // ---- หน้าเว็บสาธารณะ ----
  app.get('/api/neighbors', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(publicList());
  });

  // รูปเปิดดูได้ด้วยรหัสสุ่ม (LINE ต้องดึงรูปไปแสดงในการ์ดได้) · เสียงเปิดได้เฉพาะแอดมิน
  app.get('/api/neighbors/media/:id', async (req, res) => {
    try {
      const m = await getMedia(req.params.id);
      if (!m) return res.status(404).end();
      if (m.kind === 'audio' && !(DEPS.isAdmin && DEPS.isAdmin(req))) return res.status(401).end();
      res.set('Content-Type', m.type || 'application/octet-stream');
      res.set('Cache-Control', m.kind === 'audio' ? 'private, no-store' : 'public, max-age=604800, immutable');
      res.send(m.buf);
    } catch (e) {
      console.error('เพื่อนบ้าน media:', e.message);
      res.status(500).end();
    }
  });

  // ---- แอดมิน ----
  app.get('/api/admin/neighbors', requireAdmin, (req, res) => {
    const today = bkkToday();
    cleanup().catch(() => {});
    if (DEPS.refreshMedia) items.forEach((it) => DEPS.refreshMedia(it));   // ลองโหลดรูป/เสียงที่ค้างจากไลน์อีกรอบ
    res.json({
      today,
      counts: counts(today),
      storage: storageMode(),
      items: items
        .map((it) => ({ ...clone(it), ended: isEnded(it, today), endsOn: endOf(it), chat: it.chat ? { step: it.chat.step, lastAt: it.chat.lastAt } : null }))
        .sort((a, b) => String(b.submittedAt || b.updatedAt).localeCompare(String(a.submittedAt || a.updatedAt)))
    });
  });

  // แอดมินเพิ่มเอง (เช่น ป้าโทรมาเล่า)
  app.post('/api/admin/neighbors', requireAdmin, (req, res) => {
    const b = req.body || {};
    const fields = cleanFields(b);
    if (!fields.title) return res.status(400).json({ error: 'ใส่ชื่อกิจกรรมก่อนนะ' });
    const it = create({ ...fields, source: 'admin', status: STATUS.PENDING, submittedAt: new Date().toISOString() });
    res.json(it);
  });

  app.put('/api/admin/neighbors/:id', requireAdmin, (req, res) => {
    const it = get(req.params.id);
    if (!it) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
    res.json(update(it.id, cleanFields(req.body || {})));
  });

  // เปลี่ยนสถานะ: approved | rejected | hidden | pending  (+ แจ้งผู้ส่งทางไลน์ถ้าเลือก)
  app.post('/api/admin/neighbors/:id/status', requireAdmin, async (req, res) => {
    const it = get(req.params.id);
    if (!it) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
    const b = req.body || {};
    const to = String(b.status || '');
    if (![STATUS.APPROVED, STATUS.REJECTED, STATUS.HIDDEN, STATUS.PENDING].includes(to)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
    if (to === STATUS.APPROVED && !it.title) return res.status(400).json({ error: 'ยังไม่มีชื่อกิจกรรม — ใส่ชื่อก่อนกดขึ้นเว็บ' });
    const r = await setStatus(it, to, { note: b.note, notify: b.notify !== false, base: reqBase(req) });
    res.json(r);
  });

  // รูปที่แอดมินอัปเอง (ย่อในเบราว์เซอร์มาแล้ว) — replaceId = แทนรูปเดิม (ใช้ตอนย่อรูปใหญ่)
  app.post('/api/admin/neighbors/:id/photo', requireAdmin, async (req, res) => {
    const it = get(req.params.id);
    if (!it) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
    const m = String((req.body && req.body.image) || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return res.status(400).json({ error: 'ไฟล์รูปไม่ถูกต้อง' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'รูปใหญ่เกินไป' });
    const replaceId = String((req.body && req.body.replaceId) || '');
    const idx = replaceId ? it.photos.findIndex((p) => p.id === replaceId) : -1;
    if (idx < 0 && it.photos.length >= MAX_PHOTOS) return res.status(400).json({ error: `ใส่รูปได้สูงสุด ${MAX_PHOTOS} รูป` });
    try {
      const saved = await putMedia({ kind: 'image', type: m[1], buf, activityId: it.id });
      if (idx >= 0) { const old = it.photos[idx]; it.photos[idx] = saved; touch(it); await deleteMedia([old.id]); }
      else { it.photos.push(saved); touch(it); }
      res.json(it);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete('/api/admin/neighbors/:id/photo/:mid', requireAdmin, async (req, res) => {
    const it = get(req.params.id);
    if (!it) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
    const before = it.photos.length;
    it.photos = it.photos.filter((p) => p.id !== req.params.mid);
    if (it.photos.length !== before) { touch(it); await deleteMedia([req.params.mid]); }
    res.json(it);
  });

  // ตั้งเป็นรูปหลัก (รูปแรกคือรูปบนการ์ด)
  app.post('/api/admin/neighbors/:id/cover/:mid', requireAdmin, (req, res) => {
    const it = get(req.params.id);
    if (!it) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
    const i = it.photos.findIndex((p) => p.id === req.params.mid);
    if (i > 0) { const [p] = it.photos.splice(i, 1); it.photos.unshift(p); touch(it); }
    res.json(it);
  });

  app.delete('/api/admin/neighbors/:id', requireAdmin, async (req, res) => {
    const ok = await remove(req.params.id);
    res.json({ ok });
  });
}

// ลิงก์เว็บจริง (ใช้ทำลิงก์ในข้อความไลน์) — ตั้ง PUBLIC_BASE_URL ไว้ใน Render แล้วจะใช้ค่านั้นก่อน
function reqBase(req) {
  const env = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (env) return env;
  const host = req && req.get ? req.get('host') : '';
  if (!host) return '';
  return (/^(localhost|127\.|\[::1\])/.test(host) ? 'http://' : 'https://') + host;
}

// เปลี่ยนสถานะ + แจ้งผู้ส่ง (ใช้ร่วมกันทั้งหน้าแอดมินและปุ่มในไลน์แอดมิน)
export async function setStatus(it, to, { note = '', notify = true, base = '' } = {}) {
  const prev = it.status;
  const patch = { status: to, reviewedAt: new Date().toISOString() };
  if (note !== undefined && note !== null) patch.reviewNote = str(note, 300);
  update(it.id, patch);
  let notified = { sent: false };
  // อนุมัติแต่วันจัดผ่านไปแล้ว = ยังไม่ขึ้นเว็บ ไม่ต้องแจ้งว่า "ขึ้นเว็บแล้ว"
  const kind = to === STATUS.APPROVED ? (isEnded(it) ? '' : 'approved') : to === STATUS.REJECTED ? 'rejected' : '';
  // แจ้งครั้งแรกที่ขึ้นเว็บ/ไม่ผ่านเท่านั้น กดซ้ำไม่ส่งซ้ำ (ประหยัดโควตาไลน์)
  if (notify && kind && prev !== to && it.lineUserId && DEPS.notify) {
    try { notified = (await DEPS.notify(it, kind, { note: it.reviewNote, base })) || notified; }
    catch (e) { console.error('เพื่อนบ้าน แจ้งผู้ส่ง:', e.message); }
    if (notified.sent) update(it.id, { notifiedAt: new Date().toISOString() });
  }
  return { ok: true, item: it, notified, ended: isEnded(it), endsOn: endOf(it) };
}
