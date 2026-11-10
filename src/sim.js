import * as THREE from 'three';
import { N, P, O, road, CURB, CITY_MIN, CITY_MAX, districtAt } from './city.js';
import { Car } from './vehicle.js';
import { makeGlowTexture } from './fx.js';

const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];        // 0:+Z 1:+X 2:-Z 3:-X ; heading = dir * PI/2
const LANE = 1.7;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
const PED_TINTS = [0xffffff, 0xd8b0a0, 0x9fb7d8, 0xd8d0a0, 0xb0d8b4, 0xe0a0c0, 0x909090, 0xc8a070, 0x70a0c8, 0xf0e0d0];
const CORNER_CROSS = [[[-1, 0, 1], [0, -1, 3]], [[1, 0, 0], [0, -1, 2]], [[1, 0, 3], [0, 1, 1]], [[-1, 0, 2], [0, 1, 0]]];

export class Sim {
  constructor(G) {
    this.G = G;
    this.traffic = []; this.peds = []; this.units = []; this.cops = []; this.pickups = [];
    this.wanted = 0; this.evadeT = 0; this.crimeT = 0; this.seen = false;
    this.job = null; this.jobs = 0;
    this.pickTex = makeGlowTexture(64, 1.5);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 1.2, 40, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.3, 0.3), transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 60, 12, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.3), transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.y = 30;
    this.marker = new THREE.Group(); this.marker.add(ring, beam); this.marker.visible = false;
    G.scene.add(this.marker);
  }

  // ------------------------------------------------------------------ helpers
  focus() { return this.G.focus; }
  inView(x, z) {
    const cam = this.G.camera;
    _a.set(x - cam.position.x, 0, z - cam.position.z);
    const d = _a.length();
    cam.getWorldDirection(_b); _b.y = 0; _b.normalize();
    return d < 1 || _a.dot(_b) / d > 0.45;
  }
  lineBlocked(x0, z0, x1, z1) {
    const city = this.G.city, dx = x1 - x0, dz = z1 - z0;
    const test = (list) => {
      for (const b of list) {
        let t0 = 0, t1 = 1, ok = true;
        for (const [o, d, mn, mx] of [[x0, dx, b.x0, b.x1], [z0, dz, b.z0, b.z1]]) {
          if (Math.abs(d) < 1e-6) { if (o < mn || o > mx) { ok = false; break; } continue; }
          let a = (mn - o) / d, c = (mx - o) / d; if (a > c) [a, c] = [c, a];
          t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) { ok = false; break; }
        }
        if (ok) return true;
      }
      return false;
    };
    return test([...city.collidersNear((x0 + x1) / 2, (z0 + z1) / 2)]) || test([...city.collidersNear(x0, z0)]);
  }

  // move a character with collision against buildings, cars, poles and the island edge
  moveChar(ch, dx, dz) {
    const G = this.G, city = G.city;
    let x = ch.x + dx, z = ch.z + dz;
    const r = ch.radius;
    for (const b of city.collidersNear(x, z)) {
      const px = clamp(x, b.x0, b.x1), pz = clamp(z, b.z0, b.z1);
      let ex = x - px, ez = z - pz; const d2 = ex * ex + ez * ez;
      if (d2 >= r * r) continue;
      if (d2 < 1e-8) {
        const l = x - b.x0, rr = b.x1 - x, t = z - b.z0, bt = b.z1 - z, m = Math.min(l, rr, t, bt);
        if (m === l) x = b.x0 - r; else if (m === rr) x = b.x1 + r; else if (m === t) z = b.z0 - r; else z = b.z1 + r;
      } else { const d = Math.sqrt(d2); x += (ex / d) * (r - d); z += (ez / d) * (r - d); }
    }
    for (const c of G.cars) {
      if (Math.abs(c.x - x) > 4 || Math.abs(c.z - z) > 4) continue;
      const fx = Math.sin(c.h), fz = Math.cos(c.h);
      for (const off of [1.35, 0, -1.35]) {
        const ex = x - (c.x + fx * off), ez = z - (c.z + fz * off), d = Math.hypot(ex, ez), rr = r + 0.95;
        if (d < rr && d > 1e-4) { x += (ex / d) * (rr - d); z += (ez / d) * (rr - d); }
      }
    }
    for (const p of G.props.poles) {
      const ex = x - p.x, ez = z - p.z; if (Math.abs(ex) > 1 || Math.abs(ez) > 1) continue;
      const d = Math.hypot(ex, ez), rr = r + p.r;
      if (d < rr && d > 1e-4) { x += (ex / d) * (rr - d); z += (ez / d) * (rr - d); }
    }
    ch.x = x; ch.z = z;
    city.confine(ch, 0.3);
  }

  // ------------------------------------------------------------------ hitscan
  hitscan(o, d, max, ignore) {
    const G = this.G, hit = { t: max, kind: null, obj: null, head: false, n: _n.set(0, 1, 0) };
    // march the ray over the terrain, then bisect the crossing
    {
      const gY = G.city.groundY; let pt = 0;
      for (let t = 1.5; t < max; t += t < 40 ? 1.5 : 4) {
        if (o.y + d.y * t < gY(o.x + d.x * t, o.z + d.z * t)) {
          let a = pt, b = t;
          for (let k = 0; k < 6; k++) { const m = (a + b) / 2; if (o.y + d.y * m < gY(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
          hit.t = b; hit.kind = 'ground'; break;
        }
        pt = t;
      }
    }
    const seen = new Set();
    for (let s = 0; s <= Math.min(max, 180); s += 45) {
      for (const b of G.city.collidersNear(o.x + d.x * s, o.z + d.z * s)) {
        if (seen.has(b)) continue; seen.add(b);
        let t0 = 0, t1 = hit.t, axis = -1, ok = true;
        const slabs = [[o.x, d.x, b.x0, b.x1], [o.y, d.y, b.gy - 4, b.top], [o.z, d.z, b.z0, b.z1]];
        for (let k = 0; k < 3; k++) {
          const [oo, dd, mn, mx] = slabs[k];
          if (Math.abs(dd) < 1e-7) { if (oo < mn || oo > mx) { ok = false; break; } continue; }
          let a = (mn - oo) / dd, c = (mx - oo) / dd; if (a > c) [a, c] = [c, a];
          if (a > t0) { t0 = a; axis = k; }
          t1 = Math.min(t1, c); if (t0 > t1) { ok = false; break; }
        }
        if (ok && t0 > 0 && t0 < hit.t) { hit.t = t0; hit.kind = 'wall'; hit.n.set(0, 0, 0).setComponent(Math.max(axis, 0), -Math.sign(axis === 0 ? d.x : axis === 1 ? d.y : d.z)); }
      }
    }
    const sphere = (cx, cy, cz, r) => {
      const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
      const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - c;
      if (disc < 0) return -1;
      const t = -b - Math.sqrt(disc);
      return t > 0 ? t : -1;
    };
    for (const car of G.cars) {
      if (Math.abs(car.x - o.x) > max || Math.abs(car.z - o.z) > max) continue;
      const fx = Math.sin(car.h), fz = Math.cos(car.h);
      for (const off of [1.2, -1.2]) {
        const t = sphere(car.x + fx * off, car.y + 0.62, car.z + fz * off, 1.0);
        if (t > 0 && t < hit.t) { hit.t = t; hit.kind = 'car'; hit.obj = car; hit.n.set(-d.x, 0.3, -d.z).normalize(); }
      }
    }
    for (const ch of G.chars) {
      if (ch === ignore || ch.dead || !ch.root.visible) continue;
      if (Math.abs(ch.x - o.x) > max || Math.abs(ch.z - o.z) > max) continue;
      const hy0 = ch.headY || 1.66;
      let t = sphere(ch.x, ch.y + hy0, ch.z, 0.17);
      if (t > 0 && t < hit.t) { hit.t = t; hit.kind = 'char'; hit.obj = ch; hit.head = true; }
      for (const hy of [hy0 - 0.45, hy0 - 0.92, 0.3]) { t = sphere(ch.x, ch.y + hy, ch.z, 0.3); if (t > 0 && t < hit.t) { hit.t = t; hit.kind = 'char'; hit.obj = ch; hit.head = false; } }
    }
    hit.point = _c.copy(o).addScaledVector(d, hit.t);
    return hit;
  }

  // ------------------------------------------------------------------ crimes / wanted
  crime(inc, floor = 0) {
    this.evadeT = 0;
    if (floor > this.wanted) { this.wanted = Math.min(5, floor); this.crimeT = 2.5; return; }
    if (inc > 0 && this.crimeT <= 0 && this.wanted < 5) { this.wanted = Math.min(5, this.wanted + inc); this.crimeT = 3.5; }
  }
  clearWanted() {
    this.wanted = 0; this.evadeT = 0;
    for (const u of this.units) u.leaving = true;
  }
  alertPeds(x, z, radius) {
    for (const p of this.peds) {
      if (p.ch.dead) continue;
      if (Math.hypot(p.ch.x - x, p.ch.z - z) < radius) { p.fleeT = rnd(8, 14); p.tx = x; p.tz = z; }
    }
    for (const a of this.traffic) if (Math.hypot(a.car.x - x, a.car.z - z) < radius * 0.7) a.panic = rnd(6, 10);
  }
  damageChar(ch, dmg, fromPlayer, dirx = 0, dirz = 0) {
    if (ch.dead) return;
    const G = this.G;
    if (ch === G.player.ch) { G.hurtPlayer(dmg); return; }
    ch.health -= dmg;
    if (ch.health <= 0) {
      ch.kill(dirx * 1.5, dirz * 1.5, 1.5);
      if (fromPlayer) {
        if (ch.kind === 'cop') this.crime(1, 3); else this.crime(1, 1);
        if (ch.kind === 'ped' && Math.random() < 0.8) this.dropCash(ch.x, ch.z, Math.round(rnd(20, 140)));
        if (ch.kind === 'cop') this.dropCash(ch.x, ch.z, Math.round(rnd(60, 200)));
      }
    } else if (fromPlayer) this.crime(0, 1);
  }
  damageCar(car, dmg, fromPlayer) {
    if (car.wreck) return;
    car.health -= dmg;
    if (fromPlayer) { const ai = this.traffic.find((a) => a.car === car); if (ai) ai.panic = 8; }
  }
  dropCash(x, z, amount) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.pickTex, color: new THREE.Color(0.5, 4.5, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(1.3); s.position.set(x, this.G.city.groundY(x, z) + 0.5, z);
    this.G.scene.add(s);
    this.pickups.push({ s, x, z, amount, t: 0 });
  }

  // ------------------------------------------------------------------ lane following (traffic + police)
  laneStep(ai, dt, vmax, obey, greedy) {
    const G = this.G, car = ai.car;
    let fx = DIRS[ai.dir][0], fz = DIRS[ai.dir][1];
    let along = (road(ai.i) - car.x) * fx + (road(ai.j) - car.z) * fz;
    if (along < 7.5) {
      const opts = [];
      for (let d = 0; d < 4; d++) {
        if (d === (ai.dir + 2) % 4) continue;
        const ni = ai.i + DIRS[d][0], nj = ai.j + DIRS[d][1];
        if (ni < 0 || nj < 0 || ni > N || nj > N) continue;
        opts.push(d);
      }
      let nd = opts[0];
      if (greedy) {
        const f = this.focus(); let best = 1e9;
        for (const d of opts) { const q = Math.hypot(road(ai.i + DIRS[d][0]) - f.x, road(ai.j + DIRS[d][1]) - f.z) + Math.random() * 12; if (q < best) { best = q; nd = d; } }
      } else {
        const r = Math.random();
        nd = opts.includes(ai.dir) && r < 0.58 ? ai.dir : opts[Math.floor(Math.random() * opts.length)];
      }
      ai.i += DIRS[nd][0]; ai.j += DIRS[nd][1]; ai.dir = nd;
      fx = DIRS[nd][0]; fz = DIRS[nd][1];
      along = (road(ai.i) - car.x) * fx + (road(ai.j) - car.z) * fz;
    }
    const rx = -fz, rz = fx;
    const s = Math.max(along - (5 + car.speed * 0.55), -4);
    const tx = road(ai.i) - fx * s + rx * LANE, tz = road(ai.j) - fz * s + rz * LANE;
    const err = wrap(Math.atan2(tx - car.x, tz - car.z) - car.h);
    let vt = vmax * (Math.abs(err) > 0.3 ? 0.5 : 1);
    if (obey) {
      const sig = G.props.signal(ai.dir % 2), stop = along - 12.2;
      if (sig !== 2 && stop > -1 && stop < 28 && !(sig === 1 && stop < 6)) vt = Math.min(vt, stop < 1.4 ? 0 : stop * 0.7);
    }
    vt = Math.min(vt, this.clearAhead(car, obey ? 1 : 0.55));
    this.driveTo(car, dt, err, vt);
  }
  clearAhead(car, caution) {
    const G = this.G, fx = Math.sin(car.h), fz = Math.cos(car.h), rx = -fz, rz = fx;
    const range = (7 + car.speed * 1.15) * caution;
    let vt = 99;
    for (const o of G.cars) {
      if (o === car) continue;
      const dx = o.x - car.x, dz = o.z - car.z;
      if (Math.abs(dx) > range + 3 || Math.abs(dz) > range + 3) continue;
      const ahead = dx * fx + dz * fz, lat = Math.abs(dx * rx + dz * rz);
      if (ahead > 0 && ahead < range && lat < 2.0) vt = Math.min(vt, Math.max(0, (ahead - 6.5) * 0.9));
    }
    for (const ch of G.chars) {
      if (ch.dead || !ch.root.visible) continue;
      const dx = ch.x - car.x, dz = ch.z - car.z;
      if (Math.abs(dx) > range + 2 || Math.abs(dz) > range + 2) continue;
      const ahead = dx * fx + dz * fz, lat = Math.abs(dx * rx + dz * rz);
      if (ahead > 0 && ahead < range && lat < 1.5) vt = Math.min(vt, Math.max(0, (ahead - 4.5) * 0.9));
    }
    if (G.transit) for (const o of G.transit.vehicles) {
      const dx = o.x - car.x, dz = o.z - car.z;
      if (Math.abs(dx) > range + 3 || Math.abs(dz) > range + 3) continue;
      const ahead = dx * fx + dz * fz, lat = Math.abs(dx * rx + dz * rz);
      if (ahead > 0 && ahead < range && lat < 2.4) vt = Math.min(vt, Math.max(0, (ahead - 9) * 0.9));
    }
    return vt;
  }
  driveTo(car, dt, err, vt) {
    const e = vt - car.vF;
    const stop = vt < 0.3 && car.vF < 1;
    car.update(dt, { throttle: stop ? 0 : clamp(e * 0.55, -1, 1), steer: clamp(-err * 2.4, -1, 1), handbrake: stop }, this.G.city, this.G.cars);
  }
  placeOnRoad(car, ai, minD, maxD, allowView) {
    const f = this.focus(), G = this.G;
    for (let tries = 0; tries < 30; tries++) {
      const i = Math.floor(Math.random() * (N + 1)), j = Math.floor(Math.random() * (N + 1)), dir = Math.floor(Math.random() * 4);
      const ti = i + DIRS[dir][0], tj = j + DIRS[dir][1];
      if (ti < 0 || tj < 0 || ti > N || tj > N) continue;
      const fx = DIRS[dir][0], fz = DIRS[dir][1], d = rnd(16, P - 16);
      const x = road(i) + fx * d - fz * LANE, z = road(j) + fz * d + fx * LANE;
      const dist = Math.hypot(x - f.x, z - f.z);
      if (dist < minD || dist > maxD) continue;
      if (!allowView && dist < 130 && this.inView(x, z)) continue;
      if (G.cars.some((o) => o !== car && Math.abs(o.x - x) < 10 && Math.abs(o.z - z) < 10)) continue;
      car.x = x; car.z = z; car.h = dir * Math.PI / 2; car.vx = fx * 7; car.vz = fz * 7; car.steer = 0;
      ai.i = ti; ai.j = tj; ai.dir = dir; ai.panic = 0; ai.stuck = 0;
      car.sync(0, G.city);
      return true;
    }
    return false;
  }
  repair(car) {
    car.health = 100; car.wreck = false; car.burnT = 0; car.parked = false;
    if (car.origColor !== undefined) { car.paint.color.setHex(car.origColor); car.paint.roughness = 0.38; car.paint.clearcoat = 1; car.farMat.color.copy(car.paint.color); }
  }

  initTraffic(n) {
    const G = this.G;
    for (let k = 0; k < n; k++) {
      const car = new Car(G.makeCar(), 0, 0, 0);
      car.origColor = car.paint.color.getHex();
      const ai = { car, i: 0, j: 0, dir: 0, panic: 0, stuck: 0 };
      if (!this.placeOnRoad(car, ai, 25, 230, true)) continue;
      car.driver = 'ai';
      G.scene.add(car.root); G.cars.push(car); this.traffic.push(ai);
    }
  }
  updateTraffic(dt) {
    const f = this.focus();
    for (let k = this.traffic.length - 1; k >= 0; k--) {
      const ai = this.traffic[k], car = ai.car;
      if (car.driver !== 'ai') { this.traffic.splice(k, 1); continue; }     // hijacked
      const dist = Math.hypot(car.x - f.x, car.z - f.z);
      if (dist > 240 || (car.wreck && dist > 120 && !this.inView(car.x, car.z))) { this.repair(car); this.placeOnRoad(car, ai, 90, 200, false); continue; }
      if (car.wreck) continue;
      if (ai.panic > 0) { ai.panic -= dt; this.laneStep(ai, dt, 21, false, false); }
      else this.laneStep(ai, dt, 10.5, true, false);
      // unstick: blocked for a long time while out of sight -> respawn elsewhere
      ai.stuck = car.speed < 0.4 ? ai.stuck + dt : 0;
      if (ai.stuck > 25 && !this.inView(car.x, car.z)) this.placeOnRoad(car, ai, 90, 200, false);
    }
    // keep the streets populated after hijacks
    while (this.traffic.length < this.G.trafficCount && this.G.cars.length < 70) {
      const car = new Car(this.G.makeCar(), 0, 0, 0); car.origColor = car.paint.color.getHex();
      const ai = { car, i: 0, j: 0, dir: 0, panic: 0, stuck: 0 };
      if (!this.placeOnRoad(car, ai, 90, 210, false)) break;
      car.driver = 'ai'; this.G.scene.add(car.root); this.G.cars.push(car); this.traffic.push(ai);
    }
  }

  // ------------------------------------------------------------------ pedestrians
  ringCorner(b, c) { const m = 2.4; return c === 0 ? [b.x0 + m, b.z0 + m] : c === 1 ? [b.x1 - m, b.z0 + m] : c === 2 ? [b.x1 - m, b.z1 - m] : [b.x0 + m, b.z1 - m]; }
  placePed(p, minD, maxD, allowView) {
    const G = this.G, f = this.focus();
    for (let tries = 0; tries < 30; tries++) {
      const b = G.city.blocks[Math.floor(Math.random() * G.city.blocks.length)];
      const c = Math.floor(Math.random() * 4), [x0, z0] = this.ringCorner(b, c), [x1, z1] = this.ringCorner(b, (c + 1) % 4), t = Math.random();
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, d = Math.hypot(x - f.x, z - f.z);
      if (d < minD || d > maxD || (!allowView && d < 90 && this.inView(x, z))) continue;
      p.b = b; p.cw = Math.random() < 0.5 ? 1 : -1; p.c = p.cw > 0 ? (c + 1) % 4 : c;
      [p.tx, p.tz] = this.ringCorner(b, p.c);
      p.fleeT = 0; p.speed = rnd(1.25, 1.75);
      const ch = p.ch;
      ch.revive();
      ch.place(x, z, 0, G.city.groundY(x, z));
      return true;
    }
    return false;
  }
  initPeds(n) {
    const G = this.G;
    for (let k = 0; k < n; k++) {
      const ch = G.makeChar('ped', k); ch.kind = 'ped';
      const p = { ch, b: null, c: 0, cw: 1, tx: 0, tz: 0, fleeT: 0, speed: 1.5 };
      this.placePed(p, 12, 150, true);
      G.scene.add(ch.root); G.chars.push(ch); this.peds.push(p);
    }
  }
  updatePeds(dt) {
    const G = this.G, f = this.focus();
    for (const p of this.peds) {
      const ch = p.ch, dist = Math.hypot(ch.x - f.x, ch.z - f.z);
      if (ch.dead) { ch.update(dt, G.city.groundY(ch.x, ch.z)); if ((ch.deadT > 25 && !this.inView(ch.x, ch.z)) || dist > 170) this.placePed(p, 60, 150, false); continue; }
      if (dist > 175) { this.placePed(p, 60, 150, false); continue; }
      let sp = p.speed, hx, hz;
      if (p.fleeT > 0) {
        p.fleeT -= dt; sp = 5.6;
        hx = ch.x - p.tx; hz = ch.z - p.tz;                    // run from the threat
        if (p.fleeT <= 0) { p.b = G.city.blockAt(ch.x, ch.z) || p.b; [p.tx, p.tz] = this.ringCorner(p.b, p.c); }
      } else {
        hx = p.tx - ch.x; hz = p.tz - ch.z;
        if (hx * hx + hz * hz < 1.2) {
          if (Math.random() < 0.3) {
            const [di, dj, nc] = CORNER_CROSS[p.c][Math.floor(Math.random() * 2)];
            const ni = p.b.i + di, nj = p.b.j + dj;
            if (ni >= 0 && nj >= 0 && ni < N && nj < N) { p.b = G.city.blocks[ni * N + nj]; p.c = nc; }
            else p.c = (p.c + p.cw + 4) % 4;
          } else p.c = (p.c + p.cw + 4) % 4;
          [p.tx, p.tz] = this.ringCorner(p.b, p.c);
          hx = p.tx - ch.x; hz = p.tz - ch.z;
        }
      }
      const l = Math.hypot(hx, hz) || 1;
      ch.h += wrap(Math.atan2(hx, hz) - ch.h) * Math.min(1, dt * 6);
      ch.speed = sp;
      this.moveChar(ch, Math.sin(ch.h) * sp * dt, Math.cos(ch.h) * sp * dt);
      ch.y = G.city.groundY(ch.x, ch.z);
      ch.update(dt, ch.y);
    }
  }

  // ------------------------------------------------------------------ cars hitting people / wrecks
  updateCars(dt) {
    const G = this.G, fx = G.fx;
    for (const car of G.cars) {
      // impacts hurt the car
      if (car.lastImpact > 7 && !car.wreck) {
        car.health -= (car.lastImpact - 7) * 2.4;
        if (car.driver === 'player') { G.sfx.crash(car.lastImpact); fx.shake = Math.min(1.2, fx.shake + car.lastImpact * 0.03); }
        car.lastImpact = 0;
      }
      const hx = car.x + Math.sin(car.h) * 1.5, hz = car.z + Math.cos(car.h) * 1.5;
      if (!car.wreck && car.health < 45 && Math.random() < 0.35) fx.engineSmoke(hx, car.y + 0.9, hz, car.health < 22);
      if (!car.wreck && car.health <= 0) {
        car.burnT = (car.burnT || 0) + dt;
        fx.flame(hx, car.y + 0.8, hz, 0.8);
        if (car.burnT > 2.6) this.explodeCar(car);
      }
      if (car.wreck) {
        car.wreckT += dt;
        if (car.wreckT < 14) { fx.flame(car.x + rnd(-0.8, 0.8), car.y + 0.6, car.z + rnd(-0.8, 0.8), 1.1); if (Math.random() < 0.5) fx.engineSmoke(car.x, car.y + 1.4, car.z, true); }
        continue;
      }
      // running people over
      if (car.speed > 2.5) {
        const cfx = Math.sin(car.h), cfz = Math.cos(car.h);
        for (const ch of G.chars) {
          if (ch.dead || !ch.root.visible || ch === G.player.ch && G.player.car) continue;
          const dx = ch.x - car.x, dz = ch.z - car.z;
          if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
          const ahead = dx * cfx + dz * cfz, lat = dx * -cfz + dz * cfx;
          if (Math.abs(ahead) < 2.5 && Math.abs(lat) < 1.25) {
            if (car.speed > 5) {
              if (ch === G.player.ch) G.hurtPlayer(car.speed * 4);
              else {
                ch.kill(car.vx * 0.7 + (lat > 0 ? -cfz : cfz) * 2, car.vz * 0.7 + (lat > 0 ? cfx : -cfx) * 2, 3 + car.speed * 0.12);
                G.sfx.thud();
                if (car.driver === 'player') { this.crime(1, ch.kind === 'cop' ? 3 : 1); this.alertPeds(ch.x, ch.z, 30); if (ch.kind === 'ped' && Math.random() < 0.5) this.dropCash(ch.x, ch.z, Math.round(rnd(10, 90))); }
              }
              car.vx *= 0.93; car.vz *= 0.93;
            }
          }
        }
      }
    }
  }
  explodeCar(car) {
    const G = this.G;
    _a.set(car.x, car.y + 0.4, car.z);
    G.fx.explode(_a, 1.2);
    const f = this.focus(), d = Math.hypot(car.x - f.x, car.z - f.z);
    G.sfx.explosion(clamp(1.3 - d / 90, 0.1, 1));
    car.wreck = true; car.wreckT = 0; car.health = 0; car.vx = car.vz = 0;
    car.paint.color.setHex(0x0c0c0c); car.paint.roughness = 0.95; car.paint.clearcoat = 0; car.farMat.color.setHex(0x0c0c0c);
    for (const ch of G.chars) {
      if (ch.dead) continue;
      const dx = ch.x - car.x, dz = ch.z - car.z, dd = Math.hypot(dx, dz);
      if (dd < 9) { if (ch === G.player.ch) { if (!G.player.car) G.hurtPlayer(140 - dd * 12); } else ch.kill((dx / (dd || 1)) * 7, (dz / (dd || 1)) * 7, 6); }
    }
    for (const o of G.cars) { if (o === car || o.wreck) continue; const dd = Math.hypot(o.x - car.x, o.z - car.z); if (dd < 8) { o.health -= 70 - dd * 6; o.vx += ((o.x - car.x) / dd) * 6; o.vz += ((o.z - car.z) / dd) * 6; } }
    if (G.player.car === car) G.hurtPlayer(999);
    if (d < 120) this.crime(1, 2);
    this.alertPeds(car.x, car.z, 70);
    const u = this.units.find((q) => q.car === car); if (u) u.dead = true;
  }

  // ------------------------------------------------------------------ police
  makeUnit() {
    const G = this.G;
    const car = new Car(G.makeCar(0x0b1226), 0, 0, 0); car.origColor = 0x0b1226;
    const mk = (c, x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.2), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, 1.2, -0.28); car.body.add(m); return m; };
    car.bar = [mk(0xff0000, 0.3), mk(0x0033ff, -0.3)];
    car.driver = 'police'; car.root.visible = false;
    G.scene.add(car.root); G.cars.push(car);
    const cops = [0, 1].map(() => { const ch = G.makeChar('cop'); ch.kind = 'cop'; ch.giveGun(false); ch.root.visible = false; G.scene.add(ch.root); G.chars.push(ch); return { ch, fireT: 1, unit: null }; });
    const u = { car, cops, ai: { car, i: 0, j: 0, dir: 0 }, state: 'idle', stuck: 0, rev: 0, direct: false, leaving: false, dead: false };
    cops.forEach((c) => { c.unit = u; this.cops.push(c); });
    this.units.push(u);
    return u;
  }
  activateUnit(u) {
    this.repair(u.car);
    if (!this.placeOnRoad(u.car, u.ai, 110, 200, false)) return false;
    u.car.root.visible = true; u.car.driver = 'police'; u.state = 'pursue'; u.leaving = false; u.dead = false; u.stuck = 0; u.direct = false;
    for (const c of u.cops) { c.ch.root.visible = false; c.ch.revive(); }
    return true;
  }
  retireUnit(u) {
    u.state = 'idle'; u.car.root.visible = false; u.car.x = 9999; u.car.z = 9999 + this.units.indexOf(u) * 20; u.car.vx = u.car.vz = 0; u.car.sync(0);
    for (const c of u.cops) { c.ch.root.visible = false; c.ch.x = 9999; }
  }
  relocate(ai) {
    const car = ai.car;
    let dir = ((Math.round(car.h / (Math.PI / 2)) % 4) + 4) % 4;
    let i = clamp(Math.round((car.x - O) / P), 0, N), j = clamp(Math.round((car.z - O) / P), 0, N);
    const along = (road(i) - car.x) * DIRS[dir][0] + (road(j) - car.z) * DIRS[dir][1];
    if (along < 0) { const ni = i + DIRS[dir][0], nj = j + DIRS[dir][1]; if (ni >= 0 && nj >= 0 && ni <= N && nj <= N) { i = ni; j = nj; } else dir = (dir + 2) % 4; }
    ai.i = i; ai.j = j; ai.dir = dir;
  }
  updatePolice(dt) {
    const G = this.G, f = this.focus(), w = this.wanted;
    this.crimeT -= dt;
    const want = [0, 1, 2, 2, 3, 4][w];
    let active = this.units.filter((u) => u.state !== 'idle' && !u.leaving && !u.dead).length;
    this.spawnT = (this.spawnT || 0) - dt;
    if (active < want && this.spawnT <= 0) {
      let u = this.units.find((q) => q.state === 'idle');
      if (!u && this.units.length < 4) u = this.makeUnit();
      if (u && this.activateUnit(u)) this.spawnT = 2.5; else this.spawnT = 1;
    }
    let seen = false;
    const flash = Math.floor(G.time * 5) % 2;
    for (const u of this.units) {
      if (u.state === 'idle') continue;
      const car = u.car, dist = Math.hypot(car.x - f.x, car.z - f.z);
      car.bar[0].material.color.setRGB(flash ? 14 : 0.3, 0, 0); car.bar[1].material.color.setRGB(0, flash ? 0.05 : 1.2, flash ? 0.4 : 16);
      if ((u.leaving || u.dead) && (dist > 140 || !this.inView(car.x, car.z)) && dist > 60) { this.retireUnit(u); continue; }
      if (dist > 300) { this.retireUnit(u); continue; }
      if (u.dead || car.wreck) continue;
      if (dist < 85 && !u.leaving) seen = true;
      if (u.state === 'pursue') {
        const blocked = dist > 60 || this.lineBlocked(car.x, car.z, f.x, f.z);
        if (u.leaving) { this.laneStep(u.ai, dt, 12, true, false); continue; }
        if (!blocked) {
          u.direct = true;
          const slowTarget = f.onFoot ? dist < 16 : (f.speed < 2.5 && dist < 11);
          if (slowTarget) {
            car.update(dt, { throttle: car.vF > 0.5 ? -1 : 0, steer: 0, handbrake: true }, G.city, G.cars);
            if (car.speed < 1.5) this.deploy(u);
          } else if (u.rev > 0) {
            u.rev -= dt; car.update(dt, { throttle: -1, steer: u.revSteer, handbrake: false }, G.city, G.cars);
          } else {
            const lead = Math.min(1.1, dist / 28);
            const err = wrap(Math.atan2(f.x + f.vx * lead - car.x, f.z + f.vz * lead - car.z) - car.h);
            const vt = Math.abs(err) > 1.2 ? 9 : clamp(f.speed + 9, 15, 38);
            this.driveTo(car, dt, err, vt);
            u.stuck = car.speed < 1 ? u.stuck + dt : 0;
            if (u.stuck > 1.6) { u.rev = 1.3; u.revSteer = Math.random() < 0.5 ? 1 : -1; u.stuck = 0; }
          }
        } else {
          if (u.direct) { this.relocate(u.ai); u.direct = false; }
          if (u.rev > 0) { u.rev -= dt; car.update(dt, { throttle: -1, steer: u.revSteer, handbrake: false }, G.city, G.cars); }
          else {
            this.laneStep(u.ai, dt, 22 + w * 2.5, false, true);
            u.stuck = car.speed < 1 ? u.stuck + dt : 0;
            if (u.stuck > 2.5) { u.rev = 1.4; u.revSteer = Math.random() < 0.5 ? 1 : -1; u.stuck = 0; }
          }
        }
      } else if (u.state === 'deployed') {
        car.update(dt, { throttle: 0, steer: 0, handbrake: true }, G.city, G.cars);
        // everyone back in the car if the suspect drives off
        const alive = u.cops.filter((c) => !c.ch.dead);
        if (!alive.length) { u.dead = true; continue; }
        if (dist > 55 && !f.onFoot) {
          for (const c of alive) c.ch.root.visible = false;
          u.state = 'pursue'; this.relocate(u.ai); u.direct = false;
        }
      }
    }
    for (const c of this.cops) this.updateCop(c, dt, f);
    // wanted level decays once nobody has eyes on the player
    this.seen = seen;
    if (w > 0) {
      if (seen) this.evadeT = 0; else this.evadeT += dt;
      if (this.evadeT > 10 + w * 3.5) { this.clearWanted(); G.toast('You lost the police'); }
    }
    G.sfx.siren(w > 0 && this.units.some((u) => u.state !== 'idle' && !u.dead && Math.hypot(u.car.x - f.x, u.car.z - f.z) < 160));
  }
  deploy(u) {
    const car = u.car, rx = -Math.cos(car.h), rz = Math.sin(car.h);
    u.state = 'deployed';
    u.cops.forEach((c, k) => {
      if (c.ch.dead) return;
      const s = k ? 1.9 : -1.9;
      c.ch.place(car.x + rx * s, car.z + rz * s, car.h, car.y); c.ch.root.visible = true; c.fireT = rnd(0.8, 1.6);
    });
  }
  updateCop(c, dt, f) {
    const G = this.G, ch = c.ch;
    if (!ch.root.visible) return;
    const gy = G.city.groundY(ch.x, ch.z);
    if (ch.dead) { ch.update(dt, gy); return; }
    const dx = f.x - ch.x, dz = f.z - ch.z, dist = Math.hypot(dx, dz);
    if (dist < 85) this.seen = true;
    ch.h += wrap(Math.atan2(dx, dz) - ch.h) * Math.min(1, dt * 8);
    const w = this.wanted;
    const blocked = dist > 9 && this.lineBlocked(ch.x, ch.z, f.x, f.z);
    const range = w >= 2 ? 13 : 1.4;
    if (w === 0 || c.unit.leaving) { ch.speed = 0; ch.aiming = false; }
    else if (dist > range || blocked) {
      ch.speed = 5.3; ch.aiming = false;
      this.moveChar(ch, Math.sin(ch.h) * 5.3 * dt, Math.cos(ch.h) * 5.3 * dt);
    } else {
      ch.speed = 0;
      if (w >= 2) {
        ch.aiming = true;
        ch.aim.set(dx, (f.y + 1.2) - (ch.y + 1.4), dz);
        c.fireT -= dt;
        if (c.fireT <= 0) {
          c.fireT = rnd(0.5, 1.0) / (1 + w * 0.12);
          ch.root.updateMatrixWorld(true);
          ch.muzzle(_a);
          const pHit = clamp(0.7 - dist * 0.035, 0.12, 0.6) * (f.onFoot ? 1 : 0.6) * (f.speed > 5 ? 0.6 : 1);
          const hit = Math.random() < pHit;
          _b.set(f.x + (hit ? 0 : rnd(-1.2, 1.2)), f.y + (hit ? 1.2 : rnd(0.2, 2.4)), f.z + (hit ? 0 : rnd(-1.2, 1.2)));
          G.fx.tracer(_a, _b); G.fx.muzzle(_a); ch.kick();
          G.sfx.gun(0, clamp(1.1 - dist / 40, 0.25, 1));
          if (hit) { if (G.player.car) { G.player.car.health -= 5; G.hurtPlayer(3); } else G.hurtPlayer(9 + w); }
        }
      } else if (f.onFoot && f.speed < 1.5 && dist < 1.6) G.busted();
    }
    ch.y = gy;
    ch.update(dt, gy);
  }

  // ------------------------------------------------------------------ courier jobs + pickups
  newJob() {
    const G = this.G, f = this.focus();
    for (let t = 0; t < 40; t++) {
      const i = 1 + Math.floor(Math.random() * (N - 1)), j = 1 + Math.floor(Math.random() * (N - 1));
      const x = road(i) + (Math.random() < 0.5 ? 3.4 : -3.4), z = road(j) + rnd(20, P - 20);
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < 180 || d > 520) continue;
      this.job = { x, z, pay: Math.round((180 + d * 0.9) / 10) * 10, zone: districtAt(x, z).name, t: 0 };
      this.marker.position.set(x, G.city.groundY(x, z) + 0.6, z); this.marker.visible = true;
      G.mission(`Deliver the package to <b>${this.job.zone}</b> · $${this.job.pay}`);
      return;
    }
  }
  updateJob(dt) {
    const G = this.G, f = this.focus();
    if (!this.job) { this.jobT = (this.jobT || 2) - dt; if (this.jobT <= 0) this.newJob(); return; }
    this.marker.children[0].rotation.y += dt * 0.8;
    this.marker.children[0].scale.setScalar(1 + Math.sin(G.time * 3) * 0.06);
    if (Math.hypot(this.job.x - f.x, this.job.z - f.z) < 4.2 && f.speed < 14) {
      G.addCash(this.job.pay); G.sfx.pickup(); this.jobs++;
      G.toast(`Delivery complete  +$${this.job.pay}`);
      this.job = null; this.marker.visible = false; this.jobT = 3;
    }
  }
  updatePickups(dt) {
    const G = this.G, f = this.focus();
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]; p.t += dt;
      p.s.position.y = G.city.groundY(p.x, p.z) + 0.5 + Math.sin(p.t * 4) * 0.08;
      const d = Math.hypot(p.x - f.x, p.z - f.z);
      if (d < 1.8 && f.onFoot || p.t > 60) {
        if (p.t <= 60) { G.addCash(p.amount); G.sfx.pickup(); }
        G.scene.remove(p.s); this.pickups.splice(i, 1);
      }
    }
  }

  update(dt) {
    this.updateTraffic(dt);
    this.updatePeds(dt);
    this.updatePolice(dt);
    this.updateCars(dt);
    this.updateJob(dt);
    this.updatePickups(dt);
  }
}
