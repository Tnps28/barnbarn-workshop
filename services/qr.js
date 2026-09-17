// services/qr.js — สร้างรูป QR เป็นไฟล์ PNG ฝั่งเซิร์ฟเวอร์ (ไม่ต้องลงไลบรารีเพิ่ม)
// ใช้ qrcode-generator ตัวเดียวกับที่หน้าเว็บใช้ แล้วเข้ารหัส PNG เองด้วย zlib ที่มากับ Node
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ไฟล์ไลบรารีเป็นแบบ CommonJS แต่โปรเจกต์นี้เป็น ESM (package.json "type": "module")
// ถ้า require ตรง ๆ Node จะอ่านเป็น ESM แล้วได้ออบเจ็กต์ว่าง จึงรันตัวไฟล์เองแล้วดึงค่าออกมา
const qrcode = (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'nuad', 'vendor', 'qrcode-generator.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'define', src)(mod, mod.exports, undefined);
  return mod.exports;
})();

// ---------- PNG encoder ขนาดเล็ก (greyscale 8-bit) ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// pixels = Buffer ขนาด w*h ค่า 0-255 (0 = ดำ, 255 = ขาว)
function encodePng(pixels, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 0;  // colour type: greyscale
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // filter: none
    pixels.copy(raw, y * (w + 1) + 1, y * w, y * w + w);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- API ----------
// สร้าง PNG ของ QR ที่เข้ารหัสข้อความ text
// scale = กี่พิกเซลต่อ 1 ช่อง · quiet = ขอบขาวรอบนอก (หน่วยเป็นช่อง, มาตรฐานคือ 4)
export function qrPng(text, { scale = 10, quiet = 4 } = {}) {
  // typeNumber 0 = ให้ไลบรารีเลือกขนาดที่พอดีเอง · 'M' = กู้คืนได้ ~15% ถ้ารูปเลอะ
  const qr = qrcode(0, 'M');
  qr.addData(String(text));
  qr.make();
  const n = qr.getModuleCount();
  const w = (n + quiet * 2) * scale;
  const px = Buffer.alloc(w * w, 255); // พื้นขาว

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      const y0 = (r + quiet) * scale;
      const x0 = (c + quiet) * scale;
      for (let y = y0; y < y0 + scale; y++) px.fill(0, y * w + x0, y * w + x0 + scale);
    }
  }
  return encodePng(px, w, w);
}
