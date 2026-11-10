import * as THREE from 'three';
import { N, P, HALF, CURB, SIDEWALK, CITY_MAX, CITY_MIN, RIM, road, mulberry, mergeGeos, cityUniforms, drape, terrain } from './city.js';

// ---- palms -----------------------------------------------------------------
function frondTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 1024;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 1024);
  const r = mulberry(77);
  // leaflets: thin tapered blades leaving the rib, longest mid-frond
  for (let i = 0; i < 150; i++) {
    const t = i / 150, y = 1010 - t * 990;
    const len = (0.25 + Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.75) * 118 * (0.85 + r() * 0.3);
    for (const s of [-1, 1]) {
      const g = 70 + r() * 70, shade = 0.75 + r() * 0.35;
      x.strokeStyle = `rgb(${Math.round(38 * shade)},${Math.round(g * shade)},${Math.round(22 * shade)})`;
      x.lineWidth = 5.5 - t * 2.5;
      x.beginPath(); x.moveTo(128, y); x.quadraticCurveTo(128 + s * len * 0.6, y - len * 0.42, 128 + s * len, y - len * (0.62 + r() * 0.2)); x.stroke();
    }
  }
  x.strokeStyle = '#6a7a2c'; x.lineWidth = 7; x.beginPath(); x.moveTo(128, 1024); x.lineTo(128, 12); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function barkTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#7b6a55'; x.fillRect(0, 0, 128, 512);
  const r = mulberry(5);
  for (let y = 0; y < 512; y += 9) { x.fillStyle = `rgba(30,22,14,${0.25 + r() * 0.35})`; x.fillRect(0, y + r() * 3, 128, 2 + r() * 2.5); x.fillStyle = `rgba(190,170,140,${r() * 0.18})`; x.fillRect(0, y + 4, 128, 3); }
  for (let i = 0; i < 500; i++) { x.fillStyle = `rgba(20,14,8,${r() * 0.3})`; x.fillRect(r() * 128, r() * 512, 2, 4 + r() * 10); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 9);
  return t;
}

function palmGeometry(seed) {
  const r = mulberry(seed);
  const H = 8.5 + r() * 4.5, bend = (r() - 0.5) * 2.4, bendZ = (r() - 0.5) * 1.6;
  const trunk = new THREE.CylinderGeometry(0.13, 0.23, H, 16, 14, true);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const t = (tp.getY(i) + H / 2) / H;
    const sw = 1 + 0.28 * Math.exp(-t * 9);          // flared base
    tp.setXYZ(i, tp.getX(i) * sw + bend * t * t, t * H, tp.getZ(i) * sw + bendZ * t * t);
  }
  trunk.computeVertexNormals();
  const top = new THREE.Vector3(bend, H, bendZ);

  const fronds = [];
  const nF = 17 + Math.floor(r() * 6), ROWS = 9;
  for (let k = 0; k < nF; k++) {
    const az = (k / nF) * Math.PI * 2 + r() * 0.5;
    const ring = k % 3;                                // three tiers: upright, spreading, drooping
    const elev = ring === 0 ? 0.95 + r() * 0.3 : ring === 1 ? 0.45 + r() * 0.3 : 0.0 + r() * 0.25;
    const droop = ring === 0 ? 1.5 : ring === 1 ? 1.7 : 1.5;
    const L = 3.3 + r() * 1.3, W = 1.05 + r() * 0.3;
    const pos = [], uv = [], idx = [];
    let py = 0, pr = 0;
    for (let i = 0; i <= ROWS; i++) {
      const s = i / ROWS, ang = elev - droop * Math.pow(s, 1.35);
      if (i > 0) { py += Math.sin(ang) * (L / ROWS); pr += Math.cos(ang) * (L / ROWS); }
      const w = W * (0.35 + Math.sin(Math.pow(s, 0.8) * Math.PI) * 0.65);
      for (const side of [-1, 0, 1]) {
        const lx = side * w * 0.5, fold = Math.abs(side) * 0.20 * w;      // V cross-section
        // local frame: frond runs along +Z (radial), lx is tangential
        const x = Math.cos(az) * lx + Math.sin(az) * pr, z = -Math.sin(az) * lx + Math.cos(az) * pr;
        pos.push(top.x + x, top.y + py + fold - 0.1, top.z + z);
        uv.push(side * 0.5 + 0.5, 1 - s);
      }
      if (i < ROWS) { const a = i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    fronds.push(g);
  }
  // coconuts / crown boss
  const boss = new THREE.SphereGeometry(0.42, 8, 6); boss.translate(top.x, top.y - 0.15, top.z);
  return { trunk: mergeGeos([trunk, boss]), crown: mergeGeos(fronds), H };
}

function swayMaterial(mat, strength) {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = cityUniforms.uTime;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          #else
          vec3 ip = vec3(0.0);
          #endif
          float ph = ip.x * 0.31 + ip.z * 0.17;
          float hgt = max(transformed.y, 0.0);
          float w = sin(uTime * 1.1 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.7 + transformed.x) * 0.4;
          transformed.x += w * ${strength.toFixed(3)} * hgt * hgt * 0.012;
          transformed.z += cos(uTime * 0.9 + ph) * ${strength.toFixed(3)} * hgt * hgt * 0.008;
          transformed.y += sin(uTime * 3.1 + ph + transformed.x * 2.0 + transformed.z * 2.0) * ${strength.toFixed(3)} * 0.02 * step(6.0, hgt);
        }`);
  };
  mat.customProgramCacheKey = () => 'sway' + strength;
  return mat;
}

// ---- street furniture ------------------------------------------------------
function lampGeometry() {
  const pole = new THREE.CylinderGeometry(0.065, 0.11, 8.2, 10); pole.translate(0, 4.1, 0);
  const base = new THREE.CylinderGeometry(0.17, 0.2, 0.5, 10); base.translate(0, 0.25, 0);
  const arm = new THREE.BoxGeometry(2.5, 0.09, 0.09); arm.rotateZ(0.08); arm.translate(1.2, 8.2, 0);
  const head = new THREE.BoxGeometry(0.85, 0.13, 0.34); head.translate(2.45, 8.27, 0);
  return mergeGeos([pole, base, arm, head]);
}
function signalGeometry() {
  const pole = new THREE.CylinderGeometry(0.1, 0.14, 6.4, 10); pole.translate(0, 3.2, 0);
  const base = new THREE.CylinderGeometry(0.22, 0.26, 0.6, 10); base.translate(0, 0.3, 0);
  const arm = new THREE.CylinderGeometry(0.07, 0.09, 6.2, 8); arm.rotateZ(Math.PI / 2); arm.translate(3.1, 6.1, 0);
  const parts = [pole, base, arm];
  for (const hx of [2.6, 5.6]) {
    const box = new THREE.BoxGeometry(0.42, 1.25, 0.34); box.translate(hx, 5.35, 0);
    const visor = new THREE.BoxGeometry(0.5, 1.35, 0.06); visor.translate(hx, 5.35, 0.2);
    parts.push(box, visor);
  }
  return mergeGeos(parts);
}

export function buildProps(A, scene, city) {
  const rand = mulberry(4242);
  const group = new THREE.Group();
  scene.add(group);
  const poles = [];            // thin colliders: { x, z, r }
  const dummy = new THREE.Object3D();

  // ---------- ground patches: parks + parking lots ----------
  const GT = A.tex.sparse_grass;
  const grassGeo = [], lotGeo = [], lotLines = [];
  const parking = [];          // { x, z, h }
  const palmSpots = [];
  const quad = (x0, x1, z0, z1, y, s) => drape(x0, x1, z0, z1, y, s, 5);
  for (const b of city.blocks) {
    if (b.kind === 'park') {
      grassGeo.push(quad(b.x0 + 3.2, b.x1 - 3.2, b.z0 + 3.2, b.z1 - 3.2, CURB + 0.03, 3));
      const mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
      for (let k = 0; k < 16; k++) { const px = b.x0 + 6 + rand() * (b.x1 - b.x0 - 12), pz = b.z0 + 6 + rand() * (b.z1 - b.z0 - 12); if (!b.summit || Math.hypot(px - mx, pz - mz) > 14) palmSpots.push([px, pz]); }
    } else if (b.kind === 'vic') {
      // shared back gardens between the two rows of houses
      grassGeo.push(quad(b.x0 + SIDEWALK + 0.5, b.x1 - SIDEWALK - 0.5, b.z0 + SIDEWALK + 15.4, b.z1 - SIDEWALK - 15.4, CURB + 0.03, 3));
    } else if (b.kind === 'lot') {
      lotGeo.push(quad(b.x0 + 2.5, b.x1 - 2.5, b.z0 + 2.5, b.z1 - 2.5, CURB + 0.02, 4.5));
      for (let row = 0; row < 3; row++) {
        const z = b.z0 + 12 + row * 22;
        for (let x = b.x0 + 6; x < b.x1 - 6; x += 2.9) {
          lotLines.push(quad(x - 0.06, x + 0.06, z - 2.6, z + 2.6, CURB + 0.035, 1));
          if (rand() < 0.42 && x + 2.9 < b.x1 - 6) parking.push({ x: x + 1.45, z, h: rand() < 0.5 ? 0 : Math.PI, y: terrain(x + 1.45, z) + CURB });
        }
      }
    }
  }
  if (grassGeo.length) {
    const m = new THREE.Mesh(mergeGeos(grassGeo), new THREE.MeshStandardMaterial({ map: GT.map, normalMap: GT.normalMap, roughnessMap: GT.arm, color: 0xb6d08a }));
    m.receiveShadow = true; group.add(m);
  }
  if (lotGeo.length) {
    const AT = A.tex.asphalt_02;
    const m = new THREE.Mesh(mergeGeos(lotGeo), new THREE.MeshStandardMaterial({ map: AT.map, normalMap: AT.normalMap, roughnessMap: AT.arm, color: 0x6f6f6f }));
    m.receiveShadow = true; group.add(m);
    const l = new THREE.Mesh(mergeGeos(lotLines), new THREE.MeshStandardMaterial({ color: 0xdedcd2, roughness: 0.7 }));
    l.receiveShadow = true; group.add(l);
  }

  // ---------- palms ----------
  const south = CITY_MAX + RIM * 0.45;
  for (let x = CITY_MIN + 4; x < CITY_MAX; x += 12.5) palmSpots.push([x + rand() * 2, south + rand() * 1.2]);
  for (let k = 0; k <= N; k++) {
    // beach boulevard, inland side, and two palm-lined avenues
    if (k < N) for (let x = road(k) + 16; x < road(k + 1) - 14; x += 15) palmSpots.push([x, road(N) - HALF - 1.3]);
    for (const a of [N]) if (k < N) for (let z = road(k) + 16; z < road(k + 1) - 14; z += 26) palmSpots.push([road(a) - HALF - 1.3, z]);
  }
  for (let k = 0; k < 26; k++) palmSpots.push([CITY_MIN + rand() * (CITY_MAX - CITY_MIN), CITY_MAX + RIM + 6 + rand() * 22]);   // on the sand
  const variants = [palmGeometry(11), palmGeometry(23), palmGeometry(37), palmGeometry(51)];
  const bark = barkTexture();
  const trunkMat = swayMaterial(new THREE.MeshStandardMaterial({ map: bark, bumpMap: bark, bumpScale: 2.2, roughness: 0.92, color: 0xcfc0aa }), 1);
  const frondMat = swayMaterial(new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.55, color: 0xd8e8b8, emissive: 0x0b1503 }), 1);
  const per = variants.map(() => []);
  for (const s of palmSpots) per[Math.floor(rand() * variants.length)].push(s);
  variants.forEach((v, vi) => {
    const list = per[vi]; if (!list.length) return;
    const tm = new THREE.InstancedMesh(v.trunk, trunkMat, list.length), cm = new THREE.InstancedMesh(v.crown, frondMat, list.length);
    list.forEach(([x, z], i) => {
      dummy.position.set(x, city.groundY(x, z) - 0.05, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      const sc = 0.85 + rand() * 0.4; dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix(); tm.setMatrixAt(i, dummy.matrix); cm.setMatrixAt(i, dummy.matrix);
      poles.push({ x, z, r: 0.32 });
    });
    tm.castShadow = tm.receiveShadow = true; cm.castShadow = true; cm.receiveShadow = true;
    tm.frustumCulled = cm.frustumCulled = false;
    group.add(tm, cm);
  });

  // ---------- street lamps ----------
  const lampSpots = [];        // [x, z, rotY]
  for (let k = 0; k <= N; k++) for (let s = 0; s < N; s++) {
    for (let a = road(s) + 22; a < road(s + 1) - 16; a += 27) {
      const c = road(k), o = HALF + 0.75;
      lampSpots.push([a, c + o, Math.PI / 2], [a + 13, c - o, -Math.PI / 2]);
      lampSpots.push([c + o, a, Math.PI], [c - o, a + 13, 0]);
    }
  }
  const metal = new THREE.MeshStandardMaterial({ color: 0x24272b, metalness: 0.7, roughness: 0.45 });
  const lamps = new THREE.InstancedMesh(lampGeometry(), metal, lampSpots.length);
  const lens = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.04, 0.24), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.86, 0.62) }), lampSpots.length);
  lampSpots.forEach(([x, z, ry], i) => {
    const ly = city.groundY(x, z);
    dummy.position.set(x, ly, z); dummy.rotation.set(0, ry, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    lamps.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x + Math.cos(ry) * 2.45, ly + 8.19, z - Math.sin(ry) * 2.45); dummy.updateMatrix();
    lens.setMatrixAt(i, dummy.matrix);
    poles.push({ x, z, r: 0.2 });
  });
  lamps.castShadow = true; lamps.receiveShadow = true;
  lamps.frustumCulled = lens.frustumCulled = false;
  group.add(lamps, lens);

  // ---------- traffic signals ----------
  const sigSpots = [], bulbs = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const cx = road(i), cz = road(j);
    for (let dir = 0; dir < 4; dir++) {
      // approach heading: 0 = +Z (south-bound), 1 = +X, 2 = -Z, 3 = -X
      const h = dir * Math.PI / 2, fx = Math.sin(h), fz = Math.cos(h), rx = -fz, rz = fx;
      // skip approaches that come from outside the grid
      const fromI = i - Math.round(fx), fromJ = j - Math.round(fz);
      if (fromI < 0 || fromI > N || fromJ < 0 || fromJ > N) continue;
      const x = cx - fx * 7.5 + rx * 7.5, z = cz - fz * 7.5 + rz * 7.5;
      sigSpots.push([x, z, h]);
      poles.push({ x, z, r: 0.22 });
      const axis = dir % 2;                // 0: travelling along Z, 1: along X
      for (const hx of [2.6, 5.6]) for (let b = 0; b < 3; b++) {
        // bulb positions in signal-local space; lamps face local -Z
        const lx = hx, ly = 5.35 + (1 - b) * 0.38, lz = -0.18;
        const wx = x + Math.cos(h) * lx + Math.sin(h) * lz, wz = z - Math.sin(h) * lx + Math.cos(h) * lz;
        bulbs.push({ x: wx, y: city.groundY(x, z) + ly, z: wz, h, axis, kind: b });
      }
    }
  }
  const signals = new THREE.InstancedMesh(signalGeometry(), metal, sigSpots.length);
  sigSpots.forEach(([x, z, h], i) => { dummy.position.set(x, city.groundY(x, z), z); dummy.rotation.set(0, h, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); signals.setMatrixAt(i, dummy.matrix); });
  signals.castShadow = true; signals.frustumCulled = false;
  group.add(signals);
  const bulbMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(0.115, 14), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), bulbs.length);
  bulbs.forEach((b, i) => { dummy.position.set(b.x, b.y, b.z); dummy.rotation.set(0, b.h + Math.PI, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); bulbMesh.setMatrixAt(i, dummy.matrix); });
  bulbMesh.frustumCulled = false;
  group.add(bulbMesh);

  const ON = [new THREE.Color(9, 0.35, 0.2), new THREE.Color(8, 4.4, 0.3), new THREE.Color(0.3, 8, 2.2)];
  const OFF = [new THREE.Color(0.10, 0.012, 0.01), new THREE.Color(0.09, 0.06, 0.01), new THREE.Color(0.01, 0.07, 0.03)];
  const CYCLE = 26;
  let lastKey = '';
  const phase = (axis, t) => {
    const u = ((t % CYCLE) + CYCLE) % CYCLE, half = CYCLE / 2;
    const local = axis === 0 ? u : (u + half) % CYCLE;
    return local < half - 3.5 ? 2 : local < half - 1 ? 1 : 0;       // 2 green, 1 yellow, 0 red
  };
  let now = 0;
  const update = (t) => {
    now = t;
    const s0 = phase(0, t), s1 = phase(1, t), key = `${s0}${s1}`;
    if (key === lastKey) return;
    lastKey = key;
    bulbs.forEach((b, i) => { const on = (b.axis === 0 ? s0 : s1) === b.kind; bulbMesh.setColorAt(i, on ? ON[b.kind] : OFF[b.kind]); });
    bulbMesh.instanceColor.needsUpdate = true;
  };
  update(0);

  // kerb-side parking on the quieter streets
  for (let k = 1; k < N; k++) for (let s = 0; s < N; s++) {
    if (k === 2 || k === 5) continue;
    for (let a = road(s) + 20; a < road(s + 1) - 20; a += 6.2) {
      if (rand() < 0.2) parking.push({ x: road(k) + HALF - 1.25, z: a, h: Math.PI, y: terrain(road(k) + HALF - 1.25, a) });
      if (rand() < 0.2) parking.push({ x: road(k) - HALF + 1.25, z: a, h: 0, y: terrain(road(k) - HALF + 1.25, a) });
    }
  }

  return { group, poles, parking, update, signal: (axis) => phase(axis, now) };
}
