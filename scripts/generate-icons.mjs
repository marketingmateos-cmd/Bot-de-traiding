// Minimal raw PNG encoder (no deps) to produce PWA icons: dark background
// with a centered accent square, in both regular and "maskable" (bigger
// safe-zone padding) variants.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(size, paddingRatio) {
  const bg = [0x05, 0x07, 0x0a];
  const accent = [0x3d, 0xdc, 0x97];
  const pad = Math.round(size * paddingRatio);
  const inner = size - pad * 2;

  const raw = Buffer.alloc(size * (size * 3 + 1));
  let pos = 0;
  for (let y = 0; y < size; y++) {
    raw[pos++] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const insideSquare = x >= pad && x < pad + inner && y >= pad && y < pad + inner;
      // Simple diamond/lambda-like mark: draw a rounded square with a
      // notch, approximated with two overlapping bands.
      const cx = size / 2;
      const cy = size / 2;
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const isMark = insideSquare && (dx + dy < inner * 0.62);
      const [r, g, b] = isMark ? accent : bg;
      raw[pos++] = r;
      raw[pos++] = g;
      raw[pos++] = b;
    }
  }

  const idat = deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

writeFileSync(join(outDir, "icon-192.png"), makePng(192, 0.22));
writeFileSync(join(outDir, "icon-512.png"), makePng(512, 0.22));
writeFileSync(join(outDir, "icon-maskable-512.png"), makePng(512, 0.32));

console.log("Generated PWA icons in", outDir);
