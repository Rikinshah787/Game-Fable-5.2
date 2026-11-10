import * as THREE from 'three';
import { Batch, BRIDGE, HEAD, PIERS, CITY_MIN, CITY_MAX, RIM, CURB, HALF, road, deckY, headY, terrain, mergeGeos } from './city.js';

const ORANGE = 0xb5331f;      // the bridge's red-orange paint
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function windowBands(rows, cols) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#d9d6cf'; x.fillRect(0, 0, 512, 512);
  const ch = 512 / rows, cw = 512 / cols;
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    x.fillStyle = Math.random() < 0.15 ? '#3b4650' : '#1b2228';
    x.fillRect(q * cw + cw * 0.18, r * ch + ch * 0.25, cw * 0.64, ch * 0.5);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

function trussTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#b5331f'; x.fillRect(0, 0, 256, 256);
  // open web below the roadway: dark gaps between chords, posts and diagonals
  x.fillStyle = '#3a110b'; x.fillRect(0, 86, 256, 150);
  x.strokeStyle = '#b5331f'; x.lineWidth = 16;
  x.beginPath(); x.moveTo(0, 86); x.lineTo(256, 236); x.moveTo(256, 86); x.lineTo(0, 236); x.stroke();
  x.fillStyle = '#b5331f'; x.fillRect(0, 86, 12, 150); x.fillRect(244, 86, 12, 150);
  x.fillStyle = '#c94a32'; x.fillRect(0, 0, 256, 10); x.fillStyle = '#8f2716'; x.fillRect(0, 70, 256, 16); x.fillRect(0, 236, 256, 20);
  // railing pickets above deck level
  x.fillStyle = '#7c2114'; for (let i = 0; i < 16; i++) x.fillRect(i * 16 + 6, 12, 4, 56);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

export function buildLandmarks(A, scene, city) {
  const g = new THREE.Group();
  scene.add(g);
  const steel = new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.55, metalness: 0.25 });
  const box = (w, h, d, x, y, z, mat, shadow = true) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m; };

  // ---------------------------------------------------------------- bridge
  const { x: bx, z0, z1 } = BRIDGE, LEN = z0 - z1, HW = 8.6, CX = 8.95;
  const AT = A.tex.asphalt_02;
  const roadMat = new THREE.MeshStandardMaterial({ map: AT.map, normalMap: AT.normalMap, roughnessMap: AT.arm, color: 0x8c8c8c });
  const deck = new Batch({ position: 3, normal: 3, uv: 2 }), girder = new Batch({ position: 3, normal: 3, uv: 2 });
  const white = new Batch({ position: 3, normal: 3, uv: 2 }), yellow = new Batch({ position: 3, normal: 3, uv: 2 });
  const SEG = 7, n = Math.round(LEN / SEG);
  const V = (x, y, z, nx, ny, nz) => ({ position: [x, y, z], normal: [nx, ny, nz], uv: [x / 4.5, z / 4.5] });
  for (let k = 0; k < n; k++) {
    const za = z0 - (LEN * k) / n, zb = z0 - (LEN * (k + 1)) / n, ya = deckY(za), yb = deckY(zb);
    deck.quad(V(bx - HW, ya, za, 0, 1, 0), V(bx + HW, ya, za, 0, 1, 0), V(bx + HW, yb, zb, 0, 1, 0), V(bx - HW, yb, zb, 0, 1, 0));
    for (const s of [-1, 1]) {
      const x = bx + s * HW;
      // stiffening truss below the roadway and a rail above it
      const G2 = (y, z, v) => ({ position: [x, y, z], normal: [s, 0, 0], uv: [z / SEG, v] });
      const a = G2(ya - 2.6, za, 0), b = G2(yb - 2.6, zb, 0), c = G2(yb + 1.15, zb, 1), d = G2(ya + 1.15, za, 1);
      if (s > 0) girder.quad(b, a, d, c); else girder.quad(a, b, c, d);
      const xi = bx + s * (HW - 1.25);
      const e = V(xi, ya, za, -s, 0, 0), f = V(xi, yb, zb, -s, 0, 0), h = V(xi, yb + 1.05, zb, -s, 0, 0), i = V(xi, ya + 1.05, za, -s, 0, 0);
      if (s > 0) girder.quad(e, f, h, i); else girder.quad(f, e, i, h);
    }
    girder.quad(V(bx - HW, ya - 2.6, za, 0, -1, 0), V(bx - HW, yb - 2.6, zb, 0, -1, 0), V(bx + HW, yb - 2.6, zb, 0, -1, 0), V(bx + HW, ya - 2.6, za, 0, -1, 0));
    const strip = (b, o0, o1) => b.quad(V(bx + o0, ya + 0.03, za, 0, 1, 0), V(bx + o1, ya + 0.03, za, 0, 1, 0), V(bx + o1, yb + 0.03, zb, 0, 1, 0), V(bx + o0, yb + 0.03, zb, 0, 1, 0));
    strip(yellow, -0.24, -0.10); strip(yellow, 0.10, 0.24);
    if (k % 2 === 0) { strip(white, -3.31, -3.19); strip(white, 3.19, 3.31); }
  }
  // short approach across the promenade
  deck.quad(V(bx - HALF, CURB + 0.02, CITY_MIN + 0.5, 0, 1, 0), V(bx + HALF, CURB + 0.02, CITY_MIN + 0.5, 0, 1, 0), V(bx + HALF, CURB + 0.02, z0, 0, 1, 0), V(bx - HALF, CURB + 0.02, z0, 0, 1, 0));
  const add = (batch, mat, cast) => { const m = new THREE.Mesh(batch.build(), mat); m.castShadow = cast; m.receiveShadow = true; g.add(m); };
  add(deck, roadMat, false); add(girder, new THREE.MeshStandardMaterial({ map: trussTexture(), roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide }), true);
  add(white, city.paints.white, false); add(yellow, city.paints.yellow, false);

  // towers
  const towerZ = [z0 - LEN * 0.27, z0 - LEN * 0.73];
  const TOP = 64;                                   // above the roadway
  const topY = towerZ.map((z) => deckY(z) + TOP);
  towerZ.forEach((tz, ti) => {
    const dy = deckY(tz);
    for (const s of [-1, 1]) {
      const lx = bx + s * 11.2;
      const tiers = [[-9, dy + 6, 5.6, 7.2], [dy + 6, dy + 26, 4.9, 6.4], [dy + 26, dy + 46, 4.2, 5.6], [dy + 46, topY[ti], 3.5, 4.8]];
      for (const [ya, yb, w, d] of tiers) box(w, yb - ya, d, lx, (ya + yb) / 2, tz, steel);
      box(4.2, 2.2, 5.4, lx, topY[ti] + 1.1, tz, steel);
    }
    // portal struts: one under the deck, four above with the stepped look of the real thing
    for (const [y, h] of [[dy - 6, 3.2], [dy + 15, 3.6], [dy + 30, 3.2], [dy + 45, 2.8], [dy + 59, 3.6]]) box(22.4, h, 3.2, bx, y, tz, steel);
  });

  // main cables: straight-ish backstays and a parabola between the towers
  const anchorA = { z: z0 + 5, y: 1.2 }, anchorB = { z: z1 - 26, y: headY(bx, z1 - 26) + 1.0 };
  const cableY = (z) => {
    if (z > towerZ[0]) { const u = (anchorA.z - z) / (anchorA.z - towerZ[0]); return anchorA.y + (topY[0] + 2 - anchorA.y) * (u * 0.72 + u * u * 0.28); }
    if (z < towerZ[1]) { const u = (z - anchorB.z) / (towerZ[1] - anchorB.z); return anchorB.y + (topY[1] + 2 - anchorB.y) * (u * 0.72 + u * u * 0.28); }
    const u = (towerZ[0] - z) / (towerZ[0] - towerZ[1]), low = deckY((towerZ[0] + towerZ[1]) / 2) + 4.5;
    const hi = topY[0] + 2 + (topY[1] - topY[0]) * u;
    return low + (hi - low) * Math.pow(2 * u - 1, 2);
  };
  const hang = [];
  for (const s of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 90; k++) { const z = anchorA.z + (anchorB.z - anchorA.z) * (k / 90); pts.push(new THREE.Vector3(bx + s * CX, cableY(z), z)); }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, 0.42, 8), steel);
    tube.castShadow = true; g.add(tube);
    for (let z = z0 - 4; z > z1 + 4; z -= SEG) { const top = cableY(z), bot = deckY(z) + 1.1; if (top - bot > 0.8) hang.push([bx + s * CX, bot, top, z]); }
  }
  const hm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 6), steel, hang.length);
  const d3 = new THREE.Object3D();
  hang.forEach(([x, a, b, z], i) => { d3.position.set(x, (a + b) / 2, z); d3.scale.set(1, b - a, 1); d3.updateMatrix(); hm.setMatrixAt(i, d3.matrix); });
  hm.frustumCulled = false; g.add(hm);

  // ---------------------------------------------------------------- headland
  const GT = A.tex.sparse_grass;
  const hg = new THREE.PlaneGeometry(330, 330, 70, 70).rotateX(-Math.PI / 2);
  hg.translate(HEAD.x, 0, HEAD.z);
  const hp = hg.attributes.position, huv = hg.attributes.uv;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i), z = hp.getZ(i), d = Math.hypot(x - HEAD.x, z - HEAD.z);
    hp.setY(i, headY(x, z) - sstep(98, 150, d) * 9 + Math.sin(x * 0.11) * Math.cos(z * 0.13) * 0.5 * sstep(20, 80, d));
    huv.setXY(i, x / 6, z / 6);
  }
  hg.computeVertexNormals();
  const head = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ map: GT.map, normalMap: GT.normalMap, roughnessMap: GT.arm, color: 0xc9c48a }));
  head.receiveShadow = true; g.add(head);
  // the road carries on to a lookout near the top
  const hr = new Batch({ position: 3, normal: 3, uv: 2 });
  for (let k = 0; k < 14; k++) {
    const za = z1 - k * 5, zb = z1 - (k + 1) * 5, ya = Math.max(headY(bx, za), deckY(z1) * (k === 0 ? 1 : 0)) + 0.05, yb = headY(bx, zb) + 0.05;
    hr.quad(V(bx - HALF, ya, za, 0, 1, 0), V(bx + HALF, ya, za, 0, 1, 0), V(bx + HALF, yb, zb, 0, 1, 0), V(bx - HALF, yb, zb, 0, 1, 0));
  }
  add(hr, roadMat, false);

  // ---------------------------------------------------------------- piers on the east shore
  const WT = A.tex.wood_planks_grey || A.tex.concrete_floor_worn_001, CT = A.tex.corrugated_iron_02, KT = A.tex.container_side;
  const wood = new THREE.MeshStandardMaterial({ map: WT.map, normalMap: WT.normalMap, roughnessMap: WT.arm, color: 0xb8a88e });
  const shedMats = [0xb9c4c9, 0x9c3d2e, 0x2f6f8a].map((c) => new THREE.MeshStandardMaterial({ map: CT.map, normalMap: CT.normalMap, roughnessMap: CT.arm, metalnessMap: CT.arm, metalness: 1, color: c }));
  const pile = new THREE.CylinderGeometry(0.35, 0.35, 5, 8);
  PIERS.forEach((p, k) => {
    const w = p.x1 - p.x0, d = p.z1 - p.z0, cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    const dk = box(w, 0.5, d, cx, CURB - 0.25, cz, wood, false);
    const uv = dk.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 4, uv.getY(i) * d / 4);
    for (let x = p.x0 + 6; x < p.x1; x += 11) for (const z of [p.z0 + 1.2, p.z1 - 1.2]) { const m = new THREE.Mesh(pile, wood); m.position.set(x, -2.4, z); g.add(m); }
    const sx0 = p.x0 + 26, sx1 = p.x1 - 12, sz0 = p.z0 + 6, sz1 = p.z1 - 6, sh = 7.5;
    const shed = box(sx1 - sx0, sh, sz1 - sz0, (sx0 + sx1) / 2, CURB + sh / 2, cz, shedMats[k % 3]);
    const su = shed.geometry.attributes.uv; for (let i = 0; i < su.count; i++) su.setXY(i, su.getX(i) * 8, su.getY(i) * 2);
    box(sx1 - sx0 + 1.2, 0.35, sz1 - sz0 + 1.2, (sx0 + sx1) / 2, CURB + sh + 0.17, cz, new THREE.MeshStandardMaterial({ color: 0x55595d, roughness: 0.7 }));
    city.extras.push({ x0: sx0, x1: sx1, z0: sz0, z1: sz1, h: sh, gy: 0, top: sh + 0.5 });
    // a few stacked containers on the quay
    if (KT) for (let q = 0; q < 3; q++) {
      const cm = new THREE.MeshStandardMaterial({ map: KT.map, normalMap: KT.normalMap, roughnessMap: KT.arm, color: [0xc65a3a, 0x3a7ca5, 0x4f9a63][(q + k) % 3] });
      const cxp = p.x0 + 8 + q * 5.2;
      box(2.5, 2.6, 6.1, cxp, CURB + 1.3, p.z0 + 5.5, cm);
      city.extras.push({ x0: cxp - 1.25, x1: cxp + 1.25, z0: p.z0 + 2.45, z1: p.z0 + 8.55, h: 2.6, gy: 0, top: 2.8 });
    }
  });

  // ---------------------------------------------------------------- prison rock out in the bay
  const ix = road(4) + 30, iz = CITY_MIN - 430;
  const PT = A.tex.plastered_wall_04, RT = A.tex.concrete_floor_worn_001;
  const rock = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14), new THREE.MeshStandardMaterial({ map: RT.map, normalMap: RT.normalMap, roughnessMap: RT.arm, color: 0x8f8672 }));
  rock.scale.set(74, 15, 44); rock.position.set(ix, -2.5, iz); g.add(rock);
  const wallMat = new THREE.MeshStandardMaterial({ map: windowBands(4, 26), roughnessMap: PT.arm, normalMap: PT.normalMap, color: 0xd8d2c2 });
  box(58, 11, 15, ix - 4, 15, iz, wallMat); box(22, 7, 12, ix + 34, 12.5, iz + 4, wallMat);
  box(60, 0.6, 16.5, ix - 4, 20.8, iz, new THREE.MeshStandardMaterial({ color: 0x6b6e70, roughness: 0.8 }));
  const light = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.0, 20, 14), new THREE.MeshStandardMaterial({ color: 0xe6e3da, roughness: 0.7 }));
  light.position.set(ix - 40, 19, iz - 6); g.add(light);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8, 5) }));
  lamp.position.set(ix - 40, 30, iz - 6); g.add(lamp);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 5, 14), new THREE.MeshStandardMaterial({ color: 0x8d5a48, roughness: 0.8 }));
  tank.position.set(ix + 20, 26, iz - 4); g.add(tank);
  for (const [dx, dz] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]]) box(0.4, 14, 0.4, ix + 20 + dx, 16.5, iz - 4 + dz, steel);

  // ---------------------------------------------------------------- lookout tower on the summit
  const sb = city.blocks.find((b) => b.summit);
  if (sb) {
    const cx = (sb.x0 + sb.x1) / 2, cz = (sb.z0 + sb.z1) / 2, gy = terrain(cx, cz) + CURB;
    const conc = new THREE.MeshStandardMaterial({ roughness: 0.85, color: 0xd9d3c4, flatShading: true });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.4, 40, 20, 1), conc); shaft.position.set(cx, gy + 20, cz);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 4.9, 6, 20, 1), conc); crown.position.set(cx, gy + 43, cz);
    const basep = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.6, 3, 24, 1), conc); basep.position.set(cx, gy + 1.5, cz);
    for (const m of [shaft, crown, basep]) { m.castShadow = m.receiveShadow = true; g.add(m); }
    // arcade openings around the crown
    const dark = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.4 });
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; const o = box(1.5, 3.2, 0.5, cx + Math.sin(a) * 5.0, gy + 43.2, cz + Math.cos(a) * 5.0, dark, false); o.rotation.y = a; }
    city.extras.push({ x0: cx - 8.6, x1: cx + 8.6, z0: cz - 8.6, z1: cz + 8.6, h: 46, gy, top: gy + 46 });
  }

  // ---------------------------------------------------------------- pyramid tower downtown
  const pb = city.buildings.find((b) => b.special === 'pyramid');
  if (pb) {
    const side = Math.min(pb.x1 - pb.x0, pb.z1 - pb.z0), cx = (pb.x0 + pb.x1) / 2, cz = (pb.z0 + pb.z1) / 2;
    const tex = windowBands(48, 40);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(side / Math.SQRT2, pb.h, 4, 1).rotateY(Math.PI / 4), new THREE.MeshStandardMaterial({ map: tex, color: 0xf0ede6, roughness: 0.5, metalness: 0.1, flatShading: true }));
    cone.position.set(cx, pb.gy + pb.h / 2, cz); cone.castShadow = cone.receiveShadow = true; g.add(cone);
    // lobby plinth so the base reads as a building at street level
    box(side, 9, side, cx, pb.gy + 4.5, cz, new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.15, metalness: 0.7 }));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 0.4, 0.3) }));
    tip.position.set(cx, pb.gy + pb.h + 0.6, cz); g.add(tip);
  }
  return g;
}
