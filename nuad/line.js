// nuad/line.js — LINE OA ของพี่หนึ่ง (แยกจาก LINE OA ของ BARNBARN)
// reply = ตอบตอนลูกค้าทักมา (ไม่นับโควตา) · push = ส่งเอง (นับโควตา)
import crypto from 'crypto';

const secret = () => process.env.NUAD_LINE_CHANNEL_SECRET || '';
const token = () => process.env.NUAD_LINE_CHANNEL_ACCESS_TOKEN || '';
export const enabled = () => !!token();
export const canVerify = () => !!secret();

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
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`LINE ${kind} ${r.status}: ${await r.text()}`);
  return true;
}
export async function reply(replyToken, text) {
  if (!enabled() || !replyToken) return false;
  try { return await call('reply', { replyToken, messages: [{ type: 'text', text }] }); } catch (e) { console.error('จองนวด:', e.message); return false; }
}
export async function push(to, text) {
  if (!enabled() || !to) return false;
  try { return await call('push', { to, messages: [{ type: 'text', text }] }); } catch (e) { console.error('จองนวด:', e.message); return false; }
}
