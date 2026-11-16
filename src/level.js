// The derelict building: geometry, collision, baked window light, navigation graph, exterior.
import * as THREE from 'three';
import { World } from './physics.js';
import { makeTextures, rng } from './textures.js';

export const SUN_DIR = new THREE.Vector3(0.45, -0.72, -0.53).normalize(); // direction the light travels
export const F1 = 3.5;          // height of the upper floor
const SKY = [15, 16.5, 19];     // radiance of the overcast sky seen through openings
const SUN_INTENSITY = 6;
const WT = 0.25;                // wall thickness
const TESS = 0.45;              // bake resolution in metres
const MATS = ['wall', 'floor', 'ceil', 'concrete', 'wood', 'metal'];

// MeshStandardMaterial with an extra ambient term. No ambient lights exist in the scene:
// static geometry gets baked window light per vertex ('baked'), instanced debris gets it per
// instance ('inst'), and moving things read a probe each frame ('amb', via userData.amb).
export function litMaterial(params, mode = 'amb') {
  const m = new THREE.MeshStandardMaterial(params);
  m.userData.amb = { value: new THREE.Color(0.06, 0.06, 0.07) };
  m.userData.ambDir = { value: new THREE.Vector3(0, 1, 0) };
  if (mode === 'baked') m.vertexColors = true;
  const add = mode === 'amb'
    ? 'reflectedLight.indirectDiffuse += uAmb * diffuseColor.rgb * (0.58 + 0.5 * dot(inverseTransformDirection(normal, viewMatrix), uAmbDir));'
    : 'reflectedLight.indirectDiffuse += vColor.rgb * diffuseColor.rgb;';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uAmb = m.userData.amb;
    sh.uniforms.uAmbDir = m.userData.ambDir;
    let f = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uAmb;\nuniform vec3 uAmbDir;');
    if (mode !== 'amb') f = f.replace('#include <color_fragment>', '');
    f = f.replace('#include <aomap_fragment>', add + '\n#include <aomap_fragment>');
    sh.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'lit-' + mode;
  return m;
}

class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.idx = []; this.faces = []; this.col = null; }
  get count() { return this.p.length / 3; }
  // A tessellated rectangle. eu x ev must equal n.
  face(o, eu, ev, lu, lv, n, su, sv, uvRect) {
    const nu = Math.max(1, Math.ceil(lu / TESS)), nv = Math.max(1, Math.ceil(lv / TESS));
    const start = this.count;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const a = (lu * i) / nu, b = (lv * j) / nv;
        const x = o[0] + eu[0] * a + ev[0] * b, y = o[1] + eu[1] * a + ev[1] * b, z = o[2] + eu[2] * a + ev[2] * b;
        this.p.push(x, y, z);
        this.n.push(n[0], n[1], n[2]);
        if (uvRect) this.uv.push(i / nu, j / nv);
        else if (n[0] !== 0) this.uv.push(z / su, y / sv);
        else if (n[2] !== 0) this.uv.push(x / su, y / sv);
        else this.uv.push(x / su, z / sv);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = start + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
        this.idx.push(a, b, d, a, d, c);
      }
    }
    this.faces.push({ start, nu, nv, o, eu, ev, lu, lv, n });
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col || new Float32Array(this.p.length).fill(0.3), 3));
    g.setIndex(this.idx);
    return g;
  }
}

const NODES = {
  entry: [4, 0, 12.5], entryDoor: [4, 0, 9], corrW: [4, 0, 7.5], aDoor: [4, 0, 6], a: [4, 0, 3], abDoor: [8, 0, 3.05],
  b: [12, 0, 3], bDoor: [12, 0, 6], corrM: [12, 0, 7.5], corrE: [16, 0, 7.5], hallDoor: [16, 0, 9], hall: [16, 0, 11.2],
  hallW: [10.5, 0, 11.2], entryHall: [8, 0, 12.7], hallE: [21, 0, 11], corrS: [17.5, 0, 7.5], corrFar: [21.5, 0, 7.5],
  stairDoor: [17.5, 0, 6], s0: [17.3, 0, 0.94], s0a: [18, 0, 0.94], s1a: [20.8, 1.75, 0.94], s1: [22.2, 1.75, 0.94],
  s2: [22.2, 1.75, 2.58], s2a: [20.8, 1.75, 2.58], s3a: [18, 3.5, 2.58], s3: [17.1, 3.5, 2.58],
  uStairDoor: [17.1, 3.5, 6], uCorrS: [17.1, 3.5, 7.5], uCorrF: [18.55, 3.5, 7.5], uFDoor: [18.55, 3.5, 9],
  uF: [16.2, 3.5, 10.6], uFE: [22, 3.5, 10.4], uEF: [14, 3.5, 11.6], uE2: [11.5, 3.5, 12], uE: [8, 3.5, 12.8],
  uEDoor: [5.55, 3.5, 9], uCorrE2: [5.55, 3.5, 7.5], uCorrW: [4, 3.5, 7.5], uCorrM: [12, 3.5, 7.5], uDDoor: [12, 3.5, 6],
  uD: [12, 3.5, 3], uCDDoor: [8, 3.5, 3.05], uC: [4, 3.5, 3], uCDoor: [4, 3.5, 6],
};
const EDGES = [
  ['entry', 'entryDoor'], ['entryDoor', 'corrW'], ['corrW', 'aDoor'], ['aDoor', 'a'], ['a', 'abDoor'], ['abDoor', 'b'],
  ['b', 'bDoor'], ['bDoor', 'corrM'], ['corrW', 'corrM'], ['corrM', 'corrE'], ['corrE', 'hallDoor'], ['hallDoor', 'hall'],
  ['hall', 'hallW'], ['hallW', 'entryHall'], ['entryHall', 'entry'], ['hall', 'hallE'], ['corrE', 'corrS'], ['corrS', 'corrFar'],
  ['corrS', 'stairDoor'], ['stairDoor', 's0'], ['s0', 's0a'], ['s0a', 's1a'], ['s1a', 's1'], ['s1', 's2'], ['s2', 's2a'],
  ['s2a', 's3a'], ['s3a', 's3'], ['s3', 'uStairDoor'], ['uStairDoor', 'uCorrS'], ['uCorrS', 'uCorrF'], ['uCorrF', 'uFDoor'],
  ['uFDoor', 'uF'], ['uFDoor', 'uFE'], ['uF', 'uFE'], ['uF', 'uEF'], ['uEF', 'uE2'], ['uE2', 'uE'], ['uE', 'uEDoor'],
  ['uEDoor', 'uCorrE2'], ['uCorrE2', 'uCorrW'], ['uCorrE2', 'uCorrM'], ['uCorrM', 'uCorrS'], ['uCorrM', 'uDDoor'],
  ['uDDoor', 'uD'], ['uD', 'uCDDoor'], ['uCDDoor', 'uC'], ['uC', 'uCDoor'], ['uCDoor', 'uCorrW'],
];

export const SPAWNS = [
  { p: [19.6, 0, 13.6], yaw: Math.PI / 2 },
  { p: [12, 0, 10.6], yaw: Math.PI },
  { p: [2.5, 0, 2.5], yaw: -2.74 },
  { p: [21.5, 0, 7.5], yaw: Math.PI / 2, patrol: ['corrFar', 'corrM'] },
  { p: [13.5, 0, 2.2], yaw: 2.78 },
  { p: [22.3, 1.75, 2.2], yaw: Math.PI / 2 },
  { p: [4, 3.5, 7.5], yaw: -Math.PI / 2, patrol: ['uCorrW', 'uCorrS'] },
  { p: [3, 3.5, 2], yaw: -2.9 },
  { p: [3.5, 3.5, 13.2], yaw: -0.6 },
  { p: [10.8, 3.5, 13.6], yaw: 0.3 },
  { p: [22.3, 3.5, 10.3], yaw: Math.PI / 2 },
];
export const PLAYER_START = { p: [4, 0, 14.6], yaw: 0 };

export class Level {
  constructor(scene, photos) {
    this.scene = scene;
    this.world = new World();
    this.tex = makeTextures(photos);
    this.bufs = {};
    for (const k of MATS) this.bufs[k] = new Buf();
    this.decalBufs = new Map(); // texture -> Buf
    this.openings = [];
    this.lights = [];
    this.debris = [];
    this.r = rng(4242);
    this.group = new THREE.Group();
    scene.add(this.group);

    this.buildStructure();
    this.buildProps();
    this.world.build();
    this.buildDecals();
    this.buildLights();
    this.buildNav();
    this.buildExterior();
  }

  // ---------- primitives ----------

  box(x0, y0, z0, x1, y1, z1, mat, o = {}) {
    const m = typeof mat === 'string' ? { side: mat, top: mat, bottom: mat } : mat;
    const f = (name, origin, eu, ev, lu, lv, n) => {
      if (!name || lu < 0.001 || lv < 0.001) return;
      const s = this.tex[name].scale;
      this.bufs[name].face(origin, eu, ev, lu, lv, n, s[0], s[1]);
    };
    f(m.side, [x1, y0, z1], [0, 0, -1], [0, 1, 0], z1 - z0, y1 - y0, [1, 0, 0]);
    f(m.side, [x0, y0, z0], [0, 0, 1], [0, 1, 0], z1 - z0, y1 - y0, [-1, 0, 0]);
    f(m.side, [x0, y0, z1], [1, 0, 0], [0, 1, 0], x1 - x0, y1 - y0, [0, 0, 1]);
    f(m.side, [x1, y0, z0], [-1, 0, 0], [0, 1, 0], x1 - x0, y1 - y0, [0, 0, -1]);
    f(m.top, [x0, y1, z1], [1, 0, 0], [0, 0, -1], x1 - x0, z1 - z0, [0, 1, 0]);
    f(m.bottom, [x0, y0, z0], [1, 0, 0], [0, 0, 1], x1 - x0, z1 - z0, [0, -1, 0]);
    if (o.collide !== false) this.world.add(x0, y0, z0, x1, y1, z1, o);
  }

  // A wall along x (at z = c) or along z (at x = c) with rectangular openings cut out.
  // ext is the inward normal for exterior walls, whose openings let sky light in.
  wall(axis, c, a0, a1, y0, y1, openings = [], ext = null) {
    const h = WT / 2;
    const put = (a, b, ya, yb) => {
      if (b - a < 0.01 || yb - ya < 0.01) return;
      if (axis === 'x') this.box(a, ya, c - h, b, yb, c + h, 'wall');
      else this.box(c - h, ya, a, c + h, yb, b, 'wall');
    };
    const ops = openings.slice().sort((p, q) => p.a - q.a);
    let cur = a0;
    for (const o of ops) {
      put(cur, o.a, y0, y1);
      put(o.a, o.b, y0, o.y0);
      put(o.a, o.b, o.y1, y1);
      cur = o.b;
      this.openings.push({ axis, c, a: o.a, b: o.b, y0: o.y0, y1: o.y1, ext, kind: o.y0 > y0 + 0.3 ? 'window' : 'door', boards: o.boards || 0 });
    }
    put(cur, a1, y0, y1);
  }

  // Horizontal slab with rectangular holes [x0, z0, x1, z1].
  slab(x0, z0, x1, z1, y0, y1, holes, mat) {
    const xs = [x0, x1], zs = [z0, z1];
    for (const h of holes) { xs.push(h[0], h[2]); zs.push(h[1], h[3]); }
    const uniq = (a, lo, hi) => [...new Set(a.filter((v) => v >= lo && v <= hi))].sort((p, q) => p - q);
    const X = uniq(xs, x0, x1), Z = uniq(zs, z0, z1);
    const inHole = (x, z) => holes.some((h) => x > h[0] && x < h[2] && z > h[1] && z < h[3]);
    for (let j = 0; j < Z.length - 1; j++) {
      let run = null;
      for (let i = 0; i < X.length - 1; i++) {
        const open = inHole((X[i] + X[i + 1]) / 2, (Z[j] + Z[j + 1]) / 2);
        if (!open) { if (run === null) run = X[i]; }
        if (open || i === X.length - 2) {
          const end = open ? X[i] : X[i + 1];
          if (run !== null && end > run) this.box(run, y0, Z[j], end, y1, Z[j + 1], mat);
          run = null;
        }
      }
    }
  }

  decal(tex, cx, cy, cz, nx, nz, w, h) {
    let buf = this.decalBufs.get(tex);
    if (!buf) this.decalBufs.set(tex, (buf = new Buf()));
    const rx = nz, rz = -nx;
    const o = [cx - rx * w / 2 + nx * 0.008, cy - h / 2, cz - rz * w / 2 + nz * 0.008];
    buf.face(o, [rx, 0, rz], [0, 1, 0], w, h, [nx, 0, nz], 1, 1, true);
  }

  floorDecal(tex, cx, y, cz, w, d) {
    let buf = this.decalBufs.get(tex);
    if (!buf) this.decalBufs.set(tex, (buf = new Buf()));
    buf.face([cx - w / 2, y + 0.006, cz + d / 2], [1, 0, 0], [0, 0, -1], w, d, [0, 1, 0], 1, 1, true);
  }

  // ---------- the building ----------

  buildStructure() {
    const win = (a, w, base, sill = 0.95, top = 2.5, boards = 0) => ({ a, b: a + w, y0: base + sill, y1: base + top, boards });
    const door = (a, w, base, h = 2.15) => ({ a, b: a + w, y0: base, y1: base + h });
    const lo = 0.125, hx = 23.875, hz = 15.875;

    // slabs
    this.box(-0.125, -0.4, -0.125, 24.125, 0, 16.125, { top: 'floor', side: null, bottom: null });
    this.stairHole = [18, 0.125, 23.875, 3.3];
    this.floorHole = [20, 13, 22.5, 15];
    this.slab(-0.125, -0.125, 24.125, 16.125, 3.2, 3.5, [this.stairHole, this.floorHole], { top: 'floor', bottom: 'ceil', side: 'concrete' });
    this.skylights = [[17, 11, 20, 13.5], [19.5, 3.7, 22, 5.3], [3, 2, 5, 3.8]];
    this.slab(-0.125, -0.125, 24.125, 16.125, 6.7, 7.0, this.skylights, { top: 'concrete', bottom: 'ceil', side: 'concrete' });
    this.world.add(-80, -2, -80, 104, -0.05, 96, { occ: false }); // outside ground

    for (const base of [0, F1]) {
      const top = base + 3.2, up = base > 0;
      // exterior
      this.wall('x', 0, -0.125, 24.125, base, top,
        [win(2.2, 1.6, base), win(4.6, 1.6, base, 0.95, 2.5, up ? 0 : 2), win(10, 1.6, base), win(12.4, 1.6, base, 0.95, 2.5, up ? 3 : 0)], [0, 0, 1]);
      this.wall('x', 16, -0.125, 24.125, base, top, up
        ? [win(2, 1.8, base), win(5, 1.8, base, 0.95, 2.5, 2), win(9, 1.8, base), win(16, 1.8, base), win(19.5, 1.8, base)]
        : [door(3.4, 1.2, 0, 2.2), win(5.6, 1.6, 0, 0.95, 2.5, 3), win(10, 1.8, 0), win(13.5, 1.8, 0), win(17, 1.8, 0, 0.95, 2.5, 2), win(20.5, 1.8, 0)], [0, 0, -1]);
      this.wall('z', 0, lo, hz, base, top, [win(2, 1.8, base), win(7, 1, base, 1.1, 2.4), win(11.5, 1.8, base)], [1, 0, 0]);
      // the east wall of the stairwell is one tall piece, built below
      this.wall('z', 24, 6, hz, base, top, [win(7, 1, base, 1.1, 2.4), win(11.5, 2, base)], [-1, 0, 0]);

      // interior
      this.wall('x', 6, lo, hx, base, top, up
        ? [door(3.45, 1.1, base), door(11.45, 1.1, base), door(16.4, 1.4, base, 2.3)]
        : [door(3.45, 1.1, 0), door(11.45, 1.1, 0), { a: 13.6, b: 14.6, y0: 0.9, y1: 2.0 }, door(16.6, 1.8, 0, 2.3)]);
      this.wall('x', 9, lo, hx, base, top, up ? [door(5, 1.1, base), door(18, 1.1, base)] : [door(3.45, 1.1, 0), door(15.2, 1.6, 0, 2.3)]);
      this.wall('z', 8, lo, 5.875, base, top, [door(2.5, 1.1, base)]);
      this.wall('z', 16, lo, 5.875, base, top, []);
      if (up) this.wall('z', 14, 9.125, hz, base, top, [door(11, 1.2, base, 2.3)]);
      else this.wall('z', 8, 9.125, hz, base, top, [door(12, 1.4, 0, 2.3)]);
    }
    // stairwell east wall with a tall window over the landing
    this.wall('z', 24, lo, 6, 0, 6.7, [{ a: 0.9, b: 2.5, y0: 2.75, y1: 5.0 }], [-1, 0, 0]);
    // parapet strip between storeys on the outside walls
    this.wall('x', 0, -0.125, 24.125, 3.2, 3.5); this.wall('x', 16, -0.125, 24.125, 3.2, 3.5);
    this.wall('z', 0, lo, hz, 3.2, 3.5); this.wall('z', 24, 6, hz, 3.2, 3.5);

    // stairs
    const rise = 0.175, run = 0.28;
    for (let i = 0; i < 10; i++) {
      const xa = 18 + run * i;
      this.box(xa, 0, 0.125, xa + run, rise * (i + 1), 1.75, 'concrete');
      const xb = 20.8 - run * (i + 1), t2 = 1.75 + rise * (i + 1);
      this.box(xb, t2 - 0.5, 1.85, xb + run, t2, 3.3, 'concrete');
      // spine wall between the two flights, stepped with the upper one
      this.box(xa, 0, 1.75, xa + run, 1.75 + rise * (10 - i) + 0.9, 1.85, 'concrete');
      // rail on the open side of the upper flight
      this.box(xb, t2, 3.3, xb + run, t2 + 0.95, 3.34, 'metal', { occ: false, collide: false });
      this.world.add(xb, t2, 3.3, xb + run, t2 + 0.95, 3.36, { occ: false });
    }
    this.box(20.8, 1.55, 0.125, 23.875, 1.75, 3.3, 'concrete');
    // rail around the stair opening on the upper floor
    for (let x = 18; x < 23.8; x += 0.3) this.box(x, 3.5, 3.31, x + 0.03, 4.4, 3.34, 'metal', { collide: false });
    this.box(18, 4.4, 3.29, 23.875, 4.46, 3.36, 'metal', { collide: false });
    this.world.add(18, 3.5, 3.3, 23.875, 4.46, 3.36, { occ: false });

    // window frames and boards
    for (const o of this.openings) {
      if (!o.ext || o.kind !== 'window') continue;
      const w = o.b - o.a, h = o.y1 - o.y0, t = 0.05;
      const bar = (a0, a1, ya, yb, mat = 'wood', depth = 0.03, opts = { collide: false }) => {
        if (o.axis === 'x') this.box(a0, ya, o.c - depth, a1, yb, o.c + depth, mat, opts);
        else this.box(o.c - depth, ya, a0, o.c + depth, yb, a1, mat, opts);
      };
      bar(o.a, o.a + t, o.y0, o.y1); bar(o.b - t, o.b, o.y0, o.y1);
      bar(o.a, o.b, o.y0, o.y0 + t); bar(o.a, o.b, o.y1 - t, o.y1);
      bar(o.a + w / 2 - 0.02, o.a + w / 2 + 0.02, o.y0, o.y1);
      bar(o.a, o.b, o.y0 + h * 0.66, o.y0 + h * 0.66 + 0.04);
      for (let k = 0; k < o.boards; k++) {
        const y = o.y0 + 0.12 + (k * (h - 0.4)) / Math.max(1, o.boards - 1) * (o.boards > 1 ? 1 : 0) + (this.r() - 0.5) * 0.08;
        const inward = o.ext[0] + o.ext[2];
        const off = 0.14 * inward;
        if (o.axis === 'x') this.box(o.a - 0.15, y, o.c + off - 0.015, o.b + 0.15, y + 0.17, o.c + off + 0.015, 'wood', { solid: false });
        else this.box(o.c + off - 0.015, y, o.a - 0.15, o.c + off + 0.015, y + 0.17, o.b + 0.15, 'wood', { solid: false });
      }
    }
    // interior door casings
    for (const o of this.openings) {
      if (o.ext || o.kind !== 'door') continue;
      const d = 0.15, t = 0.04;
      if (o.axis === 'x') {
        this.box(o.a, o.y0, o.c - d, o.a + t, o.y1, o.c + d, 'wood', { collide: false });
        this.box(o.b - t, o.y0, o.c - d, o.b, o.y1, o.c + d, 'wood', { collide: false });
        this.box(o.a, o.y1 - t, o.c - d, o.b, o.y1, o.c + d, 'wood', { collide: false });
      } else {
        this.box(o.c - d, o.y0, o.a, o.c + d, o.y1, o.a + t, 'wood', { collide: false });
        this.box(o.c - d, o.y0, o.b - t, o.c + d, o.y1, o.b, 'wood', { collide: false });
        this.box(o.c - d, o.y1 - t, o.a, o.c + d, o.y1, o.b, 'wood', { collide: false });
      }
    }
    // the way in: open to daylight, but you do not get to leave
    this.world.add(3.2, 0, 16.2, 4.8, 2.4, 16.5, { ray: false, occ: false });
  }

  buildProps() {
    const B = (...a) => this.box(...a);
    const legs = (x0, z0, x1, z1, y0, y1) => {
      for (const [x, z] of [[x0, z0], [x1 - 0.05, z0], [x0, z1 - 0.05], [x1 - 0.05, z1 - 0.05]]) B(x, y0, z, x + 0.05, y1, z + 0.05, 'metal', { collide: false });
    };
    // ground floor
    B(12.75, 0, 12.25, 13.25, 3.2, 12.75, 'concrete'); B(18.75, 0, 12.25, 19.25, 3.2, 12.75, 'concrete');
    B(0.3, 0, 0.4, 1.3, 1.9, 0.9, 'metal'); B(1.35, 0, 0.4, 2.0, 1.9, 0.9, 'metal');
    B(10.2, 0.72, 1.0, 11.8, 0.78, 1.9, 'wood'); legs(10.2, 1.0, 11.8, 1.9, 0, 0.72);
    B(9.2, 0, 14.6, 10.2, 0.9, 15.5, 'wood'); B(9.4, 0.9, 14.8, 10.0, 1.5, 15.4, 'wood');
    B(21.8, 0, 9.6, 22.9, 1.0, 10.6, 'wood');
    B(15.2, 0, 14.9, 15.8, 0.95, 15.5, 'metal'); B(14.5, 0, 15.1, 15.05, 0.95, 15.65, 'metal');
    B(0.4, 0, 13.8, 1.0, 0.5, 15.6, 'wood');
    B(0.2, 0.15, 7.1, 0.38, 0.8, 7.9, 'metal', { solid: false }); B(23.62, 0.15, 7.1, 23.8, 0.8, 7.9, 'metal', { solid: false });
    B(20.3, 0, 13.2, 21.6, 0.3, 14.4, 'concrete'); B(21.0, 0.3, 13.5, 21.5, 0.55, 14.1, 'concrete'); B(21.6, 0, 14.0, 22.3, 0.22, 14.9, 'concrete');
    B(6.2, 0, 0.4, 7.6, 0.45, 1.2, 'wood'); // low pallet stack in room A
    B(19.0, 0, 4.2, 20.2, 0.8, 5.6, 'wood'); // crate under the stair slab
    // upper floor
    const u = F1;
    B(6.75, u, 12.25, 7.25, u + 3.2, 12.75, 'concrete');
    B(0.3, u, 4.4, 0.8, u + 1.9, 5.6, 'wood');
    B(13.2, u + 0.72, 0.5, 15.4, u + 0.78, 1.3, 'wood'); B(13.2, u, 0.5, 13.8, u + 0.72, 1.3, 'wood'); B(15.3, u, 0.5, 15.4, u + 0.72, 1.3, 'wood', { collide: false });
    B(11.5, u, 14.5, 12.6, u + 0.9, 15.5, 'wood'); B(11.7, u + 0.9, 14.7, 12.3, u + 1.4, 15.3, 'wood');
    B(1.0, u, 9.4, 3.2, u + 0.5, 10.3, 'wood'); B(1.0, u + 0.5, 9.4, 3.2, u + 0.95, 9.6, 'wood');
    B(9.0, u, 6.3, 10.2, u + 0.85, 6.9, 'metal');
    B(18.6, u, 12.2, 19.6, u + 0.3, 13.2, 'concrete'); B(18.9, u + 0.3, 12.5, 19.4, u + 0.5, 13.0, 'concrete');
    B(14.2, u, 14.4, 14.9, u + 1.7, 15.5, 'metal');
    // pipes and dead light fittings along both corridors
    for (const base of [0, F1]) {
      B(0.2, base + 2.95, 6.32, 23.8, base + 3.04, 6.41, 'metal', { collide: false });
      B(0.2, base + 2.86, 6.46, 23.8, base + 2.92, 6.52, 'metal', { collide: false });
      for (const x of [5, 11, 17, 22]) B(x - 0.5, base + 3.1, 7.4, x + 0.5, base + 3.2, 7.6, 'metal', { collide: false });
    }
    // door leaves swung flat against walls
    B(4.6, 0, 5.78, 5.65, 2.1, 5.83, 'wood', { collide: false });
    B(8.15, 0, 3.65, 8.2, 2.1, 4.7, 'wood', { collide: false });
    B(12.6, u, 5.78, 13.65, u + 2.1, 5.83, 'wood', { collide: false });
    B(4.6, 0, 9.17, 5.65, 2.1, 9.22, 'wood', { collide: false });

    // loose rubble
    const pile = (x, y, z, rad, n) => {
      for (let i = 0; i < n; i++) {
        const a = this.r() * 6.283, d = rad * Math.sqrt(this.r());
        const s = 0.015 + this.r() * this.r() * this.r() * 0.13;
        this.debris.push({ x: x + Math.cos(a) * d, y: y + s * 0.4, z: z + Math.sin(a) * d, s, rx: this.r() * 6, ry: this.r() * 6, sy: 0.4 + this.r() * 0.6 });
      }
    };
    pile(21.2, 0, 14.0, 1.8, 220); pile(19, F1, 12.4, 1.9, 220);
    pile(6.8, 0, 14.6, 1.0, 30); pile(14.5, 0, 9.6, 0.8, 25); pile(1.2, 0, 7.6, 0.8, 22); pile(22.5, 0, 5.2, 0.9, 25);
    pile(2, 0, 4.8, 1.0, 26); pile(14.8, 0, 4.9, 0.9, 24); pile(9.5, 0, 8.6, 0.6, 16); pile(18.5, 0, 15.2, 0.9, 24);
    pile(21.5, 1.75, 0.6, 0.6, 14); pile(2.5, F1, 14.6, 1.2, 30); pile(12.8, F1, 9.8, 0.8, 20); pile(4.2, F1, 3.0, 1.0, 34);
    pile(15, F1, 4.8, 0.8, 20); pile(20.8, F1, 4.6, 1.0, 34); pile(8, F1, 8.4, 0.5, 14); pile(22.8, F1, 9.8, 0.7, 18);
    for (let i = 0; i < 260; i++) {
      const up = this.r() < 0.5;
      pile(0.6 + this.r() * 22.8, up ? F1 : 0, 0.6 + this.r() * 14.8, 0.35, 3);
    }
  }

  buildDecals() {
    const T = this.tex, G = T.graffiti;
    // big pieces
    this.decal(T.mural, 11.5, 1.6, 9.125, 0, 1, 5.5, 2.75);
    this.decal(G[0], 7.875, 1.5, 10.5, -1, 0, 2.6, 1.3);
    this.decal(G[1], 7.875, 1.45, 4.75, -1, 0, 2.1, 1.05);
    this.decal(G[3], 20.6, 3.1, 0.125, 0, 1, 4.2, 2.1);
    this.decal(G[2], 23.875, 1.5, 14.75, -1, 0, 2.0, 1.0);
    this.decal(G[4], 8.125, 1.5, 1.35, 1, 0, 2.0, 1.0);
    this.decal(G[2], 10, F1 + 1.55, 9.125, 0, 1, 5, 2.5);
    this.decal(G[4], 15.875, F1 + 1.5, 3, -1, 0, 4, 2);
    this.decal(G[3], 16.125, F1 + 1.5, 3, 1, 0, 3.6, 1.8);
    this.decal(G[0], 23.875, F1 + 1.5, 14.75, -1, 0, 2.0, 1.0);
    this.decal(G[1], 2.2, F1 + 1.5, 8.875, 0, -1, 2.4, 1.2);
    this.decal(G[0], 20, 1.5, 6.125, 0, 1, 2.6, 1.3);

    // tags and stains wherever there is solid wall behind them
    const w = this.world, r = this.r;
    const backed = (x, y, z, nx, nz, wd, h) => {
      const rx = nz, rz = -nx;
      for (const [su, sv] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
        const px = x + rx * wd * su - nx * 0.06, py = y + h * sv, pz = z + rz * wd * su - nz * 0.06;
        if (!w.inside(px, py, pz)) return false;
        // and nothing right in front of it
        if (w.inside(px + nx * 0.14, py, pz + nz * 0.14)) return false;
      }
      return true;
    };
    const faces = [
      ['x', 6.125, 0.3, 23.7, 1], ['x', 8.875, 0.3, 23.7, -1], ['x', 5.875, 0.3, 23.7, -1], ['x', 9.125, 0.3, 23.7, 1],
      ['x', 0.125, 0.3, 23.7, 1], ['x', 15.875, 0.3, 23.7, -1],
      ['z', 0.125, 0.3, 15.7, 1], ['z', 23.875, 0.3, 15.7, -1], ['z', 7.875, 0.3, 15.7, -1], ['z', 8.125, 0.3, 15.7, 1],
      ['z', 15.875, 0.3, 5.7, -1], ['z', 16.125, 0.3, 5.7, 1], ['z', 13.875, 9.3, 15.7, -1], ['z', 14.125, 9.3, 15.7, 1],
    ];
    let placed = 0;
    for (let i = 0; i < 900 && placed < 110; i++) {
      const f = faces[Math.floor(r() * faces.length)];
      const base = r() < 0.5 ? 0 : F1;
      const a = f[2] + r() * (f[3] - f[2]);
      const kind = r();
      let tex, wd, h, y;
      if (kind < 0.3) { tex = T.tags[Math.floor(r() * 3)]; wd = 0.9 + r() * 0.9; h = wd; y = base + 0.9 + r() * 0.9; }
      else if (kind < 0.65) { tex = T.stains[2 + Math.floor(r() * 2)]; wd = 0.5 + r() * 0.9; h = 1.2 + r() * 1.6; y = base + 3.15 - h / 2; }
      else { tex = T.stains[Math.floor(r() * 2)]; wd = 0.8 + r() * 1.6; h = wd * (0.6 + r() * 0.6); y = base + 0.4 + r() * 2.2; }
      const [x, z, nx, nz] = f[0] === 'x' ? [a, f[1], 0, f[4]] : [f[1], a, f[4], 0];
      if (!backed(x, y, z, nx, nz, wd, h)) continue;
      this.decal(tex, x, y, z, nx, nz, wd, h);
      placed++;
    }
    // floor grime
    placed = 0;
    for (let i = 0; i < 400 && placed < 70; i++) {
      const base = r() < 0.5 ? 0 : F1;
      const x = 0.8 + r() * 22.4, z = 0.8 + r() * 14.4, s = 0.8 + r() * 2.2;
      let ok = true;
      for (const [dx, dz] of [[0, 0], [-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5]]) {
        if (!w.inside(x + dx * s, base - 0.1, z + dz * s) || w.inside(x + dx * s, base + 0.1, z + dz * s)) ok = false;
      }
      if (!ok) continue;
      this.floorDecal(T.stains[Math.floor(r() * 2)], x, base, z, s, s);
      placed++;
    }
  }

  buildLights() {
    for (const o of this.openings) {
      if (!o.ext) continue;
      const n = o.ext, samples = [];
      for (const fa of [0.25, 0.75]) {
        for (const fy of [0.25, 0.75]) {
          const a = o.a + (o.b - o.a) * fa, y = o.y0 + (o.y1 - o.y0) * fy;
          samples.push(o.axis === 'x' ? [a, y, o.c] : [o.c, y, a]);
        }
      }
      this.lights.push({ n, samples, area: (o.b - o.a) * (o.y1 - o.y0), L: SKY });
    }
    for (const s of this.skylights) {
      const samples = [];
      for (const fx of [0.25, 0.75]) for (const fz of [0.25, 0.75]) samples.push([s[0] + (s[2] - s[0]) * fx, 6.85, s[1] + (s[3] - s[1]) * fz]);
      this.lights.push({ n: [0, -1, 0], samples, area: (s[2] - s[0]) * (s[3] - s[1]), L: SKY.map((v) => v * 1.25) });
    }
    for (const l of this.lights) {
      l.cx = l.samples.reduce((a, s) => a + s[0], 0) / 4;
      l.cy = l.samples.reduce((a, s) => a + s[1], 0) / 4;
      l.cz = l.samples.reduce((a, s) => a + s[2], 0) / 4;
    }

    const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.94, 0.84), SUN_INTENSITY);
    sun.position.set(12, 3.5, 8).addScaledVector(SUN_DIR, -45);
    sun.target.position.set(12, 3.5, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const c = sun.shadow.camera;
    c.left = -24; c.right = 24; c.top = 24; c.bottom = -24; c.near = 5; c.far = 95;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    // probes for everything that moves
    this.PX = 12; this.PZ = 8; this.PY = [1.2, 2.6, 4.7, 6.1];
    this.probes = new Float32Array(this.PX * this.PZ * 4 * 3);
  }

  // Sky light arriving at a point through every opening. hasN = false gives an omnidirectional estimate.
  irradiance(px, py, pz, nx, ny, nz, hasN, out) {
    let r = 0, g = 0, b = 0;
    const w = this.world;
    for (const l of this.lights) {
      const cx = l.cx - px, cy = l.cy - py, cz = l.cz - pz;
      const cd2 = cx * cx + cy * cy + cz * cz;
      if (cd2 > 330) continue;
      if (hasN && cx * nx + cy * ny + cz * nz < -0.6) continue;
      const a = l.area / 4;
      let e = 0;
      for (const s of l.samples) {
        const dx = s[0] - px, dy = s[1] - py, dz = s[2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2);
        const ux = dx / d, uy = dy / d, uz = dz / d;
        const cs = hasN ? ux * nx + uy * ny + uz * nz : 0.4;
        if (cs <= 0.01) continue;
        const cw = -(ux * l.n[0] + uy * l.n[1] + uz * l.n[2]);
        if (cw <= 0.01) continue;
        if (w.blocked(px, py, pz, ux, uy, uz, d - 0.02, 'occ')) continue;
        e += (cs * cw * a) / (d2 + a);
      }
      e /= Math.PI;
      r += e * l.L[0]; g += e * l.L[1]; b += e * l.L[2];
    }
    out[0] = r; out[1] = g; out[2] = b;
  }

  sampleProbe(x, y, z, out) {
    const PX = this.PX, PZ = this.PZ, P = this.probes, Y = this.PY;
    let fx = Math.min(PX - 1.001, Math.max(0, (x - 1) / 2)), fz = Math.min(PZ - 1.001, Math.max(0, (z - 1) / 2));
    const i = Math.floor(fx), k = Math.floor(fz);
    fx -= i; fz -= k;
    let j = 0, fy = 0;
    if (y <= Y[0]) { j = 0; fy = 0; }
    else if (y >= Y[3]) { j = 2; fy = 1; }
    else { while (y > Y[j + 1]) j++; fy = (y - Y[j]) / (Y[j + 1] - Y[j]); }
    let r = 0, g = 0, b = 0;
    for (let c = 0; c < 8; c++) {
      const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1;
      const wgt = (di ? fx : 1 - fx) * (dj ? fy : 1 - fy) * (dk ? fz : 1 - fz);
      const o = (((j + dj) * PZ + (k + dk)) * PX + (i + di)) * 3;
      r += P[o] * wgt; g += P[o + 1] * wgt; b += P[o + 2] * wgt;
    }
    out[0] = r; out[1] = g; out[2] = b;
  }

  // Ambient colour for a moving object.
  ambientAt(x, y, z, color) {
    const t = this._t || (this._t = [0, 0, 0]);
    this.sampleProbe(x, y, z, t);
    color.setRGB(t[0] * 1.15 + 0.012, t[1] * 1.15 + 0.013, t[2] * 1.15 + 0.016);
  }

  // Ambient colour plus the direction most of it comes from, written to a list of materials.
  lightFor(x, y, z, mats) {
    const t = this._t || (this._t = [0, 0, 0]);
    const lum = (px, pz) => { this.sampleProbe(px, y, pz, t); return t[0] * 0.3 + t[1] * 0.6 + t[2] * 0.1; };
    const gx = lum(x + 1.5, z) - lum(x - 1.5, z), gz = lum(x, z + 1.5) - lum(x, z - 1.5);
    const c = mats[0].userData.amb.value, d = mats[0].userData.ambDir.value;
    this.ambientAt(x, y, z, c);
    const here = c.r * 0.3 + c.g * 0.6 + c.b * 0.1 + 1e-4, gl = Math.hypot(gx, gz);
    const s = gl > 1e-5 ? Math.min(1, gl / here) / gl : 0;
    d.set(gx * s, 0.55, gz * s).normalize();
    for (let i = 1; i < mats.length; i++) { mats[i].userData.amb.value.copy(c); mats[i].userData.ambDir.value.copy(d); }
  }

  // Generator so the page can show progress while the lighting is computed.
  *bake() {
    const w = this.world, t = [0, 0, 0];
    const PX = this.PX, PZ = this.PZ, P = this.probes;
    let n = 0;
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < PZ; k++) {
        for (let i = 0; i < PX; i++) {
          const x = 1 + i * 2, y = this.PY[j], z = 1 + k * 2, o = ((j * PZ + k) * PX + i) * 3;
          this.irradiance(x, y, z, 0, 0, 0, false, t);
          const sunVis = w.blocked(x, y, z, -SUN_DIR.x, -SUN_DIR.y, -SUN_DIR.z, 80, 'occ') ? 0 : 1;
          P[o] = t[0] + sunVis * 0.5; P[o + 1] = t[1] + sunVis * 0.46; P[o + 2] = t[2] + sunVis * 0.38;
          if (++n % 24 === 0) yield 0.08 * (n / (PX * PZ * 4));
        }
      }
    }
    // soften the probe field within each layer so bounce light spreads
    const tmp = new Float32Array(P.length);
    for (let j = 0; j < 4; j++) for (let k = 0; k < PZ; k++) for (let i = 0; i < PX; i++) {
      const o = ((j * PZ + k) * PX + i) * 3;
      let r = P[o] * 2, g = P[o + 1] * 2, b = P[o + 2] * 2, ws = 2;
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, kk = k + dk;
        if (ii < 0 || kk < 0 || ii >= PX || kk >= PZ) continue;
        const x0 = 1 + i * 2, z0 = 1 + k * 2, y0 = this.PY[j];
        if (w.blocked(x0, y0, z0, di, 0, dk, 2, 'occ')) continue;
        const q = ((j * PZ + kk) * PX + ii) * 3;
        r += P[q]; g += P[q + 1]; b += P[q + 2]; ws++;
      }
      tmp[o] = r / ws; tmp[o + 1] = g / ws; tmp[o + 2] = b / ws;
    }
    P.set(tmp);

    const all = [...Object.values(this.bufs), ...this.decalBufs.values()];
    const total = all.reduce((a, b) => a + b.count, 0);
    let done = 0;
    const BOUNCE = 0.5;
    for (const buf of all) {
      const col = (buf.col = new Float32Array(buf.count * 3));
      const valid = new Uint8Array(buf.count);
      for (const f of buf.faces) {
        const { start, nu, nv, o, eu, ev, lu, lv, n: N } = f;
        const iu = Math.min(0.06, lu * 0.25), iv = Math.min(0.06, lv * 0.25);
        for (let j = 0; j <= nv; j++) {
          for (let i = 0; i <= nu; i++) {
            const idx = start + j * (nu + 1) + i;
            let a = (lu * i) / nu, b = (lv * j) / nv;
            if (i === 0) a += iu; else if (i === nu) a -= iu;
            if (j === 0) b += iv; else if (j === nv) b -= iv;
            const x = o[0] + eu[0] * a + ev[0] * b + N[0] * 0.04;
            const y = o[1] + eu[1] * a + ev[1] * b + N[1] * 0.04;
            const z = o[2] + eu[2] * a + ev[2] * b + N[2] * 0.04;
            if (w.inside(x, y, z)) continue;
            this.irradiance(x, y, z, N[0], N[1], N[2], true, t);
            let r = t[0], g = t[1], bl = t[2];
            this.sampleProbe(x + N[0] * 0.7, y + N[1] * 0.7, z + N[2] * 0.7, t);
            col[idx * 3] = r + t[0] * BOUNCE + 0.010;
            col[idx * 3 + 1] = g + t[1] * BOUNCE + 0.011;
            col[idx * 3 + 2] = bl + t[2] * BOUNCE + 0.013;
            valid[idx] = 1;
          }
        }
        // vertices buried in other geometry borrow from their neighbours
        for (let pass = 0; pass < 3; pass++) {
          for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
            const idx = start + j * (nu + 1) + i;
            if (valid[idx]) continue;
            let r = 0, g = 0, b = 0, c = 0;
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const ii = i + di, jj = j + dj;
              if (ii < 0 || jj < 0 || ii > nu || jj > nv) continue;
              const q = start + jj * (nu + 1) + ii;
              if (valid[q] !== 1) continue;
              r += col[q * 3]; g += col[q * 3 + 1]; b += col[q * 3 + 2]; c++;
            }
            if (c) { col[idx * 3] = r / c; col[idx * 3 + 1] = g / c; col[idx * 3 + 2] = b / c; valid[idx] = 2; }
          }
          for (let q = start; q < start + (nu + 1) * (nv + 1); q++) if (valid[q] === 2) valid[q] = 1;
        }
        done += (nu + 1) * (nv + 1);
        yield 0.08 + 0.9 * (done / total);
      }
    }
    this.finish();
    yield 1;
  }

  finish() {
    const T = this.tex;
    const mats = {
      wall: litMaterial({ map: T.wall.map, normalMap: T.wall.normalMap, roughness: 0.93, metalness: 0 }, 'baked'),
      floor: litMaterial({ map: T.floor.map, normalMap: T.floor.normalMap, roughness: 0.9, metalness: 0 }, 'baked'),
      ceil: litMaterial({ map: T.ceil.map, normalMap: T.ceil.normalMap, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.95, metalness: 0 }, 'baked'),
      concrete: litMaterial({ map: T.concrete.map, normalMap: T.concrete.normalMap, roughness: 0.9, metalness: 0 }, 'baked'),
      wood: litMaterial({ map: T.wood.map, normalMap: T.wood.normalMap, roughness: 0.85, metalness: 0 }, 'baked'),
      metal: litMaterial({ map: T.metal.map, normalMap: T.metal.normalMap, color: T.photo ? 0x8f9294 : 0xffffff, roughness: 0.7, metalness: T.photo ? 0.15 : 0.5 }, 'baked'),
    };
    for (const [k, buf] of Object.entries(this.bufs)) {
      if (!buf.count) continue;
      const m = new THREE.Mesh(buf.geometry(), mats[k]);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }
    for (const [tex, buf] of this.decalBufs) {
      const mat = litMaterial({ map: tex, transparent: true, opacity: T.stains.includes(tex) ? 0.5 : 1, depthWrite: false, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, 'baked');
      const m = new THREE.Mesh(buf.geometry(), mat);
      m.receiveShadow = true; m.renderOrder = 1;
      this.group.add(m);
    }
    // rubble
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const im = new THREE.InstancedMesh(geo, litMaterial({ map: T.concrete.map, color: 0x9a968e, roughness: 1, metalness: 0 }, 'inst'), this.debris.length);
    const d = new THREE.Object3D(), c = new THREE.Color(), t = [0, 0, 0];
    this.debris.forEach((e, i) => {
      d.position.set(e.x, e.y, e.z);
      d.rotation.set(e.rx, e.ry, 0);
      d.scale.set(e.s, e.s * e.sy, e.s * (0.7 + e.sy * 0.5));
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
      this.irradiance(e.x, e.y + 0.05, e.z, 0, 1, 0, true, t);
      const r = t[0], g = t[1], b = t[2];
      this.sampleProbe(e.x, e.y + 0.6, e.z, t);
      im.setColorAt(i, c.setRGB(r + t[0] * 0.5 + 0.01, g + t[1] * 0.5 + 0.011, b + t[2] * 0.5 + 0.013));
    });
    im.castShadow = true; im.receiveShadow = true;
    this.group.add(im);
  }

  // ---------- navigation ----------

  buildNav() {
    this.nodeNames = Object.keys(NODES);
    this.nodes = this.nodeNames.map((k) => ({ name: k, p: new THREE.Vector3(...NODES[k]), links: [] }));
    const ix = Object.fromEntries(this.nodeNames.map((k, i) => [k, i]));
    this.nodeIndex = ix;
    for (const [a, b] of EDGES) { this.nodes[ix[a]].links.push(ix[b]); this.nodes[ix[b]].links.push(ix[a]); }
  }

  nearestNode(p) {
    let best = -1, bd = 1e9;
    const w = this.world;
    for (let pass = 0; pass < 2 && best < 0; pass++) {
      for (let i = 0; i < this.nodes.length; i++) {
        const q = this.nodes[i].p;
        if (Math.abs(q.y - p.y) > 1.3) continue;
        const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
        if (d >= bd) continue;
        if (pass === 0 && d > 0.05 && w.blocked(p.x, p.y + 0.9, p.z, dx / d, (q.y - p.y) / d, dz / d, d, 'ray')) continue;
        bd = d; best = i;
      }
    }
    return best;
  }

  // Waypoints from one position to another along the graph.
  path(from, to) {
    const a = this.nearestNode(from), b = this.nearestNode(to);
    if (a < 0 || b < 0) return [];
    const N = this.nodes.length, dist = new Float32Array(N).fill(1e9), prev = new Int16Array(N).fill(-1), seen = new Uint8Array(N);
    dist[a] = 0;
    for (;;) {
      let u = -1, ud = 1e9;
      for (let i = 0; i < N; i++) if (!seen[i] && dist[i] < ud) { ud = dist[i]; u = i; }
      if (u < 0 || u === b) break;
      seen[u] = 1;
      for (const v of this.nodes[u].links) {
        const nd = ud + this.nodes[u].p.distanceTo(this.nodes[v].p);
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; }
      }
    }
    const out = [];
    for (let u = b; u >= 0; u = prev[u]) out.unshift(this.nodes[u].p.clone());
    // finish at the exact spot when it is in plain view of the last node
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - to.y) < 0.6) {
      const dx = to.x - last.x, dz = to.z - last.z, d = Math.hypot(dx, dz);
      if (d > 0.4 && !this.world.blocked(last.x, last.y + 0.9, last.z, dx / d, 0, dz / d, d, 'ray')) out.push(new THREE.Vector3(to.x, last.y, to.z));
    }
    return out;
  }

  // ---------- outside, light shafts, dust ----------

  buildExterior() {
    const sky = new THREE.Color().setRGB(SKY[0], SKY[1], SKY[2]);
    const back = new THREE.Mesh(
      new THREE.CylinderGeometry(70, 70, 60, 48, 1, true),
      new THREE.MeshBasicMaterial({ map: this.tex.backdrop, color: sky, side: THREE.BackSide, fog: false })
    );
    this.tex.backdrop.repeat.set(2, 1);
    back.position.set(12, 20, 8);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(70, 32), new THREE.MeshBasicMaterial({ color: sky.clone().multiplyScalar(1.15), fog: false }));
    cap.rotation.x = Math.PI / 2; cap.position.set(12, 50, 8);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.5, 1.45, 1.1), fog: false }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(12, -0.06, 8);
    this.scene.add(back, cap, ground);

    // bare trees close to the windows, dark against the sky
    const P = [], I = [], r = rng(808);
    const cyl = (a, b, r0, r1) => {
      const d = b.clone().sub(a).normalize();
      const u = new THREE.Vector3(1, 0, 0).cross(d);
      if (u.lengthSq() < 0.01) u.set(0, 0, 1).cross(d);
      u.normalize();
      const v = d.clone().cross(u);
      const s = P.length / 3;
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2, cx = Math.cos(ang), sn = Math.sin(ang);
        P.push(a.x + (u.x * cx + v.x * sn) * r0, a.y + (u.y * cx + v.y * sn) * r0, a.z + (u.z * cx + v.z * sn) * r0);
        P.push(b.x + (u.x * cx + v.x * sn) * r1, b.y + (u.y * cx + v.y * sn) * r1, b.z + (u.z * cx + v.z * sn) * r1);
      }
      for (let i = 0; i < 5; i++) {
        const a0 = s + i * 2, b0 = a0 + 1, a1 = s + ((i + 1) % 5) * 2, b1 = a1 + 1;
        I.push(a0, a1, b0, a1, b1, b0);
      }
    };
    const branch = (a, dir, len, rad, depth) => {
      const b = a.clone().addScaledVector(dir, len);
      cyl(a, b, rad, rad * 0.68);
      if (depth <= 0) return;
      const n = 2 + (r() < 0.45 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const nd = dir.clone().add(new THREE.Vector3((r() - 0.5) * 1.5, (r() - 0.2) * 0.9, (r() - 0.5) * 1.5)).normalize();
        branch(b, nd, len * (0.62 + r() * 0.2), rad * 0.62, depth - 1);
      }
    };
    const spots = [[2, 21], [7, 19.5], [12, 22], [16.5, 19.8], [21, 21.5], [26, 18.5], [-4, 12], [-5.5, 6.5], [-3.5, 2], [28, 12.5], [29, 4],
      [3, -4], [9, -5.5], [14, -3.8], [21, -5], [-6, 16], [27.5, 1.5], [11, 27], [19, 26]];
    for (const [x, z] of spots) {
      branch(new THREE.Vector3(x + (r() - 0.5), -0.1, z + (r() - 0.5)), new THREE.Vector3((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2).normalize(), 2.6 + r() * 1.6, 0.07 + r() * 0.05, 5);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    tg.setIndex(I);
    const trees = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.07, 0.068, 0.066), fog: false, side: THREE.DoubleSide }));
    trees.castShadow = true;
    this.scene.add(trees);

    // light shafts where the sun comes straight in, with dust hanging in them
    const sp = [], sc = [], si = [], motes = [];
    const shaft = (corners, floorY) => {
      const top = Math.max(...corners.map((c) => c[1]));
      const len = Math.min(9, (top - floorY) / -SUN_DIR.y);
      const s = sp.length / 3;
      for (const c of corners) {
        sp.push(c[0], c[1], c[2]); sc.push(0.045, 0.045, 0.043);
        sp.push(c[0] + SUN_DIR.x * len, c[1] + SUN_DIR.y * len, c[2] + SUN_DIR.z * len); sc.push(0, 0, 0);
      }
      for (let i = 0; i < 4; i++) {
        const a0 = s + i * 2, b0 = a0 + 1, a1 = s + ((i + 1) % 4) * 2, b1 = a1 + 1;
        si.push(a0, a1, b0, a1, b1, b0);
      }
      for (let i = 0; i < 70; i++) {
        const u = r(), v = r(), t = r() * len * 0.95;
        const x = corners[0][0] + (corners[1][0] - corners[0][0]) * u + (corners[3][0] - corners[0][0]) * v;
        const y = corners[0][1] + (corners[1][1] - corners[0][1]) * u + (corners[3][1] - corners[0][1]) * v;
        const z = corners[0][2] + (corners[1][2] - corners[0][2]) * u + (corners[3][2] - corners[0][2]) * v;
        const py = y + SUN_DIR.y * t;
        if (py > floorY + 0.05) motes.push(x + SUN_DIR.x * t, py, z + SUN_DIR.z * t);
      }
    };
    for (const o of this.openings) {
      if (!o.ext || o.boards) continue;
      if (o.ext[0] * SUN_DIR.x + o.ext[2] * SUN_DIR.z < 0.2) continue;
      const c = o.axis === 'x'
        ? [[o.a, o.y0, o.c], [o.b, o.y0, o.c], [o.b, o.y1, o.c], [o.a, o.y1, o.c]]
        : [[o.c, o.y0, o.a], [o.c, o.y0, o.b], [o.c, o.y1, o.b], [o.c, o.y1, o.a]];
      shaft(c, o.y0 > F1 ? F1 : 0);
    }
    for (const s of this.skylights) shaft([[s[0], 6.7, s[1]], [s[2], 6.7, s[1]], [s[2], 6.7, s[3]], [s[0], 6.7, s[3]]], F1);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    sg.setIndex(si);
    const shafts = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, transparent: true }));
    shafts.renderOrder = 3;
    this.scene.add(shafts);

    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute(motes, 3));
    this.motes = new THREE.Points(mg, new THREE.PointsMaterial({ color: new THREE.Color().setRGB(3, 2.9, 2.5), size: 0.014, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.motes.renderOrder = 4;
    this.scene.add(this.motes);
  }

  update(time) {
    this.motes.position.set(Math.sin(time * 0.13) * 0.06, Math.sin(time * 0.21) * 0.05, Math.cos(time * 0.17) * 0.06);
  }
}
