/**
 * Generates the PWA / home-screen app icons from the BrandMark geometry
 * (the J: stem → rounded corner → foot, from src/components/BrandMark.tsx),
 * drawn as off-white on brand ebony. Pure Node — writes PNGs directly, no deps.
 *
 * Run: node scripts/make-icons.js   (outputs to public/icons/)
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ── Minimal PNG encoder (RGBA, 8-bit) ────────────────────────
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
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── The J mark, in its 0..100 coordinate space ────────────────
// Path M80 6 V71 A17 17 0 0 1 63 88 H6 with strokeWidth 8 (butt caps):
//   stem: x 76..84, y 6..71 · corner ring: centre (63,71), radius 13..21,
//   quadrant right+below centre · foot: x 6..63, y 84..92.
function inMark(u, v) {
  if (u >= 76 && u <= 84 && v >= 6 && v <= 71) return true;
  if (u >= 6 && u <= 63 && v >= 84 && v <= 92) return true;
  const du = u - 63;
  const dv = v - 71;
  if (du >= 0 && dv >= 0) {
    const r = Math.hypot(du, dv);
    if (r >= 13 && r <= 21) return true;
  }
  return false;
}

const BG = [22, 21, 20]; // brand ebony  #161514
const FG = [244, 242, 238]; // brand ink #f4f2ee

function makeIcon(size, padFrac) {
  const rgba = Buffer.alloc(size * size * 4);
  const content = size * (1 - 2 * padFrac);
  const off = size * padFrac;
  const SS = 3; // 3x3 supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS - off) / content) * 100;
          const v = ((y + (sy + 0.5) / SS - off) / content) * 100;
          if (inMark(u, v)) hit++;
        }
      }
      const a = hit / (SS * SS);
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(BG[0] + (FG[0] - BG[0]) * a);
      rgba[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * a);
      rgba[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * a);
      rgba[i + 3] = 255;
    }
  }
  return encodePNG(size, size, rgba);
}

const out = path.join(__dirname, "..", "public", "icons");
fs.mkdirSync(out, { recursive: true });
const targets = [
  ["icon-192.png", 192, 0.18],
  ["icon-512.png", 512, 0.18],
  ["icon-512-maskable.png", 512, 0.3], // extra safe-zone padding for Android masks
  ["apple-touch-icon.png", 180, 0.18],
];
for (const [name, size, pad] of targets) {
  fs.writeFileSync(path.join(out, name), makeIcon(size, pad));
  console.log(`✓ ${name} (${size}x${size})`);
}
