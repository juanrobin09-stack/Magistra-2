#!/usr/bin/env node
// Génère l'icône de Magistra sans dépendance externe (PNG encodé avec node:zlib) :
//   build/icon.png  512×512 (utilisée par electron-builder et la fenêtre)
//   build/icon.ico  PNG 16 → 256 px (Windows)
// Motif : carré arrondi en dégradé violet (#9b87d4 → #c8b6ff) et « M » stylisé foncé.
// Usage : node scripts/make-icon.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'build');

// ─── PNG ────────────────────────────────────────────────────────────────────

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtre « None »
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Dessin ─────────────────────────────────────────────────────────────────

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const FROM = hex('#9b87d4');
const TO = hex('#c8b6ff');
const INK = hex('#16122b');

// « M » : jambages verticaux et pointe centrale (coordonnées relatives, 0 → 1).
const M_POINTS = [
  [0.285, 0.715],
  [0.285, 0.305],
  [0.5, 0.575],
  [0.715, 0.305],
  [0.715, 0.715],
];
const M_SEGMENTS = M_POINTS.slice(1).map((p, i) => [M_POINTS[i], p]);

function distToSegment(px, py, [[ax, ay], [bx, by]]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideRoundedRect(x, y, margin, radius) {
  const lo = margin;
  const hi = 1 - margin;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = Math.min(Math.max(x, lo + radius), hi - radius);
  const cy = Math.min(Math.max(y, lo + radius), hi - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function render(size) {
  const ss = size >= 64 ? 4 : 6; // suréchantillonnage (anticrénelage)
  const margin = size <= 32 ? 0.02 : 0.04;
  const radius = 0.22;
  const stroke = size <= 24 ? 0.12 : size <= 48 ? 0.105 : 0.092;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          if (!insideRoundedRect(x, y, margin, radius)) continue;
          const t = Math.min(1, Math.max(0, (x + y) / 2));
          let c = FROM.map((v, i) => v + (TO[i] - v) * t);
          // Léger reflet en haut de l'icône.
          const gloss = Math.max(0, 0.14 * (1 - y / 0.55));
          c = c.map(v => v + (255 - v) * gloss);
          const d = Math.min(...M_SEGMENTS.map(s => distToSegment(x, y, s)));
          if (d <= stroke / 2) c = INK;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
        out[i + 3] = Math.round((a / (ss * ss)) * 255);
      }
    }
  }
  return encodePng(size, size, out);
}

// ─── ICO (images PNG, Windows Vista et suivants) ────────────────────────────

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map(i => i.png)]);
}

mkdirSync(outDir, { recursive: true });
const png512 = render(512);
writeFileSync(path.join(outDir, 'icon.png'), png512);
const icoImages = [16, 24, 32, 48, 64, 128, 256].map(size => ({ size, png: render(size) }));
writeFileSync(path.join(outDir, 'icon.ico'), encodeIco(icoImages));
console.log(`[make-icon] build/icon.png (${png512.length} octets) et build/icon.ico (${icoImages.length} tailles) générés.`);
