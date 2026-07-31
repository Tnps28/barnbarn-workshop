// services/email.js — ส่งอีเมลยืนยันการชำระเงินให้ผู้สมัคร (Gmail SMTP ฟรี)
// Uses Gmail SMTP via nodemailer. Set EMAIL_USER (your gmail) and EMAIL_PASS
// (a Google "App Password", 16 chars) as environment variables.
// If not configured, sendConfirmationEmail() is a graceful no-op.

import nodemailer from 'nodemailer';

const EMAIL_USER = (process.env.EMAIL_USER || '').trim();
// Gmail App Passwords are displayed as "abcd efgh ijkl mnop" — strip ALL
// whitespace so it works whether or not the user pasted the spaces.
const EMAIL_PASS = (process.env.EMAIL_PASS || '').replace(/\s+/g, '');
const EMAIL_FROM = process.env.EMAIL_FROM || 'BARNBARN Workshop';

export const emailConfigured = () => Boolean(EMAIL_USER && EMAIL_PASS);

let _transporter = null;
function transporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,       // STARTTLS on 587 (many hosts block 465)
      requireTLS: true,
      auth: { user: EMAIL_USER, pass: EMAIL_PASS },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 25000
    });
  }
  return _transporter;
}

// Diagnostic: verify SMTP connectivity/auth without sending an email.
export async function verifyEmail() {
  if (!emailConfigured()) return { ok: false, skipped: 'not_configured' };
  try {
    await transporter().verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), code: e && e.code };
  }
}

// Diagnostic: send a test email to the owner's own address (EMAIL_USER).
export async function sendTestEmail() {
  if (!emailConfigured()) return { sent: false, skipped: 'not_configured' };
  try {
    await transporter().sendMail({
      from: `"${EMAIL_FROM}" <${EMAIL_USER}>`,
      to: EMAIL_USER,
      subject: 'BARNBARN — ทดสอบระบบอีเมล ✓',
      text: 'ระบบอีเมลยืนยัน BARNBARN Workshop ทำงานได้แล้ว 🎉'
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, error: String(e && e.message ? e.message : e), code: e && e.code };
  }
}

const money = (n) => Number(n || 0).toLocaleString('th-TH');

function fmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('th-TH', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  } catch {
    return d;
  }
}

// Build the confirmation email (subject + html + text) for a paid registration.
export function buildConfirmationEmail(reg, workshop, round) {
  const title = workshop ? workshop.title : 'เวิร์กช็อป';
  const dateTxt = round ? `${fmtDate(round.date)} เวลา ${round.time}` : '';
  const loc = workshop && workshop.location ? workshop.location : '';
  const addons = (reg.addons || []).map((a) => a.name).join(', ');

  const subject = `ยืนยันการสมัคร ${title} · BARNBARN Workshop ✓`;

  const rows = [
    ['เวิร์กช็อป', title],
    ['รอบ', dateTxt],
    ['สถานที่', loc],
    ['ชื่อผู้สมัคร', reg.name],
    ['จำนวน', `${reg.people} ท่าน`],
    addons ? ['อุปกรณ์/บริการเสริม', addons] : null,
    ['ยอดชำระ', `${money(reg.amount)} บาท (ชำระแล้ว ✓)`],
    ['รหัสอ้างอิง', reg.id]
  ].filter(Boolean);

  const tableRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;color:#8a6d4b;white-space:nowrap;vertical-align:top">${k}</td>` +
        `<td style="padding:6px 12px;color:#2f2a24;font-weight:600">${v}</td></tr>`
    )
    .join('');

  const html = `
  <div style="background:#fbf6ee;padding:28px 0;font-family:'Segoe UI',Tahoma,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #efe3d2">
      <div style="background:#f6a531;padding:22px 24px;color:#fff">
        <div style="font-size:22px;font-weight:800">🌿 BARNBARN Workshop</div>
        <div style="font-size:15px;opacity:.95;margin-top:2px">ยืนยันการสมัคร &amp; รับชำระเงินเรียบร้อยแล้ว</div>
      </div>
      <div style="padding:22px 24px">
        <p style="color:#2f2a24;font-size:15px;margin:0 0 14px">
          สวัสดีค่ะ คุณ${reg.name} 😊<br/>
          เราได้รับการชำระเงินของคุณเรียบร้อยแล้ว รายละเอียดการสมัครมีดังนี้:
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;background:#fbf6ee;border-radius:10px;overflow:hidden">
          ${tableRows}
        </table>
        <p style="color:#5b5147;font-size:14px;margin:18px 0 0">
          แล้วพบกันที่เวิร์กช็อปนะคะ ✨ หากมีคำถามเพิ่มเติม ตอบกลับอีเมลนี้ หรือทักเราทาง LINE ได้เลยค่ะ
        </p>
      </div>
      <div style="background:#fbf6ee;padding:14px 24px;color:#a08a70;font-size:12px;text-align:center">
        อีเมลฉบับนี้ส่งอัตโนมัติจากระบบสมัคร BARNBARN Workshop
      </div>
    </div>
  </div>`;

  const text = [
    '🌿 ยืนยันการสมัคร BARNBARN Workshop สำเร็จแล้ว!',
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'แล้วพบกันที่เวิร์กช็อปนะคะ 😊'
  ].join('\n');

  return { subject, html, text };
}

// Send the confirmation email. Returns { sent, skipped?, error? }.
export async function sendConfirmationEmail(reg, workshop, round) {
  if (!emailConfigured()) return { sent: false, skipped: 'not_configured' };
  if (!reg || !reg.email) return { sent: false, skipped: 'no_email' };
  const { subject, html, text } = buildConfirmationEmail(reg, workshop, round);
  try {
    await transporter().sendMail({
      from: `"${EMAIL_FROM}" <${EMAIL_USER}>`,
      to: reg.email,
      subject,
      text,
      html
    });
    return { sent: true };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    console.error('📧 EMAIL send error:', msg, '| code:', e && e.code, '| response:', e && e.response);
    return { sent: false, error: msg };
  }
}
