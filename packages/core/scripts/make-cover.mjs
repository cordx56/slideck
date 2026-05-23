// Generate a sample cover image (PNG). Minimal PNG encoder with no external deps.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const W = 480;
const H = 360;

// Build RGBA pixels (diagonal gradient + circle).
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0; // filter type 0
  for (let x = 0; x < W; x++) {
    const o = y * (1 + W * 4) + 1 + x * 4;
    const t = (x + y) / (W + H);
    const dx = x - W * 0.62;
    const dy = y - H * 0.4;
    const inCircle = dx * dx + dy * dy < 90 * 90;
    raw[o] = inCircle ? 245 : Math.round(20 + t * 90);
    raw[o + 1] = inCircle ? 245 : Math.round(30 + t * 120);
    raw[o + 2] = inCircle ? 245 : Math.round(60 + t * 190);
    raw[o + 3] = 255;
  }
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync("public/examples/basic/img", { recursive: true });
writeFileSync("public/examples/basic/img/cover.png", png);
console.log(`wrote cover.png (${png.length} bytes)`);
