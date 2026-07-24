// services/line.js — ส่งข้อความยืนยันผ่าน LINE Official Account (Messaging API)
// LINE Official Account confirmation via the Messaging API push endpoint.
// If no access token is set, the message is stored on the registration so the
// admin can copy it and send it manually from the LINE OA app.

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
export const lineConfigured = () => Boolean(TOKEN);

// Build a nice Thai confirmation message for a registration.
export function buildConfirmationMessage(reg, workshop, round) {
  const dateTxt = round ? `${round.date} เวลา ${round.time}` : '';
  return [
    '🌿 ยืนยันการสมัคร BARNBARN สำเร็จแล้ว!',
    '',
    `เวิร์กช็อป: ${workshop ? workshop.title : ''}`,
    dateTxt ? `รอบ: ${dateTxt}` : '',
    workshop && workshop.location ? `สถานที่: ${workshop.location}` : '',
    `ชื่อผู้สมัคร: ${reg.name}`,
    `จำนวน: ${reg.people} ท่าน`,
    `ยอดชำระ: ${Number(reg.amount).toLocaleString('th-TH')} บาท (ชำระแล้ว ✓)`,
    `รหัสอ้างอิง: ${reg.id}`,
    '',
    'แล้วพบกันที่เวิร์กช็อปนะคะ 😊 หากมีคำถามทักแชทนี้ได้เลยค่ะ'
  ]
    .filter(Boolean)
    .join('\n');
}

// Push a message to a LINE user. Requires their LINE userId (obtained when they
// message your OA / via webhook). Returns { sent, demo, error? }.
export async function pushMessage(userId, text) {
  if (!lineConfigured() || !userId) {
    return { sent: false, demo: true };
  }
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] })
    });
    if (!res.ok) {
      const err = await res.text();
      return { sent: false, error: err };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: String(e) };
  }
}
