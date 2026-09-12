// Generates a Windows .ico (single 256x256 PNG-payload icon, which every
// Windows version since Vista accepts) from the same raw-PNG approach used
// for the PWA icons, so there is no external image-conversion dependency.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "build-resources");
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

function makePngRGBA(size) {
  const bg = [0x05, 0x07, 0x0a, 255];
  const accent = [0x3d, 0xdc, 0x97, 255];
  const pad = Math.round(size * 0.16);
  const inner = size - pad * 2;

  const raw = Buffer.alloc(size * (size * 4 + 1));
  let pos = 0;
  for (let y = 0; y < size; y++) {
    raw[pos++] = 0;
    for (let x = 0; x < size; x++) {
      const insideSquare = x >= pad && x < pad + inner && y >= pad && y < pad + inner;
      const cx = size / 2;
      const cy = size / 2;
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const isMark = insideSquare && (dx + dy < inner * 0.62);
      const [r, g, b, a] = isMark ? accent : bg;
      raw[pos++] = r;
      raw[pos++] = g;
      raw[pos++] = b;
      raw[pos++] = a;
    }
  }

  const idat = deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // color type 6 = RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const size = 256;
const png = makePngRGBA(size);

// Minimal single-image ICO container wrapping a PNG payload (supported by
// Windows Explorer/taskbar/installer since Vista — no BMP/XOR-mask needed).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // 1 image

const entry = Buffer.alloc(16);
entry[0] = size >= 256 ? 0 : size; // width (0 = 256)
entry[1] = size >= 256 ? 0 : size; // height (0 = 256)
entry[2] = 0; // color palette
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8); // image size
entry.writeUInt32LE(6 + 16, 12); // offset

writeFileSync(join(outDir, "icon.ico"), Buffer.concat([header, entry, png]));
console.log("Generated", join(outDir, "icon.ico"));
