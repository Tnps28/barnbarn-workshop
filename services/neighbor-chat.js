// services/neighbor-chat.js — ถามตอบในไลน์ "ฝากกิจกรรมเพื่อนบ้าน"
//
// ออกแบบให้ผู้สูงอายุและคนไม่ถนัดเทคโนโลยีใช้ได้
//   • ถามทีละข้อ ตัวหนังสือใหญ่ บอกเสมอว่าข้อที่เท่าไหร่จากทั้งหมด
//   • ทุกข้อมีปุ่มใหญ่ให้กด ไม่ต้องพิมพ์ (ปุ่มอยู่ในการ์ด ไม่หายไปเหมือนปุ่มลอยด้านล่าง)
//   • พิมพ์ไม่ถนัด อัดเสียงตอบได้ทุกข้อที่ต้องพิมพ์ — แอดมินฟังแล้วพิมพ์ให้ในหน้าผู้ดูแล
//   • ส่งรูปใบประกาศมาตอนไหนก็ได้ · พิมพ์ "ยกเลิก" / "ย้อนกลับ" ได้ทุกเมื่อ
//   • ก่อนส่งเห็นการ์ดสรุปหน้าตาเหมือนบนเว็บ แก้ข้อไหนก็ได้
//
// โควตาไลน์: ทุกข้อความในการถามตอบเป็น reply (ฟรี) — ที่กินโควตามีแค่
// แจ้งแอดมินตอนมีของใหม่ 1 ข้อความ และแจ้งผู้ส่งตอนขึ้นเว็บ/ไม่ผ่าน 1 ข้อความ
//
// อยากแก้ถ้อยคำคำถาม → แก้ที่ Q ด้านล่างได้เลย
import * as LINE from './line.js';
import * as NB from './neighbors.js';

const SECTION_NAME = 'เพื่อนบ้าน บ้าน-บ้าน';
const TOTAL = 8;
const IDLE_MS = 6 * 3600e3;          // เงียบไปเกิน 6 ชม. ถามก่อนว่าจะทำต่อไหม (กันกินข้อความแชททั่วไป)
const MAX_PENDING_PER_USER = 3;
const MAX_VOICES = 8;

const C = { brown: '#7a5230', orange: '#e8863c', terra: '#c9663a', green: '#3e8e5a', ink: '#3a2f27', soft: '#6b5d51', beige: '#f3e6d3' };

// ---------------------------------------------------------------- คำถาม (แก้ถ้อยคำได้ที่นี่)
const Q = {
  title: { n: 1, q: 'กิจกรรมชื่ออะไรคะ?', hint: 'พิมพ์สั้น ๆ เช่น “ตลาดนัดผักปลอดสาร” “สอนทำขนมไทย”\nพิมพ์ไม่สะดวก กดรูปไมค์ 🎤 อัดเสียงบอกได้เลยค่ะ' },
  when: { n: 2, q: 'จัดวันไหนคะ?', hint: 'กดเลือกวันจากปฏิทิน หรือพิมพ์บอก เช่น “เสาร์นี้” “20 ต.ค.”' },
  repeat: { n: 2, q: 'จัดเป็นประจำทุกวันไหนคะ?', hint: 'กดเลือก หรือพิมพ์บอก เช่น “ทุกวันพระ” “ทุกเย็นวันพุธ”' },
  time: { n: 3, q: 'เริ่มกี่โมงคะ?', hint: 'กดเลือกช่วงเวลา หรือพิมพ์บอก เช่น “9 โมงเช้า” “บ่ายสอง”' },
  place: { n: 4, q: 'จัดที่ไหนคะ?', hint: 'พิมพ์ชื่อสถานที่ เช่น “ศาลาวัด…” “บ้านป้าแดง ซอย 3”\nหรือกดปุ่ม 📍 เพื่อส่งตำแหน่งในแผนที่' },
  price: { n: 5, q: 'ต้องเสียเงินไหมคะ?', hint: '' },
  priceAmount: { n: 5, q: 'ค่าใช้จ่ายเท่าไหร่คะ?', hint: 'กดเลือก หรือพิมพ์ตัวเลข เช่น “50” “คนละ 120 รวมอาหาร”' },
  contact: { n: 6, q: 'ถ้ามีคนสนใจ ให้ติดต่อใครคะ?', hint: 'พิมพ์ชื่อและเบอร์โทร เช่น “ป้าแดง 081 234 5678”\nชื่อและเบอร์นี้จะขึ้นบนเว็บให้คนโทรหาได้' },
  contactPhone: { n: 6, q: 'เบอร์โทรที่ให้คนติดต่อได้คะ?', hint: 'พิมพ์ตัวเลข เช่น 0812345678\nเบอร์นี้จะขึ้นบนเว็บให้คนโทรหาได้' },
  photo: { n: 7, q: 'มีรูปหรือใบประกาศไหมคะ? 📷', hint: 'ถ่ายรูปหรือเลือกรูปจากเครื่องแล้วกดส่ง ได้สูงสุด 3 รูป\nไม่มีรูปก็ไม่เป็นไร กดข้ามได้เลย' },
  details: { n: 8, q: 'อยากบอกอะไรเพิ่มไหมคะ?', hint: 'เช่น ต้องเตรียมอะไรมา ใครมาได้บ้าง ต้องจองก่อนไหม\nพิมพ์หรืออัดเสียงก็ได้ ไม่มีก็กดข้าม' }
};
// ข้อที่รับคำตอบเป็นเสียงได้
const VOICE_STEPS = new Set(['title', 'when', 'repeat', 'time', 'place', 'price', 'priceAmount', 'contact', 'contactPhone', 'details']);
const FIELD_LABEL = { title: 'ชื่อกิจกรรม', when: 'วันที่', repeat: 'วันที่', time: 'เวลา', place: 'สถานที่', price: 'ค่าใช้จ่าย',
  priceAmount: 'ค่าใช้จ่าย', contact: 'ผู้ติดต่อ', contactPhone: 'เบอร์โทร', photo: 'รูป', details: 'รายละเอียด' };

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
  if (s) return s + (Number.isFinite(it.lat) ? ' (มีหมุดแผนที่)' : '');
  if (Number.isFinite(it.lat)) return 'หมุดในแผนที่';
  return hasVoice(it, 'place') ? '🎤 ส่งเป็นเสียง' : '';
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

function tidyTime(t) {
  const s = normDigits(t).replace(/\s+/g, ' ').trim();
  const m = s.match(/^(\d{1,2})\s*[:.]\s*(\d{2})\s*(น\.?|นาฬิกา)?$/);
  if (m && +m[1] < 24 && +m[2] < 60) return m[1].padStart(2, '0') + ':' + m[2] + ' น.';
  return one(s, 40);
}

export function parsePrice(t) {
  const s = normDigits(t).replace(/\s+/g, ' ').trim();
  if (/ฟรี|ไม่เสีย|ไม่มีค่า|ไม่ต้องจ่าย|free/i.test(s)) return { price: 0, priceText: 'ฟรี' };
  if (/ศรัทธา|บริจาค/.test(s)) return { price: null, priceText: 'ตามศรัทธา' };
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
const photoUrl = (it, base) => (it.photos && it.photos[0] && httpsBase(base) ? `${base}/api/neighbors/media/${it.photos[0].id}` : '');

// ---------------------------------------------------------------- การ์ดคำถามแต่ละข้อ
function prevAnswer(it, step) {
  switch (step) {
    case 'title': return it.title;
    case 'when': case 'repeat': return whenLine(it);
    case 'time': return it.timeText;
    case 'place': return placeLine(it);
    case 'price': case 'priceAmount': return priceLine(it);
    case 'contact': return contactLine(it);
    case 'contactPhone': return it.phone ? phoneFmt(it.phone) : '';
    case 'details': return it.details;
    default: return '';
  }
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
      btn('🌅 ช่วงเช้า', pb('nb:ans:time:morning', 'ช่วงเช้า'), 'primary'),
      btn('☀️ ช่วงบ่าย', pb('nb:ans:time:afternoon', 'ช่วงบ่าย')),
      btn('🌙 ช่วงเย็น', pb('nb:ans:time:evening', 'ช่วงเย็น')),
      btn('⏰ ระบุเวลา', { type: 'datetimepicker', data: 'nb:ans:time:pick', mode: 'time', initial: '09:00' })
    ];
    case 'place': return [btn('📍 ปักหมุดในแผนที่', uri('https://line.me/R/nv/location/'), 'primary')];
    case 'price': return [
      btn('🆓 ฟรี', pb('nb:ans:price:free', 'ฟรี'), 'primary'),
      btn('💰 มีค่าใช้จ่าย', pb('nb:ans:price:paid', 'มีค่าใช้จ่าย')),
      btn('🙏 ตามศรัทธา', pb('nb:ans:price:donation', 'ตามศรัทธา'))
    ];
    case 'priceAmount': return [50, 100, 200, 300].map((n, i) => btn(n + ' บาท', pb('nb:ans:priceAmount:' + n, n + ' บาท'), i === 0 ? 'primary' : 'secondary'));
    case 'contact': return it.lineDisplayName
      ? [btn('👤 ใช้ชื่อในไลน์', pb('nb:ans:contact:me', 'ใช้ชื่อ ' + it.lineDisplayName), 'primary')]
      : [];
    case 'contactPhone': return [btn('ไม่ใส่เบอร์', pb('nb:ans:contactPhone:none', 'ไม่ใส่เบอร์'))];
    case 'photo':
      if (ch.returnTo === 'review' && photoCount(it)) return [
        btn('📷 ถ่ายรูปใหม่', uri('https://line.me/R/nv/camera/'), 'primary'),
        btn('🖼️ เลือกรูปใหม่', uri('https://line.me/R/nv/cameraRoll/single')),
        btn('🗑️ ไม่ใช้รูป', pb('nb:ans:photo:clear', 'ไม่ใช้รูป')),
        btn('ใช้รูปเดิม', pb('nb:review', 'ใช้รูปเดิม'))
      ];
      return [
        btn('📷 ถ่ายรูป', uri('https://line.me/R/nv/camera/'), 'primary'),
        btn('🖼️ เลือกรูปจากเครื่อง', uri('https://line.me/R/nv/cameraRoll/single')),
        btn('ไม่มีรูป ข้ามเลย', pb('nb:ans:photo:skip', 'ไม่มีรูป'))
      ];
    case 'details': return [btn('ไม่มีแล้ว ข้ามเลย', pb('nb:ans:details:skip', 'ไม่มีแล้ว'))];
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
    photo: [QR_CAMERA, QR_ROLL]
  }[step] || [];
  return qr([...extra, back, QR_CANCEL]);
}

function questionMessage(it, step, { ack, error } = {}) {
  const d = Q[step];
  const ch = it.chat || {};
  let hint = d.hint;
  if (step === 'photo' && ch.returnTo === 'review' && photoCount(it)) hint = `ตอนนี้มี ${photoCount(it)} รูป · ส่งรูปใหม่มาได้เลย รูปเดิมจะถูกแทนที่`;
  if (step === 'contact' && it.lineDisplayName) hint += `\nหรือกดปุ่มด้านล่าง ใช้ชื่อในไลน์ “${one(it.lineDisplayName, 40)}”`;
  const prev = prevAnswer(it, step);
  const body = [
    ack ? T('✓ ' + one(ack, 110), { size: 'sm', color: C.green, weight: 'bold' }) : null,
    error ? T(error, { size: 'md', color: C.terra, weight: 'bold' }) : null,
    T(`ข้อ ${d.n} จาก ${TOTAL}` + (ch.returnTo === 'review' ? ' · กำลังแก้ไข' : ''), { size: 'sm', color: C.soft }),
    T(d.q, { size: 'xl', weight: 'bold', color: C.brown }),
    hint ? T(hint, { size: 'md', color: C.soft }) : null,
    prev && step !== 'photo' ? T('คำตอบเดิม: ' + one(prev, 80), { size: 'sm', color: C.soft }) : null
  ];
  return flexMsg(`ข้อ ${d.n}: ${d.q}`, bubble({ body: box(body), footer: box(stepButtons(it, step), 'sm') }), stepQuick(it, step));
}

// ---------------------------------------------------------------- การ์ดสรุปกิจกรรม (ใช้ทั้งผู้ส่งและแอดมิน)
function activityBubble(it, { base, header, headerColor = C.brown, buttons = [], extraRows = [], note, showVoices = false } = {}) {
  const img = photoUrl(it, base);
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
      row('📷', !img && (it.pendingPhotos || []).length ? `รูป ${photoCount(it)} รูป (กำลังโหลด)` : photoCount(it) > 1 ? `รูป ${photoCount(it)} รูป` : ''),
      row('🎤', voices ? `มีเสียงแนบ ${voices} ไฟล์` : ''),
      ...extraRows
    ], 'sm'),
    note ? T(note, { size: 'sm', color: C.soft }) : null
  ];
  return bubble({
    hero: img ? { type: 'image', url: img, size: 'full', aspectRatio: '16:9', aspectMode: 'cover' } : null,
    body: box(body),
    footer: box(buttons, 'sm')
  });
}

function reviewMessage(it, base, { ack } = {}) {
  const b = activityBubble(it, {
    base,
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
    ['contact', 'ผู้ติดต่อ / เบอร์'], ['photo', 'รูป'], ['details', 'รายละเอียด']];
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
    '• ตอบทีละข้อ ' + TOTAL + ' ข้อ (ข้ามได้ 2 ข้อ)\n• กดปุ่มตอบได้ ไม่ต้องพิมพ์เยอะ\n• พิมพ์ไม่ถนัด กดไมค์ 🎤 อัดเสียงตอบได้\n• มีใบประกาศ ถ่ายรูปส่งมาได้เลย\n• พิมพ์ “ยกเลิก” ได้ทุกเมื่อ'
  ]);
}

// ---------------------------------------------------------------- สถานะการถามตอบ
const NEXT = { title: 'when', when: 'time', repeat: 'time', time: 'place', place: 'price', price: 'contact', priceAmount: 'contact', contact: 'photo', contactPhone: 'photo', photo: 'details', details: 'review' };
const PARENT = { repeat: 'when', priceAmount: 'price', contactPhone: 'contact' };

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
    if (to === 'photo' && photoCount(it)) to = 'details';   // ส่งรูปมาก่อนแล้ว ไม่ต้องถามซ้ำ
  }
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
const photoCount = (it) => (it.photos || []).length + (it.pendingPhotos || []).length;

// รูปที่รอโหลดอยู่ใน pendingPhotos — โหลดเสร็จย้ายไป photos · ถ้าระหว่างนั้นถูกล้าง/แทนที่ไปแล้ว ทิ้งไฟล์ใหม่
async function savePhotoFromLine(itemId, messageId) {
  if (_inflight.has(messageId)) return null;
  _inflight.add(messageId);
  try {
    const { buf, type } = await lineContent(messageId, { tries: 3, wait: 1500 });
    const saved = await NB.putMedia({ kind: 'image', type: type || 'image/jpeg', buf, activityId: itemId, extra: { lineMessageId: messageId } });
    const cur = NB.get(itemId);
    if (!cur || !(cur.pendingPhotos || []).includes(messageId) || (cur.photos || []).length >= NB.MAX_PHOTOS) {
      await NB.deleteMedia([saved.id]);
      if (cur) { cur.pendingPhotos = (cur.pendingPhotos || []).filter((x) => x !== messageId); NB.touch(cur); }
      return null;
    }
    cur.photos = cur.photos || [];
    cur.photos.push(saved);
    cur.pendingPhotos = cur.pendingPhotos.filter((x) => x !== messageId);
    NB.touch(cur);
    return saved;
  } catch (e) {
    console.error('เพื่อนบ้าน: โหลดรูปจากไลน์ไม่สำเร็จ', e.message);
    if (/ใหญ่เกินไป|ไฟล์ว่าง/.test(e.message)) {           // ลองใหม่ก็ไม่ผ่าน ทิ้งเลย
      const cur = NB.get(itemId);
      if (cur) { cur.pendingPhotos = (cur.pendingPhotos || []).filter((x) => x !== messageId); NB.touch(cur); }
    }
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
  const waiting = (it.pendingPhotos || []).length || (it.voices || []).some((v) => v.status !== 'ready');
  if (!waiting) return;
  const last = _retryAt.get(it.id) || 0;
  if (Date.now() - last < 5 * 60e3) return;
  if (Date.now() - new Date(it.createdAt).getTime() > 7 * 864e5) return;
  _retryAt.set(it.id, Date.now());
  (async () => {
    for (const mid of [...(it.pendingPhotos || [])]) await savePhotoFromLine(it.id, mid);
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
  if ((isNb && cmd === 'back') || (text && isBack(text))) {
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
    ch.step = 'review'; ch.returnTo = null; touchNow();
    await send(token, [reviewMessage(it, base)], it);
    return true;
  }
  if (isNb && cmd === 'goto' && Q[a]) {
    ch.returnTo = 'review'; ch.step = a; touchNow();
    await send(token, [questionMessage(it, a)], it);
    return true;
  }
  if ((isNb && cmd === 'submit') || (text && ch.step === 'review' && isYes(text))) return submit(it, token, base);

  // ---- รูป (ส่งมาข้อไหนก็ได้) ----
  if (msg && msg.type === 'image') return onImage(it, msg, token, base);

  // ---- ตำแหน่ง ----
  if (msg && msg.type === 'location') {
    Object.assign(it, { lat: Number(msg.latitude), lng: Number(msg.longitude), placeAddress: one(msg.address || '', 200) });
    if (msg.title) it.placeName = one(msg.title, 120);
    else if (!it.placeName) it.placeName = one(msg.address || '', 120);
    if (ch.step === 'place') {
      moveOn(it, 'place'); touchNow();
      await send(token, askCurrent(it, base, { ack: 'ได้ตำแหน่งแล้ว: ' + (placeLine(it) || 'หมุดในแผนที่') }), it);
    } else {
      touchNow();
      await send(token, askCurrent(it, base, { ack: 'ได้ตำแหน่งแล้วค่ะ 📍' }), it);
    }
    return true;
  }

  // ---- เสียง ----
  if (msg && msg.type === 'audio') {
    if ((it.voices || []).length >= MAX_VOICES) {
      await send(token, askCurrent(it, base, { error: 'ส่งเสียงได้สูงสุด ' + MAX_VOICES + ' ไฟล์ค่ะ ข้อนี้ลองพิมพ์หรือกดปุ่มแทนนะคะ' }), it);
      return true;
    }
    const step = VOICE_STEPS.has(ch.step) ? ch.step : 'details';
    it.voices = it.voices || [];
    it.voices.push({ id: '', messageId: msg.id, step, duration: Number(msg.duration) || 0, status: 'pending', at: new Date().toISOString() });
    saveVoiceFromLine(it.id, msg.id);         // โหลดเบื้องหลัง ไม่ต้องรอ
    const label = FIELD_LABEL[step];
    if (ch.step === step) {
      moveOn(it, step);                  // ตอบด้วยเสียงแล้วไปข้อถัดไปเลย (ข้ามข้อย่อย แอดมินฟังเอา)
      touchNow();
      await send(token, askCurrent(it, base, { ack: `ได้รับเสียงเรื่อง${label}แล้วค่ะ 🎤 ทีมงานจะฟังแล้วพิมพ์ให้` }), it);
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
      if (PARENT[ch.step] === step) ch.step = step;            // อยู่ข้อย่อยแล้วเปลี่ยนใจ กดตัวเลือกของข้อหลักใหม่
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

async function onImage(it, msg, token, base) {
  const ch = chatOf(it);
  const set = msg.imageSet;              // ส่งหลายรูปพร้อมกัน ไลน์แยกมาทีละรูป
  const firstOfSet = !set || Number(set.index) === 1;
  // แก้รูปจากหน้าสรุป: รูปแรกที่ส่งมาใหม่แทนรูปเดิมทั้งหมด
  if (ch.step === 'photo' && ch.returnTo === 'review' && !ch.replacingPhotos && photoCount(it)) {
    const old = (it.photos || []).map((p) => p.id);
    it.photos = []; it.pendingPhotos = []; ch.replacingPhotos = true; NB.touch(it);
    await NB.deleteMedia(old);
  }
  if (photoCount(it) >= NB.MAX_PHOTOS) {
    if (firstOfSet) { await send(token, askCurrent(it, base, { error: `รับรูปได้ ${NB.MAX_PHOTOS} รูปค่ะ ใช้ ${NB.MAX_PHOTOS} รูปแรกนะคะ` }), it); }
    return true;
  }
  it.pendingPhotos = [...(it.pendingPhotos || []), msg.id];
  NB.touch(it);
  savePhotoFromLine(it.id, msg.id);     // โหลดเบื้องหลัง ตอบคนส่งก่อน
  if (!firstOfSet) return true;         // ตอบครั้งเดียวต่อชุดรูป
  if (ch.step === 'photo') { ch.replacingPhotos = false; moveOn(it, 'photo'); }
  ch.lastAt = new Date().toISOString(); NB.touch(it);
  await send(token, askCurrent(it, base, { ack: 'ได้รับรูปแล้วค่ะ 📷' + (set && Number(set.total) > 1 ? ` (${Math.min(Number(set.total), NB.MAX_PHOTOS)} รูป)` : '') }), it);
  return true;
}

async function answerButton(it, step, val, params, token, base) {
  const ch = chatOf(it);
  let ack = '', sub = null;
  switch (step) {
    case 'when':
      if (val === 'pick') {
        if (!params.date) { await send(token, askCurrent(it, base), it); return true; }
        Object.assign(it, { date: params.date, repeatText: '', whenText: '' });
        ack = 'วันที่: ' + thDate(params.date);
      } else if (val === 'repeat') { sub = 'repeat'; ack = 'จัดเป็นประจำ'; }
      else if (val === 'unsure') { Object.assign(it, { date: '', repeatText: '', whenText: 'ยังไม่แน่นอน' }); ack = 'วันที่: ยังไม่แน่นอน'; }
      break;
    case 'repeat': {
      const t = ['ทุกวันเสาร์', 'ทุกวันอาทิตย์', 'ทุกเสาร์–อาทิตย์', 'ทุกวัน'][Number(val)] || '';
      if (!t) { await send(token, askCurrent(it, base), it); return true; }
      Object.assign(it, { date: '', whenText: '', repeatText: t });
      ack = t;
      break;
    }
    case 'time': {
      const map = { morning: 'ช่วงเช้า', afternoon: 'ช่วงบ่าย', evening: 'ช่วงเย็น', allday: 'ทั้งวัน' };
      if (val === 'pick') {
        if (!params.time) { await send(token, askCurrent(it, base), it); return true; }
        it.timeText = params.time + ' น.';
      } else if (map[val]) it.timeText = map[val];
      else { await send(token, askCurrent(it, base), it); return true; }
      ack = 'เวลา: ' + it.timeText;
      break;
    }
    case 'price':
      if (val === 'free') Object.assign(it, { price: 0, priceText: 'ฟรี' });
      else if (val === 'donation') Object.assign(it, { price: null, priceText: 'ตามศรัทธา' });
      else if (val === 'paid') { sub = 'priceAmount'; Object.assign(it, { priceText: '' }); }
      ack = val === 'paid' ? 'มีค่าใช้จ่าย' : 'ค่าใช้จ่าย: ' + priceLine(it);
      break;
    case 'priceAmount': {
      const n = Number(val);
      if (!(n > 0)) { await send(token, askCurrent(it, base), it); return true; }
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
    case 'photo':
      if (val === 'clear') {
        const old = (it.photos || []).map((p) => p.id);
        it.photos = []; it.pendingPhotos = [];
        await NB.deleteMedia(old);
        ack = 'ไม่ใช้รูปแล้วค่ะ';
      } else ack = 'ไม่มีรูป';
      break;
    case 'details':
      if (val === 'skip') ack = 'ไม่มีรายละเอียดเพิ่ม';
      break;
    default: break;
  }
  moveOn(it, step, sub);
  ch.lastAt = new Date().toISOString(); NB.touch(it);
  await send(token, askCurrent(it, base, { ack }), it);
  return true;
}

async function answerText(it, text, token, base) {
  const ch = chatOf(it);
  const step = ch.step;
  const again = async (error) => { ch.lastAt = new Date().toISOString(); NB.touch(it); await send(token, askCurrent(it, base, { error }), it); return true; };
  let ack = '', sub = null;
  const t = text.trim();

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
    case 'time':
      it.timeText = tidyTime(t);
      ack = 'เวลา: ' + it.timeText;
      break;
    case 'place':
      if (t.length < 2) return again('ลองพิมพ์ชื่อสถานที่อีกครั้งนะคะ หรือกดปุ่ม 📍 ส่งตำแหน่ง');
      it.placeName = one(t, 120);
      ack = 'สถานที่: ' + it.placeName;
      break;
    case 'price':
    case 'priceAmount': {
      const p = parsePrice(t);
      if (!p) {
        if (step === 'priceAmount') { Object.assign(it, { price: null, priceText: one(t, 40) }); ack = 'ค่าใช้จ่าย: ' + it.priceText; break; }
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
    case 'photo':
      if (isSkip(t)) { ack = 'ไม่มีรูป'; break; }
      return again('ข้อนี้ส่งเป็นรูปนะคะ กด 📷 ถ่ายรูป หรือ 🖼️ เลือกรูป หรือกด “ไม่มีรูป ข้ามเลย”');
    case 'details':
      if (isSkip(t)) { ack = 'ไม่มีรายละเอียดเพิ่ม'; break; }
      it.details = String(t).slice(0, 1500);
      ack = 'ได้รับรายละเอียดแล้วค่ะ';
      break;
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
  await send(token, [simpleCard('ได้รับเรียบร้อยแล้วค่ะ', '🙏 ได้รับเรียบร้อยค่ะ', [
    `“${one(it.title || 'กิจกรรมของคุณ', 60)}”`,
    'ทีมบ้าน-บ้านจะตรวจและขึ้นเว็บให้ภายใน 1–2 วัน แล้วจะแจ้งกลับในแชทนี้นะคะ'
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
    return LINE.pushMessage(it.lineUserId, [flexMsg('🎉 กิจกรรม “' + one(it.title, 40) + '” ขึ้นเว็บแล้วค่ะ', b)]);
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
