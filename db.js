// db.js — ที่เก็บข้อมูลแบบไฟล์ JSON (ไม่ต้องติดตั้งฐานข้อมูลแยก)
// Simple file-based JSON store. No external database server needed.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const seed = {
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
          rounds: [
            { id: 'r1', date: '2026-09-06', time: '10:00–13:00', seats: 8, price: 1500 }
          ],
          active: true,
          createdAt: new Date().toISOString()
        }
      ],
      registrations: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
  }
}

function read() {
  ensure();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function write(data) {
  ensure();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// simple id generator
export function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- Workshops ----------
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
    rounds: (payload.rounds || []).map((r) => ({
      id: r.id || uid('r'),
      date: r.date || '',
      time: r.time || '',
      seats: Number(r.seats) || 0,
      price: Number(r.price) || 0
    })),
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
    active: payload.active ?? ws.active
  });
  if (Array.isArray(payload.rounds)) {
    ws.rounds = payload.rounds.map((r) => ({
      id: r.id || uid('r'),
      date: r.date || '',
      time: r.time || '',
      seats: Number(r.seats) || 0,
      price: Number(r.price) || 0
    }));
  }
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
// count seats already taken for a round (sums the number of people per registration,
// excluding cancelled registrations)
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
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
    people: Number(payload.people) || 1,
    note: payload.note || '',
    amount: Number(payload.amount) || 0,
    status: 'pending_payment', // pending_payment -> paid -> confirmed  (or cancelled)
    paymentMethod: '',
    paymentRef: '',
    confirmed: false,
    confirmationMessage: '',
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
