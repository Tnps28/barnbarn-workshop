// services/slipok.js — ตรวจสลิปโอนเงินอัตโนมัติด้วย SlipOK (https://slipok.com)
//
// แพ็ก OK BASIC = ฟรี 100 สลิป/เดือน · เกินโควตา SlipOK คิด 1.00 ฿/สลิป
// ไฟล์นี้ทำหน้าที่ "ยิง API" อย่างเดียว ไม่ได้นับโควตาเอง
// คนนับคือ db.reserveSlipCheck() ซึ่งจองสิทธิ์ก่อนจะเรียกฟังก์ชันนี้เสมอ
//
// ไม่ได้ตั้ง SLIPOK_BRANCH_ID / SLIPOK_API_KEY ไว้ = ปิดอยู่ เว็บทำงานปกติทุกอย่าง
// แค่ไม่ตรวจสลิปให้ ตกไปใช้วิธีเดิมคือแอดมินกดยืนยันเอง

// SLIPOK_ENDPOINT มีไว้ชี้ไปเซิร์ฟเวอร์จำลองตอนทดสอบเท่านั้น ปกติไม่ต้องตั้ง
const endpoint = () => (process.env.SLIPOK_ENDPOINT || 'https://api.slipok.com/api/line/apikey/');
const MAX_BYTES = 5 * 1024 * 1024;

const branchId = () => (process.env.SLIPOK_BRANCH_ID || '').trim();
const apiKey = () => (process.env.SLIPOK_API_KEY || '').trim();
const timeoutMs = () => Math.max(3000, Number(process.env.SLIPOK_TIMEOUT_MS) || 8000);

export function slipokConfigured() {
  return !!(branchId() && apiKey());
}

// รูปสลิปเก็บเป็น data URL (base64) ในฐานข้อมูล — แปลงกลับเป็นไฟล์ให้ SlipOK
// SlipOK รับ JPG / JPEG / PNG / JFIF / WEBP เท่านั้น
function toFile(slipImage) {
  const s = String(slipImage || '');
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(s);
  const mime = (m ? m[1] : 'image/jpeg').toLowerCase();
  const b64 = m ? m[2] : s;
  if (!b64) return { error: 'ไม่มีไฟล์สลิป' };
  if (!/^image\/(jpeg|jpg|png|webp|jfif)$/.test(mime)) return { error: 'ชนิดไฟล์ที่ SlipOK ไม่รับ (' + mime + ')' };
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch { return { error: 'ไฟล์สลิปเสีย อ่านไม่ออก' }; }
  if (!buf.length) return { error: 'ไฟล์สลิปว่าง' };
  if (buf.length > MAX_BYTES) return { error: 'ไฟล์สลิปใหญ่เกิน 5MB' };
  const ext = mime.split('/')[1].replace('jpeg', 'jpg');
  return { blob: new Blob([buf], { type: mime }), name: 'slip.' + ext };
}

// ยิงตรวจสลิป 1 ครั้ง — "1 ครั้งที่เรียกฟังก์ชันนี้ = 1 โควตา" เสมอ
//
// เจตนา: ไม่ส่ง amount ไปให้ SlipOK เทียบ เพราะถ้ายอดไม่ตรง SlipOK จะตอบเป็น error
// แล้วเราจะไม่เห็นว่ายอดจริงบนสลิปเท่าไหร่ — ดึงข้อมูลกลับมาเทียบเองดีกว่า
// แอดมินจะได้เห็นว่า "สลิปจริง แต่โอนมา 2,000 ไม่ใช่ 2,500"
export async function checkSlip(slipImage) {
  if (!slipokConfigured()) return { ok: false, reason: 'not_configured', message: 'ยังไม่ได้ตั้งค่า SlipOK' };

  const f = toFile(slipImage);
  if (f.error) return { ok: false, reason: 'bad_image', message: f.error };

  const form = new FormData();
  form.append('files', f.blob, f.name);
  form.append('log', 'true'); // เก็บ log ฝั่ง SlipOK = เปิดระบบจับสลิปซ้ำของเขาด้วย

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs());
  try {
    const r = await fetch(endpoint() + encodeURIComponent(branchId()), {
      method: 'POST',
      headers: { 'x-authorization': apiKey() },
      body: form,
      signal: ctl.signal
    });
    let j = null;
    try { j = await r.json(); } catch { /* บางกรณีตอบไม่ใช่ JSON */ }

    if (!j || j.success !== true || !j.data) {
      return {
        ok: false,
        reason: r.status === 401 || r.status === 403 ? 'auth' : 'rejected',
        code: String((j && (j.code ?? j.statusCode)) ?? r.status),
        message: (j && (j.message || j.error)) || ('SlipOK ตอบกลับ HTTP ' + r.status)
      };
    }

    const d = j.data;
    const person = (p) => (p && (p.displayName || p.name)) || '';
    return {
      ok: d.success === true,
      reason: d.success === true ? 'passed' : 'invalid',
      message: d.message || '',
      transRef: d.transRef || '',
      amount: Number(d.amount) || 0,
      transTimestamp: d.transTimestamp || '',
      sendingBank: d.sendingBank || '',
      receivingBank: d.receivingBank || '',
      senderName: person(d.sender),
      receiverName: person(d.receiver)
    };
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    return {
      ok: false,
      reason: aborted ? 'timeout' : 'network',
      message: aborted ? 'SlipOK ไม่ตอบใน ' + timeoutMs() + ' มิลลิวินาที' : String((e && e.message) || e)
    };
  } finally {
    clearTimeout(timer);
  }
}
