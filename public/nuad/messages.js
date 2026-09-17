// ข้อความทั้งหมดของระบบจองนวด — ใช้ร่วมกันทั้งเซิร์ฟเวอร์ (ส่งผ่าน LINE OA ของพี่หนึ่ง) และหน้าพี่หนึ่ง (ปุ่มส่งเอง)
// s = settings (มี s.siteUrl = ที่อยู่เว็บ BARNBARN)  ·  แก้ถ้อยคำได้ที่ไฟล์นี้ไฟล์เดียว

export const toT = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
export function thDate(date) {
  return new Date(date + 'T00:00:00Z').toLocaleDateString('th-TH', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' });
}
export function clock(epoch) {
  return new Date(epoch).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
}
const sig = (s) => `\n— ${s.name} · ${s.place || 'BARNBARN'}`;
const bb = (s) => (s.siteUrl ? `\n\n🌿 กิจกรรมเดือนนี้ที่ BARNBARN\n${s.siteUrl}/#calendar` : '');

// kind → { label, for: (b = นัดวันนี้, bt = นัดวันอื่น, q = บัตรคิว), text(s, x) }
export const TEMPLATES = {
  turn:    { label: 'ถึงคิวแล้ว', for: ['q', 'b'], text: (s, x) => `${x.name} ถึงคิวแล้วค่ะ เชิญเข้ามาได้เลยนะคะ 🙏${sig(s)}` },
  next:    { label: 'อีกคิวเดียว', for: ['q'], text: (s, x) => `${x.name} อีกคิวเดียวจะถึงบัตรคิวที่ ${x.no} แล้วค่ะ เตรียมตัวมาได้เลยนะคะ${sig(s)}` },
  late:    { label: 'คิวช้ากว่ากำหนด 15 นาที', for: ['q', 'b'], text: (s, x) => `ขออภัยค่ะ${x.name} วันนี้คิวช้ากว่ากำหนดประมาณ 15 นาที จะรีบดูแลให้เร็วที่สุดนะคะ${sig(s)}` },
  confirm: { label: 'ยืนยันการจอง', for: ['b', 'bt'], text: (s, x) => `ยืนยันนัดนวดค่ะ ${thDate(x.date)} เวลา ${toT(x.time)} น. รหัส ${x.id}${sig(s)}` },
  paid:    { label: 'ได้รับเงินแล้ว ขอบคุณค่ะ', for: ['b', 'bt', 'q'], text: (s, x) => `ได้รับยอดโอนแล้วค่ะ ขอบคุณมากนะคะ ${x.id ? 'รหัส ' + x.id : 'บัตรคิวที่ ' + x.no}${sig(s)}` },
  remind:  { label: 'เตือนนัดพรุ่งนี้', for: ['bt'], text: (s, x) => `เตือนนัดนวดพรุ่งนี้ค่ะ ${thDate(x.date)} เวลา ${toT(x.time)} น. ถ้าติดธุระทักแชทนี้ได้เลยนะคะ${sig(s)}` },
  thanks:  { label: 'ขอบคุณ + ชวนดูกิจกรรม BARNBARN', for: ['b', 'q'], text: (s, x) => `ขอบคุณ${x.name}ที่มานวดวันนี้นะคะ ดื่มน้ำเยอะ ๆ พักผ่อนให้สบายค่ะ 🌿${sig(s)}${bb(s)}` },
};

// ตอบกลับอัตโนมัติ (reply — ไม่นับโควตา)
export const REPLY = {
  linkBooking: (s, b) => b.status === 'hold'
    ? `รับนัดนวดรหัส ${b.id} แล้วค่ะ\n${thDate(b.date)} เวลา ${toT(b.time)} น.\nกันคิวไว้ถึง ${clock(b.holdUntil)} น. โอนแล้วส่งรูปสลิปในแชทนี้ได้เลยนะคะ${sig(s)}`
    : `ผูกนัดนวดรหัส ${b.id} กับ LINE แล้วค่ะ ${thDate(b.date)} เวลา ${toT(b.time)} น. จะแจ้งเตือนในแชทนี้นะคะ${sig(s)}`,
  linkQueue: (s, q, ahead) => `รับบัตรคิวนวดที่ ${q.no} แล้วค่ะ ตอนนี้รออีก ${ahead} คิว ใกล้ถึงคิวจะทักในแชทนี้ ไปเดินเล่นได้เลยนะคะ${sig(s)}`,
  slip: (s, x) => `ได้รับสลิป${x.id ? 'ของรหัส ' + x.id : 'ของบัตรคิวที่ ' + x.no}แล้วค่ะ ${s.name}จะตรวจแล้วแจ้งกลับนะคะ`,
  slipLate: (s, b) => `ได้รับสลิปของรหัส ${b.id} ค่ะ แต่เวลา ${toT(b.time)} น. มีคนจองไปแล้วหลังหมดเวลากันคิว ${s.name}จะติดต่อกลับในแชทนี้นะคะ`,
  notFound: () => 'ไม่พบรหัสนี้ค่ะ ลองเช็กรหัสอีกครั้งนะคะ',
};

// แจ้งพี่หนึ่ง (push — นับโควตา ปิดได้ในหน้าตั้งค่า)
export const OWNER = {
  booking: (b) => `💆 นัดนวดใหม่ ${b.id}\n${b.name} ${b.phone}\n${thDate(b.date)} ${toT(b.time)} น.`,
  slip: (x) => `🧾 สลิปใหม่ ${x.id ? 'รหัส ' + x.id : 'บัตรคิว ' + x.no} · ${x.name} — เปิดหน้าพี่หนึ่งเพื่อกดรับเงิน`,
};
