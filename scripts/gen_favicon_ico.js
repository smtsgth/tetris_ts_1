#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const width = 64;
const height = 64;
const bytesPerPixel = 4; // BGRA

const xorSize = width * height * bytesPerPixel;
const andRowBytes = Math.ceil(width / 32) * 4; // rows padded to 32-bit
const andSize = andRowBytes * height;
const bmpInfoHeaderSize = 40;
const imageDataSize = bmpInfoHeaderSize + xorSize + andSize;
const iconDirSize = 6 + 16; // ICONDIR + one ICONDIRENTRY
const totalSize = iconDirSize + imageDataSize;

const out = Buffer.alloc(totalSize);
let off = 0;

// ICONDIR
out.writeUInt16LE(0, off);
off += 2; // reserved
out.writeUInt16LE(1, off);
off += 2; // type (1 = icon)
out.writeUInt16LE(1, off);
off += 2; // count

// ICONDIRENTRY (16 bytes)
out.writeUInt8(width === 256 ? 0 : width, off);
off += 1; // width
out.writeUInt8(height === 256 ? 0 : height, off);
off += 1; // height
out.writeUInt8(0, off);
off += 1; // color count
out.writeUInt8(0, off);
off += 1; // reserved
out.writeUInt16LE(1, off);
off += 2; // planes
out.writeUInt16LE(32, off);
off += 2; // bit count
out.writeUInt32LE(imageDataSize, off);
off += 4; // bytes in resource
out.writeUInt32LE(iconDirSize, off);
off += 4; // image offset

// BITMAPINFOHEADER (40 bytes)
let infoOff = iconDirSize;
out.writeUInt32LE(bmpInfoHeaderSize, infoOff);
infoOff += 4; // biSize
out.writeInt32LE(width, infoOff);
infoOff += 4; // biWidth
out.writeInt32LE(height * 2, infoOff);
infoOff += 4; // biHeight (XOR+AND)
out.writeUInt16LE(1, infoOff);
infoOff += 2; // planes
out.writeUInt16LE(32, infoOff);
infoOff += 2; // bitCount
out.writeUInt32LE(0, infoOff);
infoOff += 4; // compression (BI_RGB)
out.writeUInt32LE(xorSize, infoOff);
infoOff += 4; // sizeImage
out.writeInt32LE(0, infoOff);
infoOff += 4; // xPelsPerMeter
out.writeInt32LE(0, infoOff);
infoOff += 4; // yPelsPerMeter
out.writeUInt32LE(0, infoOff);
infoOff += 4; // clrUsed
out.writeUInt32LE(0, infoOff);
infoOff += 4; // clrImportant

// Pixel generation (BGRA), rows bottom-up
const pixelStart = iconDirSize + bmpInfoHeaderSize;
let p = pixelStart;

function rgbaToBGRABytes(r, g, b, a) {
  return [b & 0xff, g & 0xff, r & 0xff, a & 0xff];
}

// colors
const bg = [0x0b, 0x12, 0x20, 0xff]; // #0b1220
const c1 = [0x00, 0xbc, 0xd4, 0xff]; // #00bcd4
const c2 = [0xff, 0x98, 0x00, 0xff]; // #ff9800
const c3 = [0x4c, 0xaf, 0x50, 0xff]; // #4caf50
const c4 = [0x8e, 0x44, 0xad, 0xff]; // #8e44ad

function colorAt(x, y) {
  // positions as in favicon.svg: rects at (8,8),(24,8),(40,8),(24,24) size 16x16
  if (x >= 8 && x < 24 && y >= 8 && y < 24) return c1; // top-left
  if (x >= 24 && x < 40 && y >= 8 && y < 24) return c2; // top-middle
  if (x >= 40 && x < 56 && y >= 8 && y < 24) return c3; // top-right
  if (x >= 24 && x < 40 && y >= 24 && y < 40) return c4; // middle
  return bg;
}

for (let row = height - 1; row >= 0; row--) {
  for (let x = 0; x < width; x++) {
    const col = colorAt(x, row);
    out[p++] = col[2]; // B
    out[p++] = col[1]; // G
    out[p++] = col[0]; // R
    out[p++] = col[3]; // A
  }
}

// AND mask (1bpp per pixel, rows padded to 32-bit). We'll set all bits 0 (opaque)
const andStart = pixelStart + xorSize;
let aPtr = andStart;
const maskRowBytes = andRowBytes; // already calculated
for (let y = 0; y < height; y++) {
  // write maskRowBytes zeros
  for (let i = 0; i < maskRowBytes; i++) {
    out[aPtr++] = 0x00;
  }
}

// write buffer to favicon.ico
const outPath = path.join(process.cwd(), "favicon.ico");
fs.writeFileSync(outPath, out);
console.log("Wrote", out.length, "bytes to", outPath);

// quick sanity check
if (fs.existsSync(outPath)) {
  const st = fs.statSync(outPath);
  console.log("File size:", st.size);
} else {
  console.error("Write failed");
  process.exit(1);
}

process.exit(0);
