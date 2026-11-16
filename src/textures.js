// Every texture in the game is generated here on canvases at load time. No image files.
import * as THREE from 'three';

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Tileable value noise. px, py are the integer periods.
function vnoise(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
  const y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal noise over the unit square, tileable. fx, fy are base frequencies (integers).
function fbm(u, v, fx, fy, oct, seed) {
  let amp = 0.5, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(u * fx, v * fy, fx, fy, seed + o * 17);
    norm += amp;
    amp *= 0.5; fx *= 2; fy *= 2;
  }
  return sum / norm;
}

const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const to8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

function canvasTex(canvas, srgb, repeat = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// pixelFn(u, v, out) writes [r, g, b, height]. v runs from the top of the canvas down.
function surface(w, h, pixelFn, post, normalScale = 3) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const H = new Float32Array(w * h);
  const out = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      pixelFn(x / w, y / h, out);
      const i = (y * w + x) * 4;
      img.data[i] = to8(out[0]); img.data[i + 1] = to8(out[1]); img.data[i + 2] = to8(out[2]); img.data[i + 3] = 255;
      H[y * w + x] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  if (post) post(ctx, w, h);

  const nc = document.createElement('canvas');
  nc.width = w; nc.height = h;
  const nctx = nc.getContext('2d');
  const nimg = nctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hx = H[y * w + ((x + 1) % w)] - H[y * w + ((x - 1 + w) % w)];
      const hy = H[((y + 1) % h) * w + x] - H[((y - 1 + h) % h) * w + x];
      let nx = -hx * normalScale, ny = hy * normalScale, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      nimg.data[i] = to8(nx * 0.5 + 0.5); nimg.data[i + 1] = to8(ny * 0.5 + 0.5); nimg.data[i + 2] = to8(nz * 0.5 + 0.5); nimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  return { map: canvasTex(c, true), normalMap: canvasTex(nc, false) };
}

function cracks(ctx, w, h, count, seed, color = 'rgba(20,18,16,0.55)') {
  const r = rng(seed);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = r() * w, y = r() * h, a = r() * Math.PI * 2;
    ctx.lineWidth = 0.6 + r() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const n = 20 + Math.floor(r() * 50);
    for (let k = 0; k < n; k++) {
      a += (r() - 0.5) * 0.9;
      x += Math.cos(a) * (4 + r() * 8);
      y += Math.sin(a) * (4 + r() * 8);
      ctx.lineTo(x, y);
      if (r() < 0.04) { ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y); a += (r() - 0.5) * 2; }
    }
    ctx.stroke();
  }
}

// ---------- surfaces ----------

// Plaster wall. The canvas covers 4 m across and one 3.5 m storey vertically, so the
// painted lower band lines up on both floors.
function wallTex() {
  return surface(1024, 1024, (u, v, o) => {
    const hgt = (1 - v) * 3.5;
    const n1 = fbm(u, v, 4, 4, 5, 1);
    const n2 = fbm(u, v, 9, 9, 4, 2);
    const fine = fbm(u, v, 64, 64, 2, 3);
    const peel = sstep(0.635, 0.665, fbm(u, v, 7, 7, 5, 7) + 0.1 * fine + 0.06 * sstep(1.0, 0.0, hgt));
    const edge = 1.3 + (n2 - 0.5) * 0.06;
    const band = hgt < edge ? 1 : 0;
    let r, g, b;
    if (band) { r = 0.33; g = 0.44; b = 0.43; } else { r = 0.71; g = 0.70; b = 0.65; }
    if (hgt > edge && hgt < edge + 0.035) { r = 0.22; g = 0.27; b = 0.27; }
    const shade = 0.8 + 0.4 * n1;
    r *= shade; g *= shade; b *= shade;
    const streak = sstep(0.52, 0.78, fbm(u, v, 48, 2, 3, 11)) * (0.35 + 0.65 * sstep(0.2, 3.0, hgt));
    const k1 = 1 - 0.38 * streak;
    r *= k1; g *= k1 * 0.99; b *= k1 * 0.96;
    const low = sstep(0.55, 0.0, hgt) * (0.4 + n2);
    const k2 = 1 - 0.5 * low;
    r *= k2; g *= k2; b *= k2;
    const top = sstep(2.5, 3.2, hgt) * n2;
    r *= 1 - 0.35 * top; g *= 1 - 0.28 * top; b *= 1 - 0.36 * top;
    const raw = 0.46 + 0.22 * n2;
    r += (raw * 1.03 - r) * peel; g += (raw - g) * peel; b += (raw * 0.94 - b) * peel;
    const rim = peel * (1 - peel) * 4;
    r *= 1 - 0.22 * rim; g *= 1 - 0.22 * rim; b *= 1 - 0.22 * rim;
    o[0] = r; o[1] = g; o[2] = b;
    o[3] = (1 - peel) * 0.3 + fine * 0.3 + n2 * 0.15;
  }, (ctx, w, h) => cracks(ctx, w, h, 9, 31), 1.8);
}

function floorTex() {
  return surface(1024, 1024, (u, v, o) => {
    const n1 = fbm(u, v, 3, 3, 5, 21);
    const n2 = fbm(u, v, 10, 10, 4, 22);
    const fine = fbm(u, v, 96, 96, 2, 23);
    let c = 0.43 * (0.78 + 0.44 * n1);
    let r = c * 1.02, g = c, b = c * 0.96;
    const dust = sstep(0.48, 0.72, n2) * 0.5;
    r += (0.60 - r) * dust; g += (0.58 - g) * dust; b += (0.53 - b) * dust;
    const stain = sstep(0.62, 0.74, fbm(u, v, 4, 4, 4, 25));
    const k = 1 - 0.3 * stain;
    r *= k; g *= k; b *= k;
    if (fine > 0.72) { r *= 0.78; g *= 0.78; b *= 0.78; }
    else if (fine < 0.26) { r *= 1.12; g *= 1.11; b *= 1.08; }
    o[0] = r; o[1] = g; o[2] = b;
    o[3] = fine * 0.6 + n2 * 0.4;
  }, (ctx, w, h) => {
    cracks(ctx, w, h, 14, 77);
    const r = rng(5);
    for (let i = 0; i < 900; i++) {
      const s = 1 + r() * 3;
      ctx.fillStyle = r() < 0.6 ? `rgba(28,26,24,${0.2 + r() * 0.35})` : `rgba(150,146,138,${0.2 + r() * 0.3})`;
      ctx.fillRect(r() * w, r() * h, s, s * (0.5 + r()));
    }
  }, 2.2);
}

function ceilTex() {
  return surface(512, 512, (u, v, o) => {
    const n1 = fbm(u, v, 4, 4, 5, 41);
    const fine = fbm(u, v, 48, 48, 2, 42);
    const mold = sstep(0.6, 0.82, fbm(u, v, 6, 6, 5, 43)) * 0.6;
    const peel = sstep(0.72, 0.76, fbm(u, v, 9, 9, 4, 44));
    let r = 0.62 * (0.82 + 0.36 * n1), g = r, b = r * 0.96;
    r += (0.21 - r) * mold * 0.8; g += (0.24 - g) * mold * 0.8; b += (0.18 - b) * mold * 0.8;
    r += (0.47 - r) * peel; g += (0.46 - g) * peel; b += (0.43 - b) * peel;
    o[0] = r; o[1] = g; o[2] = b;
    o[3] = (1 - peel) * 0.3 + fine * 0.5;
  }, null, 1.8);
}

function concreteTex() {
  return surface(512, 512, (u, v, o) => {
    const n1 = fbm(u, v, 4, 4, 5, 51);
    const fine = fbm(u, v, 64, 64, 2, 52);
    let c = 0.42 * (0.72 + 0.56 * n1);
    const line = Math.abs(((v * 6) % 1) - 0.5) < 0.012 ? 0.75 : 1;
    c *= line;
    if (fine > 0.74) c *= 0.6;
    const stain = sstep(0.55, 0.75, fbm(u, v, 24, 3, 3, 53));
    c *= 1 - 0.3 * stain;
    o[0] = c * 1.01; o[1] = c; o[2] = c * 0.97;
    o[3] = fine * 0.7 + (line < 1 ? 0 : 0.3);
  }, (ctx, w, h) => cracks(ctx, w, h, 6, 91));
}

function woodTex() {
  return surface(512, 512, (u, v, o) => {
    const grain = fbm(u, v, 3, 64, 4, 61);
    const n = fbm(u, v, 4, 4, 3, 62);
    const gap = Math.abs(((v * 5) % 1) - 0.5) > 0.475 ? 0.45 : 1;
    const t = grain * 0.8 + n * 0.2;
    o[0] = (0.24 + 0.2 * t) * gap; o[1] = (0.17 + 0.14 * t) * gap; o[2] = (0.10 + 0.09 * t) * gap;
    o[3] = grain * 0.6 + (gap < 1 ? 0 : 0.4);
  });
}

function metalTex() {
  return surface(512, 512, (u, v, o) => {
    const n = fbm(u, v, 6, 6, 5, 71);
    const rust = sstep(0.5, 0.68, n + 0.15 * fbm(u, v, 40, 40, 2, 72));
    let r = 0.15, g = 0.16, b = 0.17;
    r += (0.33 - r) * rust; g += (0.17 - g) * rust; b += (0.08 - b) * rust;
    const k = 0.8 + 0.4 * fbm(u, v, 12, 12, 3, 73);
    o[0] = r * k; o[1] = g * k; o[2] = b * k;
    o[3] = rust * 0.7 + n * 0.3;
  });
}

// ---------- graffiti (original pieces, drawn procedurally) ----------

const PALETTES = [
  { a: '#f2c230', b: '#d9631e', outline: '#141210', shadow: '#2b3f8f', hi: '#fff6d8' },
  { a: '#e9e4d4', b: '#8fb3c9', outline: '#12151c', shadow: '#b3262b', hi: '#ffffff' },
  { a: '#d94f8a', b: '#7a2a8c', outline: '#0f0d12', shadow: '#e8d34a', hi: '#ffd9ee' },
  { a: '#7fd1a0', b: '#1f7a63', outline: '#101412', shadow: '#f0e6c8', hi: '#eafff2' },
  { a: '#f0f0ec', b: '#bdbdb5', outline: '#0c0c0c', shadow: '#3c3c3c', hi: '#ffffff' },
];
const BLOCK_FONT = '"Arial Rounded MT Bold","Arial Black","Helvetica Neue",Impact,sans-serif';
const TAG_FONT = '"Marker Felt","Bradley Hand","Chalkduster","Comic Sans MS",cursive';

function bubbleWord(ctx, word, x, y, size, pal, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((r() - 0.5) * 0.1);
  ctx.transform(1, (r() - 0.5) * 0.12, -0.16, 1, 0, 0);
  ctx.font = `900 ${size}px ${BLOCK_FONT}`;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const total = ctx.measureText(word).width * 0.9;
  let cx = -total / 2;
  const letters = [...word].map((ch) => {
    const lw = ctx.measureText(ch).width;
    const L = { ch, x: cx + lw / 2, y: (r() - 0.5) * size * 0.14, rot: (r() - 0.5) * 0.18, s: 0.92 + r() * 0.2, lw };
    cx += lw * 0.9;
    return L;
  });
  const each = (fn) => {
    for (const L of letters) {
      ctx.save(); ctx.translate(L.x, L.y); ctx.rotate(L.rot); ctx.scale(L.s, L.s);
      fn(L); ctx.restore();
    }
  };
  // extruded shadow
  ctx.strokeStyle = pal.shadow; ctx.fillStyle = pal.shadow; ctx.lineWidth = size * 0.15;
  for (let k = size * 0.11; k > 0; k -= 3) {
    ctx.save(); ctx.translate(k, k * 0.8);
    each((L) => ctx.strokeText(L.ch, 0, 0));
    ctx.restore();
  }
  ctx.strokeStyle = pal.outline; ctx.lineWidth = size * 0.15;
  each((L) => ctx.strokeText(L.ch, 0, 0));
  const g = ctx.createLinearGradient(0, -size * 0.45, 0, size * 0.45);
  g.addColorStop(0, pal.a); g.addColorStop(1, pal.b);
  ctx.fillStyle = g;
  each((L) => ctx.fillText(L.ch, 0, 0));
  // highlight flecks inside the letters
  ctx.fillStyle = pal.hi;
  each((L) => {
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.ellipse(-L.lw * 0.18, -size * 0.2, size * 0.035, size * 0.07, 0.5, 0, 6.3); ctx.fill();
    ctx.globalAlpha = 1;
  });
  // drips
  ctx.strokeStyle = pal.outline;
  for (const L of letters) {
    if (r() < 0.6) {
      const dx = L.x + (r() - 0.5) * L.lw * 0.6, len = size * (0.15 + r() * 0.5);
      ctx.lineWidth = size * (0.012 + r() * 0.02);
      ctx.beginPath(); ctx.moveTo(dx, size * 0.38); ctx.lineTo(dx + (r() - 0.5) * 3, size * 0.38 + len); ctx.stroke();
    }
  }
  // bubbles around the piece
  for (let i = 0; i < 9; i++) {
    const bx = (r() - 0.5) * total * 1.25, by = (r() - 0.5) * size * 1.5, br = size * (0.02 + r() * 0.05);
    ctx.fillStyle = r() < 0.5 ? pal.a : pal.shadow;
    ctx.strokeStyle = pal.outline; ctx.lineWidth = size * 0.02;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.3); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function tag(ctx, text, x, y, size, color, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((r() - 0.5) * 0.5);
  ctx.font = `italic 700 ${size}px ${TAG_FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = size * 0.05;
  ctx.strokeText(text, 0, 0); ctx.fillText(text, 0, 0);
  const w = ctx.measureText(text).width;
  ctx.lineWidth = size * 0.06;
  ctx.beginPath();
  ctx.moveTo(-w * 0.55, size * 0.55);
  ctx.bezierCurveTo(-w * 0.2, size * 0.8, w * 0.2, size * 0.35, w * 0.6, size * 0.62);
  ctx.stroke();
  if (r() < 0.6) {
    ctx.beginPath(); ctx.moveTo(w * 0.6, size * 0.62); ctx.lineTo(w * 0.47, size * 0.48);
    ctx.moveTo(w * 0.6, size * 0.62); ctx.lineTo(w * 0.46, size * 0.74); ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    if (r() < 0.5) {
      const dx = (r() - 0.5) * w;
      ctx.lineWidth = size * 0.025;
      ctx.beginPath(); ctx.moveTo(dx, size * 0.3); ctx.lineTo(dx, size * (0.6 + r() * 0.9)); ctx.stroke();
    }
  }
  ctx.restore();
}

function wear(ctx, w, h, r, amount) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < amount; i++) {
    const s = 1 + r() * r() * 26;
    ctx.globalAlpha = 0.15 + r() * 0.7;
    ctx.beginPath();
    ctx.ellipse(r() * w, r() * h, s, s * (0.4 + r()), r() * 3, 0, 6.3);
    ctx.fill();
  }
  // heavier loss toward the floor
  const g = ctx.createLinearGradient(0, h * 0.7, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function graffitiPiece(word, pal, seed) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const ctx = c.getContext('2d');
  const r = rng(seed);
  // overspray cloud behind the letters
  for (let i = 0; i < 40; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, pal.shadow + '55'); g.addColorStop(1, pal.shadow + '00');
    ctx.save();
    ctx.translate(150 + r() * 724, 150 + r() * 212);
    ctx.scale(60 + r() * 90, 50 + r() * 70);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, 6.3); ctx.fill();
    ctx.restore();
  }
  const size = Math.min(300, 1500 / Math.max(3, word.length));
  bubbleWord(ctx, word, 512, 250, size, pal, r);
  tag(ctx, ['one', 'kz', '26', 'dust'][Math.floor(r() * 4)], 880, 430, 46, pal.outline, r);
  wear(ctx, 1024, 512, r, 2600);
  return canvasTex(c, true, false);
}

function tagSheet(seed) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  const r = rng(seed);
  const words = ['HUSH', 'moth', 'FERAL', 'no exit', 'RUST', 'wake', 'k9', 'ECHO', 'stay out', 'north'];
  const cols = ['#101010', '#b3262b', '#1d3f8a', '#e8e4d8', '#101010', '#2a6b4f'];
  for (let i = 0; i < 5; i++) {
    tag(ctx, words[Math.floor(r() * words.length)], 110 + r() * 290, 80 + i * 90 + r() * 30, 44 + r() * 46, cols[Math.floor(r() * cols.length)], r);
  }
  wear(ctx, 512, 512, r, 1200);
  return canvasTex(c, true, false);
}

function mural(seed) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1024;
  const ctx = c.getContext('2d');
  const r = rng(seed);
  const cols = ['#e2b23a', '#2c4f9e', '#c9c2ae', '#b8432f', '#1c1c1c'];
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // big overlapping blobs
  for (let i = 0; i < 5; i++) {
    const x = 250 + i * 380 + (r() - 0.5) * 120, y = 420 + (r() - 0.5) * 260, rad = 200 + r() * 150;
    ctx.fillStyle = cols[i % 4];
    ctx.strokeStyle = '#141414'; ctx.lineWidth = 22;
    ctx.beginPath();
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * Math.PI * 2, rr = rad * (0.8 + 0.3 * Math.sin(a * 3 + i) + r() * 0.08);
      const px = x + Math.cos(a) * rr * 1.25, py = y + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // wave bands
  for (let b = 0; b < 4; b++) {
    ctx.strokeStyle = cols[(b + 1) % 5]; ctx.lineWidth = 34 - b * 4;
    ctx.beginPath();
    const y0 = 220 + b * 170, ph = r() * 6;
    for (let x = 60; x <= 1990; x += 20) {
      const y = y0 + Math.sin(x * 0.012 + ph) * 60 + Math.sin(x * 0.031 + b) * 22;
      if (x === 60) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // dot fields and rings
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = cols[Math.floor(r() * 5)];
    ctx.beginPath(); ctx.arc(80 + r() * 1890, 90 + r() * 800, 6 + r() * 16, 0, 6.3); ctx.fill();
  }
  for (let i = 0; i < 7; i++) {
    ctx.strokeStyle = '#141414'; ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(150 + r() * 1750, 180 + r() * 620, 40 + r() * 70, 0, 6.3); ctx.stroke();
  }
  // drips
  ctx.strokeStyle = '#141414';
  for (let i = 0; i < 40; i++) {
    const x = 100 + r() * 1850, y = 500 + r() * 300;
    ctx.lineWidth = 3 + r() * 6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 60 + r() * 220); ctx.stroke();
  }
  bubbleWord(ctx, 'STILL HERE', 1024, 820, 150, PALETTES[4], r);
  wear(ctx, 2048, 1024, r, 7000);
  return canvasTex(c, true, false);
}

// ---------- small decals ----------

function stainTex(seed, tall) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = tall ? 512 : 256;
  const ctx = c.getContext('2d');
  const r = rng(seed);
  if (tall) {
    for (let i = 0; i < 26; i++) {
      const x = 40 + r() * 176, w = 4 + r() * 22, len = 120 + r() * 380;
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, `rgba(22,18,12,${0.25 + r() * 0.4})`); g.addColorStop(1, 'rgba(22,18,12,0)');
      ctx.fillStyle = g; ctx.fillRect(x, 0, w, len);
    }
  } else {
    for (let i = 0; i < 60; i++) {
      const x = 128 + (r() - 0.5) * 150 * r(), y = 128 + (r() - 0.5) * 150 * r(), rad = 12 + r() * 46;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(18,15,11,${0.1 + r() * 0.22})`); g.addColorStop(1, 'rgba(18,15,11,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.3); ctx.fill();
    }
  }
  return canvasTex(c, true, false);
}

function holeTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.22, 'rgba(4,4,4,0.95)');
  g.addColorStop(0.4, 'rgba(30,28,26,0.6)'); g.addColorStop(0.7, 'rgba(40,38,36,0.2)'); g.addColorStop(1, 'rgba(40,38,36,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const r = rng(3);
  ctx.strokeStyle = 'rgba(8,8,8,0.6)';
  for (let i = 0; i < 6; i++) {
    const a = r() * 6.3;
    ctx.lineWidth = 0.6 + r();
    ctx.beginPath(); ctx.moveTo(32, 32); ctx.lineTo(32 + Math.cos(a) * (10 + r() * 16), 32 + Math.sin(a) * (10 + r() * 16)); ctx.stroke();
  }
  return canvasTex(c, true, false);
}

function poolTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const r = rng(12);
  for (let i = 0; i < 70; i++) {
    const a = r() * 6.3, d = r() * r() * 70, rad = 18 + r() * 44;
    const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(0.7, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.3); ctx.fill();
  }
  return canvasTex(c, true, false);
}

// Horizon ring seen through the windows: pale sky, a far treeline, bare trunks.
function backdropTex() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#dfe7f2'); g.addColorStop(0.55, '#f4f5f2'); g.addColorStop(0.8, '#e9e8df');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 2048, 512);
  const r = rng(99);
  const horizon = 512 * (1 - 10 / 60);
  for (let layer = 0; layer < 3; layer++) {
    const shade = 150 - layer * 45;
    ctx.fillStyle = `rgb(${shade},${shade + 4},${shade - 4})`;
    ctx.beginPath(); ctx.moveTo(0, 512);
    for (let x = 0; x <= 2048; x += 6) {
      const y = horizon - 40 + layer * 16 - fbm(x / 2048, 0.3 + layer * 0.2, 24, 2, 4, 200 + layer) * (70 - layer * 14);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(2048, 512); ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(48,44,40,0.8)'; ctx.lineCap = 'round';
  const branch = (x, y, a, len, w, depth) => {
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    if (depth <= 0) return;
    const n = 2 + (r() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) branch(x2, y2, a + (r() - 0.5) * 1.3, len * (0.62 + r() * 0.2), w * 0.62, depth - 1);
  };
  for (let i = 0; i < 46; i++) branch(r() * 2048, horizon + 10, -Math.PI / 2 + (r() - 0.5) * 0.25, 30 + r() * 40, 2.5 + r() * 2, 4);
  ctx.fillStyle = '#5d5a4c'; ctx.fillRect(0, horizon + 6, 2048, 512 - horizon);
  const t = canvasTex(c, true, false);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------- photo-scanned surfaces (CC0, Poly Haven) with procedural wear on top ----------

const PHOTO = { wall: 'dirty_concrete', floor: 'concrete_floor_worn_001', raw: 'concrete_wall_006', debris: 'concrete_debris', ceil: 'grey_plaster_02', wood: 'weathered_planks', metal: 'rusty_metal_02' };

export async function loadPhotos() {
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('missing ' + src)); i.src = src; });
  const out = {}, jobs = [];
  for (const [k, n] of Object.entries(PHOTO)) {
    jobs.push(load(`./assets/tex/${n}_Diffuse.jpg`).then((i) => { out[k] = i; }));
    jobs.push(load(`./assets/tex/${n}_nor_gl.jpg`).then((i) => { out[k + 'N'] = i; }));
  }
  await Promise.all(jobs);
  return out;
}

function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function imgTex(img, srgb, rx = 1, ry = 1) {
  const t = new THREE.Texture(img);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// fn(u, v, out) writes [r, g, b, a] in 0..1
function mask(w, h, fn) {
  const c = mk(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), o = [1, 1, 1, 1];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    fn(x / w, y / h, o);
    const i = (y * w + x) * 4;
    img.data[i] = to8(o[0]); img.data[i + 1] = to8(o[1]); img.data[i + 2] = to8(o[2]); img.data[i + 3] = to8(o[3]);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tile(ctx, img, nx, ny, W, H) {
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) ctx.drawImage(img, (i * W) / nx, (j * H) / ny, W / nx + 1, H / ny + 1);
}

function desat(ctx, W, H, amount) {
  ctx.save();
  ctx.globalCompositeOperation = 'saturation'; ctx.globalAlpha = amount; ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function lift(ctx, W, H, amount) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = amount; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function blend(ctx, layer, mode, W, H, alpha = 1) {
  ctx.save();
  ctx.globalCompositeOperation = mode; ctx.globalAlpha = alpha; ctx.drawImage(layer, 0, 0, W, H);
  ctx.restore();
}

// 8 m x 3.5 m of stained plaster: faded paint on the lower third, water streaks, grime at
// floor and ceiling, and patches where the plaster has come away from the concrete.
function wallPhoto(ph) {
  const W = 4096, H = 2048, c = mk(W, H), ctx = c.getContext('2d');
  tile(ctx, ph.wall, 2, 1, W, H);
  desat(ctx, W, H, 0.6);
  lift(ctx, W, H, 0.3);
  const loss = (u, v, hgt) => sstep(0.655, 0.685, fbm(u, v, 12, 5, 5, 31) + 0.05 * sstep(1.2, 0.0, hgt) + 0.04 * sstep(2.6, 3.2, hgt));
  const wear = mask(1024, 512, (u, v, o) => {
    const hgt = (1 - v) * 3.5;
    const n2 = fbm(u, v, 20, 9, 4, 2), fine = fbm(u, v, 128, 56, 2, 3);
    const flake = sstep(0.56, 0.64, fbm(u, v, 16, 7, 5, 7) + 0.1 * fine);
    const edge = 1.3 + (n2 - 0.5) * 0.05;
    let r = 0.94, g = 0.965, b = 1.0;
    if (hgt < edge) { const k = (1 - flake) * 0.8; r += (0.6 - r) * k; g += (0.71 - g) * k; b += (0.74 - b) * k; }
    if (hgt > edge && hgt < edge + 0.03) { r *= 0.62; g *= 0.66; b *= 0.68; }
    const streak = sstep(0.52, 0.8, fbm(u, v, 96, 2, 3, 11)) * (0.3 + 0.7 * sstep(0.2, 3.0, hgt));
    const low = sstep(0.6, 0.0, hgt) * (0.35 + n2);
    const top = sstep(2.5, 3.2, hgt) * n2;
    const L = loss(u, v, hgt), rim = L * (1 - L) * 4;
    const k = (1 - 0.2 * streak) * (1 - 0.36 * low) * (1 - 0.2 * top) * (1 - 0.25 * rim) * (0.92 + 0.16 * fbm(u, v, 6, 3, 3, 5));
    o[0] = r * k; o[1] = g * k * 0.995; o[2] = b * k * 0.98; o[3] = 1;
  });
  blend(ctx, wear, 'multiply', W, H);
  const ex = mk(W, H), ectx = ex.getContext('2d');
  tile(ectx, ph.raw, 4, 2, W, H);
  desat(ectx, W, H, 0.5);
  const lm = mask(1024, 512, (u, v, o) => { o[0] = o[1] = o[2] = 1; o[3] = loss(u, v, (1 - v) * 3.5); });
  blend(ectx, lm, 'destination-in', W, H);
  ctx.drawImage(ex, 0, 0);
  cracks(ctx, W, H, 26, 31, 'rgba(20,18,16,0.5)');
  return { map: canvasTex(c, true), normalMap: imgTex(ph.wallN, false, 2, 1), scale: [8, 3.5] };
}

// 8 m x 8 m of worn concrete with drifts of real rubble and dust.
function floorPhoto(ph) {
  const W = 2048, H = 2048, c = mk(W, H), ctx = c.getContext('2d');
  tile(ctx, ph.floor, 4, 4, W, H);
  desat(ctx, W, H, 0.45);
  lift(ctx, W, H, 0.12);
  const tone = mask(512, 512, (u, v, o) => {
    const n = fbm(u, v, 5, 5, 5, 21), d = fbm(u, v, 14, 14, 4, 22);
    const g = 0.5 + (n - 0.5) * 0.9 + (d - 0.5) * 0.35;
    o[0] = g * 1.02; o[1] = g; o[2] = g * 0.97; o[3] = 1;
  });
  blend(ctx, tone, 'soft-light', W, H);
  const dm = (u, v) => sstep(0.6, 0.7, fbm(u, v, 7, 7, 5, 61) + 0.08 * fbm(u, v, 40, 40, 2, 62));
  const deb = mk(W, H), dctx = deb.getContext('2d');
  tile(dctx, ph.debris, 4, 4, W, H);
  desat(dctx, W, H, 0.55);
  blend(dctx, mask(512, 512, (u, v, o) => { o[0] = o[1] = o[2] = 1; o[3] = dm(u, v) * 0.95; }), 'destination-in', W, H);
  ctx.drawImage(deb, 0, 0);
  const stain = mask(512, 512, (u, v, o) => { const s = sstep(0.6, 0.72, fbm(u, v, 6, 6, 4, 25)); const k = 1 - 0.38 * s; o[0] = k; o[1] = k; o[2] = k; o[3] = 1; });
  blend(ctx, stain, 'multiply', W, H);
  cracks(ctx, W, H, 22, 77, 'rgba(18,16,14,0.45)');
  return { map: canvasTex(c, true), normalMap: imgTex(ph.floorN, false, 4, 4), scale: [8, 8] };
}

function ceilPhoto(ph) {
  const W = 1024, H = 1024, c = mk(W, H), ctx = c.getContext('2d');
  tile(ctx, ph.ceil, 2, 2, W, H);
  desat(ctx, W, H, 0.8);
  lift(ctx, W, H, 0.45);
  const m = mask(512, 512, (u, v, o) => {
    const mold = sstep(0.62, 0.84, fbm(u, v, 6, 6, 5, 43)) * 0.3, damp = sstep(0.5, 0.75, fbm(u, v, 3, 3, 4, 45)) * 0.12;
    const k = (1 - damp);
    o[0] = k * (1 - mold * 0.7); o[1] = k * (1 - mold * 0.6); o[2] = k * (1 - mold * 0.75); o[3] = 1;
  });
  blend(ctx, m, 'multiply', W, H);
  return { map: canvasTex(c, true), normalMap: imgTex(ph.ceilN, false, 2, 2), scale: [4, 4] };
}

export function makeTextures(ph) {
  const T = ph ? {
    wall: wallPhoto(ph), floor: floorPhoto(ph), ceil: ceilPhoto(ph),
    concrete: { map: imgTex(ph.raw, true), normalMap: imgTex(ph.rawN, false), scale: [2.4, 2.4] },
    wood: { map: imgTex(ph.wood, true), normalMap: imgTex(ph.woodN, false), scale: [1.6, 1.6] },
    metal: { map: imgTex(ph.metal, true), normalMap: imgTex(ph.metalN, false), scale: [1.5, 1.5] },
  } : {
    wall: { ...wallTex(), scale: [4, 3.5] }, floor: { ...floorTex(), scale: [4, 4] }, ceil: { ...ceilTex(), scale: [4, 4] },
    concrete: { ...concreteTex(), scale: [3, 3] }, wood: { ...woodTex(), scale: [1.5, 1.5] }, metal: { ...metalTex(), scale: [2, 2] },
  };
  T.photo = !!ph;
  T.graffiti = [
    graffitiPiece('HUSH', PALETTES[0], 101),
    graffitiPiece('MOTH', PALETTES[2], 102),
    graffitiPiece('FERAL', PALETTES[1], 103),
    graffitiPiece('RUST', PALETTES[3], 104),
    graffitiPiece('ECHO', PALETTES[4], 105),
  ];
  T.tags = [tagSheet(201), tagSheet(202), tagSheet(203)];
  T.mural = mural(301);
  T.stains = [stainTex(401, false), stainTex(402, false), stainTex(403, true), stainTex(404, true)];
  T.hole = holeTex();
  T.pool = poolTex();
  T.backdrop = backdropTex();
  return T;
}
