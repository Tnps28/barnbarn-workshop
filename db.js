// db.js — ที่เก็บข้อมูล
// ใช้ MongoDB Atlas (ถาวร) ถ้าตั้งค่า MONGODB_URI ไว้ ไม่งั้น fallback เป็นไฟล์ JSON
// Uses MongoDB Atlas when MONGODB_URI is set (data persists across deploys),
// otherwise falls back to a local JSON file. Keeps a synchronous interface via an
// in-memory cache with write-through to the backend.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MONGODB_URI = process.env.MONGODB_URI || '';

let DB = null; // in-memory { workshops, registrations, settings }
let mongo = null; // { client, wk, rg, st }

export function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function seed() {
  return {
    workshops: [
      {
        id: 'ws_soap01',
        title: 'เวิร์กช็อปทำสบู่ธรรมชาติ',
        subtitle: 'Natural Soap Making',
        category: 'งานคราฟต์ / Craft',
        description:
          'เรียนรู้การทำสบู่จากวัตถุดิบธรรมชาติแบบ Cold Process ตั้งแต่การเลือกน้ำมัน การผสมสี กลิ่นหอมจากสมุนไพร ไปจนถึงการตัดและแพ็กสบู่สวย ๆ กลับบ้าน เหมาะสำหรับผู้เริ่มต้น ไม่ต้องมีพื้นฐาน',
        location: 'BARNBARN Studio ซอยอารีย์ กรุงเทพฯ',
        image: '',
        rounds: [
          { id: 'r1', date: '2026-08-16', time: '13:00–16:00', seats: 12, price: 1200 },
          { id: 'r2', date: '2026-08-30', time: '13:00–16:00', seats: 12, price: 1200 }
        ],
        addons: [],
        active: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'ws_pottery01',
        title: 'เวิร์กช็อปปั้นเซรามิกมือ',
        subtitle: 'Hand-building Pottery',
        category: 'งานคราฟต์ / Craft',
        description:
          'สัมผัสความสงบของการปั้นดินด้วยมือ ทำแก้วหรือชามใบเล็กในสไตล์ของคุณเอง วิทยากรดูแลใกล้ชิด รวมค่าดินและเผาชิ้นงาน (รับกลับได้ภายหลัง)',
        location: 'BARNBARN Studio ซอยอารีย์ กรุงเทพฯ',
        image: '',
        rounds: [{ id: 'r1', date: '2026-09-06', time: '10:00–13:00', seats: 8, price: 1500 }],
        addons: [],
        active: true,
        createdAt: new Date().toISOString()
      }
    ],
    registrations: [],
    settings: {
      paymentQr: '',
      bankName: '',
      accountName: '',
      accountNumber: '',
      note: '',
      updatedAt: null
    },
    waitlist: []
  };
}

// how long an unpaid (no slip) reservation holds a seat before it's released
const HOLD_HOURS = 24;

// ---------- file backend ----------
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function loadFromFile() {
  ensureDir();
  if (fs.existsSync(DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } catch {
      /* corrupt -> reseed */
    }
  }
  const s = seed();
  fs.writeFileSync(DB_FILE, JSON.stringify(s, null, 2));
  return s;
}
function saveToFile(data) {
  ensureDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ---------- mongo backend ----------
const stripId = (doc) => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
};
async function initMongo() {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const database = client.db('barnbarn');
  mongo = {
    client,
    wk: database.collection('workshops'),
    rg: database.collection('registrations'),
    st: database.collection('settings'),
    wl: database.collection('waitlist')
  };
  const workshops = await mongo.wk.find({}).toArray();
  const registrations = await mongo.rg.find({}).toArray();
  const waitlist = await mongo.wl.find({}).toArray();
  const settingsDoc = await mongo.st.findOne({ _id: 'main' });
  if (!workshops.length && !settingsDoc) {
    DB = seed();
    await persistMongo(DB); // first-run seed
  } else {
    DB = {
      workshops: workshops.map(stripId),
      registrations: registrations.map(stripId),
      settings: settingsDoc ? stripId(settingsDoc) : seed().settings,
      waitlist: waitlist.map(stripId)
    };
  }
}
async function persistMongo(data) {
  await mongo.wk.deleteMany({});
  if (data.workshops.length)
    await mongo.wk.insertMany(data.workshops.map((w) => ({ _id: w.id, ...w })));
  await mongo.rg.deleteMany({});
  if (data.registrations.length)
    await mongo.rg.insertMany(data.registrations.map((r) => ({ _id: r.id, ...r })));
  await mongo.st.replaceOne({ _id: 'main' }, { _id: 'main', ...data.settings }, { upsert: true });
  await mongo.wl.deleteMany({});
  if ((data.waitlist || []).length)
    await mongo.wl.insertMany(data.waitlist.map((w) => ({ _id: w.id, ...w })));
}

// ---------- init (called once at startup) ----------
export async function init() {
  if (MONGODB_URI) {
    try {
      await initMongo();
      console.log('   Data store:      MongoDB Atlas ✓ (ข้อมูลถาวร)');
      return;
    } catch (e) {
      console.error('   MongoDB connect failed, using local file:', e.message);
    }
  }
  DB = loadFromFile();
  console.log(
    '   Data store:      local file (data/db.json) — ' +
      (MONGODB_URI ? 'Mongo ล้มเหลว' : 'ยังไม่ตั้งค่า MONGODB_URI, ข้อมูลจะรีเซ็ตเมื่ออัปเดต')
  );
}

// ---------- storage usage (MongoDB Atlas free tier = 512 MB) ----------
export async function getStorageStats() {
  if (!mongo) return { available: false, backend: 'file' };
  try {
    const s = await mongo.client.db('barnbarn').command({ dbStats: 1 });
    const usedBytes = (s.storageSize || 0) + (s.indexSize || 0);
    const limitBytes = 512 * 1024 * 1024;
    return {
      available: true,
      backend: 'mongodb',
      usedMB: +(usedBytes / 1048576).toFixed(2),
      dataMB: +((s.dataSize || 0) / 1048576).toFixed(2),
      limitMB: 512,
      percent: +Math.min(100, (usedBytes / limitBytes) * 100).toFixed(1),
      slips: db_slipCount()
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}
function db_slipCount() {
  try {
    return read().registrations.filter((r) => r.slipImage).length;
  } catch {
    return 0;
  }
}

// ---------- core read/write (sync interface) ----------
function read() {
  if (!DB) DB = loadFromFile();
  if (!DB.waitlist) DB.waitlist = [];
  return DB;
}

// ---------- auto-release unpaid seats after HOLD_HOURS ----------
// Registrations still 'pending_payment' (never uploaded a slip) past the hold
// window are marked 'expired' so their seats free up automatically.
export function expireStale() {
  const db = read();
  const cutoff = Date.now() - HOLD_HOURS * 3600 * 1000;
  let changed = 0;
  for (const r of db.registrations) {
    if (r.status === 'pending_payment' && new Date(r.createdAt).getTime() < cutoff) {
      r.status = 'expired';
      changed++;
    }
  }
  if (changed) write(db);
  return changed;
}
export const holdHours = () => HOLD_HOURS;

// ---------- Waitlist ----------
export function listWaitlist(filter = {}) {
  let list = read().waitlist || [];
  if (filter.workshopId) list = list.filter((w) => w.workshopId === filter.workshopId);
  return list.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}
export function waitlistCount(workshopId, roundId) {
  return (read().waitlist || []).filter(
    (w) => w.workshopId === workshopId && w.roundId === roundId
  ).length;
}
export function addWaitlist(payload) {
  const db = read();
  const w = {
    id: uid('wl'),
    workshopId: payload.workshopId,
    roundId: payload.roundId,
    name: payload.name,
    phone: payload.phone,
    createdAt: new Date().toISOString()
  };
  db.waitlist.push(w);
  write(db);
  return w;
}
export function removeWaitlist(id) {
  const db = read();
  db.waitlist = (db.waitlist || []).filter((w) => w.id !== id);
  write(db);
  return true;
}
function write(data) {
  DB = data;
  if (mongo) persistMongo(data).catch((e) => console.error('Mongo save error:', e.message));
  else saveToFile(data);
}

// ---------- Settings ----------
export function getSettings() {
  const db = read();
  return (
    db.settings || {
      paymentQr: '',
      bankName: '',
      accountName: '',
      accountNumber: '',
      note: '',
      updatedAt: null
    }
  );
}
export function saveSettings(patch) {
  const db = read();
  db.settings = Object.assign(getSettings(), patch, { updatedAt: new Date().toISOString() });
  write(db);
  return db.settings;
}

// ---------- Workshops ----------
function normalizeRounds(rounds) {
  return (rounds || []).map((r) => ({
    id: r.id || uid('r'),
    date: r.date || '',
    time: r.time || '',
    seats: Number(r.seats) || 0,
    price: Number(r.price) || 0
  }));
}
function normalizeAddons(addons) {
  return (addons || [])
    .filter((a) => (a.name || '').trim())
    .map((a) => ({ id: a.id || uid('ad'), name: a.name.trim(), price: Number(a.price) || 0 }));
}

export function listWorkshops({ onlyActive = false } = {}) {
  const db = read();
  let list = db.workshops;
  if (onlyActive) list = list.filter((w) => w.active);
  return list;
}
export function getWorkshop(id) {
  return read().workshops.find((w) => w.id === id) || null;
}
export function createWorkshop(payload) {
  const db = read();
  const ws = {
    id: uid('ws'),
    title: payload.title || 'เวิร์กช็อปใหม่',
    subtitle: payload.subtitle || '',
    category: payload.category || '',
    description: payload.description || '',
    location: payload.location || '',
    image: payload.image || '',
    imagePos: payload.imagePos || 'center',
    rounds: normalizeRounds(payload.rounds),
    addons: normalizeAddons(payload.addons),
    active: payload.active !== false,
    createdAt: new Date().toISOString()
  };
  db.workshops.push(ws);
  write(db);
  return ws;
}
export function updateWorkshop(id, payload) {
  const db = read();
  const ws = db.workshops.find((w) => w.id === id);
  if (!ws) return null;
  Object.assign(ws, {
    title: payload.title ?? ws.title,
    subtitle: payload.subtitle ?? ws.subtitle,
    category: payload.category ?? ws.category,
    description: payload.description ?? ws.description,
    location: payload.location ?? ws.location,
    image: payload.image ?? ws.image,
    imagePos: payload.imagePos ?? ws.imagePos,
    active: payload.active ?? ws.active
  });
  if (Array.isArray(payload.rounds)) ws.rounds = normalizeRounds(payload.rounds);
  if (Array.isArray(payload.addons)) ws.addons = normalizeAddons(payload.addons);
  write(db);
  return ws;
}
export function deleteWorkshop(id) {
  const db = read();
  db.workshops = db.workshops.filter((w) => w.id !== id);
  write(db);
  return true;
}

// ---------- Registrations ----------
export function seatsTaken(workshopId, roundId) {
  const db = read();
  return db.registrations
    .filter((r) => r.workshopId === workshopId && r.roundId === roundId && r.status !== 'cancelled')
    .reduce((sum, r) => sum + (Number(r.people) || 1), 0);
}
export function listRegistrations(filter = {}) {
  let list = read().registrations;
  if (filter.workshopId) list = list.filter((r) => r.workshopId === filter.workshopId);
  if (filter.status) list = list.filter((r) => r.status === filter.status);
  return list.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
export function getRegistration(id) {
  return read().registrations.find((r) => r.id === id) || null;
}
export function createRegistration(payload) {
  const db = read();
  const reg = {
    id: uid('reg'),
    workshopId: payload.workshopId,
    roundId: payload.roundId,
    name: payload.name,
    phone: payload.phone,
    email: payload.email || '',
    lineId: payload.lineId || '',
    province: payload.province || '',
    source: payload.source || '',
    people: Number(payload.people) || 1,
    allergy: payload.allergy || '',
    medical: payload.medical || '',
    addons: Array.isArray(payload.addons) ? payload.addons : [],
    note: payload.note || '',
    adminNote: '',
    amount: Number(payload.amount) || 0,
    status: 'pending_payment',
    paymentMethod: 'bank_transfer',
    paymentRef: '',
    slipImage: '',
    paidNote: '',
    notifiedAt: null,
    confirmed: false,
    confirmationMessage: '',
    attended: false,
    createdAt: new Date().toISOString()
  };
  db.registrations.push(reg);
  write(db);
  return reg;
}
export function updateRegistration(id, patch) {
  const db = read();
  const reg = db.registrations.find((r) => r.id === id);
  if (!reg) return null;
  Object.assign(reg, patch);
  write(db);
  return reg;
}
