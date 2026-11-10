import * as THREE from 'three';
import { N, road } from './city.js';

// Scripted public transit: a cable car on x = road(3) (north-south) and a bus on z = road(5) (east-west).
// Heading h: forward = (sin h, 0, cos h), right-hand vector = (-fz, fx). Traffic keeps right, 1.7 m off the centre line.

const LANE = 1.7;
const ACC = 2.5;          // m/s^2 speed-up
const DEC = 2.2;          // m/s^2 used for planned (comfortable) stops
const BRAKE = 8;          // m/s^2 hard limit when something is suddenly in the way
const DWELL = 4;          // seconds stopped at terminals and bus stops
const STOP_LINE = 12.2;   // stop line distance before an intersection centre
const OFFS = [1.35, 0, -1.35];
const clamp = THREE.MathUtils.clamp;
const _n = { lx: 0, lz: 0, pen: 0 };

// circle (local box coords lx, lz, radius r) against a box with half extents hw (local x) and hl (local z)
function boxPen(lx, lz, r, hw, hl, out) {
  const px = clamp(lx, -hw, hw), pz = clamp(lz, -hl, hl);
  const dx = lx - px, dz = lz - pz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-8) { const d = Math.sqrt(d2); out.lx = dx / d; out.lz = dz / d; out.pen = r - d; return true; }
  // centre is inside the box: leave through the nearest face
  const a = hw - lx, b = lx + hw, c = hl - lz, e = lz + hl, m = Math.min(a, b, c, e);
  if (m === a) { out.lx = 1; out.lz = 0; } else if (m === b) { out.lx = -1; out.lz = 0; } else if (m === c) { out.lx = 0; out.lz = 1; } else { out.lx = 0; out.lz = -1; }
  out.pen = m + r;
  return true;
}

function loadTex(url, onLoad) {
  new THREE.TextureLoader().load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    onLoad(t);
  }, undefined, () => console.warn('[transit] could not load', url));
}

function applyMap(mats, tex) {
  for (const m of mats) { m.map = tex; m.color.set(0xffffff); m.needsUpdate = true; }
}

// Repaint the real-world lettering on the tram side image with invented text.
function tramSideTexture(src) {
  const img = src.image, w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  g.setTransform(w / 1536, 0, 0, h / 658, 0, 0);   // work in the 1536x658 pixel space
  const serif = 'Georgia, "Times New Roman", serif';
  const band = (x0, y0, x1, y1, fill, ink, text, size, spacing) => {
    g.fillStyle = fill; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    let s = size;
    for (; s > 12; s -= 1) {
      g.font = `bold ${s}px ${serif}`;
      if ('letterSpacing' in g) g.letterSpacing = `${spacing}px`;
      if (g.measureText(text).width <= (x1 - x0) - 40) break;
    }
    g.fillText(text, (x0 + x1) / 2, (y0 + y1) / 2 + 1);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
  };
  band(340, 78, 1325, 116, '#5a1220', '#e2bf68', 'FOG CITY HILL LINE', 32, 4);
  band(758, 553, 1452, 603, '#e8d9a8', '#5a1220', 'HILL & HARBOR TRACTION CO.', 28, 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

const std = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });

const DEFS = [
  {
    name: 'cable car', axis: 'z', c: road(3), s0: road(0) + 22, s1: road(N) - 22, d: 1, s: road(1) + 46,
    L: 7.7, W: 2.4, H: 3.3, lift: 0.45, cruise: 6, sig: 0, stops: [], yields: [],
    side: 'assets/gen/tram_side.jpg', front: 'assets/gen/tram_front.jpg', tram: true,
    colors: { side: 0x5a1220, roof: 0x3a1a16, front: 0x6b2a20 },
  },
  {
    name: 'bus', axis: 'x', c: road(5), s0: road(0) + 22, s1: road(N) - 22, d: 1, s: road(3) + 46,
    L: 7.6, W: 2.55, H: 3.25, lift: 0, cruise: 10, sig: 1, yields: [0],
    stops: [0, 2, 4, 6].map((k) => (road(k) + road(k + 1)) / 2),   // middle of every second block
    side: 'assets/gen/bus_side.jpg', front: 'assets/gen/bus_front.jpg',
    colors: { side: 0xe8ecee, roof: 0xcfd4d8, front: 0xe8ecee },
  },
];

class TransitVehicle {
  constructor(def, scene, G) {
    Object.assign(this, def);
    this.G = G;
    this.speed = 0; this.dwell = 0; this.flip = false; this.served = new Set();
    this.x = 0; this.z = 0; this.y = 0; this.h = 0; this.pitch = 0;

    const col = def.colors, dark = () => std(0x17181a);
    const sideA = std(col.side), sideB = std(col.side), roof = std(col.roof), under = dark(), front = std(col.front), back = std(col.front);
    this.sideMats = [sideA, sideB]; this.endMats = [front, back];
    const root = new THREE.Group(); root.rotation.order = 'YXZ';
    const body = new THREE.Mesh(new THREE.BoxGeometry(def.W, def.H, def.L), [sideA, sideB, roof, under, front, back]);
    body.position.y = def.lift + def.H / 2; body.castShadow = true; body.receiveShadow = true;
    root.add(body);
    if (def.lift > 0) {
      const carriage = new THREE.Mesh(new THREE.BoxGeometry(def.W * 0.72, 0.32, def.L * 0.8), dark());
      carriage.position.y = def.lift - 0.1; carriage.castShadow = true; root.add(carriage);
      const wg = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 14).rotateZ(Math.PI / 2);
      for (const [wx, wz] of [[-0.8, 2.5], [0.8, 2.5], [-0.8, -2.5], [0.8, -2.5]]) {
        const wh = new THREE.Mesh(wg, dark()); wh.position.set(wx, 0.22, wz); wh.castShadow = true; root.add(wh);
      }
    }
    this.root = root;
    scene.add(root);

    loadTex(def.front, (t) => applyMap(this.endMats, t));
    if (def.tram) loadTex(def.side, (t) => { const c = tramSideTexture(t); t.dispose(); applyMap(this.sideMats, c); });
    else loadTex(def.side, (t) => applyMap(this.sideMats, t));

    this.place();
    this.groundSnap(1);
  }

  // position and heading from route coordinate s and direction d
  place() {
    const d = this.d;
    if (this.axis === 'z') { this.x = this.c - LANE * d; this.z = this.s; this.h = d > 0 ? 0 : Math.PI; }
    else { this.x = this.s; this.z = this.c + LANE * d; this.h = d > 0 ? Math.PI / 2 : -Math.PI / 2; }
  }

  groundSnap(k) {
    const city = this.G.city, fx = Math.sin(this.h), fz = Math.cos(this.h), hl = this.L / 2;
    const gf = city.groundY(this.x + fx * hl, this.z + fz * hl), gr = city.groundY(this.x - fx * hl, this.z - fz * hl);
    this.y += ((gf + gr) / 2 - this.y) * k;
    this.pitch += (Math.atan2(gr - gf, this.L) - this.pitch) * k;
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.set(this.pitch, this.h, 0);
  }

  step(dt, tr) {
    const G = this.G, d = this.d;
    let vt = this.cruise;
    if (this.dwell > 0) {
      this.dwell -= dt; vt = 0; this.speed = 0;
      if (this.dwell <= 0) {
        this.dwell = 0;
        if (this.flip) { this.flip = false; this.d = -this.d; this.served.clear(); this.place(); }
      }
    } else {
      // nearest planned stop: the terminal, or an unserved bus stop
      let dd = d * ((d > 0 ? this.s1 : this.s0) - this.s), stopI = -1;
      for (let i = 0; i < this.stops.length; i++) {
        if (this.served.has(i)) continue;
        const q = d * (this.stops[i] - this.s);
        if (q > -0.3 && q < dd) { dd = q; stopI = i; }
      }
      vt = Math.min(vt, Math.sqrt(2 * DEC * Math.max(0, dd)));
      if (dd < 0.3 && this.speed < 1.5) {
        this.speed = 0; this.dwell = DWELL; vt = 0;
        if (stopI < 0) { this.flip = true; this.s = d > 0 ? this.s1 : this.s0; } else this.served.add(stopI);
      }

      // signals: stop at the line unless it has already been passed (or a yellow is too late to stop for)
      const sig = G.props.signal(this.sig);
      if (sig !== 2) {
        const sf = this.s + d * this.L / 2;
        for (let k = 0; k <= N; k++) {
          const dist = d * (road(k) - sf) - STOP_LINE;
          if (dist <= -1 || dist > 80) continue;
          if (sig === 1 && dist < this.speed * this.speed / 7) continue;
          vt = Math.min(vt, Math.sqrt(2 * DEC * Math.max(0, dist - 0.3)));
        }
      }

      // anything in the lane ahead
      const fx = Math.sin(this.h), fz = Math.cos(this.h), rx = -fz, rz = fx, hl = this.L / 2;
      const test = (ox, oz, latMax, margin) => {
        const dx = ox - this.x, dz = oz - this.z, ahead = dx * fx + dz * fz - hl;
        if (ahead < -1 || ahead > 9 || Math.abs(dx * rx + dz * rz) >= latMax) return;
        vt = Math.min(vt, Math.sqrt(2 * 6 * Math.max(0, ahead - margin)));
      };
      for (const o of G.cars) test(o.x, o.z, 2, 3);
      for (const ch of G.chars) if (!ch.dead && ch.root.visible) test(ch.x, ch.z, 2, 2);
      for (const i of this.yields) {
        const o = tr.vehicles[i], ofx = Math.sin(o.h), ofz = Math.cos(o.h);
        for (const k of [-3.6, -1.8, 0, 1.8, 3.6]) test(o.x + ofx * k, o.z + ofz * k, 2.4, 3);
      }
    }
    this.speed += clamp(vt - this.speed, -BRAKE * dt, ACC * dt);
    if (this.speed < 0) this.speed = 0;
    if (this.dwell === 0) this.s = clamp(this.s + this.d * this.speed * dt, this.s0, this.s1);
    this.place();
    this.groundSnap(Math.min(1, dt * 8));
  }

  collideCars(G) {
    const fx = Math.sin(this.h), fz = Math.cos(this.h), rx = -fz, rz = fx;
    const hw = this.W / 2 + 0.15, hl = this.L / 2 + 0.15, tvx = fx * this.speed, tvz = fz * this.speed;
    for (const car of G.cars) {
      if (Math.hypot(car.x - this.x, car.z - this.z) > 12) continue;
      const cfx = Math.sin(car.h), cfz = Math.cos(car.h);
      let moved = false;
      for (const off of OFFS) {
        const dx = car.x + cfx * off - this.x, dz = car.z + cfz * off - this.z;
        if (!boxPen(dx * rx + dz * rz, dx * fx + dz * fz, 1.05, hw, hl, _n)) continue;
        const nx = _n.lx * rx + _n.lz * fx, nz = _n.lx * rz + _n.lz * fz;
        car.x += nx * _n.pen; car.z += nz * _n.pen; moved = true;
        const rn = (car.vx - tvx) * nx + (car.vz - tvz) * nz;
        if (rn < 0) {
          car.vx -= 1.2 * rn * nx; car.vz -= 1.2 * rn * nz;
          car.lastImpact = Math.max(car.lastImpact || 0, -rn);
        }
      }
      if (moved && car.sync) car.sync(0);
    }
  }

  collideChars(G, now) {
    const fx = Math.sin(this.h), fz = Math.cos(this.h), rx = -fz, rz = fx;
    const hw = this.W / 2 + 0.15, hl = this.L / 2 + 0.15;
    for (const ch of G.chars) {
      if (ch.dead || !ch.root.visible) continue;
      const dx = ch.x - this.x, dz = ch.z - this.z;
      if (Math.abs(dx) > 12 || Math.abs(dz) > 12) continue;
      if (!boxPen(dx * rx + dz * rz, dx * fx + dz * fz, 0.4, hw, hl, _n)) continue;
      ch.x += (_n.lx * rx + _n.lz * fx) * _n.pen; ch.z += (_n.lx * rz + _n.lz * fz) * _n.pen;
      if (this.speed > 3 && ch === G.player.ch && !G.player.car && now - (this.lastHurt ?? -9) >= 1) {
        this.lastHurt = now; G.hurtPlayer(30);
      }
    }
  }
}

export class Transit {
  constructor(G) {
    this.G = G; this.t = 0;
    this.vehicles = DEFS.map((def) => new TransitVehicle(def, G.scene, G));
  }

  update(dt) {
    this.t += dt;
    for (const v of this.vehicles) v.step(dt, this);
    for (const v of this.vehicles) { v.collideCars(this.G); v.collideChars(this.G, this.t); }
  }
}
