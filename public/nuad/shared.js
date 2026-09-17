// shared.js — ของที่หน้าลูกค้าและหน้าพี่หนึ่งใช้ร่วมกัน
export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TH = '๐๑๒๓๔๕๖๗๘๙';
export const thn = (s) => String(s).replace(/\d/g, (d) => TH[d]);
export const DAYN = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

export async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้งนะคะ');
  return j;
}

let tt;
export function toast(m) { const el = $('#toast'); el.textContent = m; el.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 2600); }

// ---------- พร้อมเพย์ (EMVCo QR) ----------
const pad2 = (n) => String(n).padStart(2, '0');
const tlv = (id, v) => id + pad2(v.length) + v;
function crc16(s) { let c = 0xFFFF; for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) : (c << 1); c &= 0xFFFF; } return c.toString(16).toUpperCase().padStart(4, '0'); }
export function ppPayload(id, amt) {
  const t = String(id || '').replace(/\D/g, '');
  const acc = t.length >= 13 ? tlv('02', t) : tlv('01', ('0000000000000' + '66' + t.replace(/^0/, '')).slice(-13));
  const a = Number(amt);
  const p = tlv('00', '01') + tlv('01', a > 0 ? '12' : '11') + tlv('29', tlv('00', 'A000000677010111') + acc)
    + tlv('58', 'TH') + tlv('53', '764') + (a > 0 ? tlv('54', a.toFixed(2)) : '') + '6304';
  return p + crc16(p);
}
export function drawQR(el, text) {
  // ใช้ qrcode-generator (MIT) ที่เก็บไว้ใน /vendor — ไม่ต้องพึ่ง CDN
  el.innerHTML = '';
  if (!window.qrcode) { el.innerHTML = '<span class="hint">โหลด QR ไม่สำเร็จ</span>'; return; }
  const q = window.qrcode(0, 'M'); q.addData(text); q.make();
  const img = new Image(); img.alt = 'QR code'; img.width = 168; img.height = 168;
  img.style.imageRendering = 'pixelated';
  img.src = q.createDataURL(6, 0);
  el.appendChild(img);
}

// ---------- LINE ----------
export const shareHref = (text) => 'https://line.me/R/msg/text/?' + encodeURIComponent(text);
export const oaChatHref = (oaId, text) => `https://line.me/R/oaMessage/${encodeURIComponent(oaId)}/?${encodeURIComponent(text)}`;

export const LINE_SVG = '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 3.5c-5.24 0-9.5 3.44-9.5 7.68 0 3.8 3.38 6.98 7.94 7.58.31.06.73.2.84.46.1.24.06.6.03.84l-.13.82c-.04.24-.19.95.83.52 1.02-.43 5.5-3.24 7.5-5.55 1.38-1.52 2.04-3.07 2.04-4.79C21.5 6.94 17.24 3.5 12 3.5z"/></svg>';
export const BB_ADD_FRIEND = 'https://lin.ee/TjK2193'; // LINE OA ของ BARNBARN

const dot = (t) => thn(String(t).replace(':', '.'));
export function header(s, live) {
  const closed = (s.closedDays || []).map((d) => DAYN[d]).join(', ');
  let l = '';
  if (live) l = live.open
    ? `<p class="live"><i></i>${live.serving ? `กำลังนวดคิว ${live.serving}` : 'ว่าง พร้อมรับคิว'} · รอ ${live.waiting} คิว</p>`
    : `<p class="live off"><i></i>ตอนนี้ปิดรับคิวหน้าร้าน · จองล่วงหน้าได้</p>`;
  return `<p class="m-eyebrow">BARNBARN · บ้าน-บ้าน สุขพอดี</p>
  <h1><span class="orn" aria-hidden="true"></span>${esc(s.shopName)}<span class="orn" aria-hidden="true"></span></h1>
  <p class="m-info">เปิด ${dot(s.open)}–${dot(s.close)} น.${s.breakStart ? ` · พัก ${dot(s.breakStart)}–${dot(s.breakEnd)} น.` : ''}${closed ? ` · หยุดทุกวัน${closed}` : ''}</p>${l}`;
}

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch { const a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} a.remove(); return ok; }
}
