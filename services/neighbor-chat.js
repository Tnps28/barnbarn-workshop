// services/neighbor-chat.js — ถามตอบในไลน์ "ฝากกิจกรรมเพื่อนบ้าน"
//
// ออกแบบให้ผู้สูงอายุและคนไม่ถนัดเทคโนโลยีใช้ได้
//   • ถามทีละข้อ ตัวหนังสือใหญ่ บอกเสมอว่าข้อที่เท่าไหร่จากทั้งหมด
//   • ทุกข้อมีปุ่มใหญ่ให้กด ไม่ต้องพิมพ์ (ปุ่มอยู่ในการ์ด ไม่หายไปเหมือนปุ่มลอยด้านล่าง)
//   • พิมพ์ไม่ถนัด อัดเสียงตอบได้ทุกข้อที่ต้องพิมพ์ — แอดมินฟังแล้วพิมพ์ให้ในหน้าผู้ดูแล
//   • ส่งรูปใบประกาศมาตอนไหนก็ได้ · พิมพ์ "ยกเลิก" / "ย้อนกลับ" ได้ทุกเมื่อ
//   • ก่อนส่งเห็นการ์ดสรุปหน้าตาเหมือนบนเว็บ แก้ข้อไหนก็ได้
//
// 10 ข้อ: ชื่อ · วันที่ · เวลาเริ่ม–เลิก · สถานที่ (พิมพ์ / ปักหมุด / แปะลิงก์ Google Maps) · ค่าใช้จ่าย
//         · ผู้ติดต่อ · ใบประกาศ · รูปกิจกรรม · รายละเอียด · ให้บ้าน-บ้านช่วย (QR Code / หมุดแผนที่ / ระบบลงทะเบียน)
//
// โควตาไลน์: ทุกข้อความในการถามตอบเป็น reply (ฟรี) — ที่กินโควตามีแค่
// แจ้งแอดมินตอนมีของใหม่ 1 ข้อความ และแจ้งผู้ส่งตอนขึ้นเว็บ/ไม่ผ่าน 1 ข้อความ
//
// อยากแก้ถ้อยคำคำถาม → แก้ที่ Q ด้านล่างได้เลย
import * as LINE from './line.js';
import * as NB from './neighbors.js';

const SECTION_NAME = 'เพื่อนบ้าน บ้าน-บ้าน';
const TOTAL = 10;
const IDLE_MS = 6 * 3600e3;          // เงียบไปเกิน 6 ชม. ถามก่อนว่าจะทำต่อไหม (กันกินข้อความแชททั่วไป)
const MAX_PENDING_PER_USER = 3;
const MAX_VOICES = 8;

const C = { brown: '#7a5230', orange: '#e8863c', terra: '#c9663a', green: '#3e8e5a', ink: '#3a2f27', soft: '#6b5d51', beige: '#f3e6d3' };

// ---------------------------------------------------------------- คำถาม (แก้ถ้อยคำได้ที่นี่)
const Q = {
  title: { n: 1, q: 'กิจกรรมชื่ออะไรคะ?', hint: 'พิมพ์สั้น ๆ เช่น “ตลาดนัดผักปลอดสาร” “สอนทำขนมไทย”\nพิมพ์ไม่สะดวก กดรูปไมค์ 🎤 อัดเสียงบอกได้เลยค่ะ' },
  when: { n: 2, q: 'จัดวันไหนคะ?', hint: 'กดเลือกวันจากปฏิทิน หรือพิมพ์บอก เช่น “เสาร์นี้” “20 ต.ค.”' },
  repeat: { n: 2, q: 'จัดเป็นประจำทุกวันไหนคะ?', hint: 'กดเลือก หรือพิมพ์บอก เช่น “ทุกวันพระ” “ทุกเย็นวันพุธ”' },
  time: { n: 3, q: 'จัดกี่โมง ถึงกี่โมงคะ?', hint: 'กด ⏰ เลือกเวลาเริ่ม แล้วจะถามเวลาเลิกต่อ\nหรือพิมพ์บอกทีเดียว เช่น “9 โมง ถึง เที่ยง” “บ่ายโมง–บ่ายสาม”' },
  timeEnd: { n: 3, q: 'เลิกกี่โมงคะ?', hint: 'กดเลือก หรือพิมพ์บอก เช่น “เที่ยง” “4 โมงเย็น”' },
  place: { n: 4, q: 'จัดที่ไหนคะ?', hint: 'พิมพ์ชื่อสถานที่ เช่น “ศาลาวัด…” “บ้านป้าแดง ซอย 3”\nหรือกด 📍 ปักหมุดในแผนที่ · มีลิงก์ Google Maps ก็แปะได้เลย' },
  placeLink: { n: 4, q: 'แปะลิงก์ Google Maps ได้เลยค่ะ 🔗', hint: 'วิธีเอาลิงก์: เปิดแอป Google Maps → ค้นหาสถานที่ → กด “แชร์” → “คัดลอกลิงก์”\nแล้วกลับมากดค้างที่ช่องพิมพ์ในแชทนี้ → “วาง” → ส่ง' },
  placeName: { n: 4, q: 'สถานที่นี้ชื่ออะไรคะ?', hint: 'ชื่อที่จะขึ้นบนเว็บ พิมพ์ชื่อที่คนแถวนั้นเรียก เช่น “บ้าน-บ้าน” “ศาลาวัด…”' },
  price: { n: 5, q: 'ต้องเสียเงินไหมคะ?', hint: '' },
  priceAmount: { n: 5, q: 'ค่าใช้จ่ายเท่าไหร่คะ?', hint: 'กดเลือก หรือกด ✏️ ระบุราคาเอง' },
  priceCustom: { n: 5, q: 'พิมพ์ราคาได้เลยค่ะ ✏️', hint: 'พิมพ์เป็นตัวเลข เช่น “900” “คนละ 120 รวมอาหาร” “เด็ก 50 ผู้ใหญ่ 100”\nพิมพ์ไม่สะดวก กดไมค์ 🎤 อัดเสียงบอกได้' },
  contact: { n: 6, q: 'ถ้ามีคนสนใจ ให้ติดต่อใครคะ?', hint: 'พิมพ์ชื่อและเบอร์โทร เช่น “ป้าแดง 081 234 5678”\nชื่อและเบอร์นี้จะขึ้นบนเว็บให้คนโทรหาได้' },
  contactPhone: { n: 6, q: 'เบอร์โทรที่ให้คนติดต่อได้คะ?', hint: 'พิมพ์ตัวเลข เช่น 0812345678\nเบอร์นี้จะขึ้นบนเว็บให้คนโทรหาได้' },
  poster: { n: 7, q: 'มีใบประกาศ/โปสเตอร์ไหมคะ? 📄', hint: 'ถ่ายรูปใบประกาศให้เห็นตัวหนังสือชัด ๆ แล้วกดส่ง (ได้ 2 รูป)\nไม่มีก็ไม่เป็นไร กดข้ามได้เลย' },
  photo: { n: 8, q: 'มีรูปกิจกรรมไหมคะ? 📷', hint: 'รูปบรรยากาศ รูปของที่จะทำหรือขาย ได้สูงสุด 3 รูป\nไม่มีก็ไม่เป็นไร กดข้ามได้เลย' },
  details: { n: 9, q: 'อยากบอกอะไรเพิ่มไหมคะ?', hint: 'เช่น ต้องเตรียมอะไรมา ใครมาได้บ้าง ต้องจองก่อนไหม\nพิมพ์หรืออัดเสียงก็ได้ ไม่มีก็กดข้าม' },
  help: { n: 10, q: 'อยากให้บ้าน-บ้านช่วยอะไรเพิ่มไหมคะ?', hint: 'กดเลือกได้หลายอย่าง (✅ = เลือกแล้ว) แล้วกด “ตกลง ไปต่อ”\n• QR Code — ส่งให้ในแชทนี้ตอนขึ้นเว็บ สแกนแล้วเปิดหน้ากิจกรรม เอาไปติดใบประกาศได้\n• ยิงหมุด Google Map — ให้คนค้นหาสถานที่เจอในแผนที่\n• ระบบลงทะเบียน — ให้คนสมัคร/จองที่ผ่านเว็บ\nเรื่องหมุดแผนที่กับระบบลงทะเบียน ทีมงานจะทักไปคุยรายละเอียดค่ะ' }
};
// ข้อที่รับคำตอบเป็นเสียงได้ → เสียงนั้นนับเป็นคำตอบของเรื่องไหน (ข้อย่อยนับรวมกับข้อหลัก)
const VOICE_STEP = { title: 'title', when: 'when', repeat: 'repeat', time: 'time', timeEnd: 'time', place: 'place', placeLink: 'place', placeName: 'place',
  price: 'price', priceAmount: 'priceAmount', priceCustom: 'priceAmount', contact: 'contact', contactPhone: 'contactPhone', details: 'details' };
const FIELD_LABEL = { title: 'ชื่อกิจกรรม', when: 'วันที่', repeat: 'วันที่', time: 'เวลา', place: 'สถานที่', price: 'ค่าใช้จ่าย',
  priceAmount: 'ค่าใช้จ่าย', contact: 'ผู้ติดต่อ', contactPhone: 'เบอร์โทร', details: 'รายละเอียด' };

// ขอให้บ้าน-บ้านช่วย (ข้อ 10) — ไม่ขึ้นเว็บ แอดมินเห็นอย่างเดียว
const WANT_LABEL = { qr: 'ทำ QR Code', map: 'ยิงหมุด Google Map', register: 'ระบบลงทะเบียน' };
const WANT_SHORT = { qr: 'QR Code', map: 'หมุดแผนที่', register: 'ระบบลงทะเบียน' };
const wantsOf = (it) => (Array.isArray(it.wants) ? it.wants : []).filter((k) => WANT_LABEL[k]);
const wantsLine = (it) => wantsOf(it).map((k) => WANT_SHORT[k]).join(' · ');

// ใบประกาศ / รูปกิจกรรม เก็บแยกกัน
const SLOT = {
  poster: { key: 'posters', pending: 'pendingPosters', max: () => NB.MAX_POSTERS, word: 'ใบประกาศ' },
  photo: { key: 'photos', pending: 'pendingPhotos', max: () => NB.MAX_PHOTOS, word: 'รูปกิจกรรม' }
};
const slotCount = (it, slot) => (it[SLOT[slot].key] || []).length + (it[SLOT[slot].pending] || []).length;
const photoCount = (it) => slotCount(it, 'photo');
const posterCount = (it) => slotCount(it, 'poster');

// ---------------------------------------------------------------- ตัวช่วยข้อความ
// ตัดความยาวตามหน่วยที่ไลน์นับ (UTF-16) โดยไม่ตัดอีโมจิครึ่งตัว และไม่ทิ้งสระ/วรรณยุกต์ไทยไว้ลอย ๆ
const TH_MARK = /[ัิ-ฺ็-๎]/;
function cut(s, n) {
  const chars = Array.from(String(s == null ? '' : s));
  let out = '', i = 0;
  for (; i < chars.length; i++) { if (out.length + chars[i].length > n) break; out += chars[i]; }
  if (i >= chars.length) return out;
  // ถูกตัด: ถอยกลับให้จบที่ตัวอักษรเต็มตัว แล้วใส่ … ถ้ายังมีที่
  let k = i;
  while (k > 0 && TH_MARK.test(chars[k])) k--;
  out = chars.slice(0, k).join('');
  while (out.length > n - 1 && out.length) out = Array.from(out).slice(0, -1).join('');
  return out.replace(/\s+$/, '') + '…';
}
const one = (s, n) => cut(String(s || '').replace(/\s+/g, ' ').trim(), n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TH_DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export function thDate(ymd, { dow = true, year = true } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return '';
  const d = new Date(ymd + 'T00:00:00Z');
  return (dow ? TH_DOW[d.getUTCDay()] + ' ' : '') + d.getUTCDate() + ' ' + TH_MON[d.getUTCMonth()] + (year ? ' ' + (d.getUTCFullYear() + 543) : '');
}
const phoneFmt = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
  if (d.length === 9) return d.slice(0, 2) + '-' + d.slice(2, 5) + '-' + d.slice(5);
  return d;
};
const hasVoice = (it, ...steps) => (it.voices || []).some((v) => steps.includes(v.step));

export function whenLine(it) {
  if (it.date) return thDate(it.date) + (it.endDate && it.endDate !== it.date ? ' – ' + thDate(it.endDate) : '');
  if (it.repeatText) return it.repeatText;
  if (it.whenText) return it.whenText;
  return hasVoice(it, 'when', 'repeat') ? '🎤 ส่งเป็นเสียง' : '';
}
export function priceLine(it) {
  if (it.priceText) return it.priceText;
  if (it.price === 0) return 'ฟรี';
  if (Number.isFinite(it.price) && it.price > 0) return it.price.toLocaleString('en-US') + ' บาท';
  return hasVoice(it, 'price', 'priceAmount') ? '🎤 ส่งเป็นเสียง' : '';
}
function placeLine(it) {
  const s = [it.placeName, it.placeAddress && it.placeAddress !== it.placeName ? it.placeAddress : ''].filter(Boolean).join(' · ');
  const pin = Number.isFinite(it.lat) || it.mapUrl;
  if (s) return s + (pin ? ' (มีหมุดแผนที่)' : '');
  if (pin) return 'หมุดในแผนที่';
  return hasVoice(it, 'place') ? '🎤 ส่งเป็นเสียง' : '';
}
function mediaLine(it, slot) {
  const s = SLOT[slot];
  const n = slotCount(it, slot);
  if (!n) return '';
  return `${s.word} ${n} รูป` + ((it[s.pending] || []).length ? ' (กำลังโหลด)' : '');
}
function contactLine(it) {
  const s = [it.hostName, it.phone ? 'โทร ' + phoneFmt(it.phone) : ''].filter(Boolean).join(' · ');
  return s || (hasVoice(it, 'contact', 'contactPhone') ? '🎤 ส่งเป็นเสียง' : '');
}
const timeLine = (it) => it.timeText || (hasVoice(it, 'time') ? '🎤 ส่งเป็นเสียง' : '');
const titleLine = (it) => it.title || (hasVoice(it, 'title') ? '🎤 ชื่อกิจกรรม (ส่งเป็นเสียง)' : '');

// ---------------------------------------------------------------- อ่านคำตอบที่พิมพ์มา
const normDigits = (s) => String(s || '').replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)));
const MONTHS = [
  ['มกราคม', 'ม.ค.', 'มค'], ['กุมภาพันธ์', 'ก.พ.', 'กพ'], ['มีนาคม', 'มี.ค.', 'มีค'], ['เมษายน', 'เม.ย.', 'เมย'],
  ['พฤษภาคม', 'พ.ค.', 'พค'], ['มิถุนายน', 'มิ.ย.', 'มิย'], ['กรกฎาคม', 'ก.ค.', 'กค'], ['สิงหาคม', 'ส.ค.', 'สค'],
  ['กันยายน', 'ก.ย.', 'กย'], ['ตุลาคม', 'ต.ค.', 'ตค'], ['พฤศจิกายน', 'พ.ย.', 'พย'], ['ธันวาคม', 'ธ.ค.', 'ธค']
];
const MONTH_TOKENS = MONTHS.flatMap((names, i) => names.map((t) => [t, i])).sort((a, b) => b[0].length - a[0].length);
// ปีต้องไม่ใช่ตัวเลขเวลา: "25 ต.ค. 13.00" / "เสาร์ 25 ต.ค. 10 โมง" ไม่ใช่ปี 2013 / 2010
const MONTH_RE = new RegExp('(\\d{1,2})\\s*(' + MONTH_TOKENS.map(([t]) => t.replace(/\./g, '\\.')).join('|') + ')'
  + '(?:\\s*(\\d{2,4})(?![\\d:.])(?!\\s*(?:โมง|น\\.|นาฬิกา|ทุ่ม|ชม)))?');
const DOW_WORDS = [['อาทิตย์', 0], ['จันทร์', 1], ['อังคาร', 2], ['พุธ', 3], ['พฤหัส', 4], ['ศุกร์', 5], ['เสาร์', 6]];

const ymdOf = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return '';
  return dt.toISOString().slice(0, 10);
};
const plusDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function fixYear(y) {
  if (y == null || y === '') return null;
  let n = Number(y);
  if (String(y).length <= 2) n = n >= 60 ? 2500 + n - 543 : 2000 + n;   // 69 → 2569 → 2026 · 26 → 2026
  else if (n > 2400) n -= 543;                                           // พ.ศ. → ค.ศ.
  return n;
}

// คืน YYYY-MM-DD หรือ '' ถ้าอ่านไม่ออก (ข้อความที่มีคำว่า "ทุก" ถือเป็นจัดประจำ ไม่ใช่วันเดียว)
export function parseThaiDate(text, today = NB.bkkToday()) {
  const s = normDigits(text).replace(/\s+/g, ' ').trim();
  if (!s || /ทุก/.test(s)) return '';
  if (/วันนี้/.test(s)) return today;
  if (/พรุ่งนี้/.test(s)) return plusDays(today, 1);
  if (/มะรืน/.test(s)) return plusDays(today, 2);
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return ymdOf(+m[1], +m[2] - 1, +m[3]);
  const ty = +today.slice(0, 4);
  const withYear = (d, mo, y) => {
    let fy = fixYear(y);
    if (fy && (fy < ty - 1 || fy > ty + 2)) fy = null;   // ปีแปลก ๆ (พิมพ์ผิด) ไม่เชื่อ ใช้ปีนี้/ปีหน้าแทน
    let out = ymdOf(fy || ty, mo, d);
    if (out && !fy && out < plusDays(today, -7)) out = ymdOf(ty + 1, mo, d);   // ม.ค. ที่พูดตอน ธ.ค. = ปีหน้า
    return out;
  };
  m = s.match(MONTH_RE);
  if (m) {
    const idx = MONTH_TOKENS.find(([t]) => t === m[2])[1];
    return withYear(+m[1], idx, m[3]);
  }
  m = s.match(/(?:^|\D)(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(\d{2,4}))?(?!\d)/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return withYear(+m[1], +m[2] - 1, m[3]);
  for (const [w, dow] of DOW_WORDS) {
    if (!s.includes(w)) continue;
    if (w === 'อาทิตย์' && /อาทิตย์(หน้า|ที่แล้ว)/.test(s) && !/วันอาทิตย์/.test(s)) return ''; // "อาทิตย์หน้า" อาจแปลว่าสัปดาห์หน้า
    const td = new Date(today + 'T00:00:00Z').getUTCDay();
    let add = (dow - td + 7) % 7;
    if (new RegExp(w + '\\s*หน้า').test(s)) add += 7;
    return plusDays(today, add);
  }
  return '';
}

// ---------------------------------------------------------------- เวลา
// อ่านเวลาแบบที่คนไทยพูด: 9 โมง · 9.30 · บ่ายสอง · 4 โมงเย็น · สองทุ่ม · เที่ยง · ตีห้า · สามโมงเช้า (= 9:00 แบบโบราณ)
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (h, m = 0) => pad2(h) + ':' + pad2(m);
const toMin = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
const addMin = (t, n) => {
  const v = toMin(t);
  if (v == null) return '';
  const x = v + n;
  return x >= 0 && x < 1440 ? hhmm(Math.floor(x / 60), x % 60) : '';
};
const timeRange = (start, end) => (end ? `${start}–${end} น.` : `${start} น.`);

const TH_NUMWORDS = [['สิบเอ็ด', '11'], ['สิบสอง', '12'], ['สิบ', '10'], ['หนึ่ง', '1'], ['นึง', '1'], ['สอง', '2'], ['สาม', '3'],
  ['สี่', '4'], ['ห้า', '5'], ['หก', '6'], ['เจ็ด', '7'], ['แปด', '8'], ['เก้า', '9']];
const TH_NUM_RE = TH_NUMWORDS.map(([w]) => w).join('|');
const TH_NUM_OF = Object.fromEntries(TH_NUMWORDS);
function normTime(text) {
  let s = normDigits(text).toLowerCase().replace(/\s+/g, ' ').trim();
  s = s.replace(/(นะคะ|นะครับ|ค่ะ|คะ|ครับ|จ้า|จ้ะ|นะ)/g, ' ').replace(/\s+/g, ' ').trim();   // "12 ค่ะ" = 12
  // ตัดวันที่ออกก่อน — "20 ต.ค. 9 โมง" เลข 20 ไม่ใช่เวลา
  s = s.replace(new RegExp(MONTH_RE.source, 'g'), ' ').replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/(^|\D)\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?(?!\d)/g, '$1 ');
  s = s.replace(/ทุ่ม(นึง|หนึ่ง|เดียว)/g, '1ทุ่ม').replace(/บ่ายโมง/g, 'บ่าย1โมง');
  // คำบอกจำนวนแปลงเป็นเลขเฉพาะตอนเป็นเวลา (ไม่ให้ "ห้าง" "เก้าอี้" กลายเป็นเวลา)
  s = s.replace(new RegExp(`(บ่าย|ตี)\\s*(${TH_NUM_RE})`, 'g'), (a, pre, w) => pre + TH_NUM_OF[w]);
  s = s.replace(new RegExp(`(${TH_NUM_RE})(?=\\s*(?:โมง|ทุ่ม|นาฬิกา|ครึ่ง))`, 'g'), (w) => TH_NUM_OF[w]);
  return s.replace(/(^|[^\d\s])\s*ทุ่ม/g, (all, before) => before + '1ทุ่ม');   // "ทุ่มครึ่ง" = 1 ทุ่มครึ่ง
}
const TIME_TOKEN = /(เที่ยงคืน|เที่ยง(?:วัน)?(?:\s*ครึ่ง)?)|(บ่าย|ตี)?\s*(\d{1,2})(?:\s*[:.]\s*(\d{2}))?\s*(โมง|ทุ่ม|นาฬิกา|น\.?|a\.?m\.?|p\.?m\.?)?\s*(ครึ่ง)?\s*(เช้า|เย็น|ค่ำ|บ่าย|กลางวัน|a\.?m\.?|p\.?m\.?)?/g;
// amb = ตีความได้สองแบบ (เช่น "6" อาจเป็น 6 โมงเช้าหรือ 6 โมงเย็น) — ใช้ตอนเทียบเวลาเริ่ม/เลิก
function readTimeToken(m) {
  if (m[1]) return { t: /คืน/.test(m[1]) ? '00:00' : /ครึ่ง/.test(m[1]) ? '12:30' : '12:00', amb: false };
  const pre = m[2] || '', unit = (m[5] || '').replace(/\./g, ''), suf = (m[7] || '').replace(/\./g, '');
  let h = +m[3], amb = false;
  const mi = m[4] != null ? +m[4] : (m[6] ? 30 : 0);
  if (mi > 59) return null;
  const pm = unit === 'pm' || suf === 'pm', am = unit === 'am' || suf === 'am';
  if (pm || am) { if (h < 1 || h > 12) return null; h = (h % 12) + (pm ? 12 : 0); }
  else if (unit === 'ทุ่ม') { if (h < 1 || h > 6) return null; h = (18 + h) % 24; }      // 6 ทุ่ม = เที่ยงคืน
  else if (pre === 'ตี') { if (h < 1 || h > 6) return null; }
  else if (pre === 'บ่าย' || suf === 'บ่าย' || suf === 'กลางวัน') { if (h >= 1 && h <= 6) h += 12; else if (h < 12) return null; }
  else if (suf === 'เย็น' || suf === 'ค่ำ') { if (h >= 1 && h <= 7) h += 12; else if (h < 12) return null; }
  else if (suf === 'เช้า') { if (unit === 'โมง' && h >= 1 && h <= 5) h += 6; else if (h > 12) return null; }  // สามโมงเช้า = 9:00
  else if (unit === 'โมง') { if (h >= 1 && h <= 5) h += 12; else if (h === 6) { h = 18; amb = true; } }   // 2 โมง = บ่ายสอง
  else if (unit === 'น' || unit === 'นาฬิกา' || m[4] != null) { /* แบบ 24 ชม. */ }
  else if (h >= 1 && h <= 6) { h += 12; amb = true; }                                    // เลขเปล่า "1-4" = บ่ายโมงถึงสี่โมงเย็น
  else if (h >= 7 && h <= 11) amb = true;
  if (h > 23) return null;
  return { t: hhmm(h, mi), amb };
}
// เลขเปล่า ๆ (ไม่มี โมง/น./นาที) นับเป็นเวลาเฉพาะเมื่ออยู่ติดเครื่องหมายช่วง ("9-12" "9 ถึง 12") หรือพิมพ์มาแค่เลขเดียว
// กัน "เก้าอี้ 20 ตัว" "อายุ 60 ขึ้นไป" กลายเป็นเวลา
const SEP_AFTER = /^\s*(?:-|–|—|~|ถึง|จนถึง|จน|to\b)/;
const SEP_BEFORE = /(?:-|–|—|~|ถึง|จน|to)\s*$/;
export function parseTimes(text) {
  const s = normTime(text);
  const out = [];
  TIME_TOKEN.lastIndex = 0;
  let m;
  while ((m = TIME_TOKEN.exec(s)) && out.length < 2) {
    const bare = !m[1] && !m[2] && m[4] == null && !m[5] && !m[6] && !m[7];
    if (bare && s.trim() !== m[0].trim() && !SEP_AFTER.test(s.slice(m.index + m[0].length)) && !SEP_BEFORE.test(s.slice(0, m.index))) continue;
    const r = readTimeToken(m);
    if (r) out.push(r);
  }
  return out;
}
// ช่วงเวลาใช้ได้ไหม: เลิกหลังเริ่ม หรือข้ามคืน (เริ่มเย็น เลิกเช้ามืด)
export const okRange = (start, end) => toMin(end) > toMin(start) || (toMin(start) >= 17 * 60 && toMin(end) <= 6 * 60);
// คืน { start, end? } หรือ { label } (ช่วงเช้า/บ่าย/เย็น/ทั้งวัน) หรือ null = อ่านไม่ออก
// after = เวลาเริ่มที่ได้มาแล้ว (ตอนถามเวลาเลิก)
export function parseTimeRange(text, { after = '' } = {}) {
  const s = normTime(text);
  const toks = parseTimes(text);
  if (!toks.length) {
    if (/ทั้งวัน/.test(s)) return { label: 'ทั้งวัน' };
    if (/เช้า/.test(s)) return { label: 'ช่วงเช้า' };
    if (/บ่าย|กลางวัน/.test(s)) return { label: 'ช่วงบ่าย' };
    if (/เย็น|ค่ำ/.test(s)) return { label: 'ช่วงเย็น' };
    return null;
  }
  const later = (tok, ref) => {                    // เวลาเลิกที่กำกวม ให้อยู่หลังเวลาเริ่ม
    if (toMin(tok.t) > toMin(ref) || !tok.amb) return tok.t;
    const p = addMin(tok.t, 720);
    return p && toMin(p) > toMin(ref) ? p : tok.t;
  };
  const pair = (start, end) => (end === start ? { start } : okRange(start, end) ? { start, end } : { start, end, bad: true });
  if (after && toks.length === 1) return pair(after, later(toks[0], after));
  if (toks.length >= 2) {
    const [a, b] = toks;
    let start = a.t;
    if (toMin(b.t) <= toMin(start) && a.amb) {      // "6-8 โมงเช้า" = 06:00–08:00
      const q = addMin(start, -720);
      if (q && toMin(q) < toMin(b.t)) start = q;
    }
    return pair(start, later(b, start));
  }
  return { start: toks[0].t, open: /ต้นไป|จนกว่า|จนเลิก|จนหมด/.test(s) };
}

export function parsePrice(t) {
  const s = normDigits(t).replace(/\s+/g, ' ').trim();
  // มีตัวเลขอยู่ด้วย ("ผู้ใหญ่ 100 เด็กฟรี") = มีค่าใช้จ่าย เก็บข้อความเต็มไว้ ไม่ใช่ "ฟรี"
  const digits = /\d/.test(s);
  if (!digits && /ไม่ฟรี|ไม่ได้ฟรี/.test(s)) return null;
  if (!digits && /ฟรี|ไม่เสีย|ไม่มีค่า|ไม่ต้องจ่าย|free/i.test(s)) return { price: 0, priceText: 'ฟรี' };
  if (!digits && /ศรัทธา|บริจาค/.test(s)) return { price: null, priceText: 'ตามศรัทธา' };
  const m = s.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (m) {
    const price = Math.round(Number(m[0]));
    const plain = /^\D{0,6}\d+(?:\.\d+)?\s*(บาท|฿|-)?\s*$/.test(s.replace(/,/g, ''));
    return { price, priceText: plain ? '' : one(s, 40) };
  }
  return null;
}

export function parseContact(t) {
  const s = normDigits(t).replace(/\s+/g, ' ').trim();
  const m = s.match(/0[\d\s-]{7,12}\d/);
  let phone = '';
  if (m) { const d = m[0].replace(/\D/g, ''); if (d.length === 9 || d.length === 10) phone = d; }
  let name = phone ? s.replace(m[0], ' ') : s;
  name = name.replace(/(เบอร์โทรศัพท์|เบอร์โทร|เบอร์|โทรศัพท์|โทร\.?|tel\.?|ติดต่อ)/gi, ' ').replace(/[,:;()\-–—]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { phone, name: one(name, 60) };
}

// ---------------------------------------------------------------- ลิงก์แผนที่ (Google Maps)
const URL_IN_TEXT = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%()]+/i;   // ตัวอักษรในลิงก์จริงเป็น ASCII — ภาษาไทยที่พิมพ์ต่อท้ายไม่ติดไปด้วย
// ลิงก์สั้นของ Google ที่ระบบเปิดดูปลายทางได้ (อ่านแค่ header Location ไม่โหลดหน้าเว็บ)
// ลิงก์อื่นที่ผู้ใช้ส่งมา ระบบเก็บไว้เฉย ๆ ไม่เปิดเอง
const SHORT_MAP_HOST = /^(maps\.app\.goo\.gl|goo\.gl|g\.co)$/i;
const isGoogleHost = (h) => /^(maps\.app\.goo\.gl|goo\.gl|g\.co)$/i.test(h) || /^(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/i.test(h);
// ลิงก์แผนที่ที่ยอมให้ขึ้นเป็นปุ่ม "ดูแผนที่" บนเว็บ
function isMapUrl(u) {
  const h = u.hostname.toLowerCase(), p = u.pathname;
  if (h === 'maps.app.goo.gl') return true;
  if (h === 'goo.gl') return /^\/maps/.test(p);
  if (h === 'g.co') return /^\/kgs\//.test(p);
  if (/^maps\.google\./.test(h) && isGoogleHost(h)) return true;
  if (/^(www\.)?google\./.test(h) && isGoogleHost(h)) return /^\/maps/.test(p);
  return h === 'maps.apple.com' || h === 'map.longdo.com';
}
// คืน { raw, url, map } — map = เป็นลิงก์แผนที่จริง
export function extractLink(text) {
  const str = String(text || '');
  const m = str.match(URL_IN_TEXT);
  if (!m) return null;
  let raw = m[0];
  // ลิงก์ Google Maps แบบยาว (คัดลอกจากเบราว์เซอร์) อาจมีภาษาไทยดิบ ๆ ใน path — ต่อให้ครบถึงช่องว่าง
  // ลิงก์สั้น (maps.app.goo.gl/xxx) ยังตัดที่ตัวอักษร ASCII ตัวสุดท้าย ("…/AbCค่ะ" → "…/AbC")
  if (/^https?:\/\/(www\.|maps\.)?google\.[a-z.]+\/maps\//i.test(raw)) {
    const full = str.slice(m.index).match(/^https?:\/\/[^\s<>"'“”‘’]+/i);
    if (full) raw = full[0];
  }
  raw = raw.replace(/[)\].,;!?]+$/, '');
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.username || u.password) return null;
  return { raw, url: u.toString(), map: isMapUrl(u) };
}
// ชื่อสถานที่ / พิกัด จากลิงก์ Google Maps แบบยาว
export function parseMapUrl(href) {
  const out = { name: '', lat: null, lng: null };
  let u;
  try { u = new URL(href); } catch { return out; }
  const dec = (s) => { const t = String(s || '').replace(/\+/g, ' '); try { return decodeURIComponent(t); } catch { return t; } };
  const full = dec(u.href);
  let m = full.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/) || full.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (!m) {
    const q = u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('ll') || u.searchParams.get('daddr') || '';
    m = q.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
  }
  if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) { out.lat = +m[1]; out.lng = +m[2]; }
  const pm = u.pathname.match(/\/maps\/(?:place|search)\/([^/]+)/);
  const name = (pm ? dec(pm[1]) : dec(u.searchParams.get('q') || u.searchParams.get('query') || '')).split(',')[0].trim();
  if (name && !/^-?\d+(\.\d+)?\s*(,|$)/.test(name) && !/[°′″]/.test(name)) out.name = one(name, 80);
  return out;
}
// ลิงก์สั้น maps.app.goo.gl → อ่านปลายทางจาก header ทีละทอด (ไม่เกิน 3 ทอด) แล้วแกะชื่อ/พิกัด
export async function resolveMapLink(url, { timeout = 3000 } = {}) {
  let u;
  try { u = new URL(url); } catch { return { name: '', lat: null, lng: null }; }
  if (!isGoogleHost(u.hostname)) return { name: '', lat: null, lng: null };   // อ่านชื่อ/พิกัดเฉพาะลิงก์ของ Google
  let info = parseMapUrl(u.href);
  const deadline = Date.now() + timeout;        // รวมทุกทอดไม่เกิน 3 วิ (ต้องตอบไลน์ให้ทันเวลา)
  for (let hop = 0; hop < 3 && u.protocol === 'https:' && SHORT_MAP_HOST.test(u.hostname); hop++) {
    const left = deadline - Date.now();
    if (left < 200) break;
    try {
      const r = await fetch(u.href, { redirect: 'manual', signal: AbortSignal.timeout(left), headers: { 'User-Agent': 'BarnBarn-Neighbors/1.0' } });
      const loc = r.headers.get('location');
      if (!loc) break;
      u = new URL(loc, u);
      if (!isGoogleHost(u.hostname)) break;
      info = parseMapUrl(u.href);
    } catch { break; }
  }
  return info;
}

// ---------------------------------------------------------------- ที่อยู่ภาษาไทยจากหมุด
// ที่อยู่ที่ไลน์ส่งมากับหมุดเป็นภาษาตามเครื่อง (มักอังกฤษปนไทย) → ขอที่อยู่ภาษาไทยจาก OpenStreetMap (ฟรี ไม่ต้องมีคีย์)
// กติกาของ OSM: ไม่เกิน 1 ครั้ง/วินาที · บอกชื่อแอปใน User-Agent · ใส่เครดิต (หน้าเว็บมีบรรทัดเครดิตให้แล้ว)
const hasThai = (s) => /[฀-๿]/.test(s || '');
const hasLatinWords = (s) => /[A-Za-z]{3,}/.test(String(s || '').replace(/thailand/ig, ''));
export function cleanLineAddress(s) {
  return String(s || '').replace(/,?\s*(Thailand|ประเทศไทย)\s*$/i, '').replace(/\s+/g, ' ').trim();
}
const ROMAN_TH = [[/\bKrung Thep Maha Nakhon\b|\bBangkok\b/gi, 'กรุงเทพมหานคร'], [/\bKhwaeng\s+/gi, 'แขวง '], [/\bKhet\s+/gi, 'เขต '],
  [/\bTambon\s+/gi, 'ตำบล '], [/\bAmphoe\s+/gi, 'อำเภอ '], [/\bChang Wat\s+/gi, 'จังหวัด '], [/\bSoi\s+/gi, 'ซอย '], [/\bThanon\s+/gi, 'ถนน ']];
export function romanFallback(s) {          // ใช้ตอนขอที่อยู่ไทยไม่สำเร็จ — แปลงคำนำหน้าเท่าที่แปลงได้
  let out = cleanLineAddress(s);
  for (const [re, th] of ROMAN_TH) out = out.replace(re, th);
  return out.replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
}
// รวมที่อยู่จาก OSM: เลขที่/ซอยใช้ของไลน์ถ้าเป็นภาษาไทยอยู่แล้ว (ละเอียดกว่า) + แขวง/เขต/จังหวัด/รหัสไปรษณีย์ จาก OSM
export function formatThaiAddress(a, lineAddress = '') {
  a = a || {};
  // "29 ซอย 7 บ้านราชพฤกษ์ Khwaeng Saen Saep, ..." → เอาช่วงภาษาไทยด้านหน้า "29 ซอย 7 บ้านราชพฤกษ์"
  const first = cleanLineAddress(lineAddress).split(',')[0].split(/\s+(?=[A-Za-z]{3,})/)[0].trim();
  const fromLine = hasThai(first) && !hasLatinWords(first) ? first : '';
  const local = fromLine || [a.house_number, a.road].filter(Boolean).join(' ');
  const keys = ['quarter', 'suburb', 'city_district', 'district', 'town', 'municipality', 'county', 'city', 'state', 'province'];
  if (!fromLine) keys.unshift('village', 'hamlet');
  const parts = [];
  for (const k of keys) {
    const v = String(a[k] || '').trim();
    if (!v || !hasThai(v) || parts.includes(v) || local.includes(v)) continue;
    parts.push(v);
  }
  if (!parts.length) return '';
  return [local, ...parts, /^\d{5}$/.test(a.postcode || '') ? a.postcode : ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
const GEO_UA = 'BarnBarn-Neighbors/1.0 (' + ((process.env.PUBLIC_BASE_URL || '').trim() || 'barnbarn-workshop.onrender.com') + ')';
const _geo = new Map();
let _geoNext = 0;
// คืน { text, src: 'osm' | 'line' }
export async function thaiAddress(lat, lng, lineAddress = '', { timeout = 6000 } = {}) {
  const clean = cleanLineAddress(lineAddress);
  const fallback = { text: romanFallback(clean), src: 'line' };
  if (clean && hasThai(clean) && !hasLatinWords(clean)) return { text: clean, src: 'line' };   // เป็นภาษาไทยอยู่แล้ว
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fallback;
  const key = lat.toFixed(5) + ',' + lng.toFixed(5) + '|' + clean;
  if (_geo.has(key)) return _geo.get(key);
  const wait = _geoNext - Date.now();
  _geoNext = Math.max(Date.now(), _geoNext) + 1100;
  if (wait > 0) await sleep(wait);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&layer=address&addressdetails=1&accept-language=th`;
    const r = await fetch(url, { headers: { 'User-Agent': GEO_UA, 'Accept-Language': 'th' }, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const th = formatThaiAddress(j && j.address, clean);
    if (!th) return fallback;
    const res = { text: th, src: 'osm' };
    _geo.set(key, res);
    if (_geo.size > 300) _geo.delete(_geo.keys().next().value);
    return res;
  } catch (e) {
    console.error('เพื่อนบ้าน: ขอที่อยู่ภาษาไทยไม่สำเร็จ', e.message);
    return fallback;
  }
}

// คำที่เริ่มการฝากกิจกรรม — ตั้งใจให้แคบ เพราะลูกค้าเวิร์กช็อปพิมพ์ "ลงกิจกรรม" / "เห็นประกาศกิจกรรม" กันบ่อย
// ถ้าคำกว้างไป บอทจะแย่งแชทที่แอดมินควรตอบเอง · ข้อความยาวถือว่าเป็นการคุยกับแอดมิน ไม่เริ่มระบบ
const isTrigger = (t) => {
  const s = String(t || '').replace(/\s/g, '');
  if (['เพื่อนบ้าน', 'เพื่อนบ้านบ้าน-บ้าน', 'เพื่อนบ้านบ้านบ้าน', 'ฝากประกาศ'].includes(s)) return true;
  return s.length <= 30 && /ฝากกิจกรรม|ฝากประกาศกิจกรรม/.test(s);
};
const isCancel = (t) => /^(ยกเลิก|ไม่เอาแล้ว|cancel)$/i.test(String(t || '').trim());
const isBack = (t) => /^(ย้อน|ย้อนกลับ|กลับ|แก้ข้อก่อน)$/.test(String(t || '').trim());
const isRestart = (t) => /^เริ่มใหม่$/.test(String(t || '').trim());
const isSkip = (t) => /^(ข้าม|ไม่มี|ไม่มีค่ะ|ไม่มีครับ|ไม่มีรูป|ไม่มีแล้ว|ไม่ใส่|ไม่ใส่เบอร์|-|ไม่)$/.test(String(t || '').trim());
const isYes = (t) => /^(ส่ง|ส่งเลย|ตกลง|ถูกต้อง|ใช่|โอเค|ok|ok\s*ค่ะ)$/i.test(String(t || '').trim());

// ---------------------------------------------------------------- ชิ้นส่วนการ์ด (Flex)
const T = (text, o = {}) => ({ type: 'text', text: cut(String(text), 2000), wrap: true, ...o });
// กล่องว่างทำให้ไลน์ปฏิเสธทั้งการ์ด จึงคืน null แล้วให้ตัวแม่ตัดทิ้ง
const box = (contents, spacing = 'md', o = {}) => {
  const c = contents.filter(Boolean);
  return c.length ? { type: 'box', layout: 'vertical', spacing, contents: c, ...o } : null;
};
const pb = (data, displayText) => ({ type: 'postback', data: cut(data, 300), ...(displayText ? { displayText: cut(displayText, 300) } : {}) });
const uri = (u) => ({ type: 'uri', uri: u });
function btn(label, action, style = 'secondary') {
  const b = { type: 'button', style, height: 'md', action: { ...action, label: cut(label, 20) } };
  if (style === 'primary') b.color = C.orange;
  if (style === 'secondary') b.color = C.beige;
  if (style === 'link') b.color = C.terra;
  return b;
}
const row = (icon, text) => (text ? {
  type: 'box', layout: 'baseline', spacing: 'sm',
  contents: [T(icon, { flex: 0, size: 'md' }), T(text, { flex: 1, size: 'md', color: C.ink })]
} : null);
const bubble = ({ hero, body, footer }) => {
  const b = { type: 'bubble', size: 'mega', body: body || box([T('บ้าน-บ้าน', { size: 'md' })]) };
  if (hero) b.hero = hero;
  if (footer) b.footer = footer;
  return b;
};
const flexMsg = (altText, contents, quickReply) => ({ type: 'flex', altText: cut(altText || 'ข้อความจากบ้าน-บ้าน', 300), contents, ...(quickReply ? { quickReply } : {}) });
const qr = (actions) => {
  const items = actions.filter(Boolean).slice(0, 13).map((a) => ({ type: 'action', action: { ...a, label: cut(a.label, 20) } }));
  return items.length ? { items } : undefined;
};
const QR_BACK = { type: 'postback', label: '↩️ ย้อนกลับ', data: 'nb:back', displayText: 'ย้อนกลับ' };
const QR_CANCEL = { type: 'postback', label: '✖️ ยกเลิก', data: 'nb:cancel', displayText: 'ยกเลิก' };
const QR_CAMERA = { type: 'camera', label: '📷 ถ่ายรูป' };
const QR_ROLL = { type: 'cameraRoll', label: '🖼️ เลือกรูป' };
const QR_LOC = { type: 'location', label: '📍 ส่งตำแหน่ง' };
const QR_START = { type: 'postback', label: '🏡 ฝากกิจกรรม', data: 'nb:start', displayText: 'ฝากกิจกรรม' };

// ปุ่มลอยสำหรับแนบกับข้อความต้อนรับตอนมีคนแอดเพื่อน
export const startQuickReply = () => qr([QR_START]);

const httpsBase = (base) => (/^https:\/\//.test(base || '') ? base : '');
// รูปบนหัวการ์ด: รูปกิจกรรมก่อน ไม่มีค่อยใช้ใบประกาศ (ใบประกาศแสดงแบบไม่ครอปตัวหนังสือ)
function heroOf(it, base) {
  if (!httpsBase(base)) return null;
  const p = (it.photos || [])[0], q = (it.posters || [])[0];
  if (p) return { type: 'image', url: `${base}/api/neighbors/media/${p.id}`, size: 'full', aspectRatio: '16:9', aspectMode: 'cover' };
  if (q) return { type: 'image', url: `${base}/api/neighbors/media/${q.id}`, size: 'full', aspectRatio: '4:3', aspectMode: 'fit', backgroundColor: '#f3ede2' };
  return null;
}
const CAMERA = 'https://line.me/R/nv/camera/';
const ROLL = 'https://line.me/R/nv/cameraRoll/single';
const PLACE_STEPS = new Set(['place', 'placeLink', 'placeName']);
const hhmmData = (t) => String(t || '').replace(':', '');                 // "09:30" → "0930" (ในปุ่มห้ามมี :)
const hhmmFromData = (v) => (/^\d{4}$/.test(v || '') && +v.slice(0, 2) < 24 && +v.slice(2) < 60 ? v.slice(0, 2) + ':' + v.slice(2) : '');

// ---------------------------------------------------------------- การ์ดคำถามแต่ละข้อ
function prevAnswer(it, step) {
  switch (step) {
    case 'title': return it.title;
    case 'when': case 'repeat': return whenLine(it);
    case 'time': return it.timeText;
    case 'place': case 'placeLink': return placeLine(it);
    case 'placeName': return it.placeName;
    case 'price': case 'priceAmount': case 'priceCustom': return priceLine(it);
    case 'contact': return contactLine(it);
    case 'contactPhone': return it.phone ? phoneFmt(it.phone) : '';
    case 'details': return it.details;
    default: return '';
  }
}

function mediaButtons(it, slot) {
  const ch = it.chat || {};
  const w = SLOT[slot].word;
  if (ch.returnTo === 'review' && slotCount(it, slot)) return [
    btn('📷 ถ่ายรูปใหม่', uri(CAMERA), 'primary'),
    btn('🖼️ เลือกรูปใหม่', uri(ROLL)),
    btn('🗑️ ไม่ใช้' + w, pb(`nb:ans:${slot}:clear`, 'ไม่ใช้' + w)),
    btn('ใช้' + w + 'เดิม', pb('nb:review', 'ใช้' + w + 'เดิม'))
  ];
  return slot === 'poster'
    ? [btn('📷 ถ่ายรูปใบประกาศ', uri(CAMERA), 'primary'), btn('🖼️ เลือกจากเครื่อง', uri(ROLL)), btn('ไม่มีใบประกาศ ข้าม', pb('nb:ans:poster:skip', 'ไม่มีใบประกาศ'))]
    : [btn('📷 ถ่ายรูป', uri(CAMERA), 'primary'), btn('🖼️ เลือกจากเครื่อง', uri(ROLL)), btn('ไม่มีรูป ข้ามเลย', pb('nb:ans:photo:skip', 'ไม่มีรูป'))];
}

function helpButtons(it) {
  const on = new Set(wantsOf(it));
  const tog = (k) => {
    const sel = on.has(k);
    const b = btn((sel ? '✅ ' : '⬜ ') + WANT_LABEL[k], pb(`nb:ans:help:${k}.${sel ? 'off' : 'on'}`, (sel ? 'ไม่เอา ' : 'ขอ ') + WANT_LABEL[k]));
    if (sel) b.color = '#cfe8d5';
    return b;
  };
  return [tog('qr'), tog('map'), tog('register'),
    btn(on.size ? 'ตกลง ไปต่อ ➡️' : 'ไม่ต้องการ ไปต่อ ➡️', pb('nb:ans:help:done', on.size ? 'ตกลง' : 'ไม่ต้องการ'), 'primary')];
}

function stepButtons(it, step) {
  const today = NB.bkkToday();
  const ch = it.chat || {};
  switch (step) {
    case 'when': {
      const max = NB.bkkToday(730);
      return [
      btn('📅 เลือกวันจากปฏิทิน', { type: 'datetimepicker', data: 'nb:ans:when:pick', mode: 'date',
        initial: it.date && it.date >= today && it.date <= max ? it.date : today, min: today, max }, 'primary'),
      btn('🔁 จัดเป็นประจำ', pb('nb:ans:when:repeat', 'จัดเป็นประจำ')),
      btn('❔ ยังไม่แน่นอน', pb('nb:ans:when:unsure', 'ยังไม่แน่นอน'))
      ];
    }
    case 'repeat': return ['ทุกวันเสาร์', 'ทุกวันอาทิตย์', 'ทุกเสาร์–อาทิตย์', 'ทุกวัน']
      .map((t, i) => btn(t, pb('nb:ans:repeat:' + i, t), i === 0 ? 'primary' : 'secondary'));
    case 'time': return [
      btn('⏰ เลือกเวลาเริ่ม', { type: 'datetimepicker', data: 'nb:ans:time:pick', mode: 'time', initial: ch.timeStart || '09:00' }, 'primary'),
      btn('🌅 ช่วงเช้า', pb('nb:ans:time:morning', 'ช่วงเช้า')),
      btn('☀️ ช่วงบ่าย', pb('nb:ans:time:afternoon', 'ช่วงบ่าย')),
      btn('🌙 ช่วงเย็น', pb('nb:ans:time:evening', 'ช่วงเย็น'))
    ];
    case 'timeEnd': {
      // ปุ่มทุกปุ่มจำเวลาเริ่มของการ์ดนั้นไว้ด้วย (0900.1100) — กดการ์ดเก่าก็ได้คู่เวลาที่เห็นบนการ์ดนั้น ไม่ไปคู่กับเวลาเริ่มใหม่
      const s = ch.timeStart || '09:00', sd = hhmmData(s);
      const picks = [60, 120, 180].map((n) => addMin(s, n)).filter(Boolean);     // ไม่ข้ามเที่ยงคืน
      return [
        ...picks.map((t, i) => btn(`ถึง ${t} น.`, pb(`nb:ans:timeEnd:${sd}.${hhmmData(t)}`, `ถึง ${t} น.`), i === 0 ? 'primary' : 'secondary')),
        btn('⏰ เลือกเวลาเลิกเอง', { type: 'datetimepicker', data: `nb:ans:timeEnd:${sd}.pick`, mode: 'time', initial: addMin(s, 120) || '23:59', min: s }, picks.length ? 'secondary' : 'primary'),
        btn('ไม่ระบุเวลาเลิก', pb(`nb:ans:timeEnd:${sd}.none`, 'ไม่ระบุเวลาเลิก'), 'link')
      ];
    }
    case 'place': return [
      btn('📍 ปักหมุดในแผนที่', uri('https://line.me/R/nv/location/'), 'primary'),
      btn('🔗 แปะลิงก์แผนที่', pb('nb:ans:place:link', 'มีลิงก์ Google Maps'))
    ];
    case 'placeLink': return [
      btn('เปิด Google Maps', uri('https://maps.google.com/?openExternalBrowser=1'), 'primary'),
      btn('📍 ปักหมุดในไลน์แทน', uri('https://line.me/R/nv/location/')),
      btn('ไม่มีลิงก์', pb('nb:ans:placeLink:none', 'ไม่มีลิงก์'), 'link')
    ];
    case 'placeName': return [
      ch.placeCandidate ? btn('✓ ใช้ชื่อ “' + ch.placeCandidate + '”', pb('nb:ans:placeName:use', 'ใช้ชื่อ ' + ch.placeCandidate), 'primary') : null,
      btn('ไม่ต้องใส่ชื่อ', pb('nb:ans:placeName:none', 'ไม่ต้องใส่ชื่อ'), ch.placeCandidate ? 'secondary' : 'primary')
    ].filter(Boolean);
    case 'price': return [
      btn('🆓 ฟรี', pb('nb:ans:price:free', 'ฟรี'), 'primary'),
      btn('💰 มีค่าใช้จ่าย', pb('nb:ans:price:paid', 'มีค่าใช้จ่าย')),
      btn('🙏 ตามศรัทธา', pb('nb:ans:price:donation', 'ตามศรัทธา'))
    ];
    case 'priceAmount': return [
      ...[50, 100, 200, 300].map((n, i) => btn(n + ' บาท', pb('nb:ans:priceAmount:' + n, n + ' บาท'), i === 0 ? 'primary' : 'secondary')),
      btn('✏️ ระบุราคาเอง', pb('nb:ans:priceAmount:custom', 'ระบุราคาเอง'))
    ];
    case 'contact': return it.lineDisplayName
      ? [btn('👤 ใช้ชื่อในไลน์', pb('nb:ans:contact:me', 'ใช้ชื่อ ' + it.lineDisplayName), 'primary')]
      : [];
    case 'contactPhone': return [btn('ไม่ใส่เบอร์', pb('nb:ans:contactPhone:none', 'ไม่ใส่เบอร์'))];
    case 'poster': case 'photo': return mediaButtons(it, step);
    case 'details': return [btn('ไม่มีแล้ว ข้ามเลย', pb('nb:ans:details:skip', 'ไม่มีแล้ว'))];
    case 'help': return helpButtons(it);
    default: return [];
  }
}

function stepQuick(it, step) {
  const ch = it.chat || {};
  const back = (ch.history || []).length ? QR_BACK : null;
  const extra = {
    when: [{ type: 'message', label: 'เสาร์นี้', text: 'เสาร์นี้' }, { type: 'message', label: 'อาทิตย์นี้', text: 'วันอาทิตย์นี้' }],
    time: [{ type: 'postback', label: 'ทั้งวัน', data: 'nb:ans:time:allday', displayText: 'ทั้งวัน' }],
    place: [QR_LOC],
    placeName: [QR_LOC],
    poster: [QR_CAMERA, QR_ROLL],
    photo: [QR_CAMERA, QR_ROLL]
  }[step] || [];
  return qr([...extra, back, QR_CANCEL]);
}

function questionMessage(it, step, { ack, error } = {}) {
  const d = Q[step];
  const ch = it.chat || {};
  let hint = d.hint;
  if ((step === 'poster' || step === 'photo') && ch.returnTo === 'review' && slotCount(it, step)) {
    hint = `ตอนนี้มี${SLOT[step].word} ${slotCount(it, step)} รูป · ส่งรูปใหม่มาได้เลย ของเดิมจะถูกแทนที่`;
  }
  if (step === 'timeEnd') hint = `เริ่ม ${ch.timeStart || '-'} น. · ` + hint;
  if (step === 'placeName') {
    if (ch.placeCandidate) hint += `\nหรือกดปุ่มใช้ชื่อ “${one(ch.placeCandidate, 40)}”`;
    if (it.placeAddress) hint += `\n📍 ${one(it.placeAddress, 120)}`;
  }
  if (step === 'contact' && it.lineDisplayName) hint += `\nหรือกดปุ่มด้านล่าง ใช้ชื่อในไลน์ “${one(it.lineDisplayName, 40)}”`;
  const prev = ['poster', 'photo', 'help', 'timeEnd', 'placeName'].includes(step) ? '' : prevAnswer(it, step);
  const body = [
    ack ? T('✓ ' + one(ack, 110), { size: 'sm', color: C.green, weight: 'bold' }) : null,
    error ? T(error, { size: 'md', color: C.terra, weight: 'bold' }) : null,
    T(`ข้อ ${d.n} จาก ${TOTAL}` + (ch.returnTo === 'review' ? ' · กำลังแก้ไข' : ''), { size: 'sm', color: C.soft }),
    T(d.q, { size: 'xl', weight: 'bold', color: C.brown }),
    hint ? T(hint, { size: 'md', color: C.soft }) : null,
    prev ? T('คำตอบเดิม: ' + one(prev, 80), { size: 'sm', color: C.soft }) : null
  ];
  return flexMsg(`ข้อ ${d.n}: ${d.q}`, bubble({ body: box(body), footer: box(stepButtons(it, step), 'sm') }), stepQuick(it, step));
}

// ---------------------------------------------------------------- การ์ดสรุปกิจกรรม (ใช้ทั้งผู้ส่งและแอดมิน)
function activityBubble(it, { base, header, headerColor = C.brown, buttons = [], extraRows = [], note, showVoices = false, showWants = false } = {}) {
  const voices = showVoices ? (it.voices || []).length : 0;
  const body = [
    header ? T(header, { size: 'sm', weight: 'bold', color: headerColor }) : null,
    T(titleLine(it) || '(ยังไม่มีชื่อกิจกรรม)', { size: 'xl', weight: 'bold', color: C.ink }),
    box([
      row('📅', whenLine(it)),
      row('⏰', timeLine(it)),
      row('📍', placeLine(it)),
      row('💰', priceLine(it)),
      row('👤', contactLine(it)),
      row('📝', it.details ? one(it.details, 220) : (hasVoice(it, 'details') ? '🎤 ส่งเป็นเสียง' : '')),
      row('📄', mediaLine(it, 'poster')),
      row('📷', mediaLine(it, 'photo')),
      row('🎤', voices ? `มีเสียงแนบ ${voices} ไฟล์` : ''),
      row('🙋', showWants && wantsOf(it).length ? 'ขอให้บ้าน-บ้านช่วย: ' + wantsLine(it) : ''),
      ...extraRows
    ], 'sm'),
    note ? T(note, { size: 'sm', color: C.soft }) : null
  ];
  return bubble({ hero: heroOf(it, base), body: box(body), footer: box(buttons, 'sm') });
}

function reviewMessage(it, base, { ack } = {}) {
  const b = activityBubble(it, {
    base,
    showWants: true,
    header: (ack ? '✓ ' + one(ack, 110) + '\n' : '') + 'ตรวจดูอีกครั้งนะคะ หน้าตาบนเว็บจะเป็นแบบนี้',
    buttons: [
      btn('✅ ถูกต้อง ส่งเลย', pb('nb:submit', 'ส่งเลย'), 'primary'),
      btn('✏️ แก้ไข', pb('nb:edit', 'ขอแก้ไข')),
      btn('ยกเลิก', pb('nb:cancel', 'ยกเลิก'), 'link')
    ],
    note: 'กด “ส่งเลย” = ยินยอมให้บ้าน-บ้านเผยแพร่ข้อมูลนี้ (รวมชื่อและเบอร์ที่ให้ไว้) บนเว็บไซต์ หลังทีมงานตรวจแล้ว'
  });
  return flexMsg('ตรวจดูก่อนส่งนะคะ: ' + (it.title || 'กิจกรรมของคุณ'), b, qr([QR_CANCEL]));
}

function editMenuMessage(it) {
  const items = [['title', 'ชื่อกิจกรรม'], ['when', 'วันที่'], ['time', 'เวลา'], ['place', 'สถานที่'], ['price', 'ค่าใช้จ่าย'],
    ['contact', 'ผู้ติดต่อ / เบอร์'], ['poster', 'ใบประกาศ'], ['photo', 'รูปกิจกรรม'], ['details', 'รายละเอียด'], ['help', 'ให้บ้าน-บ้านช่วย']];
  const buttons = items.map(([k, l]) => ({ ...btn('✏️ ' + l, pb('nb:goto:' + k, 'แก้' + l)), height: 'sm' }));
  buttons.push(btn('กลับไปหน้าสรุป', pb('nb:review', 'กลับไปหน้าสรุป'), 'link'));
  return flexMsg('แก้ข้อไหนคะ?', bubble({ body: box([T('แก้ข้อไหนคะ?', { size: 'xl', weight: 'bold', color: C.brown }), T('กดเลือกข้อที่อยากแก้ได้เลย', { size: 'md', color: C.soft })]), footer: box(buttons, 'sm') }));
}

const simpleCard = (alt, title, lines, buttons = [], quick) => flexMsg(alt, bubble({
  body: box([T(title, { size: 'xl', weight: 'bold', color: C.brown }), ...lines.filter(Boolean).map((l) => T(l, { size: 'md', color: C.soft }))]),
  footer: box(buttons, 'sm')
}), quick);

function introMessage() {
  return simpleCard('ฝากกิจกรรมเพื่อนบ้าน', '🏡 ฝากกิจกรรมเพื่อนบ้าน', [
    'บ้าน-บ้านช่วยประกาศกิจกรรมของเพื่อนบ้านบนเว็บไซต์ให้ฟรีค่ะ',
    '• ตอบทีละข้อ ' + TOTAL + ' ข้อ (ข้ามได้ 4 ข้อ)\n• กดปุ่มตอบได้ ไม่ต้องพิมพ์เยอะ\n• พิมพ์ไม่ถนัด กดไมค์ 🎤 อัดเสียงตอบได้\n• มีใบประกาศ ถ่ายรูปส่งมาได้เลย\n• พิมพ์ “ยกเลิก” ได้ทุกเมื่อ'
  ]);
}

// ---------------------------------------------------------------- สถานะการถามตอบ
const NEXT = {
  title: 'when', when: 'time', repeat: 'time', time: 'place', timeEnd: 'place',
  place: 'price', placeLink: 'price', placeName: 'price',
  price: 'contact', priceAmount: 'contact', priceCustom: 'contact', contact: 'poster', contactPhone: 'poster',
  poster: 'photo', photo: 'details', details: 'help', help: 'review'
};
// ข้อย่อย → ข้อหลัก (ข้อในตระกูลเดียวกัน กดปุ่มข้ามกันได้โดยไม่นับว่า "แก้ข้อเก่า")
const MAIN = { repeat: 'when', timeEnd: 'time', placeLink: 'place', placeName: 'place', priceAmount: 'price', priceCustom: 'price', contactPhone: 'contact' };
const mainOf = (step) => MAIN[step] || step;
// ลำดับข้อ ใช้ตัดสินว่ารูปที่ส่งมานอกข้อรูป เป็นใบประกาศ (ส่งมาก่อนถึงข้อ 7) หรือรูปกิจกรรม
const ORDER = ['title', 'when', 'repeat', 'time', 'timeEnd', 'place', 'placeLink', 'placeName', 'price', 'priceAmount', 'priceCustom',
  'contact', 'contactPhone', 'poster', 'photo', 'details', 'help', 'review'];

function chatOf(it) {
  if (!it.chat) it.chat = { step: 'title', history: [], returnTo: null, startedAt: new Date().toISOString(), lastAt: new Date().toISOString() };
  it.chat.history = it.chat.history || [];
  return it.chat;
}

// ไปข้อถัดไป · sub = ข้อย่อยที่ต้องถามต่อ (เช่น เลือก "จัดเป็นประจำ" → ถามว่าทุกวันไหน)
function moveOn(it, from, sub) {
  const ch = chatOf(it);
  let to;
  if (sub) to = sub;
  else if (ch.returnTo) { to = ch.returnTo; ch.returnTo = null; }
  else {
    to = NEXT[from] || 'review';
    if (to === 'poster' && posterCount(it)) to = NEXT.poster;   // ส่งใบประกาศมาก่อนแล้ว ไม่ต้องถามซ้ำ
    if (to === 'photo' && photoCount(it)) to = NEXT.photo;
  }
  if (to !== 'poster' && to !== 'photo') ch.replacing = null;
  if (to !== 'timeEnd') delete ch.timePrev;          // ตอบเวลาเสร็จแล้ว ไม่ต้องจำค่าเดิม
  if (to !== ch.step) {
    ch.history.push(ch.step);
    if (ch.history.length > 30) ch.history = ch.history.slice(-30);
  }
  ch.step = to;
  return to;
}

function askCurrent(it, base, opts = {}) {
  const step = chatOf(it).step;
  if (step === 'review') return [reviewMessage(it, base, opts)];
  return [questionMessage(it, step, opts)];
}

// ---------------------------------------------------------------- ส่งข้อความ (reply ฟรี) + สำรองเป็นข้อความธรรมดา
// ประทับรหัสฉบับร่างลงในปุ่มทุกปุ่ม (nb:xxx|<id>) — กดปุ่มในการ์ดของรายการเก่า จะได้ไม่ไปแก้/ส่ง/ลบรายการปัจจุบัน
function stamp(node, id) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((x) => stamp(x, id)); return; }
  if (node.type === 'postback' || node.type === 'datetimepicker') {
    const d = String(node.data || '');
    if (d.startsWith('nb:') && !d.startsWith('nb:start') && !d.includes('|')) node.data = d + '|' + id;
  }
  for (const k of Object.keys(node)) if (node[k] && typeof node[k] === 'object') stamp(node[k], id);
}
async function send(replyToken, messages, it) {
  if (it && it.id) stamp(messages, it.id);
  const ok = await LINE.reply(replyToken, messages);
  if (ok || !LINE.lineConfigured()) return ok;
  // การ์ดส่งไม่ผ่าน (เช่น รูปเสีย) → ส่งเป็นตัวหนังสือแทน คนตอบจะได้ไม่ค้าง
  const plain = messages.map((m) => (m.type === 'flex' ? m.altText : m.text)).filter(Boolean).join('\n\n');
  return LINE.reply(replyToken, [{ type: 'text', text: cut(plain || 'ขออภัยค่ะ ระบบขัดข้อง พิมพ์ตอบได้เลยนะคะ', 4900) }]);
}

// ---------------------------------------------------------------- เรียก API ไลน์ (โหลดรูป/เสียง, ชื่อโปรไฟล์)
const TOKEN = () => process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
async function profileName(userId) {
  if (!TOKEN()) return '';
  try {
    const r = await fetch('https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId), {
      headers: { Authorization: 'Bearer ' + TOKEN() }, signal: AbortSignal.timeout(4000)
    });
    if (!r.ok) return '';
    const j = await r.json();
    return one(j.displayName || '', 60);
  } catch { return ''; }
}

// เสียงที่เพิ่งส่งมา ไลน์อาจยังเตรียมไฟล์ไม่เสร็จ (ตอบ 202) ต้องรอแล้วลองใหม่
async function lineContent(messageId, { tries = 1, wait = 2500, timeout = 20000 } = {}) {
  if (!TOKEN()) throw new Error('ยังไม่ได้ตั้ง LINE token');
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
      headers: { Authorization: 'Bearer ' + TOKEN() }, signal: AbortSignal.timeout(timeout)
    });
    if (r.status === 200) return { buf: Buffer.from(await r.arrayBuffer()), type: (r.headers.get('content-type') || '').split(';')[0].trim() };
    if (r.status === 202 && i < tries - 1) { await sleep(wait); continue; }
    throw new Error('LINE content ' + r.status);
  }
  throw new Error('LINE content not ready');
}

// โหลดรูป/เสียงเบื้องหลังเสมอ (ตอบคนส่งก่อน ไม่ให้ reply token หมดเวลา) · _inflight กันโหลดซ้ำไฟล์เดียวกัน
const _inflight = new Set();

// รูปที่รอโหลดอยู่ใน pendingPhotos / pendingPosters — โหลดเสร็จย้ายไป photos / posters
// ถ้าระหว่างนั้นถูกล้าง/แทนที่ไปแล้ว หรือช่องเต็ม ทิ้งไฟล์ใหม่
async function saveImageFromLine(itemId, messageId, slot) {
  const S = SLOT[slot] || SLOT.photo;
  if (_inflight.has(messageId)) return null;
  _inflight.add(messageId);
  const dropPending = (cur) => { if (cur) { cur[S.pending] = (cur[S.pending] || []).filter((x) => x !== messageId); NB.touch(cur); } };
  try {
    const { buf, type } = await lineContent(messageId, { tries: 3, wait: 1500 });
    const saved = await NB.putMedia({ kind: 'image', type: type || 'image/jpeg', buf, activityId: itemId, extra: { lineMessageId: messageId, slot } });
    const cur = NB.get(itemId);
    if (!cur || !(cur[S.pending] || []).includes(messageId) || (cur[S.key] || []).length >= S.max()) {
      await NB.deleteMedia([saved.id]);
      dropPending(cur);
      return null;
    }
    cur[S.key] = cur[S.key] || [];
    cur[S.key].push(saved);
    dropPending(cur);
    return saved;
  } catch (e) {
    console.error('เพื่อนบ้าน: โหลดรูปจากไลน์ไม่สำเร็จ', e.message);
    if (/ใหญ่เกินไป|ไฟล์ว่าง/.test(e.message)) dropPending(NB.get(itemId));   // ลองใหม่ก็ไม่ผ่าน ทิ้งเลย
    return null;
  } finally {
    _inflight.delete(messageId);
  }
}

async function saveVoiceFromLine(itemId, messageId) {
  if (_inflight.has(messageId)) return;
  _inflight.add(messageId);
  try {
    const { buf, type } = await lineContent(messageId, { tries: 8, wait: 2500 });
    const saved = await NB.putMedia({ kind: 'audio', type: type || 'audio/m4a', buf, activityId: itemId, extra: { lineMessageId: messageId } });
    const cur = NB.get(itemId);
    const v = cur && (cur.voices || []).find((x) => x.messageId === messageId);
    if (!v || (v.status === 'ready' && v.id)) { await NB.deleteMedia([saved.id]); return; }
    Object.assign(v, saved, { status: 'ready' });
    NB.touch(cur);
  } catch (e) {
    console.error('เพื่อนบ้าน: โหลดเสียงจากไลน์ไม่สำเร็จ', e.message);
    const cur = NB.get(itemId);
    const v = cur && (cur.voices || []).find((x) => x.messageId === messageId);
    if (v && v.status !== 'ready') { v.status = 'failed'; v.lastTry = new Date().toISOString(); NB.touch(cur); }
  } finally {
    _inflight.delete(messageId);
  }
}

// ลองโหลดรูป/เสียงที่ค้างอีกรอบ (หน้าแอดมินเรียกตอนเปิดดู) — ไลน์เก็บไฟล์ไว้ให้ไม่นาน ลองได้ภายใน ~7 วัน
const _retryAt = new Map();
export function refreshMedia(it) {
  if (!it || !TOKEN()) return;
  const waiting = (it.pendingPhotos || []).length || (it.pendingPosters || []).length || (it.voices || []).some((v) => v.status !== 'ready');
  if (!waiting) return;
  const last = _retryAt.get(it.id) || 0;
  if (Date.now() - last < 5 * 60e3) return;
  if (Date.now() - new Date(it.createdAt).getTime() > 7 * 864e5) return;
  _retryAt.set(it.id, Date.now());
  (async () => {
    for (const mid of [...(it.pendingPosters || [])]) await saveImageFromLine(it.id, mid, 'poster');
    for (const mid of [...(it.pendingPhotos || [])]) await saveImageFromLine(it.id, mid, 'photo');
    for (const v of (it.voices || []).filter((x) => x.status !== 'ready' && x.messageId)) await saveVoiceFromLine(it.id, v.messageId);
  })().catch(() => {});
}

// ---------------------------------------------------------------- ทำงานทีละคน ไม่ให้ข้อความของคนเดียวกันแซงกัน
const queues = new Map();
function inQueue(userId, fn) {
  const prev = queues.get(userId) || Promise.resolve();
  const next = prev.then(fn).catch((e) => { console.error('เพื่อนบ้าน chat:', e.message); return true; });
  queues.set(userId, next);
  next.finally(() => { if (queues.get(userId) === next) queues.delete(userId); });
  return next;
}

let lastBase = '';
function baseOf(req) {
  const env = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (env) return env;
  const host = req && typeof req.get === 'function' ? req.get('host') : '';
  if (host) {
    const local = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host);
    lastBase = (local ? 'http://' : 'https://') + host;
  }
  return lastBase;
}

// ================================================================ ทางเข้าหลัก
// เรียกจาก webhook ใน server.js · คืน true ถ้าเป็นเรื่องของระบบนี้ (ตอบไปแล้ว)
// คืน false = ไม่เกี่ยว ปล่อยให้แอดมินตอบเองในแอป LINE OA เหมือนเดิม
const _seen = new Set();   // กันไลน์ส่งเหตุการณ์เดิมซ้ำ (redelivery) แล้วระบบเดินข้ามไป 2 ข้อ
export function handleLineEvent(ev, req) {
  const src = ev && ev.source;
  if (!src || src.type !== 'user' || !src.userId) return Promise.resolve(false);
  if (ev.type !== 'message' && ev.type !== 'postback') return Promise.resolve(false);
  if (ev.webhookEventId) {
    if (_seen.has(ev.webhookEventId)) return Promise.resolve(true);
    _seen.add(ev.webhookEventId);
    if (_seen.size > 1000) _seen.delete(_seen.values().next().value);
  }
  const base = baseOf(req);
  const data = ev.type === 'postback' ? String((ev.postback && ev.postback.data) || '') : '';
  if (data.startsWith('nbadm:')) return inQueue(src.userId, () => onAdminPostback(ev, base));
  return inQueue(src.userId, () => onUserEvent(ev, base));
}

async function onUserEvent(ev, base) {
  const userId = ev.source.userId;
  const token = ev.replyToken;
  const msg = ev.type === 'message' ? ev.message || {} : null;
  const text = msg && msg.type === 'text' ? String(msg.text || '').trim() : null;
  const rawData = ev.type === 'postback' ? String((ev.postback && ev.postback.data) || '') : '';
  const [data, stampId = ''] = rawData.split('|');
  const params = (ev.postback && ev.postback.params) || {};
  const isNb = data.startsWith('nb:');
  const [, cmd = '', a = '', b = ''] = isNb ? data.split(':') : [];

  let it = NB.draftOf(userId);

  // ปุ่มจากการ์ดของรายการอื่น (ส่งไปแล้ว / ยกเลิกไปแล้ว) — ไม่ให้ไปมีผลกับรายการที่กำลังทำอยู่
  if (isNb && cmd !== 'start' && stampId && (!it || it.id !== stampId)) {
    if (it) {
      chatOf(it).paused = false; it.chat.lastAt = new Date().toISOString(); NB.touch(it);
      await send(token, askCurrent(it, base, { ack: 'ปุ่มนั้นเป็นของรายการก่อนหน้านะคะ ตอบข้อนี้ต่อได้เลย' }), it);
    } else {
      await send(token, [simpleCard('รายการนี้จบไปแล้ว', 'รายการนี้จบไปแล้วค่ะ', ['ส่งไปแล้วหรือยกเลิกไปแล้ว ถ้าจะฝากกิจกรรมใหม่ กดปุ่มด้านล่างได้เลยนะคะ'],
        [btn('🏡 ฝากกิจกรรมใหม่', pb('nb:start', 'ฝากกิจกรรม'), 'primary')])], it);
    }
    return true;
  }

  // ---- เริ่ม ----
  if ((isNb && cmd === 'start') || (text && isTrigger(text))) {
    if (it) {
      const ch = chatOf(it);
      ch.paused = false; ch.lastAt = new Date().toISOString(); NB.touch(it);
      const msgs = askCurrent(it, base);
      msgs[0] = withAck(msgs[0], 'ยังมีที่ตอบค้างไว้ ทำต่อจากเดิมเลยนะคะ');
      addQuick(msgs[msgs.length - 1], { type: 'postback', label: '🔄 เริ่มใหม่', data: 'nb:restart', displayText: 'เริ่มใหม่' });
      await send(token, msgs, it);
      return true;
    }
    const mine = NB.byUser(userId);
    if (mine.filter((x) => x.status === NB.STATUS.PENDING).length >= MAX_PENDING_PER_USER) {
      await send(token, [{ type: 'text', text: `ตอนนี้มีกิจกรรมของคุณรอทีมงานตรวจอยู่ ${MAX_PENDING_PER_USER} รายการแล้วค่ะ 🙏\nรอตรวจเสร็จก่อนนะคะ แล้วค่อยฝากเพิ่มได้` }], it);
      return true;
    }
    it = NB.create({ lineUserId: userId, status: NB.STATUS.DRAFT });
    chatOf(it);
    it.lineDisplayName = await profileName(userId);
    NB.touch(it);
    await send(token, [introMessage(), questionMessage(it, 'title')], it);
    return true;
  }

  // ---- ไม่มีฉบับร่าง ----
  if (!it) {
    if (isNb) {   // กดปุ่มในการ์ดเก่า หลังส่งไปแล้ว/ยกเลิกไปแล้ว
      await send(token, [simpleCard('รายการนี้จบไปแล้ว', 'รายการนี้จบไปแล้วค่ะ', ['ส่งไปแล้วหรือยกเลิกไปแล้ว ถ้าจะฝากกิจกรรมใหม่ กดปุ่มด้านล่างได้เลยนะคะ'],
        [btn('🏡 ฝากกิจกรรมใหม่', pb('nb:start', 'ฝากกิจกรรม'), 'primary')])], it);
      return true;
    }
    return false;
  }

  const ch = chatOf(it);
  const touchNow = () => { ch.lastAt = new Date().toISOString(); NB.touch(it); };

  // ---- เงียบไปนาน: ถามก่อนว่าจะทำต่อไหม ไม่เอาข้อความใหม่ไปเป็นคำตอบ ----
  if (isNb) ch.paused = false;       // กดปุ่มของระบบนี้ = กลับมาทำต่อแล้ว
  else if (ch.paused) {
    // รอให้กด "ทำต่อ" ก่อน ข้อความอื่นปล่อยให้แอดมินตอบ (ยกเว้นพิมพ์ ยกเลิก / เริ่มใหม่)
    if (!(text && (isCancel(text) || isRestart(text)))) return false;
    ch.paused = false;
  } else {
    if (Date.now() - new Date(ch.lastAt).getTime() > IDLE_MS) {
      ch.paused = true; NB.touch(it);
      await send(token, [simpleCard('ยังจะฝากกิจกรรมต่อไหมคะ?', 'ยังจะฝากกิจกรรมต่อไหมคะ?',
        [`ตอบไว้ถึงข้อ ${(Q[ch.step] || { n: TOTAL }).n} แล้ว` + (it.title ? ` (“${one(it.title, 40)}”)` : '')],
        [btn('▶️ ทำต่อ', pb('nb:resume', 'ทำต่อ'), 'primary'), btn('🔄 เริ่มใหม่', pb('nb:restart', 'เริ่มใหม่')), btn('ยกเลิก', pb('nb:cancel', 'ยกเลิก'), 'link')])], it);
      return true;
    }
  }

  // ---- คำสั่งทั่วไป ----
  if ((isNb && cmd === 'cancel') || (text && isCancel(text))) {
    await send(token, [simpleCard('ยกเลิกการฝากกิจกรรม?', 'ยกเลิกการฝากกิจกรรมนี้ใช่ไหมคะ?', ['ที่ตอบไว้จะหายไปทั้งหมด'],
      [btn('ใช่ ยกเลิก', pb('nb:cancelYes', 'ใช่ ยกเลิก'), 'primary'), btn('ไม่ ทำต่อ', pb('nb:resume', 'ทำต่อ'))])], it);
    return true;
  }
  if (isNb && cmd === 'cancelYes') {
    await NB.remove(it.id);
    await send(token, [{ type: 'text', text: 'ยกเลิกเรียบร้อยค่ะ 🙏\nถ้าจะฝากกิจกรรมใหม่ พิมพ์ “ฝากกิจกรรม” หรือกดปุ่มด้านล่างได้เลยนะคะ', quickReply: qr([QR_START]) }], it);
    return true;
  }
  if ((isNb && cmd === 'restart') || (text && isRestart(text))) {
    const keep = { lineUserId: it.lineUserId, lineDisplayName: it.lineDisplayName };
    await NB.remove(it.id);
    it = NB.create({ ...keep, status: NB.STATUS.DRAFT });
    chatOf(it); NB.touch(it);
    await send(token, [questionMessage(it, 'title', { ack: 'เริ่มใหม่ตั้งแต่ข้อแรกนะคะ' })], it);
    return true;
  }
  if (isNb && cmd === 'resume') {
    ch.paused = false; touchNow();
    await send(token, askCurrent(it, base, { ack: 'ทำต่อจากเดิมนะคะ' }), it);
    return true;
  }
  // ออกจากข้อเวลาเลิกโดยยังไม่ได้ตอบ (ย้อนกลับ / ไปหน้าสรุป / ไปแก้ข้ออื่น / กดส่ง) → คืนค่าเวลาเดิม
  const leaveTimeEnd = () => { if (ch.step === 'timeEnd' && 'timePrev' in ch) { it.timeText = ch.timePrev; delete ch.timePrev; } };
  if ((isNb && cmd === 'back') || (text && isBack(text))) {
    leaveTimeEnd();
    if (ch.returnTo === 'review') {      // กำลังแก้จากหน้าสรุป → ย้อนกลับไปหน้าสรุป
      ch.step = 'review'; ch.returnTo = null; touchNow();
      await send(token, [reviewMessage(it, base, { ack: 'กลับมาหน้าสรุปค่ะ' })], it);
      return true;
    }
    const prev = ch.history.pop();
    if (prev) { ch.step = prev; ch.returnTo = null; }
    touchNow();
    await send(token, askCurrent(it, base, { ack: prev ? 'ย้อนกลับมาข้อก่อนหน้าค่ะ' : '' }), it);
    return true;
  }
  if (isNb && cmd === 'edit') { touchNow(); await send(token, [editMenuMessage(it)], it); return true; }
  if (isNb && cmd === 'review') {
    leaveTimeEnd();
    ch.step = 'review'; ch.returnTo = null; touchNow();
    await send(token, [reviewMessage(it, base)], it);
    return true;
  }
  if (isNb && cmd === 'goto' && Q[a]) {
    leaveTimeEnd();
    ch.returnTo = 'review'; ch.step = a; touchNow();
    await send(token, [questionMessage(it, a)], it);
    return true;
  }
  if ((isNb && cmd === 'submit') || (text && ch.step === 'review' && isYes(text))) { leaveTimeEnd(); return submit(it, token, base); }

  // ---- รูป (ส่งมาข้อไหนก็ได้) ----
  if (msg && msg.type === 'image') return onImage(it, msg, token, base);

  // ---- ตำแหน่ง (ปักหมุด) ----
  if (msg && msg.type === 'location') return onLocation(it, msg, token, base);

  // ---- เสียง ----
  if (msg && msg.type === 'audio') {
    if ((it.voices || []).length >= MAX_VOICES) {
      await send(token, askCurrent(it, base, { error: 'ส่งเสียงได้สูงสุด ' + MAX_VOICES + ' ไฟล์ค่ะ ข้อนี้ลองพิมพ์หรือกดปุ่มแทนนะคะ' }), it);
      return true;
    }
    const vstep = VOICE_STEP[ch.step];
    const step = vstep || 'details';
    it.voices = it.voices || [];
    it.voices.push({ id: '', messageId: msg.id, step, duration: Number(msg.duration) || 0, status: 'pending', at: new Date().toISOString() });
    saveVoiceFromLine(it.id, msg.id);         // โหลดเบื้องหลัง ไม่ต้องรอ
    if (vstep) {
      moveOn(it, ch.step);               // ตอบด้วยเสียงแล้วไปข้อถัดไปเลย (ข้ามข้อย่อย แอดมินฟังเอา)
      touchNow();
      await send(token, askCurrent(it, base, { ack: `ได้รับเสียงเรื่อง${FIELD_LABEL[step]}แล้วค่ะ 🎤 ทีมงานจะฟังแล้วพิมพ์ให้` }), it);
    } else {
      touchNow();
      await send(token, askCurrent(it, base, { ack: 'ได้รับเสียงแล้วค่ะ 🎤 ทีมงานจะฟังให้' }), it);
    }
    return true;
  }

  // ---- สติกเกอร์ / วิดีโอ / ไฟล์ ----
  if (msg && msg.type === 'sticker') { touchNow(); await send(token, askCurrent(it, base, { ack: 'ขอบคุณสติกเกอร์ค่ะ 😊 ตอบข้อนี้ได้เลยนะคะ' }), it); return true; }
  if (msg && msg.type !== 'text') { touchNow(); await send(token, askCurrent(it, base, { error: 'ตอนนี้รับได้แค่ข้อความ รูป เสียง และตำแหน่งนะคะ' }), it); return true; }

  // ---- คำตอบจากปุ่ม (ปุ่มของข้อเก่าก็กดได้ ถือว่าแก้ข้อนั้น แล้วกลับมาข้อเดิม) ----
  if (isNb && cmd === 'ans') {
    const step = a;
    if (!Q[step]) return true;
    if (step !== ch.step) {
      // ข้อเดียวกัน (เช่น อยู่ข้อย่อยแล้วกดตัวเลือกของข้อหลักใหม่) = เปลี่ยนใจ ไม่ต้องกลับมาข้อเดิม
      if (mainOf(step) === mainOf(ch.step)) ch.step = step;
      else { if (!ch.returnTo) ch.returnTo = ch.step; ch.step = step; }
    }
    return answerButton(it, step, b, params, token, base);
  }

  // ---- คำตอบที่พิมพ์ ----
  if (text != null) return answerText(it, text, token, base);
  return true;
}

function withAck(message, ack) {
  // แทรกบรรทัดยืนยันไว้บนสุดของการ์ด
  if (message && message.type === 'flex' && message.contents && message.contents.body) {
    message.contents.body.contents.unshift(T('✓ ' + one(ack, 70), { size: 'sm', color: C.green, weight: 'bold' }));
  }
  return message;
}
function addQuick(message, action) {
  if (!message) return;
  const items = (message.quickReply && message.quickReply.items) || [];
  items.unshift({ type: 'action', action: { ...action, label: cut(action.label, 20) } });
  message.quickReply = { items: items.slice(0, 13) };
}

// รูปที่ส่งมา: ข้อใบประกาศ → ใบประกาศ · ข้อรูปกิจกรรม → รูปกิจกรรม
// ส่งมานอกสองข้อนี้: ก่อนถึงข้อ 7 ถือเป็นใบประกาศ (ข้อความต้อนรับบอกว่า "มีใบประกาศ ถ่ายรูปส่งมาได้เลย") หลังจากนั้นเป็นรูปกิจกรรม
function slotForImage(it, step) {
  if (step === 'poster' || step === 'photo') return step;
  const early = ORDER.indexOf(step) < ORDER.indexOf('poster');
  if (early) return posterCount(it) < NB.MAX_POSTERS ? 'poster' : 'photo';
  return photoCount(it) < NB.MAX_PHOTOS ? 'photo' : 'poster';
}

async function onImage(it, msg, token, base) {
  const ch = chatOf(it);
  const set = msg.imageSet;              // ส่งหลายรูปพร้อมกัน ไลน์แยกมาทีละรูป
  const known = !!(set && ch.imgSet && ch.imgSet.id === set.id);
  // ไลน์รุ่นเก่า (Android ≤ 11.15) ไม่ส่งลำดับรูปมา → ถือว่ารูปแรกที่เห็นของชุดนั้นคือรูปแรก
  const firstOfSet = !set || (set.index != null ? Number(set.index) === 1 : !known);
  // ทั้งชุดลงช่องเดียวกัน (ตัดสินจากรูปแรกของชุด)
  let slot = known ? ch.imgSet.slot : slotForImage(it, ch.step);
  // แก้รูปจากหน้าสรุป: รูปแรกที่ส่งมาใหม่แทนของเดิมทั้งหมดในช่องนั้น
  if (ch.step === slot && ch.returnTo === 'review' && ch.replacing !== slot && slotCount(it, slot)) {
    const S = SLOT[slot];
    const old = (it[S.key] || []).map((p) => p.id);
    it[S.key] = []; it[S.pending] = []; ch.replacing = slot; NB.touch(it);
    await NB.deleteMedia(old);
  }
  // จำจำนวนใบประกาศตอนเห็นชุดนี้ครั้งแรก (รูปในชุดอาจมาไม่เรียงลำดับ)
  if (set && !known) ch.imgSet = { id: set.id, slot, postersBefore: posterCount(it) };
  if (slotCount(it, slot) >= SLOT[slot].max()) {
    // ใบประกาศเต็มแล้ว รูปที่เกินเก็บเป็นรูปกิจกรรม · รูปกิจกรรมเต็มแล้ว ไม่รับเพิ่ม
    if (slot === 'poster' && photoCount(it) < NB.MAX_PHOTOS) slot = 'photo';
    else {
      if (firstOfSet) {
        await send(token, askCurrent(it, base, { error: `รับ${SLOT[slot].word}ได้ ${SLOT[slot].max()} รูปค่ะ ใช้ ${SLOT[slot].max()} รูปแรกนะคะ` }), it);
      }
      return true;
    }
  }
  const S = SLOT[slot];
  // ส่งใบประกาศมาเป็นชุดเกินที่รับได้ → รูปที่เกินจะเป็นรูปกิจกรรม (รู้ตั้งแต่รูปแรกจากจำนวนในชุด)
  const total = set ? Number(set.total) || 1 : 1;
  const postersBefore = set && ch.imgSet && ch.imgSet.id === set.id ? ch.imgSet.postersBefore : posterCount(it);
  const overflow = firstOfSet && slot === 'poster' ? Math.max(0, total - (NB.MAX_POSTERS - (postersBefore || 0))) : 0;
  it[S.pending] = [...(it[S.pending] || []), msg.id];
  NB.touch(it);
  saveImageFromLine(it.id, msg.id, slot);   // โหลดเบื้องหลัง ตอบคนส่งก่อน
  if (!firstOfSet) return true;             // ตอบครั้งเดียวต่อชุดรูป
  if (ch.step === 'poster' || ch.step === 'photo') moveOn(it, ch.step);
  if (overflow && ch.step === 'photo') moveOn(it, 'photo');   // ได้รูปกิจกรรมจากชุดนี้แล้ว ไม่ต้องถาม
  ch.lastAt = new Date().toISOString(); NB.touch(it);
  const many = total > 1 ? ` (${total} รูป)` : '';
  let ack = slot === 'poster' ? 'ได้รับใบประกาศแล้วค่ะ 📄' + many : 'ได้รับรูปแล้วค่ะ 📷' + many;
  if (overflow) ack += ` · ใบประกาศเก็บได้ ${NB.MAX_POSTERS} รูป ที่เหลือเก็บเป็นรูปกิจกรรมนะคะ`;
  await send(token, askCurrent(it, base, { ack }), it);
  return true;
}

// ---------------------------------------------------------------- ปักหมุด / ลิงก์แผนที่
const GENERIC_PIN_TITLE = /^(location|my location|current location|selected location|dropped pin|ตำแหน่ง(ที่ตั้ง|ปัจจุบัน|ของฉัน|ที่เลือก)?|หมุดที่ปัก)$/i;

// ขอที่อยู่ไทย รอไม่เกิน waitMs ที่เหลือทำต่อเบื้องหลัง (เสร็จทีหลังก็อัปเดตให้ ถ้ายังเป็นหมุดเดิม)
async function fillThaiAddress(it, lineAddress, waitMs) {
  const id = it.id, lat = it.lat, lng = it.lng, before = it.placeAddress;
  const job = thaiAddress(lat, lng, lineAddress).then((r) => {
    const cur = NB.get(id);
    if (!cur || cur.lat !== lat || cur.lng !== lng || cur.placeAddress !== before || !r || !r.text) return;
    cur.placeAddress = one(r.text, 200);
    cur.addrSrc = r.src;
    NB.touch(cur);
  }).catch(() => {});
  if (waitMs > 0) {
    let t;
    await Promise.race([job, new Promise((res) => { t = setTimeout(res, waitMs); })]);
    clearTimeout(t);
  }
}

async function onLocation(it, msg, token, base) {
  const ch = chatOf(it);
  const lat = Number(msg.latitude), lng = Number(msg.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    await send(token, askCurrent(it, base, { error: 'อ่านตำแหน่งไม่ได้ค่ะ ลองปักหมุดใหม่อีกครั้งนะคะ' }), it);
    return true;
  }
  const lineAddr = cleanLineAddress(msg.address || '');
  Object.assign(it, { lat, lng, mapUrl: '', placeAddress: one(romanFallback(lineAddr), 200), addrSrc: lineAddr ? 'line' : '' });
  let title = one(msg.title || '', 120);
  if (!title || GENERIC_PIN_TITLE.test(title) || cleanLineAddress(title) === lineAddr) title = '';
  await fillThaiAddress(it, lineAddr, 2500);
  const ack = 'ได้หมุดแล้วค่ะ 📍' + (it.placeAddress ? ' ' + one(it.placeAddress, 90) : '');
  if (PLACE_STEPS.has(ch.step)) {
    // ถามชื่อสถานที่อีกที — หมุดอาจเป็นร้านข้าง ๆ (ค้นชื่อจริงไม่เจอ เลยปักใกล้ ๆ)
    ch.placeCandidate = (ch.placeTyped && it.placeName) || title;
    moveOn(it, ch.step, 'placeName');
  } else if (!it.placeName && title) it.placeName = title;
  ch.lastAt = new Date().toISOString(); NB.touch(it);
  await send(token, askCurrent(it, base, { ack }), it);
  return true;
}

const stripPolite = (x) => String(x || '').replace(/(ขอบคุณ(มาก)?(ค่ะ|คะ|ครับ)?|นะคะ|นะครับ|ค่ะ|คะ|ครับ|จ้า|จ้ะ)/g, ' ').replace(/\s+/g, ' ').trim();
// ต้องมีระดับแขวง/ตำบลขึ้นไป หรือรหัสไปรษณีย์ — "ซอย" "ถนน" "กรุงเทพ" อย่างเดียวอาจเป็นชื่อร้าน ("ธนาคารกรุงเทพ" "ตลาดถนนคนเดิน")
// ต./อ./จ. ต้องไม่ใช่ตัวย่ออื่น ("ต.ค." "อ.ส.ม.")
const ADDR_WORDS = /(แขวง|เขต|ตำบล|อำเภอ|จังหวัด|(?:^|\s)[ตอจ]\.(?![ก-ฮ]\.)|\b\d{5}\b)/;
const looksLikeAddress = (x) => { const t = stripPolite(x); return t.length >= 6 && ADDR_WORDS.test(t); };
// ประโยคคุย ไม่ใช่ชื่อสถานที่ ("ขอบคุณค่ะ" "ส่งให้แล้วนะคะ" "ลองดูเพจนี้")
const CHATTER = /(ขอบคุณ|ส่งให้|ส่งมา|ส่งลิงก์|ฝาก|ลองดู|ดูได้|กดดู|กดลิงก์|คลิก|เชิญ|แชร์|ตามลิงก์|อันนี้|ตัวนี้|แล้วนะ|แล้วค่ะ|แล้วครับ)/;
// ชื่อสถานที่ที่จะเสนอให้กดยืนยัน — ตัดคำเกริ่น/คำลงท้ายออก ("นี่ค่ะ" "ค่ะ" ไม่ใช่ชื่อ)
export function nameCandidate(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) {
    t = t.replace(/^(นี่คือ|นี่|นี้|ลิงก์|ลิ้งค์|ลิงค์|link|แผนที่|ที่อยู่|พิกัด|โลเคชั่น|location|ตามนี้|ตรงนี้|ที่นี่)\s*[:：\-–]?\s*/i, '')
      .replace(/\s*(ค่ะ|คะ|ครับ|นะคะ|นะครับ|จ้า|จ้ะ|นะ|เลย)+\s*[.!]*$/, '').trim();
  }
  if (CHATTER.test(t)) return '';
  const core = t.replace(/[\s.,!?:：\-–()]+/g, '');
  return core.length >= 2 ? one(t, 120) : '';
}

// ข้อความที่มีลิงก์ (พิมพ์มาในข้อสถานที่) · แชร์จากแอป Google Maps มักมาเป็น "ชื่อ / ที่อยู่ / ลิงก์"
async function onMapLink(it, link, text, token, base) {
  const ch = chatOf(it);
  const rest = String(text).replace(link.raw, '\n');
  const lines = rest.split(/\n+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const reply = async (opts) => { ch.lastAt = new Date().toISOString(); NB.touch(it); await send(token, askCurrent(it, base, opts), it); return true; };
  if (!link.map) {
    // ไม่ใช่ลิงก์แผนที่ (เช่น เพจเฟซบุ๊ก) — ไม่เอาขึ้นปุ่ม "ดูแผนที่" บนเว็บ เก็บไว้ในโน้ตให้แอดมินดูแทน
    if (!String(it.adminNote || '').includes(link.url)) {
      it.adminNote = cut(((it.adminNote ? it.adminNote + '\n' : '') + 'ลิงก์ที่ผู้ส่งแนบมาตอนถามสถานที่: ' + link.url), 500);
    }
    const name = nameCandidate(lines.join(' '));
    if (name && ch.step !== 'placeLink') {           // มีข้อความอื่นมาด้วย → เสนอเป็นชื่อให้กดยืนยัน (อาจเป็นแค่ประโยคชวนคุย)
      ch.placeCandidate = name;
      moveOn(it, ch.step, 'placeName');
      return reply({ ack: 'ลิงก์ที่แนบมาไม่ใช่แผนที่ ทีมงานจะดูให้ค่ะ' });
    }
    return reply({ error: 'ลิงก์นี้ไม่ใช่ลิงก์แผนที่ค่ะ ลองเปิดแอป Google Maps → กด “แชร์” → “คัดลอกลิงก์” แล้ววางใหม่ หรือพิมพ์ชื่อสถานที่แทนก็ได้นะคะ' });
  }
  // ลิงก์ยาวที่คัดลอกจากเบราว์เซอร์ (เกิน 500 ตัว) — อ่านชื่อ/พิกัดในลิงก์ แล้วเก็บเป็นลิงก์ค้นหาสั้น ๆ แทน
  let url = link.url;
  const info = url.length > 500 ? parseMapUrl(url) : await resolveMapLink(url).catch(() => ({}));
  const pin = Number.isFinite(info.lat) && Number.isFinite(info.lng);
  if (url.length > 500) url = pin ? `https://www.google.com/maps/search/?api=1&query=${info.lat},${info.lng}` : '';
  if (!url) return reply({ error: 'ลิงก์ยาวเกินไปค่ะ ลองเปิดแอป Google Maps → กด “แชร์” → “คัดลอกลิงก์” (จะได้ลิงก์สั้น ๆ) แล้ววางใหม่นะคะ' });
  // แชร์จากแอป Google Maps (หลายบรรทัด) = บรรทัดแรกคือชื่อ บรรทัดถัดไปที่หน้าตาเป็นที่อยู่คือที่อยู่
  // พิมพ์บรรทัดเดียวพร้อมลิงก์ = มักเป็นประโยคคุย ("ส่งให้แล้วนะคะ") → ใช้ชื่อจาก Google ก่อน
  const shared = lines.length >= 2;
  const nameLine = shared ? lines[0] : (lines[0] && !looksLikeAddress(lines[0]) ? lines[0] : '');
  const addrLines = (shared ? lines.slice(1) : lines).filter(looksLikeAddress);
  const sharedAddr = one(addrLines.map(stripPolite).join(' '), 200);
  // หมุด/ที่อยู่เก่าไม่ตรงกับลิงก์ใหม่ ล้างทิ้ง
  Object.assign(it, { mapUrl: url, lat: pin ? info.lat : null, lng: pin ? info.lng : null, placeAddress: sharedAddr, addrSrc: sharedAddr ? 'user' : '' });
  if (!sharedAddr && pin) fillThaiAddress(it, '', 0);
  // ถามชื่อสถานที่ทุกครั้ง ให้กดยืนยันชื่อที่แชร์มา/ชื่อใน Google — กันคำอย่าง "ค่ะ" "นี่ค่ะ" กลายเป็นชื่อบนเว็บ
  const typed = nameCandidate(nameLine);
  ch.placeCandidate = (shared ? typed || info.name : info.name || typed) || (ch.placeTyped && it.placeName) || '';
  moveOn(it, ch.step, 'placeName');
  return reply({ ack: 'ได้ลิงก์แผนที่แล้วค่ะ 🔗' });
}

async function answerButton(it, step, val, params, token, base) {
  const ch = chatOf(it);
  const reask = async (error) => { await send(token, askCurrent(it, base, { error }), it); return true; };
  let ack = '', sub = null;
  switch (step) {
    case 'when':
      if (val === 'pick') {
        if (!params.date) return reask();
        Object.assign(it, { date: params.date, repeatText: '', whenText: '' });
        ack = 'วันที่: ' + thDate(params.date);
      } else if (val === 'repeat') { sub = 'repeat'; ack = 'จัดเป็นประจำ'; }
      else if (val === 'unsure') { Object.assign(it, { date: '', repeatText: '', whenText: 'ยังไม่แน่นอน' }); ack = 'วันที่: ยังไม่แน่นอน'; }
      break;
    case 'repeat': {
      const t = ['ทุกวันเสาร์', 'ทุกวันอาทิตย์', 'ทุกเสาร์–อาทิตย์', 'ทุกวัน'][Number(val)] || '';
      if (!t) return reask();
      Object.assign(it, { date: '', whenText: '', repeatText: t });
      ack = t;
      break;
    }
    case 'time': {
      const map = { morning: 'ช่วงเช้า', afternoon: 'ช่วงบ่าย', evening: 'ช่วงเย็น', allday: 'ทั้งวัน' };
      if (val === 'pick') {
        if (toMin(params.time) == null) return reask();
        if (!('timePrev' in ch)) ch.timePrev = it.timeText || '';   // กด "ย้อนกลับ" จากข้อเวลาเลิก จะได้คืนค่าเดิม
        ch.timeStart = params.time;
        it.timeText = timeRange(params.time);       // ถ้าไม่ตอบเวลาเลิก ก็ยังมีเวลาเริ่ม
        sub = 'timeEnd';
        ack = 'เริ่ม ' + params.time + ' น.';
      } else if (map[val]) { it.timeText = map[val]; ack = 'เวลา: ' + it.timeText; }
      else return reask();
      break;
    }
    case 'timeEnd': {
      const v = String(val);
      const [sd, what] = v.includes('.') ? v.split('.') : ['', v];
      const start = hhmmFromData(sd) || ch.timeStart;
      if (toMin(start) == null) { ch.step = 'time'; return reask(); }
      ch.timeStart = start;
      if (what === 'none') it.timeText = timeRange(start);
      else {
        const end = what === 'pick' ? params.time : hhmmFromData(what);
        if (toMin(end) == null) return reask();
        if (end !== start && !okRange(start, end)) return reask(`เวลาเลิกต้องหลังเวลาเริ่ม ${start} น. ค่ะ ลองเลือกใหม่อีกครั้งนะคะ`);
        it.timeText = timeRange(start, end === start ? '' : end);
      }
      ack = 'เวลา: ' + it.timeText;
      break;
    }
    case 'place':
      if (val === 'link') sub = 'placeLink';
      break;
    case 'placeLink':
      if (val === 'none') {
        if (!it.placeName && !Number.isFinite(it.lat) && !it.mapUrl) { sub = 'place'; ack = 'ไม่เป็นไรค่ะ พิมพ์ชื่อสถานที่ หรือกด 📍 ปักหมุดแทนได้เลย'; }
        else ack = 'ไม่มีลิงก์';
      }
      break;
    case 'placeName':
      if (val === 'use' && ch.placeCandidate) { it.placeName = one(ch.placeCandidate, 120); ch.placeTyped = true; ack = 'สถานที่: ' + it.placeName; }
      else if (val === 'none') { it.placeName = ''; ack = 'ไม่ใส่ชื่อสถานที่'; }
      else return reask();
      break;
    case 'price':
      if (val === 'free') Object.assign(it, { price: 0, priceText: 'ฟรี' });
      else if (val === 'donation') Object.assign(it, { price: null, priceText: 'ตามศรัทธา' });
      else if (val === 'paid') { sub = 'priceAmount'; Object.assign(it, { price: null, priceText: '' }); }
      ack = val === 'paid' ? 'มีค่าใช้จ่าย' : 'ค่าใช้จ่าย: ' + priceLine(it);
      break;
    case 'priceAmount': {
      if (val === 'custom') { sub = 'priceCustom'; break; }
      const n = Number(val);
      if (!(n > 0)) return reask();
      Object.assign(it, { price: n, priceText: '' });
      ack = 'ค่าใช้จ่าย: ' + priceLine(it);
      break;
    }
    case 'contact':
      if (val === 'me') {
        it.hostName = it.lineDisplayName || it.hostName;
        ack = 'ผู้ติดต่อ: ' + (it.hostName || '-');
        if (!it.phone) sub = 'contactPhone';
      }
      break;
    case 'contactPhone':
      if (val === 'none') { it.phone = ''; ack = 'ไม่ใส่เบอร์'; }
      break;
    case 'poster':
    case 'photo': {
      const S = SLOT[step];
      if (val === 'clear') {
        const old = (it[S.key] || []).map((p) => p.id);
        it[S.key] = []; it[S.pending] = [];
        await NB.deleteMedia(old);
        ack = 'ไม่ใช้' + S.word + 'แล้วค่ะ';
      } else ack = step === 'poster' ? 'ไม่มีใบประกาศ' : 'ไม่มีรูปกิจกรรม';
      break;
    }
    case 'details':
      if (val === 'skip') ack = 'ไม่มีรายละเอียดเพิ่ม';
      break;
    case 'help': {
      if (val === 'done') { ack = wantsOf(it).length ? 'ขอให้ช่วย: ' + wantsLine(it) : 'ไม่ต้องการความช่วยเหลือเพิ่ม'; break; }
      // เลือก/ไม่เลือก ทีละอย่าง แล้วถามข้อเดิมซ้ำ (ปุ่มบอกชัดว่าจะ "ขอ" หรือ "ไม่เอา" — กดปุ่มในการ์ดเก่าก็ไม่สลับผิด)
      const [k, onoff] = String(val).split('.');
      if (!WANT_LABEL[k]) return reask();
      const set = new Set(wantsOf(it));
      if (onoff === 'off') set.delete(k); else set.add(k);
      it.wants = Object.keys(WANT_LABEL).filter((x) => set.has(x));
      ch.lastAt = new Date().toISOString(); NB.touch(it);
      await send(token, askCurrent(it, base, { ack: (onoff === 'off' ? 'เอาออกแล้ว: ' : 'เลือกแล้ว: ') + WANT_SHORT[k] + ' · เลือกเสร็จกด “ตกลง ไปต่อ”' }), it);
      return true;
    }
    default: break;
  }
  moveOn(it, step, sub);
  ch.lastAt = new Date().toISOString(); NB.touch(it);
  await send(token, askCurrent(it, base, { ack }), it);
  return true;
}

// เลือกตามคำที่พิมพ์ในข้อ 10 (เช่น "อยากได้ QR กับแผนที่")
function wantsFromText(t) {
  const s = String(t || '').toLowerCase();
  const out = [];
  if (/qr|คิวอาร์|คิว อาร์/.test(s)) out.push('qr');
  if (/แผนที่|หมุด|map|แมพ|แม็พ/.test(s)) out.push('map');
  if (/ลงทะเบียน|สมัคร|จอง|register/.test(s)) out.push('register');
  return out;
}

async function answerText(it, text, token, base) {
  const ch = chatOf(it);
  const step = ch.step;
  const again = async (error) => { ch.lastAt = new Date().toISOString(); NB.touch(it); await send(token, askCurrent(it, base, { error }), it); return true; };
  let ack = '', sub = null;
  const t = text.trim();

  // ข้อสถานที่: มีลิงก์แผนที่ในข้อความ → เก็บเป็นลิงก์แผนที่
  if (PLACE_STEPS.has(step)) {
    const link = extractLink(t);
    if (link) return onMapLink(it, link, t, token, base);
  }

  switch (step) {
    case 'title':
      if (t.length < 2) return again('ชื่อสั้นไปนิดนะคะ ลองพิมพ์ชื่อกิจกรรมอีกครั้งค่ะ');
      it.title = one(t, 120);
      ack = 'ชื่อ: ' + it.title;
      break;
    case 'when': {
      const d = parseThaiDate(t);
      if (d && d < NB.bkkToday()) return again(`วันที่ ${thDate(d)} ผ่านไปแล้วค่ะ ลองกดเลือกวันจากปฏิทิน หรือพิมพ์ใหม่อีกครั้งนะคะ`);
      if (d) { Object.assign(it, { date: d, repeatText: '', whenText: '' }); ack = 'วันที่: ' + thDate(d); }
      else if (/ทุก/.test(t)) { Object.assign(it, { date: '', whenText: '', repeatText: one(t, 60) }); ack = it.repeatText; }
      else { Object.assign(it, { date: '', repeatText: '', whenText: one(t, 80) }); ack = 'วันที่: ' + it.whenText; }
      break;
    }
    case 'repeat':
      Object.assign(it, { date: '', whenText: '', repeatText: one(/^ทุก/.test(t) ? t : 'ทุก' + t, 60) });
      ack = it.repeatText;
      break;
    case 'time': {
      const r = parseTimeRange(t);
      if (r && r.bad) return again(`เวลาเลิก ${r.end} น. มาก่อนเวลาเริ่ม ${r.start} น. ค่ะ ลองพิมพ์ใหม่ เช่น “9 โมง ถึง เที่ยง”`);
      if (r && r.start && r.end) it.timeText = timeRange(r.start, r.end);
      else if (r && r.start && r.open) it.timeText = r.start + ' น. เป็นต้นไป';
      else if (r && r.start) {                         // ได้แค่เวลาเริ่ม → ถามเวลาเลิกต่อ
        if (!('timePrev' in ch)) ch.timePrev = it.timeText || '';
        ch.timeStart = r.start;
        it.timeText = timeRange(r.start);
        sub = 'timeEnd';
        ack = 'เริ่ม ' + r.start + ' น.';
        break;
      } else if (r && r.label) it.timeText = r.label;
      else it.timeText = one(t, 40);
      ack = 'เวลา: ' + it.timeText;
      break;
    }
    case 'timeEnd': {
      const start = ch.timeStart;
      if (toMin(start) == null) { ch.step = 'time'; return answerText(it, text, token, base); }
      if (isSkip(t) || /ไม่ระบุ|ไม่แน่นอน|ไม่รู้/.test(t)) it.timeText = timeRange(start);
      else {
        const r = parseTimeRange(t, { after: start });
        if (r && r.bad) return again(`เวลาเลิกต้องหลังเวลาเริ่ม ${start} น. ค่ะ ลองกดเลือก หรือพิมพ์ใหม่อีกครั้งนะคะ`);
        if (r && r.start && r.end) it.timeText = timeRange(r.start, r.end);
        else if (r && r.start) it.timeText = timeRange(start);
        else it.timeText = cut(start + ' น. – ' + t.replace(/\s+/g, ' '), 40);   // เช่น "จนกว่าของจะหมด"
      }
      ack = 'เวลา: ' + it.timeText;
      break;
    }
    case 'place':
    case 'placeLink':
      if (t.length < 2) return again('ลองพิมพ์ชื่อสถานที่อีกครั้งนะคะ หรือกดปุ่ม 📍 ปักหมุดในแผนที่');
      it.placeName = one(t, 120); ch.placeTyped = true;
      ack = 'สถานที่: ' + it.placeName;
      break;
    case 'placeName':
      if (isSkip(t)) { it.placeName = ''; ack = 'ไม่ใส่ชื่อสถานที่'; break; }
      if (t.length < 2) return again('ลองพิมพ์ชื่อสถานที่อีกครั้งนะคะ');
      it.placeName = one(t, 120); ch.placeTyped = true;
      ack = 'สถานที่: ' + it.placeName;
      break;
    case 'price':
    case 'priceAmount':
    case 'priceCustom': {
      const p = parsePrice(t);
      if (!p) {
        if (step !== 'price') { Object.assign(it, { price: null, priceText: one(t, 40) }); ack = 'ค่าใช้จ่าย: ' + it.priceText; break; }
        return again('กดปุ่มด้านล่าง หรือพิมพ์ตัวเลขเป็นบาทได้เลยค่ะ');
      }
      Object.assign(it, p);
      ack = 'ค่าใช้จ่าย: ' + priceLine(it);
      break;
    }
    case 'contact': {
      const c = parseContact(t);
      if (c.name) it.hostName = c.name;
      else if (!it.hostName && it.lineDisplayName) it.hostName = it.lineDisplayName;
      if (c.phone) it.phone = c.phone;
      ack = 'ผู้ติดต่อ: ' + (contactLine(it) || '-');
      if (!c.phone && !it.phone) sub = 'contactPhone';
      break;
    }
    case 'contactPhone': {
      if (isSkip(t)) { it.phone = ''; ack = 'ไม่ใส่เบอร์'; break; }
      const c = parseContact(t);
      if (!c.phone) return again('เบอร์ดูไม่ครบค่ะ ลองพิมพ์ตัวเลข 10 หลักอีกครั้ง เช่น 0812345678');
      it.phone = c.phone;
      if (c.name && !it.hostName) it.hostName = c.name;
      ack = 'เบอร์: ' + phoneFmt(it.phone);
      break;
    }
    case 'poster':
      if (isSkip(t)) { ack = 'ไม่มีใบประกาศ'; break; }
      return again('ข้อนี้ส่งเป็นรูปนะคะ กด 📷 ถ่ายรูปใบประกาศ หรือ 🖼️ เลือกจากเครื่อง หรือกด “ไม่มีใบประกาศ ข้าม”');
    case 'photo':
      if (isSkip(t)) { ack = 'ไม่มีรูปกิจกรรม'; break; }
      return again('ข้อนี้ส่งเป็นรูปนะคะ กด 📷 ถ่ายรูป หรือ 🖼️ เลือกจากเครื่อง หรือกด “ไม่มีรูป ข้ามเลย”');
    case 'details':
      if (isSkip(t)) { ack = 'ไม่มีรายละเอียดเพิ่ม'; break; }
      it.details = String(t).slice(0, 1500);
      ack = 'ได้รับรายละเอียดแล้วค่ะ';
      break;
    case 'help': {
      if (isSkip(t) || /ไม่ต้องการ|ไม่ต้อง|ไม่เอา/.test(t)) { it.wants = []; ack = 'ไม่ต้องการความช่วยเหลือเพิ่ม'; break; }
      if (isYes(t)) { ack = wantsOf(it).length ? 'ขอให้ช่วย: ' + wantsLine(it) : 'ไม่ต้องการความช่วยเหลือเพิ่ม'; break; }
      const add = wantsFromText(t);
      if (!add.length) return again('กดเลือกจากปุ่มด้านล่างได้เลยค่ะ แล้วกด “ตกลง ไปต่อ”');
      const set = new Set([...wantsOf(it), ...add]);
      it.wants = Object.keys(WANT_LABEL).filter((x) => set.has(x));
      ack = 'ขอให้ช่วย: ' + wantsLine(it);
      break;
    }
    case 'review':
      if (/^แก้/.test(t)) { ch.lastAt = new Date().toISOString(); NB.touch(it); await send(token, [editMenuMessage(it)], it); return true; }
      // พิมพ์มาตอนหน้าสรุป ถือเป็นรายละเอียดเพิ่มเติม
      it.details = ((it.details ? it.details + '\n' : '') + String(t)).slice(0, 1500);
      ch.lastAt = new Date().toISOString(); NB.touch(it);
      await send(token, [reviewMessage(it, base, { ack: 'เพิ่มในรายละเอียดให้แล้วค่ะ' })], it);
      return true;
    default:
      return again();
  }
  moveOn(it, step, sub);
  ch.lastAt = new Date().toISOString(); NB.touch(it);
  await send(token, askCurrent(it, base, { ack }), it);
  return true;
}

async function submit(it, token, base) {
  const ch = chatOf(it);
  if (!it.title && !hasVoice(it, 'title')) {
    ch.step = 'title'; ch.returnTo = 'review'; NB.touch(it);
    await send(token, [questionMessage(it, 'title', { error: 'ขาดชื่อกิจกรรมค่ะ ใส่ชื่อก่อนส่งนะคะ' })], it);
    return true;
  }
  const now = new Date().toISOString();
  NB.update(it.id, { status: NB.STATUS.PENDING, submittedAt: now, consentAt: now, chat: null });
  const w = wantsOf(it);
  const talk = ['map', 'register'].filter((k) => w.includes(k)).map((k) => WANT_SHORT[k]);
  await send(token, [simpleCard('ได้รับเรียบร้อยแล้วค่ะ', '🙏 ได้รับเรียบร้อยค่ะ', [
    `“${one(it.title || 'กิจกรรมของคุณ', 60)}”`,
    'ทีมบ้าน-บ้านจะตรวจและขึ้นเว็บให้ภายใน 1–2 วัน แล้วจะแจ้งกลับในแชทนี้นะคะ',
    w.includes('qr') ? '📱 QR Code ของกิจกรรม จะส่งให้ในแชทนี้ตอนขึ้นเว็บค่ะ' : '',
    talk.length ? `🙋 เรื่อง${talk.join('และ')} ทีมงานจะทักมาคุยรายละเอียดในแชทนี้ค่ะ` : ''
  ], [
    httpsBase(base) ? btn('ดูหน้าเว็บ', uri(base + '/#neighbors')) : null,
    btn('🏡 ฝากกิจกรรมอื่นอีก', pb('nb:start', 'ฝากกิจกรรม'))
  ].filter(Boolean))], it);
  notifyOwnerNew(NB.get(it.id) || it, base).catch((e) => console.error('เพื่อนบ้าน แจ้งแอดมิน:', e.message));
  return true;
}

// ---------------------------------------------------------------- แจ้งแอดมิน (push 1 ข้อความ)
async function notifyOwnerNew(it, base) {
  const d = NB.deps();
  const s = d.getSettings ? d.getSettings() : {};
  if (!s || s.notifyOwnerOn === false || !s.ownerUserId || !LINE.lineConfigured()) return;
  const admin = httpsBase(base) ? base + '/admin#neighbors' : '';
  const b = activityBubble(it, {
    base,
    header: '🔔 กิจกรรมเพื่อนบ้านใหม่ รอตรวจ',
    headerColor: C.terra,
    showVoices: true,
    showWants: true,
    extraRows: [row('💬', 'ส่งโดย ' + (it.lineDisplayName || 'ผู้ใช้ไลน์'))],
    buttons: [
      btn('✅ ขึ้นเว็บเลย', pb('nbadm:approve:' + it.id, 'ขึ้นเว็บเลย'), 'primary'),
      admin ? btn('📝 เปิดหน้าแอดมิน', uri(admin)) : null,
      btn('❌ ไม่ผ่าน', pb('nbadm:reject:' + it.id, 'ไม่ผ่าน'), 'link')
    ].filter(Boolean)
  });
  await LINE.pushMessage(s.ownerUserId, [flexMsg('🔔 กิจกรรมเพื่อนบ้านใหม่: ' + (it.title || 'รอตรวจ'), b)]);
}

async function onAdminPostback(ev, base) {
  const d = NB.deps();
  const s = d.getSettings ? d.getSettings() : {};
  if (!s || !s.ownerUserId || ev.source.userId !== s.ownerUserId) return true;   // ไม่ใช่แอดมิน เงียบ
  const [, cmd, id] = String(ev.postback.data).split(':');
  const token = ev.replyToken;
  if (cmd === 'noop') { await send(token, [{ type: 'text', text: 'โอเค ยังไม่เปลี่ยนอะไรค่ะ' }]); return true; }
  const it = NB.get(id);
  if (!it) { await send(token, [{ type: 'text', text: 'ไม่พบรายการนี้แล้วค่ะ (อาจถูกลบไปแล้ว)' }]); return true; }
  const admin = httpsBase(base) ? base + '/admin#neighbors' : '';
  if (cmd === 'approve') {
    if (it.status === NB.STATUS.APPROVED) { await send(token, [{ type: 'text', text: '“' + one(it.title, 60) + '” ขึ้นเว็บอยู่แล้วค่ะ ✓' }]); return true; }
    if (!it.title) {
      await send(token, [simpleCard('ยังไม่มีชื่อกิจกรรม', 'ยังขึ้นเว็บไม่ได้ค่ะ', ['ชื่อกิจกรรมส่งมาเป็นเสียง ต้องเปิดหน้าแอดมิน ฟังแล้วพิมพ์ชื่อก่อนนะคะ'],
        admin ? [btn('📝 เปิดหน้าแอดมิน', uri(admin), 'primary')] : [])]);
      return true;
    }
    const r = await NB.setStatus(it, NB.STATUS.APPROVED, { notify: true, base });
    if (r.ended) {
      await send(token, [{ type: 'text', text: `⚠️ อนุมัติแล้ว แต่ยังไม่ขึ้นเว็บ เพราะวันจัดผ่านไปแล้ว\nเปิดหน้าแอดมินแก้วันที่ก่อนนะคะ` + (admin ? '\n' + admin : '') }]);
      return true;
    }
    await send(token, [{ type: 'text', text: `✅ ขึ้นเว็บแล้ว: ${one(it.title, 60)}` + (r.notified && r.notified.sent ? '\nแจ้งผู้ส่งทางไลน์แล้ว' : '') }]);
    return true;
  }
  if (cmd === 'reject') {
    await send(token, [simpleCard('ยืนยันไม่ให้ขึ้นเว็บ?', 'ไม่ให้ขึ้นเว็บใช่ไหม?', [`“${one(it.title || 'กิจกรรมนี้', 60)}”`, 'ระบบจะส่งข้อความสุภาพแจ้งผู้ส่ง 1 ข้อความ ถ้าอยากเขียนเหตุผลเอง ใช้หน้าแอดมินแทน'],
      [btn('ใช่ ไม่ผ่าน', pb('nbadm:rejectYes:' + it.id, 'ใช่ ไม่ผ่าน'), 'primary'), btn('ยกเลิก', pb('nbadm:noop:' + it.id, 'ยกเลิก'))])]);
    return true;
  }
  if (cmd === 'rejectYes') {
    if (it.status === NB.STATUS.REJECTED) { await send(token, [{ type: 'text', text: 'ตั้งเป็นไม่ผ่านไว้แล้วค่ะ' }]); return true; }
    const r = await NB.setStatus(it, NB.STATUS.REJECTED, { notify: true, base });
    await send(token, [{ type: 'text', text: '❌ ตั้งเป็นไม่ผ่านแล้ว' + (r.notified && r.notified.sent ? ' · แจ้งผู้ส่งแล้ว' : '') }]);
    return true;
  }
  return true;
}

// ---------------------------------------------------------------- แจ้งผู้ส่งตอนขึ้นเว็บ/ไม่ผ่าน (push 1 ข้อความ)
export async function notifyStatus(it, kind, { note, base: givenBase } = {}) {
  if (!it.lineUserId || !LINE.lineConfigured()) return { sent: false };
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || givenBase || lastBase;
  if (kind === 'approved') {
    const b = activityBubble(it, {
      base,
      header: '🎉 กิจกรรมของคุณขึ้นเว็บแล้วค่ะ',
      headerColor: C.green,
      buttons: httpsBase(base) ? [btn('ดูบนเว็บ', uri(base + '/#nb-' + it.id), 'primary'), btn('🏡 ฝากกิจกรรมอื่น', pb('nb:start', 'ฝากกิจกรรม'))] : [],
      note: 'ขอบคุณที่ช่วยให้ชุมชนคึกคักนะคะ 🏡'
    });
    const msgs = [flexMsg('🎉 กิจกรรม “' + one(it.title, 40) + '” ขึ้นเว็บแล้วค่ะ', b)];
    // ขอ QR Code ไว้ → แนบไปในการส่งครั้งเดียวกัน (ไลน์นับ 1 ข้อความต่อการส่ง 1 ครั้ง ไม่ว่ามีกี่บอลลูน)
    if (wantsOf(it).includes('qr') && httpsBase(base)) {
      const q = `${base}/api/neighbors/qr/${it.id}.png`;
      msgs.push({ type: 'text', text: '📱 QR Code ของกิจกรรมนี้ค่ะ\nสแกนแล้วเปิดหน้ากิจกรรมบนเว็บบ้าน-บ้าน (มีวันเวลา แผนที่ เบอร์ติดต่อ)\nกดที่รูป แล้วกดบันทึก เอาไปพิมพ์ติดใบประกาศได้เลย' });
      msgs.push({ type: 'image', originalContentUrl: q, previewImageUrl: q });
    }
    return LINE.pushMessage(it.lineUserId, msgs);
  }
  if (kind === 'rejected') {
    const lines = [
      `ขออภัยค่ะ 🙏 กิจกรรม “${one(it.title || 'ที่ฝากมา', 60)}” ยังขึ้นเว็บไม่ได้`,
      note ? 'เหตุผล: ' + one(note, 200) : '',
      '',
      'ถ้ามีคำถาม พิมพ์ทักในแชทนี้ได้เลย หรือพิมพ์ “ฝากกิจกรรม” เพื่อส่งใหม่ค่ะ'
    ].filter((x, i) => x || i === 2);
    return LINE.pushMessage(it.lineUserId, [{ type: 'text', text: lines.join('\n') }]);
  }
  return { sent: false };
}

// บรรทัดต่อท้ายรายงานประจำวันของแอดมิน
export function reportLine() {
  const c = NB.counts();
  return c.pending ? `\n\n🏡 ${SECTION_NAME}: รอตรวจ ${c.pending} รายการ` : '';
}
