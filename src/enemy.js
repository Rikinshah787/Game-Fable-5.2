// Hostiles. One particle skeleton drives everything: while alive the particles follow a
// procedural pose (plus a springy flinch when hit); on death the same particles become a
// Verlet ragdoll that keeps reacting to every further bullet.
import * as THREE from 'three';
import { raySegment } from './physics.js';
import { litMaterial } from './level.js';
import { Rig, soldierReady } from './soldier.js';

const HEAD = 0, NECK = 1, LSH = 2, RSH = 3, LHIP = 4, RHIP = 5, STERN = 6, LELB = 7, RELB = 8, LHAND = 9, RHAND = 10,
  LKNEE = 11, RKNEE = 12, LFOOT = 13, RFOOT = 14, NP = 15;
const RAD = [0.105, 0.07, 0.085, 0.085, 0.1, 0.1, 0.11, 0.05, 0.05, 0.045, 0.045, 0.06, 0.06, 0.08, 0.08];
const INVM = [0.9, 0.7, 0.6, 0.6, 0.5, 0.5, 0.45, 1.1, 1.1, 1.4, 1.4, 0.9, 0.9, 1.2, 1.2];
const UPPER = 0.25, FORE = 0.25, THIGH = 0.44, SHIN = 0.44;
const H = 1 / 120;
const TORSO = [NECK, LSH, RSH, LHIP, RHIP, STERN];

const PARTS = [
  { a: HEAD, b: HEAD, r: 0.125, dmg: 200 },
  { a: NECK, b: -1, r: 0.185, dmg: 55 },
  { a: LSH, b: LELB, r: 0.06, dmg: 26, p: LELB }, { a: LELB, b: LHAND, r: 0.05, dmg: 22, p: LHAND },
  { a: RSH, b: RELB, r: 0.06, dmg: 26, p: RELB }, { a: RELB, b: RHAND, r: 0.05, dmg: 22, p: RHAND },
  { a: LHIP, b: LKNEE, r: 0.085, dmg: 34, p: LKNEE }, { a: LKNEE, b: LFOOT, r: 0.065, dmg: 28, p: LFOOT },
  { a: RHIP, b: RKNEE, r: 0.085, dmg: 34, p: RKNEE }, { a: RKNEE, b: RFOOT, r: 0.065, dmg: 28, p: RFOOT },
];
const NEIGH = {
  [HEAD]: [NECK, LSH, RSH], [NECK]: [HEAD, LSH, RSH, STERN], [LSH]: [NECK, STERN, LELB], [RSH]: [NECK, STERN, RELB],
  [LHIP]: [RHIP, STERN, LKNEE], [RHIP]: [LHIP, STERN, RKNEE], [STERN]: [LSH, RSH, LHIP, RHIP, NECK],
  [LELB]: [LSH, LHAND], [RELB]: [RSH, RHAND], [LHAND]: [LELB], [RHAND]: [RELB],
  [LKNEE]: [LHIP, LFOOT], [RKNEE]: [RHIP, RFOOT], [LFOOT]: [LKNEE], [RFOOT]: [RKNEE],
};
const MINS = [
  [LSH, LHAND, 0.18], [RSH, RHAND, 0.18], [LHIP, LFOOT, 0.34], [RHIP, RFOOT, 0.34], [LKNEE, RKNEE, 0.15], [LFOOT, RFOOT, 0.15],
  [LHAND, STERN, 0.14], [RHAND, STERN, 0.14], [LELB, STERN, 0.16], [RELB, STERN, 0.16], [LKNEE, STERN, 0.26], [RKNEE, STERN, 0.26],
  [LFOOT, RHIP, 0.28], [RFOOT, LHIP, 0.28], [HEAD, LHAND, 0.15], [HEAD, RHAND, 0.15], [HEAD, LKNEE, 0.22], [HEAD, RKNEE, 0.22],
  [LHAND, RHAND, 0.07], [LFOOT, STERN, 0.4], [RFOOT, STERN, 0.4],
];
const MIDS = [
  [LHIP, LKNEE, 0.07], [LKNEE, LFOOT, 0.055], [RHIP, RKNEE, 0.07], [RKNEE, RFOOT, 0.055],
  [LSH, LELB, 0.05], [LELB, LHAND, 0.045], [RSH, RELB, 0.05], [RELB, RHAND, 0.045], [NECK, LHIP, 0.09], [NECK, RHIP, 0.09],
];
const TENSE = [[LHIP, LFOOT], [RHIP, RFOOT], [LHIP, RFOOT], [RHIP, LFOOT], [STERN, LFOOT], [STERN, RFOOT], [LSH, LHAND], [RSH, RHAND], [STERN, LKNEE], [STERN, RKNEE]];

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

function ik(a, c, l1, l2, px, py, pz, j) {
  let dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z, d = Math.hypot(dx, dy, dz) || 1e-6;
  dx /= d; dy /= d; dz /= d;
  const maxd = (l1 + l2) * 0.995, mind = Math.abs(l1 - l2) + 0.02;
  if (d > maxd || d < mind) { d = clamp(d, mind, maxd); c.set(a.x + dx * d, a.y + dy * d, a.z + dz * d); }
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const dp = px * dx + py * dy + pz * dz;
  const qx = px - dx * dp, qy = py - dy * dp, qz = pz - dz * dp, ql = Math.hypot(qx, qy, qz) || 1e-6;
  j.set(a.x + dx * x + (qx / ql) * h, a.y + dy * x + (qy / ql) * h, a.z + dz * x + (qz / ql) * h);
}

// Writes the 15 joint positions for a standing/walking/aiming figure.
function pose(e, out) {
  const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw);
  const fx = -sy, fz = -cy, rx = cy, rz = -sy;
  const lean = 0.08 + e.aim * 0.1 + e.stoop;
  const hipY = e.pos.y + 0.965 - e.stoop * 0.5 + Math.abs(Math.sin(e.walk)) * 0.025 * e.moving;
  const hx = e.pos.x, hz = e.pos.z;
  const sl = Math.sin(lean), cl = Math.cos(lean);
  const sx = fx * sl, s_y = cl, sz = fz * sl;       // spine
  const cx = fx * cl, c_y = -sl, cz = fz * cl;      // chest normal
  out[LHIP].set(hx - rx * 0.1, hipY, hz - rz * 0.1);
  out[RHIP].set(hx + rx * 0.1, hipY, hz + rz * 0.1);
  const nx = hx + sx * 0.56, ny = hipY + s_y * 0.56, nz = hz + sz * 0.56;
  out[NECK].set(nx, ny, nz);
  out[LSH].set(nx - sx * 0.05 - rx * 0.19, ny - s_y * 0.05, nz - sz * 0.05 - rz * 0.19);
  out[RSH].set(nx - sx * 0.05 + rx * 0.19, ny - s_y * 0.05, nz - sz * 0.05 + rz * 0.19);
  out[STERN].set(hx + sx * 0.32 + cx * 0.12, hipY + s_y * 0.32 + c_y * 0.12, hz + sz * 0.32 + cz * 0.12);
  out[HEAD].set(nx + sx * 0.15 + cx * 0.03, ny + s_y * 0.15 + c_y * 0.03, nz + sz * 0.15 + cz * 0.03);

  const stride = 0.3 * e.moving, lf = Math.sin(e.walk) * stride;
  const ll = Math.max(0, Math.cos(e.walk)) * 0.09 * e.moving, rl = Math.max(0, -Math.cos(e.walk)) * 0.09 * e.moving;
  out[LFOOT].set(hx - rx * 0.12 + fx * (lf + 0.07), e.pos.y + 0.12 + ll, hz - rz * 0.12 + fz * (lf + 0.07));
  out[RFOOT].set(hx + rx * 0.12 + fx * (-lf - 0.08), e.pos.y + 0.12 + rl, hz + rz * 0.12 + fz * (-lf - 0.08));
  ik(out[LHIP], out[LFOOT], THIGH, SHIN, fx, 0.15, fz, out[LKNEE]);
  ik(out[RHIP], out[RFOOT], THIGH, SHIN, fx, 0.15, fz, out[RKNEE]);

  // rifle: low ready when relaxed, shouldered when aiming
  const pitch = lerp(-0.85, e.aimPitch, e.aim), gy = e.yaw + lerp(0.45, 0, e.aim), cp = Math.cos(pitch);
  const gx = -Math.sin(gy) * cp, g_y = Math.sin(pitch), gz = -Math.cos(gy) * cp;
  e.gdir.set(gx, g_y, gz);
  const drop = lerp(0.3, 0.1, e.aim), R = out[RSH];
  out[RHAND].set(R.x + gx * 0.26 - rx * 0.12, R.y + g_y * 0.26 - drop, R.z + gz * 0.26 - rz * 0.12);
  out[LHAND].set(out[RHAND].x + gx * 0.22, out[RHAND].y + g_y * 0.22 + 0.03, out[RHAND].z + gz * 0.22);
  ik(out[RSH], out[RHAND], UPPER, FORE, rx * 0.6 - fx * 0.3, -1, rz * 0.6 - fz * 0.3, out[RELB]);
  ik(out[LSH], out[LHAND], UPPER, FORE, -rx * 0.5, -1, -rz * 0.5, out[LELB]);
}

// rest lengths
const REST = (() => {
  const e = { yaw: 0, pos: new THREE.Vector3(), aim: 0, stoop: 0, walk: 0, moving: 0, aimPitch: 0, gdir: new THREE.Vector3() };
  const P = Array.from({ length: NP }, () => new THREE.Vector3());
  pose(e, P);
  const d = (i, j) => P[i].distanceTo(P[j]);
  const rigid = [[NECK, LSH], [NECK, RSH], [LSH, RSH], [LSH, LHIP], [RSH, RHIP], [LSH, RHIP], [RSH, LHIP], [LHIP, RHIP], [NECK, LHIP], [NECK, RHIP],
    [STERN, LSH], [STERN, RSH], [STERN, LHIP], [STERN, RHIP], [STERN, NECK]];
  const sticks = rigid.map(([i, j]) => [i, j, d(i, j), 1]);
  sticks.push([HEAD, NECK, d(HEAD, NECK), 1], [HEAD, LSH, d(HEAD, LSH), 0.5], [HEAD, RSH, d(HEAD, RSH), 0.5], [HEAD, STERN, d(HEAD, STERN), 0.5]);
  sticks.push([LSH, LELB, UPPER, 1], [LELB, LHAND, FORE, 1], [RSH, RELB, UPPER, 1], [RELB, RHAND, FORE, 1],
    [LHIP, LKNEE, THIGH, 1], [LKNEE, LFOOT, SHIN, 1], [RHIP, RKNEE, THIGH, 1], [RKNEE, RFOOT, SHIN, 1]);
  return sticks;
})();

let GEO = null;
function geos() {
  if (GEO) return GEO;
  GEO = {
    torso: new THREE.CapsuleGeometry(0.15, 0.32, 4, 10),
    vest: new THREE.BoxGeometry(0.34, 0.36, 0.17),
    head: new THREE.SphereGeometry(0.1, 12, 10),
    helmet: new THREE.SphereGeometry(0.114, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56),
    upper: new THREE.CapsuleGeometry(0.052, UPPER - 0.04, 3, 8),
    fore: new THREE.CapsuleGeometry(0.043, FORE - 0.04, 3, 8),
    thigh: new THREE.CapsuleGeometry(0.078, THIGH - 0.06, 3, 8),
    shin: new THREE.CapsuleGeometry(0.056, SHIN - 0.04, 3, 8),
    hand: new THREE.SphereGeometry(0.046, 8, 6),
    boot: new THREE.BoxGeometry(0.095, 0.09, 0.25).translate(0, -0.015, -0.055),
    gunBody: new THREE.BoxGeometry(0.04, 0.075, 0.5).translate(0, 0, 0.12),
    gunBarrel: new THREE.CylinderGeometry(0.011, 0.011, 0.34, 6).rotateX(Math.PI / 2).translate(0, 0.012, 0.52),
    gunMag: new THREE.BoxGeometry(0.03, 0.17, 0.06).translate(0, -0.11, 0.14),
    gunStock: new THREE.BoxGeometry(0.035, 0.09, 0.22).translate(0, -0.02, -0.22),
  };
  return GEO;
}

const JACKETS = [0x3b4233, 0x33363c, 0x4a3f30, 0x283240, 0x4f4a3c, 0x2e352f];
const PANTS = [0x2e3136, 0x3b3a30, 0x4d4a3f, 0x26282c];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1);
const _hit = { t: 0, box: null, nx: 0, ny: 0, nz: 0 }, _rs = { t: 0, s: 0 };

export class Enemy {
  constructor(scene, level, spawn, index) {
    this.level = level; this.world = level.world; this.index = index;
    this.pos = new THREE.Vector3(...spawn.p);
    this.yaw = spawn.yaw; this.baseYaw = spawn.yaw; this.yawTarget = spawn.yaw;
    this.aim = 0; this.aimPitch = 0; this.stoop = 0; this.walk = Math.random() * 6; this.moving = 0;
    this.gdir = new THREE.Vector3(0, 0, -1);
    this.hp = 100; this.dead = false; this.asleep = false;
    this.state = 'idle'; this.react = 0; this.lostT = 0; this.searchT = 0; this.staggerT = 0;
    this.sees = false; this.senseT = Math.random() * 0.1;
    this.burst = 3; this.shotCd = 0; this.pause = 0; this.shots = 0; this.hearCd = 0;
    this.lastKnown = new THREE.Vector3();
    this.path = null; this.pi = 0; this.segStart = new THREE.Vector3();
    this.patrol = spawn.patrol ? spawn.patrol.map((n) => level.nodes[level.nodeIndex[n]].p) : null;
    this.patrolI = 0; this.waitT = Math.random() * 2;
    this.phase = Math.random() * 10;

    const mk = () => Array.from({ length: NP }, () => new THREE.Vector3());
    this.P = mk(); this.prev = mk(); this.base = mk(); this.last = mk(); this.O = mk(); this.V = mk();
    this.tense = []; this.tenseT = 0; this.tenseDur = 1; this.thudded = false; this.sleepC = 0; this.pooled = false;
    this.gp = [new THREE.Vector3(), new THREE.Vector3()]; this.gprev = [new THREE.Vector3(), new THREE.Vector3()];
    this.gunLoose = false; this.gunSleep = 0;
    this.ambT = Math.random() * 0.3;

    // meshes
    const G = geos(), r = Math.random;
    this.mats = {
      jacket: litMaterial({ color: JACKETS[Math.floor(r() * JACKETS.length)], roughness: 0.92, metalness: 0 }),
      pants: litMaterial({ color: PANTS[Math.floor(r() * PANTS.length)], roughness: 0.9, metalness: 0 }),
      gear: litMaterial({ color: 0x1a1b1d, roughness: 0.7, metalness: 0.15 }),
      head: litMaterial({ color: r() < 0.5 ? 0x1d1d20 : 0x2b2622, roughness: 0.95, metalness: 0 }),
    };
    this.matList = Object.values(this.mats);
    this.group = new THREE.Group();
    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; this.group.add(m); return m; };
    const M = (this.M = {});
    this.rig = soldierReady() ? new Rig(this.group) : null;
    if (this.rig) this.matList = [...this.rig.mats, this.mats.gear];
    if (!this.rig) {
    M.torso = add(G.torso, this.mats.jacket); M.torso.scale.set(1.28, 1, 0.84);
    M.vest = new THREE.Mesh(G.vest, this.mats.gear); M.vest.castShadow = true; M.vest.receiveShadow = true; M.vest.scale.set(1 / 1.28, 1, 1 / 0.84); M.torso.add(M.vest);
    M.head = add(G.head, this.mats.head); M.head.scale.set(0.95, 1.12, 1.04);
    if (r() < 0.6) { const h = new THREE.Mesh(G.helmet, this.mats.gear); h.position.y = 0.012; h.castShadow = true; h.receiveShadow = true; M.head.add(h); }
    M.lu = add(G.upper, this.mats.jacket); M.ru = add(G.upper, this.mats.jacket);
    M.lf = add(G.fore, this.mats.jacket); M.rf = add(G.fore, this.mats.jacket);
    M.lt = add(G.thigh, this.mats.pants); M.rt = add(G.thigh, this.mats.pants);
    M.ls = add(G.shin, this.mats.pants); M.rs = add(G.shin, this.mats.pants);
    M.lh = add(G.hand, this.mats.gear); M.rh = add(G.hand, this.mats.gear);
    M.lb = add(G.boot, this.mats.gear); M.rb = add(G.boot, this.mats.gear);
    }
    M.gun = new THREE.Group();
    for (const g of [G.gunBody, G.gunBarrel, G.gunMag, G.gunStock]) { const m = new THREE.Mesh(g, this.mats.gear); m.castShadow = true; m.receiveShadow = true; M.gun.add(m); }
    this.group.add(M.gun);
    scene.add(this.group);
    this.ghostMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.5, 0.42, 0.08), transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    if (this.rig) this.ghosts = this.rig.ghost(this.ghostMat);
    else {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.2, 4, 10), this.ghostMat);
      m.visible = false; m.renderOrder = 9; m.frustumCulled = false;
      this.group.add(m); this.ghosts = [m];
    }
    this.gDelay = 0; this.gT = 0; this.gDur = 1;

    pose(this, this.base);
    for (let i = 0; i < NP; i++) { this.P[i].copy(this.base[i]); this.last[i].copy(this.base[i]); this.prev[i].copy(this.base[i]); }
    this.sync();
  }

  // ---------- perception and behaviour ----------

  canSee(g) {
    const pl = g.player;
    if (pl.dead) return false;
    const eye = this.P[HEAD], t = pl.eye;
    const dx = t.x - eye.x, dy = t.y - eye.y, dz = t.z - eye.z, dist = Math.hypot(dx, dy, dz);
    if (dist > 34) return false;
    const dh = Math.hypot(dx, dz) || 1e-6;
    const facing = (-Math.sin(this.yaw) * dx - Math.cos(this.yaw) * dz) / dh;
    const cone = this.state === 'idle' ? 0.42 : -0.2;
    if (facing < cone && dist > 2.2) return false;
    return !this.world.blocked(eye.x, eye.y, eye.z, dx / dist, dy / dist, dz / dist, dist - 0.1, 'ray');
  }

  hear(p) {
    if (this.dead || this.hearCd > 0) return;
    if (this.state === 'idle' || this.state === 'hunt') {
      this.hearCd = 2.5;
      this.lastKnown.copy(p);
      this.state = 'hunt'; this.searchT = 0;
      this.setPath(p);
    }
  }

  setPath(target) {
    this.path = this.level.path(this.pos, target);
    this.pi = 0;
    this.segStart.copy(this.pos);
  }

  follow(dt, speed) {
    if (!this.path || this.pi >= this.path.length) { this.movingT = 0; return true; }
    const wp = this.path[this.pi];
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.12) { this.pos.y = wp.y; this.segStart.copy(wp); this.pi++; return this.pi >= this.path.length; }
    const step = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * step; this.pos.z += (dz / d) * step;
    const total = Math.hypot(wp.x - this.segStart.x, wp.z - this.segStart.z);
    const f = total > 0.001 ? clamp(1 - (d - step) / total, 0, 1) : 1;
    this.pos.y = lerp(this.segStart.y, wp.y, f);
    this.yawTarget = Math.atan2(-dx, -dz);
    this.walk += step * 5.2;
    this.movingT = 1;
    return false;
  }

  fire(g) {
    const pl = g.player, muzzle = _a.copy(this.P[RHAND]).addScaledVector(this.gdir, 0.55);
    g.fx.flash(muzzle);
    g.sfx.shot(muzzle);
    g.fx.muzzleSmoke(muzzle, this.gdir);
    const dist = muzzle.distanceTo(pl.eye);
    let chance = clamp(0.6 - dist * 0.022, 0.12, 0.58);
    if (pl.speed > 3) chance *= 0.6;
    if (pl.crouching) chance *= 0.75;
    if (this.shots < 2) chance *= 0.45;
    this.shots++;
    const target = _b.copy(pl.eye); target.y -= 0.25;
    if (Math.random() < chance) {
      g.fx.tracer(muzzle, target);
      pl.damage(13 + Math.random() * 10, _c.subVectors(target, muzzle).normalize());
    } else {
      const off = 0.25 + Math.random() * 0.7, ang = Math.random() * 6.28;
      target.x += Math.cos(ang) * off; target.y += Math.sin(ang) * off * 0.7; target.z += Math.sin(ang * 1.7) * off;
      const dir = _c.subVectors(target, muzzle).normalize();
      if (this.world.raycast(muzzle.x, muzzle.y, muzzle.z, dir.x, dir.y, dir.z, 60, _hit)) {
        const hp = _d.copy(muzzle).addScaledVector(dir, _hit.t);
        g.fx.impact(hp, { x: _hit.nx, y: _hit.ny, z: _hit.nz }, _hit.box.mat);
        g.fx.tracer(muzzle, hp);
        g.sfx.impact(hp);
      }
      if (off < 0.6) g.sfx.whiz(Math.cos(ang) > 0 ? 0.7 : -0.7);
    }
  }

  think(dt, g) {
    const pl = g.player;
    this.senseT -= dt; this.hearCd -= dt;
    if (this.senseT <= 0) { this.senseT = 0.07 + Math.random() * 0.05; this.sees = this.canSee(g); }
    this.movingT = 0;
    let aimT = 0, turn = 3;

    if (this.state === 'idle') {
      if (this.patrol) {
        aimT = 0.15;
        if (this.follow(dt, 1.05)) {
          this.waitT -= dt;
          this.yawTarget = this.yaw + Math.sin(g.time * 0.5 + this.phase) * 0.01;
          if (this.waitT <= 0) { this.waitT = 1.5 + Math.random() * 2.5; this.patrolI = (this.patrolI + 1) % this.patrol.length; this.setPath(this.patrol[this.patrolI]); }
        }
      } else {
        this.yawTarget = this.baseYaw + Math.sin(g.time * 0.35 + this.phase) * 0.55;
        turn = 0.8;
      }
      if (this.sees) { this.state = 'combat'; this.react = 0.45 + Math.random() * 0.45; this.lostT = 0; }
    } else if (this.state === 'combat') {
      aimT = 1; turn = 6;
      if (this.sees) {
        this.lostT = 0;
        this.lastKnown.copy(pl.feet);
        const dx = pl.eye.x - this.pos.x, dz = pl.eye.z - this.pos.z;
        this.yawTarget = Math.atan2(-dx, -dz);
        const sh = this.P[RSH];
        this.aimPitch = lerp(this.aimPitch, Math.atan2(pl.eye.y - 0.25 - sh.y, Math.hypot(dx, dz)), 1 - Math.exp(-dt * 8));
        this.react -= dt;
        if (this.react <= 0 && this.aim > 0.85 && Math.abs(wrap(this.yawTarget - this.yaw)) < 0.25) {
          if (this.pause > 0) this.pause -= dt;
          else {
            this.shotCd -= dt;
            if (this.shotCd <= 0) {
              this.fire(g);
              this.shotCd = 0.115;
              if (--this.burst <= 0) { this.burst = 2 + Math.floor(Math.random() * 3); this.pause = 0.5 + Math.random() * 0.9; }
            }
          }
        }
      } else {
        this.lostT += dt;
        if (this.lostT > 1.3) { this.state = 'hunt'; this.searchT = 0; this.setPath(this.lastKnown); }
      }
    } else if (this.state === 'hunt') {
      aimT = 0.55; turn = 5;
      if (this.sees) { this.state = 'combat'; this.react = 0.25 + Math.random() * 0.3; this.lostT = 0; }
      else if (this.follow(dt, 2.3)) {
        this.searchT += dt;
        this.yawTarget = this.yaw + Math.sin(this.searchT * 1.3 + this.phase) * 0.04;
        if (this.searchT > 5) { this.state = 'idle'; this.patrol = null; this.baseYaw = this.yaw; }
      }
    } else if (this.state === 'stagger') {
      aimT = 0.3;
      this.staggerT -= dt;
      if (this.staggerT <= 0) { this.state = 'combat'; this.react = 0.2 + Math.random() * 0.25; this.lostT = 0; }
    }

    const dy = wrap(this.yawTarget - this.yaw), maxTurn = turn * dt;
    this.yaw += clamp(dy, -maxTurn, maxTurn);
    this.aim += (aimT - this.aim) * (1 - Math.exp(-dt * 7));
    this.moving += (this.movingT - this.moving) * (1 - Math.exp(-dt * 8));
    const st = this.state === 'stagger' ? 0.35 : 0;
    this.stoop += (st - this.stoop) * (1 - Math.exp(-dt * 10));
  }

  // ---------- hits ----------

  // Returns {t, part} for the nearest body part the ray passes through, or null.
  rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    const s = this.P[STERN];
    const wx = s.x - ox, wy = s.y - oy, wz = s.z - oz, along = wx * dx + wy * dy + wz * dz;
    if (along < -1.5 || along > maxT + 1.5) return null;
    const px = wx - dx * along, py = wy - dy * along, pz = wz - dz * along;
    if (px * px + py * py + pz * pz > 2.0) return null;
    let best = null, bt = maxT;
    for (let k = 0; k < PARTS.length; k++) {
      const part = PARTS[k], a = this.P[part.a];
      let bx, by, bz;
      if (part.b < 0) { bx = (this.P[LHIP].x + this.P[RHIP].x) / 2; by = (this.P[LHIP].y + this.P[RHIP].y) / 2; bz = (this.P[LHIP].z + this.P[RHIP].z) / 2; }
      else { const b = this.P[part.b]; bx = b.x; by = b.y; bz = b.z; }
      const d = raySegment(ox, oy, oz, dx, dy, dz, a.x, a.y, a.z, bx, by, bz, _rs);
      if (d > part.r) continue;
      const t = _rs.t - Math.sqrt(part.r * part.r - d * d);
      if (t > 0 && t < bt) { bt = t; best = part; }
    }
    return best ? { t: bt, part: best } : null;
  }

  nearestOf(list, p) {
    let bi = list[0], bd = 1e9;
    for (const i of list) { const d = this.P[i].distanceToSquared(p); if (d < bd) { bd = d; bi = i; } }
    return bi;
  }

  hit(part, dir, point, g, mult = 1) {
    const i = part.a === HEAD ? HEAD : part.b < 0 ? this.nearestOf(TORSO, point) : part.p;
    const push = 0.45 + 0.55 * mult;
    g.fx.bodyHit(point, dir);
    g.sfx.thump(point);
    if (this.dead) { this.impulse(i, dir, 2.6 * push); return; }
    this.hp -= part.dmg * mult;
    this.V[i].addScaledVector(dir, 3.2 * push);
    for (const n of NEIGH[i]) this.V[n].addScaledVector(dir, 1.3 * push);
    if (this.hp <= 0) { this.die(i, dir, part.a === HEAD, g); return; }
    this.state = 'stagger'; this.staggerT = 0.3 + Math.random() * 0.35;
    this.lastKnown.copy(g.player.feet);
    this.pause = 0; this.burst = 2;
  }

  // A concussion charge went off at c. Bodies are thrown; the living are hurt or killed.
  blast(c, radius, g) {
    const s = this.P[STERN], dx = s.x - c.x, dy = s.y - (c.y + 0.12), dz = s.z - c.z, d = Math.hypot(dx, dy, dz);
    if (d > radius) return;
    if (d > 0.5 && this.world.blocked(c.x, c.y + 0.12, c.z, dx / d, dy / d, dz / d, d - 0.3, 'ray')) return;
    const f = 1 - d / radius, dir = _c.set(dx, dy + 0.4 * d + 0.15, dz).normalize();
    const fling = (dv) => {
      for (let k = 0; k < NP; k++) this.prev[k].addScaledVector(dir, -dv * (0.75 + Math.random() * 0.5) * H);
      if (this.gunLoose) for (const q of this.gprev) q.addScaledVector(dir, -dv * 0.8 * H);
      this.asleep = false; this.sleepC = 0; this.pooled = true;
    };
    if (this.dead) { fling(1.5 + 7 * f); return; }
    this.hp -= 25 + 170 * f;
    if (this.hp <= 0) { this.die(STERN, _d.copy(dir), false, g); fling(2.5 + 6 * f); return; }
    for (const k of TORSO) this.V[k].addScaledVector(dir, 4.5);
    this.V[HEAD].addScaledVector(dir, 5);
    this.state = 'stagger'; this.staggerT = 0.8 + Math.random() * 0.5;
    this.lastKnown.copy(g.player.feet);
    this.pause = 0; this.burst = 2;
  }

  // Show this hostile through walls for a moment (the echo pulse).
  reveal(delay, dur) { this.gDelay = delay; this.gT = dur; this.gDur = dur; }

  impulse(i, dir, dv) {
    this.prev[i].addScaledVector(dir, -dv * H);
    for (const n of NEIGH[i]) this.prev[n].addScaledVector(dir, -dv * 0.4 * H);
    this.asleep = false; this.sleepC = 0;
  }

  die(i, dir, head, g) {
    this.dead = true; this.state = 'dead';
    const inv = 1 / Math.max(g.dt, 1 / 240);
    for (let k = 0; k < NP; k++) {
      _a.subVectors(this.P[k], this.last[k]).multiplyScalar(inv);
      if (_a.lengthSq() > 12) _a.setLength(3.46);
      this.prev[k].copy(this.P[k]).addScaledVector(_a, -H);
    }
    this.impulse(i, dir, head ? 2.2 : 3.0);
    for (let k = 0; k < NP; k++) this.prev[k].addScaledVector(dir, -0.5 * H);
    // muscles let go over a moment rather than instantly
    this.tense = TENSE.map(([a, b]) => [a, b, this.P[a].distanceTo(this.P[b])]);
    this.tenseDur = head ? 0.08 : 0.25 + Math.random() * 0.55;
    this.tenseT = this.tenseDur;
    // the rifle goes its own way
    this.gunLoose = true;
    this.gp[0].copy(this.P[RHAND]); this.gp[1].copy(this.P[RHAND]).addScaledVector(this.gdir, 0.6);
    _a.subVectors(this.P[RHAND], this.last[RHAND]).multiplyScalar(inv).clampLength(0, 3);
    this.gprev[0].copy(this.gp[0]).addScaledVector(_a, -H);
    this.gprev[1].copy(this.gp[1]).addScaledVector(_a, -H).addScaledVector(dir, -0.6 * H);
    this.gprev[1].y -= 1.0 * H;
    g.onKill(this);
  }

  // ---------- ragdoll ----------

  collide(i, friction) {
    const p = this.P[i], q = this.prev[i];
    const bx = p.x, by = p.y, bz = p.z;
    if (!this.world.pushSphere(p, RAD[i])) return;
    const n = this.world.n;
    const vx = bx - q.x, vy = by - q.y, vz = bz - q.z;
    const vn = vx * n.x + vy * n.y + vz * n.z;
    const tx = vx - vn * n.x, ty = vy - vn * n.y, tz = vz - vn * n.z;
    const k = 1 - friction, bn = vn < 0 ? -vn * 0.08 : vn;
    q.set(p.x - (tx * k + bn * n.x), p.y - (ty * k + bn * n.y), p.z - (tz * k + bn * n.z));
    if (!this.thudded && vn < -0.011 && n.y > 0.5 && (i === STERN || i === LHIP || i === RHIP || i === LSH || i === RSH || i === HEAD)) {
      this.thudded = true; this.thudAt = true;
    }
  }

  step() {
    const P = this.P, prev = this.prev, g = 9.81 * H * H;
    let maxMove = 0;
    for (let i = 0; i < NP; i++) {
      const p = P[i], q = prev[i];
      const vx = (p.x - q.x) * 0.992, vy = (p.y - q.y) * 0.992, vz = (p.z - q.z) * 0.992;
      const m = vx * vx + vy * vy + vz * vz; if (m > maxMove) maxMove = m;
      q.copy(p);
      p.x += vx; p.y += vy - g; p.z += vz;
    }
    const tk = this.tenseT > 0 ? 0.45 * (this.tenseT / this.tenseDur) : 0;
    for (let it = 0; it < 5; it++) {
      for (let s = 0; s < REST.length; s++) {
        const c = REST[s], a = P[c[0]], b = P[c[1]];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const wa = INVM[c[0]], wb = INVM[c[1]], f = ((d - c[2]) / d) * c[3] / (wa + wb);
        a.x += dx * f * wa; a.y += dy * f * wa; a.z += dz * f * wa;
        b.x -= dx * f * wb; b.y -= dy * f * wb; b.z -= dz * f * wb;
      }
      for (let s = 0; s < MINS.length; s++) {
        const c = MINS[s], a = P[c[0]], b = P[c[1]];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= c[2] * c[2]) continue;
        const d = Math.sqrt(d2) || 1e-6, f = ((d - c[2]) / d) * 0.5;
        a.x += dx * f; a.y += dy * f; a.z += dz * f;
        b.x -= dx * f; b.y -= dy * f; b.z -= dz * f;
      }
      if (tk > 0) {
        for (let s = 0; s < this.tense.length; s++) {
          const c = this.tense[s], a = P[c[0]], b = P[c[1]];
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const f = ((d - c[2]) / d) * 0.5 * tk;
          a.x += dx * f; a.y += dy * f; a.z += dz * f;
          b.x -= dx * f; b.y -= dy * f; b.z -= dz * f;
        }
      }
      // knees only fold one way
      const cx = (P[LSH].x + P[RSH].x + P[LHIP].x + P[RHIP].x) / 4, cy = (P[LSH].y + P[RSH].y + P[LHIP].y + P[RHIP].y) / 4, cz = (P[LSH].z + P[RSH].z + P[LHIP].z + P[RHIP].z) / 4;
      let fx = P[STERN].x - cx, fy = P[STERN].y - cy, fz = P[STERN].z - cz;
      const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1e-6; fx /= fl; fy /= fl; fz /= fl;
      for (let leg = 0; leg < 2; leg++) {
        const hip = P[leg ? RHIP : LHIP], knee = P[leg ? RKNEE : LKNEE], foot = P[leg ? RFOOT : LFOOT];
        const d = (knee.x - (hip.x + foot.x) / 2) * fx + (knee.y - (hip.y + foot.y) / 2) * fy + (knee.z - (hip.z + foot.z) / 2) * fz;
        if (d < 0.02) {
          const c = (0.02 - d) * 0.35;
          knee.x += fx * c; knee.y += fy * c; knee.z += fz * c;
          hip.x -= fx * c * 0.3; hip.y -= fy * c * 0.3; hip.z -= fz * c * 0.3;
          foot.x -= fx * c * 0.3; foot.y -= fy * c * 0.3; foot.z -= fz * c * 0.3;
        }
      }
      if (it >= 3) for (let i = 0; i < NP; i++) this.collide(i, 0.3);
      if (it === 4) {
        for (let s = 0; s < MIDS.length; s++) {
          const c = MIDS[s], a = P[c[0]], b = P[c[1]];
          _a.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
          const mx = _a.x, my = _a.y, mz = _a.z;
          if (this.world.pushSphere(_a, c[2])) {
            const ex = _a.x - mx, ey = _a.y - my, ez = _a.z - mz;
            a.x += ex; a.y += ey; a.z += ez; b.x += ex; b.y += ey; b.z += ez;
          }
        }
      }
    }
    if (this.tenseT > 0) this.tenseT -= H;
    if (maxMove < 6e-7) { if (++this.sleepC > 100) this.asleep = true; } else this.sleepC = 0;
  }

  stepGun() {
    const g = 9.81 * H * H;
    let move = 0;
    for (let i = 0; i < 2; i++) {
      const p = this.gp[i], q = this.gprev[i];
      const vx = (p.x - q.x) * 0.99, vy = (p.y - q.y) * 0.99, vz = (p.z - q.z) * 0.99;
      move += vx * vx + vy * vy + vz * vz;
      q.copy(p); p.x += vx; p.y += vy - g; p.z += vz;
    }
    for (let it = 0; it < 3; it++) {
      const a = this.gp[0], b = this.gp[1];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6, f = ((d - 0.6) / d) * 0.5;
      a.x += dx * f; a.y += dy * f; a.z += dz * f; b.x -= dx * f; b.y -= dy * f; b.z -= dz * f;
      for (let i = 0; i < 2; i++) {
        const p = this.gp[i], q = this.gprev[i], bx = p.x, by = p.y, bz = p.z;
        if (!this.world.pushSphere(p, 0.035)) continue;
        const n = this.world.n, vx = bx - q.x, vy = by - q.y, vz = bz - q.z, vn = vx * n.x + vy * n.y + vz * n.z;
        const bn = vn < 0 ? -vn * 0.2 : vn;
        q.set(p.x - ((vx - vn * n.x) * 0.6 + bn * n.x), p.y - ((vy - vn * n.y) * 0.6 + bn * n.y), p.z - ((vz - vn * n.z) * 0.6 + bn * n.z));
      }
    }
    if (move < 1e-6) { if (++this.gunSleep > 100) this.gunLoose = false; } else this.gunSleep = 0;
  }

  // ---------- frame update ----------

  update(dt, g, substeps) {
    if (this.gT > 0) {
      if (this.gDelay > 0) this.gDelay -= dt;
      else {
        this.gT -= dt;
        const on = this.gT > 0 && !this.dead;
        this.ghostMat.opacity = on ? Math.min(1, this.gT / (this.gDur * 0.45)) * 0.55 : 0;
        for (const m of this.ghosts) m.visible = on;
        if (on && !this.rig) this.ghosts[0].position.set(this.pos.x, this.pos.y + 0.9, this.pos.z);
        if (!on) this.gT = 0;
      }
    }
    if (!this.dead) {
      this.think(dt, g);
      for (let i = 0; i < NP; i++) this.last[i].copy(this.P[i]);
      pose(this, this.base);
      const k = 130, c = 15;
      for (let i = 0; i < NP; i++) {
        const o = this.O[i], v = this.V[i];
        v.x += (-k * o.x - c * v.x) * dt; v.y += (-k * o.y - c * v.y) * dt; v.z += (-k * o.z - c * v.z) * dt;
        o.addScaledVector(v, dt);
        if (o.lengthSq() > 0.07) o.setLength(0.264);
        this.P[i].copy(this.base[i]).add(o);
      }
    } else {
      for (let s = 0; s < substeps; s++) {
        if (!this.asleep) this.step();
        if (this.gunLoose) this.stepGun();
      }
      if (this.thudAt) { this.thudAt = false; g.sfx.thump(this.P[STERN]); }
      if (this.asleep && !this.pooled) {
        this.pooled = true;
        const s = this.P[STERN];
        if (this.world.raycast(s.x, s.y + 0.1, s.z, 0, -1, 0, 1.2, _hit) && _hit.ny > 0.5) g.fx.pool(s.x, s.y + 0.1 - _hit.t, s.z);
      }
      if (this.asleep && !this.gunLoose) return;
    }
    this.sync();
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 0.2;
      const s = this.P[STERN];
      this.level.lightFor(s.x, s.y, s.z, this.matList);
    }
  }

  limb(mesh, a, b) {
    mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    _a.subVectors(b, a).normalize();
    mesh.quaternion.setFromUnitVectors(_Y, _a);
  }

  sync() {
    const P = this.P, M = this.M;
    if (this.rig) {
      this.rig.apply(P, !this.dead);
      if (this.dead) {
        M.gun.position.copy(this.gp[0]);
        _a.subVectors(this.gp[1], this.gp[0]).normalize();
      } else {
        this.rig.rHand.getWorldPosition(M.gun.position);
        this.rig.lHand.getWorldPosition(_a).sub(M.gun.position);
        if (_a.lengthSq() < 0.01) _a.copy(this.gdir); else _a.normalize();
        M.gun.position.addScaledVector(_a, 0.04);
      }
      M.gun.quaternion.setFromUnitVectors(_Z, _a);
      return;
    }
    // torso frame
    const hx = (P[LHIP].x + P[RHIP].x) / 2, hy = (P[LHIP].y + P[RHIP].y) / 2, hz = (P[LHIP].z + P[RHIP].z) / 2;
    const X = _a.subVectors(P[RSH], P[LSH]).normalize();
    const Y = _b.set(P[NECK].x - hx, P[NECK].y - hy, P[NECK].z - hz).normalize();
    const Z = _c.crossVectors(X, Y).normalize();
    X.crossVectors(Y, Z).normalize();
    _m.makeBasis(X, Y, Z);
    M.torso.quaternion.setFromRotationMatrix(_m);
    M.torso.position.set((P[NECK].x + hx) / 2, (P[NECK].y + hy) / 2, (P[NECK].z + hz) / 2);
    const front = (P[STERN].x - M.torso.position.x) * Z.x + (P[STERN].y - M.torso.position.y) * Z.y + (P[STERN].z - M.torso.position.z) * Z.z;
    M.vest.position.set(0, 0.05, front > 0 ? 0.07 : -0.07);
    M.head.position.copy(P[HEAD]);
    M.head.quaternion.copy(M.torso.quaternion);
    const fz = front > 0 ? -1 : 1; // Z multiplier that points backwards, for the boots
    this.limb(M.lu, P[LSH], P[LELB]); this.limb(M.ru, P[RSH], P[RELB]);
    this.limb(M.lf, P[LELB], P[LHAND]); this.limb(M.rf, P[RELB], P[RHAND]);
    this.limb(M.lt, P[LHIP], P[LKNEE]); this.limb(M.rt, P[RHIP], P[RKNEE]);
    this.limb(M.ls, P[LKNEE], P[LFOOT]); this.limb(M.rs, P[RKNEE], P[RFOOT]);
    M.lh.position.copy(P[LHAND]); M.rh.position.copy(P[RHAND]);
    for (let leg = 0; leg < 2; leg++) {
      const boot = leg ? M.rb : M.lb, knee = P[leg ? RKNEE : LKNEE], foot = P[leg ? RFOOT : LFOOT];
      const by = _a.subVectors(knee, foot).normalize();
      const bz = _b.copy(Z).multiplyScalar(fz);
      bz.addScaledVector(by, -bz.dot(by));
      if (bz.lengthSq() < 1e-4) bz.set(1, 0, 0).addScaledVector(by, -by.x);
      bz.normalize();
      const bx = _d.crossVectors(by, bz);
      _m.makeBasis(bx, by, bz);
      boot.quaternion.setFromRotationMatrix(_m);
      boot.position.copy(foot);
    }
    // rifle
    if (this.dead) {
      M.gun.position.copy(this.gp[0]);
      _a.subVectors(this.gp[1], this.gp[0]).normalize();
    } else {
      M.gun.position.copy(P[RHAND]);
      _a.subVectors(P[LHAND], P[RHAND]).normalize();
    }
    M.gun.quaternion.setFromUnitVectors(_Z, _a);
  }
}
