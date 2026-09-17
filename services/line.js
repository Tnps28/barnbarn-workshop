// services/line.js — LINE OA ของ "บ้าน-บ้าน สุขพอดี" (Messaging API)
// reply = ตอบตอนลูกค้าทักมา (ฟรี ไม่นับโควตา) · push = เราส่งเอง (นับโควตา 300/เดือน)
// อ่านค่า env แบบ lazy เพราะ server.js โหลด .env หลัง import โมดูลนี้
import crypto from 'crypto';

const token = () => process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const secret = () => process.env.LINE_CHANNEL_SECRET || '';

export const lineConfigured = () => Boolean(token());
export const canVerify = () => Boolean(secret());

// ตรวจลายเซ็นของ LINE — กันคนปลอมข้อความมาผูกใบสมัครของคนอื่น
export function verify(raw, signature) {
  if (!secret() || !raw || !signature) return false;
  const a = Buffer.from(crypto.createHmac('sha256', secret()).update(raw).digest('base64'));
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function call(kind, body) {
  const r = await fetch('https://api.line.me/v2/bot/message/' + kind, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`LINE ${kind} ${r.status}: ${await r.text()}`);
  return true;
}

// รับได้ทั้งข้อความสั้น ๆ หรือ array ของ message object (เช่นข้อความ + รูป)
function toMessages(input) {
  const arr = Array.isArray(input) ? input : [input];
  return arr
    .filter(Boolean)
    .map((m) => (typeof m === 'string' ? { type: 'text', text: m } : m))
    .slice(0, 5); // LINE รับได้สูงสุด 5 ข้อความต่อการเรียก 1 ครั้ง
}

// รูปภาพ — LINE ต้องการลิงก์ https สาธารณะ (ไม่รับ base64)
export const imageMessage = (url) => ({
  type: 'image',
  originalContentUrl: url,
  previewImageUrl: url
});

// ตอบกลับตอนลูกค้าทักมา — ฟรี ใช้ได้ภายใน ~30 วินาทีหลังได้ replyToken
export async function reply(replyToken, input) {
  const messages = toMessages(input);
  if (!lineConfigured() || !replyToken || !messages.length) return false;
  try {
    return await call('reply', { replyToken, messages });
  } catch (e) {
    console.error('LINE reply:', e.message);
    return false;
  }
}

// ส่งเอง — ต้องรู้ userId ของลูกค้า (ได้จาก webhook ตอนเขาส่งรหัสอ้างอิงมาในแชท)
// คืน { sent, demo, error? } เพื่อให้หน้าแอดมินรู้ว่าต้องก๊อปส่งเองไหม
export async function pushMessage(userId, input) {
  const messages = toMessages(input);
  if (!lineConfigured() || !userId || !messages.length) return { sent: false, demo: true };
  try {
    await call('push', { to: userId, messages });
    return { sent: true };
  } catch (e) {
    console.error('LINE push:', e.message);
    return { sent: false, error: e.message };
  }
}

// ---------------------------------------------------------------- ข้อความสำเร็จรูป
const money = (n) => Number(n || 0).toLocaleString('th-TH');
const roundTxt = (round) => (round ? `${round.date} เวลา ${round.time}` : '');

// ยืนยันที่นั่งหลังแอดมินตรวจสลิปแล้ว
export function buildConfirmationMessage(reg, workshop, round) {
  return [
    '🌿 ยืนยันการสมัคร BARNBARN สำเร็จแล้ว!',
    '',
    `เวิร์กช็อป: ${workshop ? workshop.title : ''}`,
    roundTxt(round) ? `รอบ: ${roundTxt(round)}` : '',
    workshop && workshop.location ? `สถานที่: ${workshop.location}` : '',
    `ชื่อผู้สมัคร: ${reg.name}`,
    `จำนวน: ${reg.people} ท่าน`,
    `ยอดชำระ: ${money(reg.amount)} บาท (ชำระแล้ว ✓)`,
    `รหัสอ้างอิง: ${reg.id}`,
    '',
    '🎟️ รูป QR ด้านล่างคือบัตรเข้างาน วันงานเปิดให้ผู้จัดสแกนได้เลยค่ะ',
    '',
    'แล้วพบกันที่เวิร์กช็อปนะคะ 😊 หากมีคำถามทักแชทนี้ได้เลยค่ะ'
  ].filter(Boolean).join('\n');
}

// ตอบตอนลูกค้าส่งรหัสอ้างอิงเข้ามาในแชท (ผูกบัญชีไลน์กับใบสมัครสำเร็จ)
export function buildLinkedMessage(reg, workshop, round) {
  const status = reg.status === 'confirmed' || reg.confirmed
    ? 'สถานะ: ยืนยันที่นั่งแล้ว ✓'
    : reg.status === 'awaiting_verification'
      ? 'สถานะ: ได้รับสลิปแล้ว กำลังตรวจสอบค่ะ'
      : 'สถานะ: รอชำระเงิน';
  return [
    '✅ เชื่อมบัญชี LINE กับใบสมัครเรียบร้อยแล้วค่ะ',
    '',
    `เวิร์กช็อป: ${workshop ? workshop.title : ''}`,
    roundTxt(round) ? `รอบ: ${roundTxt(round)}` : '',
    `ชื่อผู้สมัคร: ${reg.name}`,
    `รหัสอ้างอิง: ${reg.id}`,
    status,
    '',
    '🎟️ รูป QR ด้านล่างคือบัตรเข้างาน เก็บไว้ในแชทนี้ได้เลย ไม่ต้องปรินต์',
    'วันงานเปิดให้ผู้จัดสแกน แล้วข่าวสารของรอบนี้จะส่งมาที่นี่นะคะ 🌿'
  ].filter(Boolean).join('\n');
}

// ตอบตอนลูกค้าแจ้งชำระเงิน (เว็บเรียก push เพราะไม่มี replyToken)
export function buildSlipReceivedMessage(reg, workshop, round) {
  return [
    '📩 ได้รับสลิปของคุณแล้วค่ะ',
    '',
    `เวิร์กช็อป: ${workshop ? workshop.title : ''}`,
    roundTxt(round) ? `รอบ: ${roundTxt(round)}` : '',
    `ยอดที่แจ้งโอน: ${money(reg.amount)} บาท`,
    `รหัสอ้างอิง: ${reg.id}`,
    '',
    'ผู้จัดกำลังตรวจสอบ และจะส่งข้อความยืนยันที่นั่งมาที่แชทนี้ค่ะ 🌿'
  ].filter(Boolean).join('\n');
}

// ตอบตอนมีคนกดแอดเพื่อน
export function buildWelcomeMessage() {
  return [
    '🌿 ยินดีต้อนรับสู่ บ้าน-บ้าน สุขพอดี ค่ะ',
    '',
    'ถ้าคุณสมัครเวิร์กช็อปไว้แล้ว ให้ส่ง "รหัสอ้างอิง" ที่ได้จากหน้าเว็บ',
    '(ขึ้นต้นด้วย reg_) มาในแชทนี้ได้เลยค่ะ',
    'ระบบจะผูกให้อัตโนมัติ แล้วส่งข้อความยืนยันที่นั่งมาที่นี่',
    '',
    'มีคำถามอื่นทักมาได้เลยนะคะ 😊'
  ].join('\n');
}

// ตอบตอนส่งรหัสมาแต่หาไม่เจอ
export function buildNotFoundMessage() {
  return [
    'ไม่พบใบสมัครที่ตรงกับรหัสนี้ค่ะ 😢',
    '',
    'ลองตรวจดูรหัสอ้างอิงจากหน้าเว็บอีกครั้ง (ขึ้นต้นด้วย reg_)',
    'หรือพิมพ์มาบอกเราได้เลยค่ะ เดี๋ยวช่วยตรวจให้'
  ].join('\n');
}
