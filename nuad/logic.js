// logic.js — เวลา ช่องว่าง คิว (ใช้เวลาไทยเสมอ ไม่ว่าเซิร์ฟเวอร์อยู่ประเทศไหน)
import * as db from './store.js';

export const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
export { toT } from '../public/nuad/messages.js';

export function nowBKK() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  const h = Number(g('hour')) % 24;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, min: h * 60 + Number(g('minute')) };
}
export function addDays(date, n) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const weekday = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
export const slotLen = () => Math.max(15, Number(db.data().settings.slotMin) || 60);

const ACTIVE = ['hold', 'slip', 'paid', 'done'];

export function expireHolds() {
  let changed = false;
  for (const b of db.data().bookings) {
    if (b.status === 'hold' && Date.now() >= b.holdUntil) { b.status = 'expired'; changed = true; }
  }
  if (changed) db.save();
  return changed;
}

export function isFree(date, t, excludeId) {
  const s = db.data().settings, len = slotLen();
  if ((s.closedDays || []).includes(weekday(date))) return false;
  if (t < toMin(s.open) || t + len > toMin(s.close)) return false;
  if (s.breakStart && s.breakEnd && t < toMin(s.breakEnd) && t + len > toMin(s.breakStart)) return false;
  return !db.data().bookings.some((b) => b.id !== excludeId && b.date === date && ACTIVE.includes(b.status)
    && t < b.time + (b.len || len) && t + len > b.time);
}

// กติกาคิวหน้าร้าน vs จองออนไลน์: นัดที่จองไว้ก่อนได้เวลาของตัวเอง · คนที่รับบัตรคิวแล้ว
// ได้ช่วงเวลาที่คาดว่าจะได้นวด — จองออนไลน์ของวันนี้จะจองทับช่วงนั้นไม่ได้
function queueHoldsList() {
  const len = slotLen(), n = nowBKK(), est = estimate(), out = [];
  const sv = todayQueue().find((x) => x.status === 'serving');
  if (sv) out.push([sv.startedMin, Math.max(n.min, sv.startedMin + len)]);
  for (const t of Object.values(est)) if (t != null) out.push([t, t + len]);
  return out;
}

export function slots(date) {
  const s = db.data().settings, len = slotLen(), now = nowBKK(), out = [];
  const queueHolds = date === now.date ? queueHoldsList() : [];
  if ((s.closedDays || []).includes(weekday(date))) return out;
  for (let t = toMin(s.open); t + len <= toMin(s.close); t += 30) {
    if (s.breakStart && t >= toMin(s.breakStart) && t < toMin(s.breakEnd)) continue;
    if (date === now.date && t < now.min) continue;
    out.push({ t, ok: isFree(date, t) && !(date === now.date && queueHolds.some(([a, z]) => t < z && t + len > a)) });
  }
  return out;
}

export const todayQueue = () => {
  const d = nowBKK().date;
  return db.data().queue.filter((q) => q.date === d).sort((a, b) => a.order - b.order);
};

// เวลาที่คาดว่าจะได้นวด ของแต่ละบัตรคิวที่รออยู่ (ข้ามเวลาพักและนัดที่จองไว้)
export function estimate() {
  const n = nowBKK(), len = slotLen(), q = todayQueue(), out = {};
  const sv = q.find((x) => x.status === 'serving');
  let cur = sv ? Math.max(n.min, sv.startedMin + len) : n.min;
  for (const x of q.filter((x) => x.status === 'waiting')) {
    let t = cur, g = 0;
    while (!isFree(n.date, t) && g++ < 400) t += 5;
    if (g >= 400) { out[x.no] = null; continue; }
    out[x.no] = t; cur = t + len;
  }
  return out;
}

export function ticketInfo(q) {
  const list = todayQueue(), sv = list.find((x) => x.status === 'serving');
  const waiting = list.filter((x) => x.status === 'waiting');
  const idx = waiting.findIndex((x) => x.no === q.no);
  return { no: q.no, status: q.status, paid: !!q.paid, linked: !!q.lineUserId,
    ahead: idx < 0 ? 0 : idx + (sv ? 1 : 0), est: estimate()[q.no] ?? null, serving: sv ? sv.no : null };
}

export function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c; do { c = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(''); }
  while (db.data().bookings.some((b) => b.id === c));
  return c;
}
