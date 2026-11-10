import * as THREE from 'three';

// ---- layout constants ------------------------------------------------------
export const N = 7;            // blocks per side
export const P = 92;           // pitch between road centre lines
export const HALF = 6.5;       // half roadway width (2 lanes each way)
export const SIDEWALK = 4.5;
export const CURB = 0.16;
export const O = -(N * P) / 2; // world coordinate of road 0
export const road = (k) => O + k * P;
export const CITY_MIN = O - HALF, CITY_MAX = O + N * P + HALF;
export const RIM = 9;          // promenade width outside the outer roads

// the bridge leaves the north shore and lands on a headland across the strait
export const BRIDGE = { x: road(1), z0: CITY_MIN - RIM, z1: CITY_MIN - RIM - 560, w: 7.5 };
export const HEAD = { x: road(1), z: CITY_MIN - RIM - 560 - 74, r: 104, h: 22 };
export const PIERS = [0, 1, 2].map((k) => { const z = road(1) + 36 + k * 150; return { x0: CITY_MAX + RIM - 0.5, x1: CITY_MAX + RIM + 96, z0: z, z1: z + 30 }; });
const HILLS = [{ x: -20, z: -60, r: 185, h: 30 }, { x: -205, z: 95, r: 150, h: 19 }, { x: 165, z: 140, r: 125, h: 10 }];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// height of the land under the city: a few rounded hills that flatten out toward the shoreline
export function terrain(x, z) {
  const edge = Math.min(x - CITY_MIN, CITY_MAX - x, z - CITY_MIN, CITY_MAX - z);
  if (edge <= 0) return 0;
  let h = 0;
  for (const q of HILLS) h += q.h * Math.exp(-(((x - q.x) ** 2 + (z - q.z) ** 2) / (q.r * q.r)) * 2.2);
  return h * sstep(0, 105, edge);
}
export function deckY(z) { const s = clamp((BRIDGE.z0 - z) / (BRIDGE.z0 - BRIDGE.z1), 0, 1); return CURB + (8 - CURB) * s + 7 * Math.sin(Math.PI * s); }
export function headY(x, z) { return HEAD.h * Math.exp(-((x - HEAD.x) ** 2 + (z - HEAD.z) ** 2) / (74 * 74)); }

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Batch {
  constructor(spec) { this.spec = spec; this.a = {}; for (const k in spec) this.a[k] = []; this.idx = []; this.n = 0; }
  vert(v) { for (const k in this.spec) { const d = v[k]; for (let i = 0; i < d.length; i++) this.a[k].push(d[i]); } return this.n++; }
  quad(v0, v1, v2, v3) { const a = this.vert(v0), b = this.vert(v1), c = this.vert(v2), d = this.vert(v3); this.idx.push(a, b, c, a, c, d); }
  tri(v0, v1, v2) { this.idx.push(this.vert(v0), this.vert(v1), this.vert(v2)); }
  build() {
    const g = new THREE.BufferGeometry();
    for (const k in this.spec) g.setAttribute(k, new THREE.Float32BufferAttribute(this.a[k], this.spec[k]));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : this.idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

export const GLSL_NOISE = /* glsl */`
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  float fbm2(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn2(p); p = p * 2.07 + 13.1; a *= 0.5; } return s / 0.9375; }
`;

// ---- facade material -------------------------------------------------------
const STYLES = {
  glass:   { tex: 'concrete_tile_facade', cellW: 1.7, floorH: 3.8, h0: 5.6, win: [0.035, 0.965, 0.0, 0.74], shop: [0.04, 0.96, 0.06, 0.86], glass: [0.95, 0.045, 0.30, 0], tintGlass: 1, wallCol: [0.16, 0.17, 0.18] },
  office:  { tex: 'concrete_tile_facade', cellW: 3.0, floorH: 3.6, h0: 5.0, win: [0.07, 0.93, 0.30, 0.86], shop: [0.06, 0.94, 0.06, 0.82], glass: [0.55, 0.06, 0.65, 1], tintGlass: 0, wallCol: [1, 1, 1] },
  deco:    { tex: 'white_stucco', cellW: 3.4, floorH: 3.3, h0: 4.3, win: [0.25, 0.75, 0.24, 0.80], shop: [0.08, 0.92, 0.05, 0.74], glass: [0.22, 0.06, 1.0, 1], tintGlass: 0, wallCol: [1, 1, 1] },
  brick:   { tex: 'brick_wall_001', cellW: 3.0, floorH: 3.2, h0: 4.2, win: [0.28, 0.72, 0.22, 0.80], shop: [0.08, 0.92, 0.05, 0.74], glass: [0.22, 0.06, 1.0, 1], tintGlass: 0, wallCol: [1, 1, 1] },
  plaster: { tex: 'painted_plaster_wall', cellW: 3.6, floorH: 3.4, h0: 4.4, win: [0.23, 0.77, 0.25, 0.79], shop: [0.07, 0.93, 0.05, 0.76], glass: [0.22, 0.06, 1.0, 1], tintGlass: 0, wallCol: [1, 1, 1] },
  // narrow painted row houses: tall sash windows, a door-height opening at street level
  vic:     { tex: 'white_stucco', cellW: 2.35, floorH: 3.3, h0: 3.6, win: [0.24, 0.76, 0.16, 0.84], shop: [0.30, 0.70, 0.0, 0.70], glass: [0.22, 0.06, 1.0, 1], tintGlass: 0, wallCol: [1, 1, 1] },
};
const TEX_SCALE = 3.2;

export const cityUniforms = { uNight: { value: 0.35 }, uTime: { value: 0 }, uWet: { value: 1 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) } };

function makeFacadeMaterial(A, name) {
  const S = STYLES[name], T = A.tex[S.tex];
  const m = new THREE.MeshStandardMaterial({
    map: T.map, normalMap: T.normalMap, roughnessMap: T.arm, metalnessMap: T.arm, aoMap: T.arm,
    metalness: 1, roughness: 1, vertexColors: true, envMapIntensity: 1.0,
  });
  m.normalScale.set(0.9, 0.9);
  const U = {
    uWin: { value: new THREE.Vector4(...S.win) }, uShop: { value: new THREE.Vector4(...S.shop) },
    uGlass: { value: new THREE.Vector4(...S.glass) }, uTintGlass: { value: S.tintGlass },
    uWallCol: { value: new THREE.Vector3(...S.wallCol) },
    uNight: cityUniforms.uNight, uSunDir: cityUniforms.uSunDir,
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aCellUv; attribute vec3 aInfo;
        varying vec2 vCellUv; varying vec3 vInfo; varying vec3 vWPos; varying vec3 vWNor;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCellUv = aCellUv; vInfo = aInfo;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz; vWNor = normalize(mat3(modelMatrix) * normal);`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec4 uWin, uShop, uGlass; uniform float uTintGlass, uNight; uniform vec3 uWallCol, uSunDir;
        varying vec2 vCellUv; varying vec3 vInfo; varying vec3 vWPos; varying vec3 vWNor;
        ${GLSL_NOISE}
        float fWin = 0.0; vec3 fEmis = vec3(0.0); vec3 fTilt = vec3(0.0); float fFrame = 0.0;`)
      .replace('#include <color_fragment>', /* glsl */`
        {
          vec3 tint = vColor.rgb;
          vec3 wallCol = diffuseColor.rgb * mix(tint, uWallCol, uTintGlass);
          vec2 cid = floor(vCellUv), f = fract(vCellUv);
          bool ground = vCellUv.y < 1.0;
          vec4 wr = ground ? uShop : uWin;
          float seed = vInfo.z;
          vec2 cellM = vInfo.xy;
          vec2 fw = fwidth(vCellUv) + 1e-5;
          float lod = smoothstep(0.07, 0.38, max(fw.x, fw.y));

          // opening mask at the wall plane, box-filtered so distant facades resolve to their average instead of shimmering
          float mx = clamp((min(f.x + 0.5 * fw.x, wr.y) - max(f.x - 0.5 * fw.x, wr.x)) / fw.x, 0.0, 1.0);
          float my = clamp((min(f.y + 0.5 * fw.y, wr.w) - max(f.y - 0.5 * fw.y, wr.z)) / fw.y, 0.0, 1.0);
          mx = mix(mx, wr.y - wr.x, smoothstep(0.45, 1.0, fw.x));
          my = mix(my, wr.w - wr.z, smoothstep(0.45, 1.0, fw.y));
          float win = mx * my;

          // wall weathering: streaks, a dirt band at street level, shadow line under each sill
          vec2 wm = vCellUv * cellM;
          float streak = fbm2(vec2(wm.x * 2.3 + seed * 9.0, wm.y * 0.11));
          wallCol *= 0.80 + 0.30 * streak;
          wallCol *= 0.86 + 0.14 * fbm2(wm * 0.35 + seed);
          if (ground) wallCol *= mix(0.62, 1.0, smoothstep(0.0, 0.35, f.y));
          float sill = smoothstep(wr.z, wr.z - 0.12, f.y) * mx * (ground ? 0.0 : 1.0);
          wallCol *= 1.0 - 0.30 * sill * (1.0 - lod);
          diffuseColor.rgb = wallCol;

          if (win > 0.002) {
            vec3 Nw = normalize(vWNor);
            vec3 Tw = normalize(cross(vec3(0.0, 1.0, 0.0), Nw));
            vec3 r = normalize(vWPos - cameraPosition);
            vec3 d = vec3(dot(r, Tw), r.y, max(-dot(r, Nw), 0.06));
            // the glazing sits back from the wall face: shift the lookup along the view ray and shade the reveal it exposes
            float RECESS = (uTintGlass > 0.5 ? 0.05 : (ground ? 0.12 : 0.20)) * (1.0 - lod);
            vec2 rmin = wr.xz * cellM, rmax = wr.yw * cellM;
            vec2 q = f * cellM + d.xy / d.z * RECESS;
            float reveal = 0.0, revShade = 1.0;
            if (q.x < rmin.x || q.x > rmax.x) { reveal = 1.0; revShade = 0.70; }
            if (q.y > rmax.y) { reveal = 1.0; revShade = 0.40; } else if (q.y < rmin.y) { reveal = 1.0; revShade = 1.06; }
            // lintel / jamb shadow from the sun on the recessed plane
            vec3 sdir = vec3(dot(uSunDir, Tw), uSunDir.y, dot(uSunDir, Nw));
            float sunShade = 1.0;
            if (sdir.z > 0.05) {
              vec2 qs = q + sdir.xy / sdir.z * RECESS;
              sunShade = (qs.x > rmin.x && qs.x < rmax.x && qs.y < rmax.y) ? 1.0 : 0.5;
            }
            vec2 qf = q / cellM;

            vec2 dm = min(qf - wr.xz, wr.yw - qf) * cellM;
            float frame = 1.0 - smoothstep(0.05, 0.075, min(dm.x, dm.y));
            if (uGlass.w > 0.5) {
              frame = max(frame, 1.0 - smoothstep(0.02, 0.04, abs(qf.x - 0.5 * (wr.x + wr.y)) * cellM.x));
              if (!ground) frame = max(frame, 1.0 - smoothstep(0.02, 0.04, abs(qf.y - mix(wr.z, wr.w, 0.62)) * cellM.y));
            }
            // interior mapping: intersect the view ray with a box room behind the glass
            vec2 rid = vec2(floor(cid.x * (uTintGlass > 0.5 ? 0.34 : 1.0)), cid.y);          // curtain walls: one room spans three panes
            float roomW = cellM.x * (uTintGlass > 0.5 ? 2.94 : 1.0);
            vec3 room = vec3(roomW, cellM.y, ground ? 8.0 : 5.5);
            float px = uTintGlass > 0.5 ? fract((cid.x + qf.x) * 0.34) * roomW : qf.x * roomW;
            vec3 p = vec3(px, qf.y * room.y, 0.0);
            vec3 tt = (step(0.0, d) * room - p) / d;
            float t = min(tt.x, min(tt.y, tt.z));
            vec3 hp = p + d * t;
            float rnd = h21(rid + seed * 17.3);
            vec3 base = mix(vec3(0.62, 0.56, 0.48), vec3(0.42, 0.50, 0.56), rnd);
            base = mix(base, vec3(0.70, 0.42, 0.34), step(0.82, h21(rid + seed + 4.0)));
            float shade;
            if (t == tt.z) {
              shade = 0.78;
              float fh = (0.22 + 0.25 * h21(rid + 3.1)) * room.y;
              float furn = step(hp.y, fh) * step(0.2, fract(hp.x * (0.6 + rnd) + rnd));
              shade *= mix(1.0, 0.38, furn);
              vec2 pic = abs(vec2(fract(hp.x / room.x * 2.0) - 0.5, hp.y / room.y - 0.62));
              shade *= mix(1.0, 0.55 + 0.6 * h21(rid + 8.0), step(pic.x, 0.16) * step(pic.y, 0.11) * step(0.5, rnd));
            } else if (t == tt.y) {
              shade = d.y > 0.0 ? 1.0 : 0.42;
              if (d.y > 0.0) shade += 1.4 * smoothstep(0.5, 0.0, length(vec2(hp.x / room.x - 0.5, hp.z / room.z - 0.45)) * 2.2);
            } else shade = 0.6;
            float depthFade = exp(-hp.z * 0.22);
            float lit = step(1.0 - uNight * 0.85 - (ground ? 0.5 : 0.0), h21(rid * 1.37 + seed));
            vec3 warm = mix(vec3(1.0, 0.74, 0.44), vec3(0.72, 0.84, 1.0), step(0.78, h21(rid + seed + 9.0)));
            vec3 interior = base * shade * (lit * warm * 0.9 + (1.0 - lit) * vec3(0.26, 0.29, 0.33) * depthFade * (1.0 - uNight * 0.6));
            // blinds / curtains
            float bl = h21(rid + seed * 3.0 + 5.0);
            float blindY = wr.w - (wr.w - wr.z) * bl * 0.9;
            float blind = step(blindY, qf.y) * step(0.42, h21(rid + 2.0 + seed)) * (ground ? 0.0 : 1.0);
            float slat = 0.82 + 0.18 * step(0.5, fract(qf.y * cellM.y * 16.0));
            vec3 blindCol = mix(vec3(0.78, 0.75, 0.68), vec3(0.50, 0.54, 0.58), h21(rid + 7.0)) * slat;
            interior = mix(interior, blindCol * (0.26 * sunShade * (1.0 - uNight * 0.6) + lit * warm * 0.55), blind);

            frame = mix(frame, 0.12, lod);
            interior = mix(interior, vec3(0.075, 0.08, 0.09) + vec3(1.0, 0.74, 0.44) * 0.25 * uNight, lod);
            vec3 glassCol = mix(vec3(0.05, 0.07, 0.08), tint, uTintGlass);
            vec3 frameCol = mix(vec3(0.05, 0.055, 0.06), vec3(0.52, 0.51, 0.48), step(0.6, h21(vec2(seed, 3.0))) * (1.0 - uTintGlass)) * sunShade;
            vec3 opening = mix(mix(glassCol, frameCol, frame), wallCol * revShade, reveal);
            diffuseColor.rgb = mix(diffuseColor.rgb, opening, win);
            float g = win * (1.0 - reveal);
            fFrame = frame * g;
            fWin = g * (1.0 - frame);
            fEmis = interior * fWin * uGlass.z;
            fTilt = (vec3(h21(rid + seed + 1.0), h21(rid + seed + 2.0), h21(rid + seed + 3.0)) - 0.5) * 0.022 * (1.0 - lod);
          }
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, uGlass.y, fWin); roughnessFactor = mix(roughnessFactor, 0.55, fFrame);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, uGlass.x, fWin); metalnessFactor = mix(metalnessFactor, 0.15, fFrame);`)
      .replace('#include <normal_fragment_maps>', `vec3 geoN = normal;
        #include <normal_fragment_maps>
        normal = normalize(mix(normal, geoN + (viewMatrix * vec4(fTilt, 0.0)).xyz, max(fWin, fFrame)));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += fEmis;`);
  };
  m.customProgramCacheKey = () => 'facade';
  return m;
}

// walls of one building. b.gy is the ground level it stands on; b.base lifts a set-back tower onto its podium
function addWalls(batch, b, S, skip = -1) {
  const faces = [[b.x0, b.z1, 1, 0, 0, 1], [b.x1, b.z0, -1, 0, 0, -1], [b.x1, b.z1, 0, -1, 1, 0], [b.x0, b.z0, 0, 1, -1, 0]];
  const base = b.base || 0, gy = b.gy;
  for (let fi = 0; fi < 4; fi++) {
    if (fi === skip) continue;
    const [sx, sz, tx, tz, nx, nz] = faces[fi];
    const L = tx !== 0 ? b.x1 - b.x0 : b.z1 - b.z0;
    const cx = Math.max(1, Math.round(L / S.cellW)), cw = L / cx;
    const segs = [];
    if (base === 0) segs.push([0, S.h0, 0, 1, S.h0]);
    const y0 = base === 0 ? S.h0 : base;
    const ny = Math.max(1, Math.round((b.h - y0) / S.floorH)), ch = (b.h - y0) / ny;
    segs.push([y0, b.h, 1, 1 + ny, ch]);
    const uoff = b.seed * 7.31;
    for (const [ya, yb, va, vb, cellH] of segs) {
      const mk = (s, y, cu, cv) => ({
        position: [sx + tx * s, gy + y, sz + tz * s], normal: [nx, 0, nz],
        uv: [(s + uoff) / TEX_SCALE, y / TEX_SCALE], aCellUv: [cu, cv], aInfo: [cw, cellH, b.seed], color: b.tint,
      });
      batch.quad(mk(0, ya, 0, va), mk(L, ya, cx, va), mk(L, yb, cx, vb), mk(0, yb, 0, vb));
    }
  }
}

// walls textured with a facade photo. faces: which of the four sides; reps(L) -> how many times the photo repeats along a wall
function photoWalls(batch, b, faceIdx, reps) {
  const faces = [[b.x0, b.z1, 1, 0, 0, 1], [b.x1, b.z0, -1, 0, 0, -1], [b.x1, b.z1, 0, -1, 1, 0], [b.x0, b.z0, 0, 1, -1, 0]];
  for (const fi of faceIdx) {
    const [sx, sz, tx, tz, nx, nz] = faces[fi];
    const L = tx !== 0 ? b.x1 - b.x0 : b.z1 - b.z0, n = reps(L);
    const mk = (s, y, u, v) => ({ position: [sx + tx * s, b.gy + y, sz + tz * s], normal: [nx, 0, nz], uv: [u, v] });
    batch.quad(mk(0, 0, 0, 0), mk(L, 0, n, 0), mk(L, b.h, n, 1), mk(0, b.h, 0, 1));
  }
}

// ---- lot generation --------------------------------------------------------
const PASTEL = [[0.86, 0.50, 0.56], [0.42, 0.74, 0.68], [0.88, 0.76, 0.42], [0.88, 0.60, 0.42], [0.48, 0.66, 0.84], [0.80, 0.79, 0.75], [0.68, 0.56, 0.80], [0.82, 0.78, 0.68]];
const LADIES = [[0.80, 0.42, 0.40], [0.36, 0.60, 0.72], [0.84, 0.74, 0.40], [0.50, 0.72, 0.52], [0.72, 0.52, 0.76], [0.82, 0.80, 0.74], [0.42, 0.50, 0.72], [0.86, 0.58, 0.36], [0.62, 0.74, 0.76]];
const GLASS_TINT = [[0.05, 0.22, 0.27], [0.10, 0.16, 0.26], [0.30, 0.20, 0.11], [0.09, 0.11, 0.13], [0.06, 0.20, 0.17], [0.16, 0.22, 0.30]];
const BRICK_TINT = [[1, 1, 1], [0.86, 0.72, 0.66], [1.1, 0.95, 0.85], [0.7, 0.66, 0.66]];
const OFFICE_TINT = [[0.92, 0.90, 0.86], [0.74, 0.76, 0.80], [0.98, 0.94, 0.84], [0.60, 0.62, 0.66]];

export const DISTRICTS = [
  { name: 'Financial District', cx: 165, cz: -175 },
  { name: 'Marina', cx: 0, cz: 330 },
  { name: 'Nob Hill', cx: -20, cz: -60 },
  { name: 'The Mission', cx: -215, cz: 110 },
  { name: 'Embarcadero', cx: 285, cz: 60 },
  { name: 'North Beach', cx: -215, cz: -255 },
];
export function districtAt(x, z) {
  if (z < CITY_MIN - RIM - 4) return z < BRIDGE.z1 ? { name: 'Marin Headlands' } : { name: 'Golden Gate' };
  if (z > road(N - 2) + P * 0.5) return DISTRICTS[1];
  let best = DISTRICTS[0], bd = 1e9;
  for (const d of DISTRICTS) { if (d === DISTRICTS[1]) continue; const q = Math.hypot(x - d.cx, z - d.cz); if (q < bd) { bd = q; best = d; } }
  return best;
}

function planBlocks(rand) {
  const blocks = [];
  const pick = (a) => a[Math.floor(rand() * a.length)];
  let tallest = null;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x0 = road(i) + HALF, x1 = road(i + 1) - HALF, z0 = road(j) + HALF, z1 = road(j + 1) - HALF;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const core = Math.max(0, 1 - Math.hypot(cx - DISTRICTS[0].cx, cz - DISTRICTS[0].cz) / 235);
    const beach = j >= N - 2 ? (j === N - 1 ? 1 : 0.5) : 0;
    const blk = { i, j, x0, x1, z0, z1, buildings: [], kind: 'built' };
    blocks.push(blk);
    const r = rand();
    // the summit of the big hill is a park with a lookout tower
    if (HILLS[0].x > x0 && HILLS[0].x < x1 && HILLS[0].z > z0 && HILLS[0].z < z1) { blk.kind = 'park'; blk.summit = true; continue; }
    if (beach < 1 && core < 0.5 && r < 0.08) { blk.kind = 'park'; continue; }
    if (core < 0.35 && r > 0.94) { blk.kind = 'lot'; continue; }
    const ix0 = x0 + SIDEWALK, ix1 = x1 - SIDEWALK, iz0 = z0 + SIDEWALK, iz1 = z1 - SIDEWALK;

    // painted row houses in the south-west
    if (i <= 2 && j >= 2 && j <= 4 && core < 0.3) {
      blk.kind = 'vic';
      const S = STYLES.vic, wHouse = 7.0, gap = 0.22, n = Math.floor((ix1 - ix0 + gap) / (wHouse + gap));
      const h = S.h0 + S.floorH * 2;
      for (const front of [-1, 1]) for (let a = 0; a < n; a++) {
        const bx0 = ix0 + a * (wHouse + gap), bz0 = front < 0 ? iz0 : iz1 - 15;
        blk.buildings.push({ x0: bx0, x1: bx0 + wHouse, z0: bz0, z1: bz0 + 15, h: h + (rand() < 0.3 ? S.floorH : 0), style: 'vic', tint: pick(LADIES), seed: rand() * 100, base: 0, blk, vic: front });
      }
      continue;
    }

    let nx, nz;
    if (core > 0.62) { nx = rand() < 0.5 ? 1 : 2; nz = rand() < 0.5 ? 1 : 2; }
    else if (beach === 1) { nx = 3; nz = 2; }
    else { nx = 2 + Math.floor(rand() * 2); nz = 2; }
    const gap = core > 0.62 ? 5 : 2.2;
    const w = (ix1 - ix0 - gap * (nx - 1)) / nx, d = (iz1 - iz0 - gap * (nz - 1)) / nz;
    for (let a = 0; a < nx; a++) for (let c = 0; c < nz; c++) {
      const bx0 = ix0 + a * (w + gap), bz0 = iz0 + c * (d + gap);
      let style, h, tint;
      const q = rand();
      if (core > 0.62) { style = q < 0.72 ? 'glass' : 'office'; h = 55 + core * 95 * (0.55 + rand() * 0.6); }
      else if (core > 0.3) { style = q < 0.35 ? 'glass' : q < 0.7 ? 'office' : 'brick'; h = 22 + core * 60 + rand() * 22; }
      else if (beach === 1) { style = q < 0.8 ? 'deco' : 'plaster'; h = 10 + rand() * 14; }
      else if (beach > 0) { style = q < 0.5 ? 'deco' : q < 0.8 ? 'plaster' : 'glass'; h = 14 + rand() * 26; }
      else { style = q < 0.4 ? 'brick' : q < 0.75 ? 'plaster' : 'office'; h = 11 + rand() * 20; }
      tint = style === 'glass' ? pick(GLASS_TINT) : style === 'deco' || style === 'plaster' ? pick(PASTEL) : style === 'brick' ? pick(BRICK_TINT) : pick(OFFICE_TINT);
      const S = STYLES[style];
      h = S.h0 + Math.max(2, Math.round((h - S.h0) / S.floorH)) * S.floorH;
      const inset = rand() * 1.2;
      const b = { x0: bx0 + inset, x1: bx0 + w - inset, z0: bz0 + inset, z1: bz0 + d - inset, h, style, tint, seed: rand() * 100, base: 0, blk };
      if ((style === 'glass' || style === 'office') && h > 48 && rand() < 0.75) {
        // podium + set-back tower
        const ph = S.h0 + S.floorH * (1 + Math.floor(rand() * 3));
        const si = 3 + rand() * 4;
        blk.buildings.push({ ...b, h: ph, style: 'office', tint: pick(OFFICE_TINT), seed: rand() * 100 });
        blk.buildings.push({ ...b, x0: b.x0 + si, x1: b.x1 - si, z0: b.z0 + si, z1: b.z1 - si, base: ph, collide: false });
      } else {
        blk.buildings.push(b);
        if (core > 0.62 && (!tallest || b.h > tallest.h)) tallest = b;
      }
    }
  }
  // the tallest plain tower downtown becomes the pyramid
  if (tallest) { tallest.special = 'pyramid'; tallest.h = 150; }
  return blocks;
}

// ---- ground ----------------------------------------------------------------
function worldUvBox(x0, x1, z0, z1, y0, y1, scale) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, p.getX(i) / scale, p.getZ(i) / scale);
    else if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, p.getZ(i) / scale, p.getY(i) / scale);
    else uv.setXY(i, p.getX(i) / scale, p.getY(i) / scale);
  }
  return g;
}
export function mergeGeos(list) {
  // minimal merge for geometries sharing position/normal/uv (missing normals/uvs/indices are filled in)
  for (const g of list) {
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  let vc = 0, ic = 0;
  for (const g of list) { vc += g.attributes.position.count; ic += g.index.count; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array; for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
    vo += g.attributes.position.count; io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// a flat patch laid over the hills: subdivided, world-space UVs, lifted by `lift`; optional skirt hides the edge
export function drape(x0, x1, z0, z1, lift, uvScale, cell = 6, skirt = 0) {
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), nz = Math.max(1, Math.ceil((z1 - z0) / cell));
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz).rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { p.setY(i, terrain(p.getX(i), p.getZ(i)) + lift); uv.setXY(i, p.getX(i) / uvScale, p.getZ(i) / uvScale); }
  g.computeVertexNormals();
  if (!skirt) return g;
  const b = new Batch({ position: 3, normal: 3, uv: 2 });
  const wall = (ax, az, bx, bz, nx2, nz2) => {
    const ya = terrain(ax, az) + lift, yb = terrain(bx, bz) + lift;
    const v = (x, y, z) => ({ position: [x, y, z], normal: [nx2, 0, nz2], uv: [(x + z) / uvScale, y / uvScale] });
    b.quad(v(ax, ya - skirt, az), v(bx, yb - skirt, bz), v(bx, yb, bz), v(ax, ya, az));
  };
  for (let k = 0; k < nx; k++) {
    const xa = x0 + ((x1 - x0) * k) / nx, xb = x0 + ((x1 - x0) * (k + 1)) / nx;
    wall(xa, z1, xb, z1, 0, 1); wall(xb, z0, xa, z0, 0, -1);
  }
  for (let k = 0; k < nz; k++) {
    const za = z0 + ((z1 - z0) * k) / nz, zb = z0 + ((z1 - z0) * (k + 1)) / nz;
    wall(x1, zb, x1, za, 1, 0); wall(x0, za, x0, zb, -1, 0);
  }
  return mergeGeos([g, b.build()]);
}

function groundMaterial(T, opts) {
  const m = new THREE.MeshStandardMaterial({ map: T.map, normalMap: T.normalMap, roughnessMap: T.arm, aoMap: T.arm, metalness: 0, roughness: 1, color: opts.color || 0xffffff });
  m.onBeforeCompile = (s) => {
    s.uniforms.uWet = cityUniforms.uWet;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying float vUp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz; vUp = normal.y;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos; varying float vUp; uniform float uWet; float gPud = 0.0;\n${GLSL_NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float big = fbm2(vWPos.xz * 0.045);
          diffuseColor.rgb *= ${opts.vary.toFixed(2)} + ${(2 * (1 - opts.vary)).toFixed(2)} * big;
          float crack = fbm2(vWPos.xz * 0.6 + 7.0);
          diffuseColor.rgb *= 0.9 + 0.2 * crack;
          // water only pools where the ground is level
          gPud = smoothstep(${opts.pud[0].toFixed(2)}, ${opts.pud[1].toFixed(2)}, fbm2(vWPos.xz * 0.085 + 31.0)) * uWet * smoothstep(0.9975, 0.9995, vUp);
          diffuseColor.rgb *= mix(1.0, 0.42, gPud);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor * ${opts.rough.toFixed(2)}, 0.02, gPud);`)
      .replace('#include <normal_fragment_maps>', `vec3 geoN = normal;
        #include <normal_fragment_maps>
        normal = normalize(mix(normal, geoN, gPud));`);
  };
  m.customProgramCacheKey = () => 'ground' + JSON.stringify(opts);
  return m;
}

export function paintTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(40,40,40,${Math.random() * 0.5})`; const s = 1 + Math.random() * 5; x.fillRect(Math.random() * 256, Math.random() * 256, s, s * (0.3 + Math.random())); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function buildMarkings() {
  const white = new Batch({ position: 3, normal: 3, uv: 2 }), yellow = new Batch({ position: 3, normal: 3, uv: 2 });
  const LIFT = 0.035;
  // axis: 0 = road runs along X (at z = c), 1 = runs along Z. Long strips are cut into short pieces so they follow the hills.
  const rect = (b, axis, c, a0, a1, o0, o1) => {
    const n = Math.max(1, Math.ceil((a1 - a0) / 2.2));
    for (let k = 0; k < n; k++) {
      const s0 = a0 + ((a1 - a0) * k) / n, s1 = a0 + ((a1 - a0) * (k + 1)) / n;
      const P4 = axis === 0 ? [[s0, c + o0], [s1, c + o0], [s1, c + o1], [s0, c + o1]] : [[c + o0, s0], [c + o1, s0], [c + o1, s1], [c + o0, s1]];
      const v = P4.map(([px, pz]) => ({ position: [px, terrain(px, pz) + LIFT, pz], normal: [0, 1, 0], uv: [px * 0.5, pz * 0.5] }));
      if (axis === 0) b.quad(v[3], v[2], v[1], v[0]); else b.quad(v[0], v[3], v[2], v[1]);
    }
  };
  for (let axis = 0; axis < 2; axis++) for (let k = 0; k <= N; k++) for (let s = 0; s < N; s++) {
    const c = road(k), a0 = road(s) + 12.2, a1 = road(s + 1) - 12.2;
    rect(yellow, axis, c, a0, a1, -0.24, -0.10); rect(yellow, axis, c, a0, a1, 0.10, 0.24);
    for (let a = a0 + 1; a < a1 - 3; a += 9) { rect(white, axis, c, a, a + 3, -3.31, -3.19); rect(white, axis, c, a, a + 3, 3.19, 3.31); }
    // stop lines (right-hand traffic) + zebra crossings at both ends
    for (const end of [0, 1]) {
      const ia = end === 0 ? road(s) : road(s + 1), dir = end === 0 ? 1 : -1;
      const s0 = ia + dir * 10.9, s1 = ia + dir * 11.4;
      const sideSign = axis === 0 ? (end === 0 ? -1 : 1) : (end === 0 ? 1 : -1);
      rect(white, axis, c, Math.min(s0, s1), Math.max(s0, s1), sideSign > 0 ? 0.3 : -6.3, sideSign > 0 ? 6.3 : -0.3);
      const z0 = ia + dir * 7.2, z1 = ia + dir * 10.2;
      for (let o = -6.0; o < 6.0; o += 1.2) rect(white, axis, c, Math.min(z0, z1), Math.max(z0, z1), o, o + 0.6);
    }
  }
  return { white: white.build(), yellow: yellow.build() };
}

// ---- city ------------------------------------------------------------------
export function buildCity(A, scene) {
  const rand = mulberry(20261110);
  const blocks = planBlocks(rand);
  const group = new THREE.Group();
  scene.add(group);

  // roads: one asphalt sheet draped over the hills
  const ext = CITY_MAX + RIM + 2;
  const asphalt = new THREE.Mesh(drape(-ext, ext, -ext, ext, 0, 4.5, 3),
    groundMaterial(A.tex.asphalt_02, { vary: 0.72, pud: [0.60, 0.74], rough: 0.78, color: 0x9a9a9a }));
  asphalt.receiveShadow = true;
  group.add(asphalt);

  // sidewalks: block slabs follow the slope; the outer promenade is flat and its sides double as the sea wall
  const slabs = blocks.map((b) => drape(b.x0, b.x1, b.z0, b.z1, CURB, 3.0, 6.6, 0.6));
  const r0 = CITY_MIN, r1 = CITY_MAX, e = RIM;
  slabs.push(worldUvBox(r0 - e, r1 + e, r0 - e, r0, -4, CURB, 3.0), worldUvBox(r0 - e, r1 + e, r1, r1 + e, -4, CURB, 3.0),
    worldUvBox(r0 - e, r0, r0, r1, -4, CURB, 3.0), worldUvBox(r1, r1 + e, r0, r1, -4, CURB, 3.0));
  const sidewalk = new THREE.Mesh(mergeGeos(slabs), groundMaterial(A.tex.concrete_pavement, { vary: 0.80, pud: [0.70, 0.80], rough: 0.9, color: 0xc9c5bd }));
  sidewalk.receiveShadow = true; sidewalk.castShadow = true;
  group.add(sidewalk);

  // road paint
  const mk = buildMarkings();
  const paintTex = paintTexture();
  const paintMat = (color) => new THREE.MeshStandardMaterial({ color, map: paintTex, roughness: 0.62, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, transparent: true, opacity: 0.82 });
  const paints = { white: paintMat(0xe9e9e4), yellow: paintMat(0xe0b62a) };
  for (const k of ['white', 'yellow']) { const m = new THREE.Mesh(mk[k], paints[k]); m.receiveShadow = true; group.add(m); }

  // buildings
  const spec = { position: 3, normal: 3, uv: 2, aCellUv: 2, aInfo: 3, color: 3 };
  const batches = {}; for (const k in STYLES) batches[k] = new Batch(spec);
  const roof = new Batch({ position: 3, normal: 3, uv: 2 });
  const gable = new Batch({ position: 3, normal: 3, uv: 2 });
  const gableEnds = new Batch({ position: 3, normal: 3, color: 3 });
  const trims = [];        // [x, y, z, sx, sy, sz, r, g, b]
  const panes = [];        // dark glass boxes
  const neon = [];
  const buildings = [];
  let lastGy = 0;
  const GV = (A.gen && A.gen.vic) || [], GF = (A.gen && A.gen.fac) || [], GA = (A.gen && A.gen.ad) || [];
  const photo = new Map();          // texture -> Batch
  const photoBatch = (t) => { if (!photo.has(t)) photo.set(t, new Batch({ position: 3, normal: 3, uv: 2 })); return photo.get(t); };
  const BAY = 13.6;                 // metres covered by one square facade photo (four storeys)
  for (const blk of blocks) for (const b of blk.buildings) {
    buildings.push(b);
    const lowRise = b.style === 'deco' || b.style === 'plaster' || b.style === 'brick';
    const photoVic = b.vic && GV.length ? GV[Math.floor(b.seed * 7) % GV.length] : null;
    const photoFac = !b.vic && !b.base && !b.special && lowRise && GF.length && (b.seed * 13) % 1 < 0.8 ? GF[Math.floor(b.seed * 3) % GF.length] : null;
    if (photoVic) { b.h = 10.4; b.tint = photoVic.userData.wall; }       // 7 m wide x 10.4 m tall matches the 2:3 photo
    if (photoFac) b.h = BAY * ((b.seed * 5) % 1 < 0.5 ? 1 : 1.1);
    if (b.base) b.gy = lastGy;
    else b.gy = lastGy = Math.min(terrain(b.x0, b.z0), terrain(b.x1, b.z0), terrain(b.x0, b.z1), terrain(b.x1, b.z1)) - 0.35;
    const gy = b.gy, top = gy + b.h;
    b.top = top;
    if (b.special) continue;                           // drawn by the landmarks module
    const S = STYLES[b.style];
    if (photoFac) photoWalls(photoBatch(photoFac), b, [0, 1, 2, 3], (L) => Math.max(1, Math.round(L / b.h)));
    else addWalls(batches[b.style], b, S, photoVic ? (b.vic < 0 ? 1 : 0) : -1);
    if (photoVic) photoWalls(photoBatch(photoVic), b, [b.vic < 0 ? 1 : 0], () => 1);
    const w = b.x1 - b.x0, d = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;

    if (b.vic) {
      // gable roof with the ridge running front to back
      const rh = 2.7, o = 0.25;
      const A0 = [b.x0 - o, top, b.z0 - o], A1 = [b.x0 - o, top, b.z1 + o], B0 = [b.x1 + o, top, b.z0 - o], B1 = [b.x1 + o, top, b.z1 + o], R0 = [cx, top + rh, b.z0 - o], R1 = [cx, top + rh, b.z1 + o];
      const sl = Math.hypot(w / 2, rh), nl = [-rh / sl, w / 2 / sl, 0], nr = [rh / sl, w / 2 / sl, 0];
      const rv = (p, n) => ({ position: p, normal: n, uv: [p[2] / 3, (p[0] + p[1]) / 3] });
      gable.quad(rv(A0, nl), rv(A1, nl), rv(R1, nl), rv(R0, nl));
      gable.quad(rv(B1, nr), rv(B0, nr), rv(R0, nr), rv(R1, nr));
      const ge = (p, n) => ({ position: p, normal: n, color: b.tint.map((v) => v * 0.9) });
      gableEnds.tri(ge([b.x0, top, b.z1], [0, 0, 1]), ge([b.x1, top, b.z1], [0, 0, 1]), ge([cx, top + rh, b.z1], [0, 0, 1]));
      gableEnds.tri(ge([b.x1, top, b.z0], [0, 0, -1]), ge([b.x0, top, b.z0], [0, 0, -1]), ge([cx, top + rh, b.z0], [0, 0, -1]));
      if (photoVic) continue;                               // the photo already has the bay, door and steps
      // bay window, front steps, cornice
      const fz = b.vic < 0 ? b.z0 : b.z1, out = b.vic;      // front face and its outward direction
      const bayH = b.h - S.h0, bx = b.x0 + 2.05;
      trims.push([bx, gy + S.h0 + bayH / 2, fz + out * 0.45, 2.7, bayH, 0.9, ...b.tint]);
      trims.push([bx, top + 0.12, fz + out * 0.5, 3.0, 0.24, 1.2, 0.78, 0.77, 0.74]);
      const floors = Math.round(bayH / S.floorH);
      for (let f = 0; f < floors; f++) panes.push([bx, gy + S.h0 + (f + 0.55) * S.floorH, fz + out * 0.91, 1.9, 1.75, 0.06]);
      trims.push([b.x0 + 5.3, gy + 0.55, fz + out * 1.1, 1.5, 1.1, 2.2, 0.5, 0.5, 0.5]);
      trims.push([cx, top - 0.22, fz + out * 0.16, w + 0.2, 0.44, 0.34, 0.78, 0.77, 0.74]);
      continue;
    }

    const rv = (x, z) => ({ position: [x, top, z], normal: [0, 1, 0], uv: [x / 6, z / 6] });
    roof.quad(rv(b.x0, b.z1), rv(b.x1, b.z1), rv(b.x1, b.z0), rv(b.x0, b.z0));
    const tc = b.style === 'glass' || photoFac ? [0.12, 0.13, 0.14] : b.tint.map((v) => Math.min(0.8, v * 0.9));
    // parapet
    const ph = b.style === 'glass' ? 1.6 : 0.9, pt = 0.35;
    trims.push([cx, top + ph / 2, b.z0 + pt / 2, w, ph, pt, ...tc], [cx, top + ph / 2, b.z1 - pt / 2, w, ph, pt, ...tc],
      [b.x0 + pt / 2, top + ph / 2, cz, pt, ph, d, ...tc], [b.x1 - pt / 2, top + ph / 2, cz, pt, ph, d, ...tc]);
    if (lowRise && !photoFac) {
      // eyebrow ledges over each floor + a base course
      const ny = Math.round((b.h - S.h0) / S.floorH);
      const lc = b.style === 'brick' ? [0.62, 0.60, 0.56] : [0.78, 0.77, 0.74];
      for (let f = 0; f <= ny; f++) {
        if (b.style !== 'deco' && f > 0 && f < ny) continue;
        trims.push([cx, gy + S.h0 + f * S.floorH - 0.12, cz, w + 0.64, 0.2, d + 0.64, ...lc]);
      }
      // awning over the shop fronts
      if (rand() < 0.75 && b.base === 0) {
        const ac = [[0.75, 0.12, 0.14], [0.08, 0.36, 0.42], [0.92, 0.72, 0.18], [0.12, 0.2, 0.42], [0.9, 0.9, 0.86]][Math.floor(rand() * 5)];
        trims.push([cx, gy + S.h0 - 0.75, cz, w + 2.6, 0.12, d + 2.6, ...ac]);
      }
    }
    // rooftop clutter
    const nr = Math.floor(2 + rand() * 4);
    for (let k = 0; k < nr; k++) {
      const sx = 1.6 + rand() * 3, sz = 1.6 + rand() * 3, sy = 1 + rand() * 2.2;
      trims.push([b.x0 + 2.5 + rand() * Math.max(1, w - 5), top + sy / 2, b.z0 + 2.5 + rand() * Math.max(1, d - 5), sx, sy, sz, 0.36, 0.37, 0.38]);
    }
    if (b.h > 60) { trims.push([cx, top + 9, cz, 0.35, 18, 0.35, 0.3, 0.3, 0.32]); neon.push([cx, top + 18.2, cz, 0.5, 0.5, 0.5, 8, 0.3, 0.2]); }
    // neon blade sign on low-rise hotels
    if ((b.style === 'deco' || b.style === 'plaster') && b.base === 0 && !photoFac && rand() < 0.6) {
      const col = [[9, 0.6, 3.2], [0.4, 5.5, 7], [8, 3.6, 0.5], [1.2, 7, 2.2], [6, 1.2, 8]][Math.floor(rand() * 5)];
      const side = rand() < 0.5 ? b.z1 + 0.5 : b.z0 - 0.5;
      const nh = Math.min(b.h - S.h0 - 1, 7 + rand() * 4);
      trims.push([b.x0 + 1.2, gy + S.h0 + nh / 2 + 0.6, side, 0.9, nh + 0.5, 0.3, 0.05, 0.05, 0.06]);
      neon.push([b.x0 + 1.2, gy + S.h0 + nh / 2 + 0.6, side + Math.sign(side - cz) * 0.17, 0.5, nh, 0.06, ...col]);
    }
  }
  for (const [t, batch] of photo) {
    const pm = new THREE.Mesh(batch.build(), new THREE.MeshStandardMaterial({ map: t, roughness: 0.82, metalness: 0 }));
    pm.castShadow = pm.receiveShadow = true; group.add(pm);
  }
  // rooftop billboards for the invented local brands
  if (GA.length) {
    const cand = buildings.filter((b) => !b.vic && !b.special && !b.base && b.h > 13 && b.h < 46 && b.x1 - b.x0 > 15 && b.z1 - b.z0 > 15);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.6, metalness: 0.5 });
    for (let k = 0; k < Math.min(9, cand.length); k++) {
      const b = cand[Math.floor(((k + 0.5) / 9) * cand.length)], blk = b.blk, tex = GA[k % GA.length];
      // face whichever street the building stands closest to
      const opts = [[b.z1, blk.z1 - b.z1, 0, 1], [b.z0, b.z0 - blk.z0, 0, -1], [b.x1, blk.x1 - b.x1, 1, 0], [b.x0, b.x0 - blk.x0, -1, 0]].sort((p, q) => p[1] - q[1])[0];
      const nx = opts[2], nz = opts[3], bw = 11.5, bh = bw * (tex.image.height / tex.image.width);
      const px = nx ? opts[0] - nx * 0.6 : (b.x0 + b.x1) / 2, pz = nz ? opts[0] - nz * 0.6 : (b.z0 + b.z1) / 2, py = b.top + 2.2 + bh / 2;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22 }));
      board.position.set(px + nx * 0.2, py, pz + nz * 0.2); board.rotation.y = Math.atan2(nx, nz);
      const back = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.5, bh + 0.5, 0.3), dark);
      back.position.set(px, py, pz); back.rotation.y = board.rotation.y; back.castShadow = true;
      group.add(board, back);
      for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.4, 0.35), dark); post.position.set(px + (nz ? s * bw * 0.32 : 0), b.top + 1.2, pz + (nx ? s * bw * 0.32 : 0)); group.add(post); }
    }
  }
  const mats = {};
  for (const k in STYLES) {
    if (!batches[k].n) continue;
    mats[k] = makeFacadeMaterial(A, k);
    const mesh = new THREE.Mesh(batches[k].build(), mats[k]);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  const RT = A.tex.concrete_floor_worn_001;
  const roofMesh = new THREE.Mesh(roof.build(), new THREE.MeshStandardMaterial({ map: RT.map, normalMap: RT.normalMap, roughnessMap: RT.arm, color: 0x8a8a88 }));
  roofMesh.receiveShadow = true; roofMesh.castShadow = true;
  group.add(roofMesh);
  if (gable.n) {
    const GT = A.tex.roof_09;
    const gm = new THREE.Mesh(gable.build(), new THREE.MeshStandardMaterial({ map: GT.map, normalMap: GT.normalMap, roughnessMap: GT.arm, color: 0x9a9088, side: THREE.DoubleSide }));
    gm.castShadow = gm.receiveShadow = true; group.add(gm);
    const em = new THREE.Mesh(gableEnds.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    em.castShadow = em.receiveShadow = true; group.add(em);
  }

  // instanced trim boxes
  const ST = A.tex.plastered_wall_04;
  const dm = new THREE.Object3D(), col = new THREE.Color();
  const boxes = (list, mat, colored) => {
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, Math.max(1, list.length));
    list.forEach((t, i) => { dm.position.set(t[0], t[1], t[2]); dm.scale.set(t[3], t[4], t[5]); dm.updateMatrix(); m.setMatrixAt(i, dm.matrix); if (colored) m.setColorAt(i, col.setRGB(t[6], t[7], t[8])); });
    m.count = list.length;
    group.add(m);
    return m;
  };
  const trimMesh = boxes(trims, new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.0, roughnessMap: ST.arm, normalMap: ST.normalMap }), true);
  trimMesh.castShadow = trimMesh.receiveShadow = true;
  boxes(panes, new THREE.MeshStandardMaterial({ color: 0x3a4c5c, roughness: 0.05, metalness: 0.55, envMapIntensity: 1.6 }), false);
  boxes(neon, new THREE.MeshBasicMaterial(), true);

  // beach + sea
  const BT = A.tex.coast_sand_01;
  const beachGeo = new THREE.PlaneGeometry(ext * 2 + 400, 130, 60, 12);
  beachGeo.rotateX(-Math.PI / 2);
  const bp = beachGeo.attributes.position, buv = beachGeo.attributes.uv;
  for (let i = 0; i < bp.count; i++) {
    const t = (bp.getZ(i) + 65) / 130;                 // 0 at the promenade, 1 out at sea
    bp.setY(i, 0.12 - Math.pow(t, 1.4) * 3.4 + Math.sin(bp.getX(i) * 0.05) * 0.12 * t);
    buv.setXY(i, bp.getX(i) / 5, bp.getZ(i) / 5);
  }
  beachGeo.translate(0, 0, r1 + e + 65 - 0.5);
  beachGeo.computeVertexNormals();
  const beach = new THREE.Mesh(beachGeo, new THREE.MeshStandardMaterial({ map: BT.map, normalMap: BT.normalMap, roughnessMap: BT.arm, color: 0xf2e6cf }));
  beach.receiveShadow = true;
  group.add(beach);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0a4750, roughness: 0.07, metalness: 0.0, normalMap: A.waterNormals, envMapIntensity: 1.6 }));
  water.material.onBeforeCompile = (s) => {
    s.uniforms.uTime = cityUniforms.uTime;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; uniform float uTime;')
      .replace('#include <normal_fragment_maps>', /* glsl */`
        {
          vec2 w = vWPos.xz;
          vec3 n1 = texture2D(normalMap, w * 0.021 + uTime * vec2(0.010, 0.006)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, w * 0.083 - uTime * vec2(0.012, 0.021)).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(normalMap, w * 0.31 + uTime * vec2(-0.03, 0.02)).xyz * 2.0 - 1.0;
          float far = smoothstep(900.0, 60.0, length(vWPos - cameraPosition));
          vec3 nn = normalize(vec3((n1.xy * 0.9 + n2.xy * 0.6 + n3.xy * 0.35 * far) * 0.55, 1.0));
          normal = normalize((viewMatrix * vec4(nn.x, nn.z, nn.y, 0.0)).xyz);
        }`);
  };
  water.position.y = -1.15;
  group.add(water);

  // ---- queries ----
  const blockAt = (x, z) => {
    const i = Math.floor((x - O) / P), j = Math.floor((z - O) / P);
    return i >= 0 && j >= 0 && i < N && j < N ? blocks[i * N + j] : null;
  };
  // height of the surface you can stand or drive on
  const groundY = (x, z) => {
    if (z < CITY_MIN - RIM) return z >= BRIDGE.z1 ? (Math.abs(x - BRIDGE.x) < BRIDGE.w + 2 ? deckY(z) : -1.2) : headY(x, z);
    if (z > CITY_MAX + RIM) return 0.12 - Math.pow(Math.min(1, (z - CITY_MAX - RIM) / 130), 1.4) * 3.4;
    if (x < CITY_MIN || x > CITY_MAX || z < CITY_MIN || z > CITY_MAX) return CURB;
    const lx = ((x - O) % P + P) % P, lz = ((z - O) % P + P) % P;
    return terrain(x, z) + (lx > HALF && lx < P - HALF && lz > HALF && lz < P - HALF ? CURB : 0);
  };
  // colliders near a point (the 3x3 blocks around it, plus any landmark boxes)
  const extras = [];
  const near = [];
  const collidersNear = (x, z) => {
    near.length = 0;
    const i = Math.floor((x - O) / P), j = Math.floor((z - O) / P);
    for (let a = i - 1; a <= i + 1; a++) for (let c = j - 1; c <= j + 1; c++) {
      if (a < 0 || c < 0 || a >= N || c >= N) continue;
      for (const b of blocks[a * N + c].buildings) if (b.collide !== false) near.push(b);
    }
    for (const b of extras) if (x > b.x0 - 60 && x < b.x1 + 60 && z > b.z0 - 60 && z < b.z1 + 60) near.push(b);
    return near;
  };

  // where things are allowed to be: the island, the bridge deck, the piers and the headland
  const B = { min: CITY_MIN - RIM + 1, max: CITY_MAX + RIM - 1, sea: CITY_MAX + RIM + 45 };
  const regions = [
    { x0: B.min, x1: B.max, z0: B.min, z1: B.sea },
    { x0: BRIDGE.x - BRIDGE.w + 0.3, x1: BRIDGE.x + BRIDGE.w - 0.3, z0: BRIDGE.z1 - 3, z1: B.min + 3 },
    ...PIERS.map((p) => ({ x0: B.max - 3, x1: p.x1 - 0.8, z0: p.z0 + 0.8, z1: p.z1 - 0.8 })),
  ];
  // push `o` back inside the nearest allowed region; returns the speed it hit the edge with
  const confine = (o, r) => {
    let bx = 0, bz = 0, bd = 1e18;
    for (const R of regions) {
      const cx = clamp(o.x, R.x0 + r, R.x1 - r), cz = clamp(o.z, R.z0 + r, R.z1 - r), d = (cx - o.x) ** 2 + (cz - o.z) ** 2;
      if (d === 0) return 0;
      if (d < bd) { bd = d; bx = cx; bz = cz; }
    }
    const hx = o.x - HEAD.x, hz = o.z - HEAD.z, hd = Math.hypot(hx, hz), hr = HEAD.r - r;
    if (hd <= hr) return 0;
    if ((hd - hr) ** 2 < bd) { bx = HEAD.x + (hx / hd) * hr; bz = HEAD.z + (hz / hd) * hr; }
    const nx = bx - o.x, nz = bz - o.z, l = Math.hypot(nx, nz) || 1;
    o.x = bx; o.z = bz;
    if (o.vx === undefined) return 0;
    const vn = (o.vx * nx + o.vz * nz) / l;
    if (vn >= 0) return 0;
    o.vx -= (vn * nx / l) * 1.2; o.vz -= (vn * nz / l) * 1.2;
    return -vn;
  };

  return { group, blocks, buildings, extras, blockAt, groundY, collidersNear, confine, mats, paints, rand, bounds: B };
}
