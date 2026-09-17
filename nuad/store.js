// nuad/store.js — ข้อมูลระบบจองนวด แยกจากข้อมูลเวิร์กช็อปของ BARNBARN
// MongoDB: database "barnbarn" collection "nuad" (เอกสารเดียว _id:'main')
// ไม่มี MONGODB_URI → data/nuad.json (ทดสอบในเครื่องเท่านั้น)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'nuad.json');

let cache = null, col = null, useMongo = false, chain = Promise.resolve();

export const DEFAULT_SETTINGS = {
  shopName: 'นวดแผนไทย พี่หนึ่ง',
  name: 'พี่หนึ่ง',
  place: 'BARNBARN',
  pp: '',
  open: '10:00', close: '20:00', breakStart: '13:00', breakEnd: '14:00',
  closedDays: [3],
  slotMin: 60,
  holdMin: 15,
  notifyOwner: true,
  autoRemind: true,
  ownerUserId: '',
};
const seed = () => ({ settings: { ...DEFAULT_SETTINGS }, bookings: [], queue: [] });

function normalize(d) {
  d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  d.bookings = d.bookings || []; d.queue = d.queue || [];
  const cut = Date.now() - 60 * 864e5; // เก็บย้อนหลัง 60 วัน
  const cutDate = new Date(cut).toISOString().slice(0, 10);
  d.bookings = d.bookings.filter((b) => b.date >= cutDate);
  d.queue = d.queue.filter((q) => (q.createdAt || 0) > cut);
  return d;
}

export async function init() {
  const URI = process.env.MONGODB_URI || '';
  if (URI) {
    try {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(URI, { serverSelectionTimeoutMS: 8000 });
      await client.connect();
      col = client.db('barnbarn').collection('nuad');
      const doc = await col.findOne({ _id: 'main' });
      const { _id, ...rest } = doc || seed();
      cache = normalize(rest); useMongo = true; save();
      console.log('   จองนวด:          MongoDB ✓');
      return;
    } catch (e) { console.error('   จองนวด: ต่อ MongoDB ไม่ได้ —', e.message); }
  }
  try { cache = normalize(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { cache = normalize(seed()); }
  save();
  console.log('   จองนวด:          ไฟล์ data/nuad.json (ข้อมูลรีเซ็ตเมื่ออัปเดต)');
}

export const data = () => cache;
export const storageMode = () => (useMongo ? 'mongodb' : 'file');
export function save() {
  if (!cache) return;
  if (useMongo) {
    const snap = JSON.parse(JSON.stringify(cache));
    chain = chain.then(() => col.replaceOne({ _id: 'main' }, { _id: 'main', ...snap }, { upsert: true }))
      .catch((e) => console.error('จองนวด: บันทึก Mongo ไม่สำเร็จ', e.message));
  } else {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
  }
}
