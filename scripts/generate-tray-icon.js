/**
 * OBSOLETE — do not run. `assets/tray-icon.png` is now a resized derivative of the real app icon
 * (`assets/ninja-quick-icon.png`); this script hand-builds the old plain-amber-square placeholder
 * it replaced and would silently overwrite the real tray icon if run again. Kept only for history;
 * to regenerate the tray icon, resize the real master icon instead (see AGENTS.md's "App icon &
 * system tray" section).
 *
 * (Original doc, for reference: one-time asset generator that wrote a small 32x32 tray icon PNG by
 * hand-building raw pixel/PNG chunk data, amber-accented to match the old POE2 theme.)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 32;
const AMBER = [245, 158, 11]; // matches renderer/styles.css --poe2-accent
const BORDER = [26, 29, 36]; // matches --bg-primary

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(crcInput) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function buildPng() {
  const channels = 4;
  const raw = Buffer.alloc(SIZE * (1 + SIZE * channels));
  for (let y = 0; y < SIZE; y++) {
    const rowStart = y * (1 + SIZE * channels);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < SIZE; x++) {
      const isBorder = x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1;
      const color = isBorder ? BORDER : AMBER;
      const px = rowStart + 1 + x * channels;
      raw[px] = color[0];
      raw[px + 1] = color[1];
      raw[px + 2] = color[2];
      raw[px + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'tray-icon.png');
fs.writeFileSync(outFile, buildPng());
console.log(`wrote ${outFile} (${fs.statSync(outFile).size} bytes)`);
