// Loose objects simulated as rigid bodies with the Rapier physics engine: crates, drums,
// tyres, cans, bottles, chairs, extinguishers and the Thumper's concussion charges.
// The building's static boxes (physics.js) are mirrored into Rapier as fixed colliders.
import * as THREE from 'three';
import { litMaterial, F1 } from './level.js';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';

let R = null;
export async function initPhysics() {
  const mod = await import('../vendor/rapier/rapier.es.js');
  R = mod.default;
  await R.init();
}

const G_STATIC = 1, G_PROP = 2, G_PUSH = 4, G_CHARGE = 8;
const grp = (member, filter) => ((member << 16) | filter) >>> 0;
const BLAST_R = 5.5;

// parts: [shape, ...size, ox, oy, oz]; box sizes are half-extents, cyl is (half-height, radius).
// hy is the distance from the body origin down to its base. pen: bullets pass through it.
const KINDS = {
  crate: { m: 22, parts: [['box', 0.3, 0.3, 0.3]], hy: 0.3, tex: 'wood', colors: [0xb9a688, 0xa8946f], rough: 0.85, metal: 0, pen: true, snd: 'wood', fr: 0.7 },
  carton: { m: 1.6, parts: [['box', 0.225, 0.175, 0.2]], hy: 0.175, colors: [0x8d7350, 0x7c6748], rough: 0.95, metal: 0, pen: true, snd: 'soft', fr: 0.8 },
  cinder: { m: 13, parts: [['box', 0.195, 0.095, 0.095]], hy: 0.095, tex: 'concrete', colors: [0x9c9a94], rough: 0.95, metal: 0, snd: 'hard', fr: 0.9 },
  plank: { m: 4.5, parts: [['box', 0.95, 0.02, 0.1]], hy: 0.02, tex: 'wood', colors: [0xa89878], rough: 0.85, metal: 0, pen: true, snd: 'wood', fr: 0.7 },
  barrel: { m: 19, parts: [['cyl', 0.44, 0.29]], hy: 0.44, r: 0.29, tex: 'metal', colors: [0x5d7388, 0x8a4a34, 0x6c7256], rough: 0.6, metal: 0.3, snd: 'metal', fr: 0.6 },
  tire: { m: 9, parts: [['cyl', 0.1, 0.34]], hy: 0.1, r: 0.34, colors: [0x151515], rough: 0.95, metal: 0, snd: 'soft', fr: 1.0, rest: 0.4 },
  can: { m: 0.35, parts: [['cyl', 0.06, 0.05]], hy: 0.06, r: 0.05, colors: [0x9aa0a6, 0x8b3a2e, 0x4a6a58, 0xa08a3c], rough: 0.4, metal: 0.6, pen: true, snd: 'tin', fr: 0.5 },
  bucket: { m: 1.2, parts: [['cyl', 0.13, 0.13]], hy: 0.13, r: 0.13, colors: [0x5a6068, 0x6a4a3a], rough: 0.5, metal: 0.5, pen: true, snd: 'tin', fr: 0.6 },
  bottle: { m: 0.5, parts: [['cyl', 0.11, 0.035]], hy: 0.11, r: 0.035, colors: [0x1f3a26, 0x3a2a14, 0x2b3a3a], rough: 0.15, metal: 0, pen: true, snd: 'glass', fragile: true, fr: 0.5 },
  ext: { m: 5, parts: [['cyl', 0.22, 0.07]], hy: 0.22, r: 0.07, colors: [0x8a1611], rough: 0.4, metal: 0.3, snd: 'metal', vent: true, fr: 0.6 },
  chair: { m: 5, hy: 0.465, colors: [0x3d4347, 0x4a3f35], rough: 0.6, metal: 0.4, pen: true, snd: 'metal', fr: 0.7,
    parts: [['box', 0.21, 0.015, 0.21, 0, 0, 0], ['box', 0.21, 0.2, 0.015, 0, 0.215, -0.195],
      ['box', 0.015, 0.225, 0.015, 0.19, -0.24, 0.19], ['box', 0.015, 0.225, 0.015, -0.19, -0.24, 0.19],
      ['box', 0.015, 0.225, 0.015, 0.19, -0.24, -0.19], ['box', 0.015, 0.225, 0.015, -0.19, -0.24, -0.19]] },
};

// Photo-scanned props (CC0, Poly Haven), the same set and placement as the Unreal build.
// shape: box or round (upright cylinder); m: mass in kg, 0 = fixed furniture; pen: bullets pass through;
// keep: for files holding two variants side by side, the node-name fragment of the one to use.
const SCAN = {
  Barrel_01: { shape: 'round', m: 19, snd: 'metal' }, Barrel_02: { shape: 'round', m: 19, snd: 'metal' }, barrel_03: { shape: 'round', m: 21, snd: 'metal' },
  wooden_crate_01: { m: 12, snd: 'wood', pen: true }, wooden_crate_02: { m: 16, snd: 'wood', pen: true }, wooden_military_crate: { m: 26, snd: 'wood', pen: true },
  old_military_crate: { m: 18, snd: 'wood', pen: true, keep: '_a' }, cardboard_box_01: { m: 1.5, snd: 'soft', pen: true }, old_tyre: { m: 9, snd: 'soft' },
  metal_jerrycan: { m: 4, snd: 'tin', pen: true }, korean_fire_extinguisher_01: { m: 5, snd: 'metal', vent: true },
  metal_trash_can: { m: 6, snd: 'tin', pen: true, keep: '_rust' }, SchoolChair_01: { m: 5, snd: 'metal', pen: true },
  plastic_monobloc_chair_01: { m: 2.5, snd: 'soft', pen: true }, wooden_stool_01: { m: 3, snd: 'wood', pen: true }, plastic_crate_01: { m: 1.5, snd: 'soft', pen: true },
  trashbag: { m: 3, snd: 'soft', pen: true }, propane_tank: { shape: 'round', m: 12, snd: 'metal' }, ammo_box: { m: 6, snd: 'metal' },
  Television_01: { m: 14, snd: 'hard', pen: true },
  metal_office_desk: { m: 0, snd: 'metal', pen: true }, steel_frame_shelves_01: { m: 0, snd: 'metal', pen: true, scale: 0.1 },
  concrete_road_barrier_02: { m: 0, snd: 'hard' }, old_bed_frame: { m: 0, snd: 'metal', pen: true },
};
// [model, x, floor height, z, yaw in degrees], in game metres
const SCAN_LAYOUT = (u) => [
  ['Barrel_01', 1.5, 0, 12.2, 0], ['Barrel_02', 2.15, 0, 11.9, 40], ['old_tyre', 2.3, 0, 13.3, 20], ['wooden_crate_02', 6.3, 0, 13.6, 10],
  ['old_military_crate', 6.95, 0, 14.4, -15], ['cardboard_box_01', 5.6, 0, 15.4, 0], ['cardboard_box_01', 6.2, 0, 15.5, 30],
  ['korean_fire_extinguisher_01', 7.6, 0, 9.5, 0], ['trashbag', 1.0, 0, 15.0, 0], ['plastic_monobloc_chair_01', 2.8, 0, 10.0, 200],
  ['wooden_military_crate', 16.6, 0, 15.2, 5], ['wooden_crate_01', 18.0, 0, 15.3, 70], ['barrel_03', 22.7, 0, 11.6, 0], ['Barrel_01', 23.2, 0, 12.4, 90],
  ['Barrel_02', 22.3, 0, 12.6, 10], ['old_tyre', 11.2, 0, 15.2, 0], ['SchoolChair_01', 20.4, 0, 11.3, 140], ['SchoolChair_01', 15.0, 0, 11.6, 30],
  ['concrete_road_barrier_02', 17.8, 0, 10.0, 0], ['plastic_crate_01', 14.2, 0, 13.4, 15], ['cardboard_box_01', 10.6, 0, 9.7, 0], ['cardboard_box_01', 11.3, 0, 9.65, 25],
  ['metal_trash_can', 9.0, 0, 9.7, 0], ['cardboard_box_01', 9.6, 0, 6.65, 5], ['cardboard_box_01', 10.3, 0, 6.6, 20], ['metal_jerrycan', 14.6, 0, 8.6, 60],
  ['korean_fire_extinguisher_01', 19.6, 0, 8.7, 0], ['propane_tank', 22.6, 0, 6.7, 0], ['trashbag', 2.2, 0, 8.6, 0],
  ['Barrel_02', 1.4, 0, 4.7, 0], ['barrel_03', 2.1, 0, 5.3, 0], ['wooden_crate_02', 6.9, 0, 4.9, 20], ['old_tyre', 5.4, 0, 1.0, 0], ['ammo_box', 3.6, 0, 0.7, 30],
  ['steel_frame_shelves_01', 4.6, 0, 0.5, 0], ['SchoolChair_01', 10.9, 0, 2.6, 180], ['plastic_monobloc_chair_01', 12.4, 0, 2.3, 120],
  ['metal_office_desk', 13.8, 0, 5.2, 0], ['Television_01', 15.3, 0, 3.0, 200], ['wooden_crate_01', 14.9, 0, 0.8, 5], ['metal_jerrycan', 9.0, 0, 5.2, 0],
  ['plastic_crate_01', 17.0, 0, 4.9, 0], ['cardboard_box_01', 23.2, 0, 5.2, 0],
  ['cardboard_box_01', 8.6, u, 8.6, 10], ['Barrel_01', 15.2, u, 8.6, 0], ['korean_fire_extinguisher_01', 2.0, u, 6.6, 0], ['old_tyre', 21.5, u, 8.5, 0],
  ['wooden_military_crate', 6.6, u, 1.0, 0], ['barrel_03', 1.5, u, 1.3, 0], ['SchoolChair_01', 4.6, u, 4.6, 60], ['SchoolChair_01', 14.2, u, 1.9, 180],
  ['wooden_stool_01', 12.6, u, 1.2, 0], ['old_bed_frame', 3.2, u, 1.4, 90], ['propane_tank', 9.0, u, 5.3, 0], ['wooden_crate_02', 11.0, u, 4.9, 25],
  ['metal_trash_can', 12.6, u, 5.3, 0], ['wooden_crate_01', 5.0, u, 14.9, 10], ['old_military_crate', 9.0, u, 10.2, 0], ['Barrel_02', 16.5, u, 15.1, 0],
  ['Barrel_01', 23.2, u, 14.0, 0], ['cardboard_box_01', 14.5, u, 12.6, 0], ['plastic_monobloc_chair_01', 10.2, u, 12.4, 20], ['Television_01', 20.6, u, 9.9, 0],
  ['trashbag', 21.2, u, 12.4, 0], ['metal_office_desk', 20.6, u, 15.2, 0],
];
const SCANS = new Map();

export async function loadScans(base = './assets/models/props/') {
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(SCAN).map(async ([id, spec]) => {
    try {
      const g = await loader.loadAsync(base + id + '/' + id + '.gltf');
      const root = g.scene;
      if (spec.keep) {
        const drop = [];
        root.traverse((o) => { if (o.isMesh && !o.name.includes(spec.keep)) drop.push(o); });
        for (const o of drop) o.parent.remove(o);
      }
      root.updateMatrixWorld(true);
      const k = spec.scale || 1, box = new THREE.Box3().setFromObject(root);
      SCANS.set(id, { root, size: box.getSize(new THREE.Vector3()).multiplyScalar(k), center: box.getCenter(new THREE.Vector3()).multiplyScalar(k), k });
    } catch (e) { console.warn('Scanned prop ' + id + ' unavailable:', e.message); }
  }));
  return SCANS.size;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _n = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1);

export class Props {
  constructor(scene, level, fx, sfx) {
    this.scene = scene; this.level = level; this.fx = fx; this.sfx = sfx;
    this.items = []; this.charges = []; this.pushers = [];
    this.byCollider = new Map();
    this.hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, item: null };
    this.quiet = 1;
    this.w = null;
    if (!R) return; // the engine failed to load: the game runs without loose objects
    this.w = new R.World({ x: 0, y: -9.81, z: 0 });
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    for (const b of level.world.boxes) {
      if (!b.ray) continue;
      this.w.createCollider(R.ColliderDesc.cuboid((b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2, (b.z1 - b.z0) / 2)
        .setTranslation((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2)
        .setFriction(0.8).setCollisionGroups(grp(G_STATIC, G_PROP | G_CHARGE)));
    }
    this.geos = new Map();
    this.rand = (() => { let s = 977; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; })();
    if (SCANS.size) this.layoutScans(); else this.layout();
    const cm = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(7, 2.4, 0.35), fog: false });
    const cg = new THREE.SphereGeometry(0.045, 10, 8);
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(cg, cm); mesh.visible = false; scene.add(mesh);
      this.charges.push({ mesh, body: null, t: 0, last: new THREE.Vector3() });
    }
    this.w.step();
  }

  get count() { return this.items.length; }

  // ---------- construction ----------

  geo(part) {
    const key = part.slice(0, part[0] === 'box' ? 4 : 3).join(',');
    let g = this.geos.get(key);
    if (!g) {
      g = part[0] === 'box' ? new THREE.BoxGeometry(part[1] * 2, part[2] * 2, part[3] * 2) : new THREE.CylinderGeometry(part[2], part[2], part[1] * 2, 18);
      this.geos.set(key, g);
    }
    return g;
  }

  mesh(kind, K, mat) {
    const g = new THREE.Group();
    const add = (geo, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    const cached = (key, make) => { let geo = this.geos.get(key); if (!geo) this.geos.set(key, (geo = make())); return geo; };
    if (kind === 'tire') add(cached('tire', () => new THREE.TorusGeometry(0.24, 0.1, 10, 22).rotateX(Math.PI / 2)));
    else if (kind === 'bucket') {
      add(cached('bucket', () => new THREE.CylinderGeometry(0.14, 0.11, 0.26, 16, 1, true)));
      add(cached('bucketBase', () => new THREE.CircleGeometry(0.11, 16).rotateX(Math.PI / 2)), 0, -0.128, 0);
      mat.side = THREE.DoubleSide;
    } else {
      for (const p of K.parts) { const o = p[0] === 'box' ? 4 : 3; add(this.geo(p), p[o] || 0, p[o + 1] || 0, p[o + 2] || 0); }
      if (kind === 'barrel') for (const y of [-0.43, -0.15, 0.15, 0.43]) add(cached('rim', () => new THREE.CylinderGeometry(0.3, 0.3, 0.025, 18)), 0, y, 0);
      if (kind === 'bottle') add(cached('neck', () => new THREE.CylinderGeometry(0.013, 0.03, 0.09, 10)), 0, 0.15, 0);
      if (kind === 'ext') { add(cached('valve', () => new THREE.CylinderGeometry(0.025, 0.04, 0.07, 10)), 0, 0.25, 0); add(cached('lever', () => new THREE.BoxGeometry(0.02, 0.02, 0.12)), 0, 0.29, 0.03); }
    }
    return g;
  }

  // Put an object on a surface at height y. side lays a cylinder down.
  place(kind, x, y, z, yaw = this.rand() * 6.283, side = false) {
    const K = KINDS[kind];
    const lift = side ? K.r : K.hy;
    if (this.level.world.overlap(x - 0.04, y + 0.03, z - 0.04, x + 0.04, y + lift * 2, z + 0.04)) return null;
    _q.setFromAxisAngle(_Y, yaw);
    if (side) _q.multiply(_q2.setFromAxisAngle(_Z, Math.PI / 2));
    const home = { p: new THREE.Vector3(x, y + lift + 0.004, z), q: _q.clone() };
    const body = this.w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(home.p.x, home.p.y, home.p.z).setRotation(home.q)
      .setLinearDamping(0.05).setAngularDamping(K.r ? 0.55 : 0.3));
    const item = { kind, K, body, home, last: new THREE.Vector3(), ambT: 0, cool: 0, broken: false, spent: false, vent: 0, ventP: new THREE.Vector3(), ventN: new THREE.Vector3() };
    for (const p of K.parts) {
      const o = p[0] === 'box' ? 4 : 3;
      const d = (p[0] === 'box' ? R.ColliderDesc.cuboid(p[1], p[2], p[3]) : R.ColliderDesc.cylinder(p[1], p[2]))
        .setTranslation(p[o] || 0, p[o + 1] || 0, p[o + 2] || 0).setMass(K.m / K.parts.length)
        .setFriction(K.fr).setRestitution(K.rest || 0.12).setCollisionGroups(grp(G_PROP, G_STATIC | G_PROP | G_PUSH | G_CHARGE));
      this.byCollider.set(this.w.createCollider(d, body).handle, item);
    }
    const color = K.colors[Math.floor(this.rand() * K.colors.length)];
    const mat = litMaterial({ map: K.tex ? this.level.tex[K.tex].map : null, color, roughness: K.rough, metalness: K.metal });
    item.mats = [mat];
    item.mesh = this.mesh(kind, K, mat);
    this.scene.add(item.mesh);
    this.items.push(item);
    this.sync(item, true);
    return item;
  }

  layout() {
    const u = F1, P = (...a) => this.place(...a);
    const stack = (k, x, y, z, n, yaw = 0) => { for (let i = 0; i < n; i++) P(k, x + (i % 2) * 0.03, y + i * (KINDS[k].hy * 2 + 0.006), z, yaw + i * 0.3); };
    const cans = (x, y, z) => {
      for (const i of [-1, 0, 1]) P('can', x + i * 0.106, y, z, 0);
      for (const i of [-0.5, 0.5]) P('can', x + i * 0.106, y + 0.124, z, 0);
      P('can', x, y + 0.248, z, 0);
    };
    // ground floor: entry hall
    stack('crate', 6.3, 0, 13.6, 2, 0.2); P('crate', 6.95, 0, 13.7, 0.5);
    P('barrel', 1.5, 0, 12.2); P('barrel', 2.15, 0, 11.9); P('tire', 2.3, 0, 13.3);
    P('bottle', 9.6, 1.5, 15.0); P('bottle', 9.8, 1.5, 15.2); P('can', 9.7, 1.5, 14.9);
    P('ext', 7.6, 0, 9.5); P('carton', 5.6, 0, 15.4); P('carton', 6.1, 0, 15.5, 0.4);
    // big hall
    stack('crate', 16.6, 0, 15.2, 3, 0.1); P('crate', 17.3, 0, 15.3, 0.7);
    P('barrel', 22.7, 0, 11.6); P('barrel', 23.2, 0, 12.4); P('barrel', 22.4, 0, 12.5, 0, true);
    stack('tire', 11.2, 0, 15.2, 3); P('chair', 20.4, 0, 11.3, 2.4); P('chair', 15.0, 0, 11.6, 0.6);
    stack('cinder', 17.6, 0, 9.7, 3, 0); P('cinder', 18.1, 0, 9.75, 1.2); P('plank', 12.4, 0, 14.6, 0.3); P('plank', 12.6, 0.045, 14.5, 0.5);
    P('bucket', 14.2, 0, 13.4); P('carton', 10.6, 0, 9.7); stack('carton', 11.2, 0, 9.65, 2, 0.2);
    // corridor
    stack('carton', 9.6, 0, 6.65, 2, 0.1); P('carton', 10.2, 0, 6.6, 0.3); P('bucket', 14.6, 0, 8.6);
    P('ext', 19.6, 0, 8.7); P('plank', 6.4, 0, 8.6, 0.05); P('cinder', 2.2, 0, 8.6); P('tire', 22.6, 0, 6.6);
    // room A and B
    P('barrel', 1.4, 0, 4.7); P('barrel', 2.1, 0, 5.2); stack('crate', 6.9, 0, 4.9, 2, 0.3); P('tire', 5.4, 0, 1.0);
    stack('cinder', 3.6, 0, 0.7, 2, 0); P('ext', 7.5, 0, 2.2);
    cans(11.0, 0.78, 1.45); P('bottle', 10.5, 0.78, 1.3); P('bottle', 11.5, 0.78, 1.6); P('bottle', 11.6, 0.78, 1.25);
    P('chair', 10.9, 0, 2.5, Math.PI); P('chair', 12.4, 0, 2.3, 2.2); P('crate', 14.9, 0, 0.8, 0.1); P('bucket', 9.0, 0, 5.2);
    // stairwell
    P('bucket', 17.0, 0, 4.9); P('carton', 23.2, 0, 5.2); P('can', 21.6, 1.75, 0.5); P('bottle', 23.4, 1.75, 2.9);
    // upper floor
    stack('carton', 8.6, u, 8.6, 2, 0.2); P('barrel', 15.2, u, 8.6); P('ext', 2.0, u, 6.6); P('tire', 21.5, u, 8.5);
    stack('crate', 6.6, u, 1.0, 2, 0.1); P('barrel', 1.5, u, 1.3); P('barrel', 1.6, u, 2.1, 0, true); P('chair', 4.6, u, 4.6, 1.0);
    cans(14.3, u + 0.78, 0.9); P('bottle', 13.6, u + 0.78, 0.8); P('bottle', 15.0, u + 0.78, 1.0); P('chair', 14.2, u, 1.9, Math.PI);
    P('ext', 9.0, u, 5.3); P('crate', 11.0, u, 4.9, 0.4); P('bucket', 12.6, u, 1.2);
    stack('crate', 5.0, u, 14.9, 2, 0.2); stack('tire', 9.0, u, 10.2, 2); P('barrel', 16.5, u, 15.1); P('barrel', 23.2, u, 14.0);
    stack('cinder', 20.6, u, 9.9, 2, 0); P('plank', 21.2, u, 12.4, 1.4); P('carton', 14.5, u, 12.6); P('chair', 10.2, u, 12.4, 0.3);
    P('bottle', 12.0, u + 1.4, 15.0); P('bottle', 11.85, u + 1.4, 14.85); P('can', 12.15, u + 1.4, 15.1);
  }

  // A photo-scanned prop: its own materials (so each copy is lit where it stands), a physics body sized to the scan.
  placeScan(id, x, y, z, yawDeg) {
    const S = SCANS.get(id), spec = SCAN[id];
    if (!S) return null;
    const { size, center, k } = S, fixed = !spec.m;
    const yaw = (-yawDeg * Math.PI) / 180;
    const home = { p: new THREE.Vector3(x, y + size.y / 2 + 0.004, z), q: new THREE.Quaternion().setFromAxisAngle(_Y, yaw) };
    const body = this.w.createRigidBody((fixed ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic().setLinearDamping(0.05).setAngularDamping(spec.shape === 'round' ? 0.55 : 0.3))
      .setTranslation(home.p.x, home.p.y, home.p.z).setRotation(home.q));
    const round = spec.shape === 'round', radius = Math.max(size.x, size.z) / 2;
    const desc = (round ? R.ColliderDesc.cylinder(size.y / 2, radius) : R.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2))
      .setFriction(0.7).setRestitution(0.1).setCollisionGroups(grp(G_PROP, G_STATIC | G_PROP | G_PUSH | G_CHARGE));
    if (!fixed) desc.setMass(spec.m);
    const K = { m: spec.m || 500, snd: spec.snd, pen: !!spec.pen, vent: !!spec.vent, fragile: false, r: round ? radius : 0, colors: [0xffffff] };
    const item = { kind: id, K, body, home, fixed, last: new THREE.Vector3(), ambT: 0, cool: 0, broken: false, spent: false, vent: 0, ventP: new THREE.Vector3(), ventN: new THREE.Vector3() };
    this.byCollider.set(this.w.createCollider(desc, body).handle, item);

    const mesh = new THREE.Group(), inner = S.root.clone(true);
    inner.scale.setScalar(k);
    inner.position.copy(center).multiplyScalar(-1);
    item.mats = [];
    inner.traverse((o) => {
      if (!o.isMesh) return;
      const src = o.material;
      const m = litMaterial({
        map: src.map, normalMap: src.normalMap, roughnessMap: src.roughnessMap, metalnessMap: src.metalnessMap, aoMap: src.aoMap,
        color: src.color, roughness: src.roughness, metalness: src.metalness, transparent: src.transparent, alphaTest: src.alphaTest, side: src.side,
      });
      o.material = m; item.mats.push(m);
      o.castShadow = true; o.receiveShadow = true;
    });
    mesh.add(inner);
    item.mesh = mesh;
    this.scene.add(mesh);
    this.items.push(item);
    this.sync(item, true);

    // fixed furniture also blocks the player, bullets and the light of the muzzle in the box world
    if (fixed) {
      const c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw));
      const ex = c * size.x / 2 + sn * size.z / 2, ez = sn * size.x / 2 + c * size.z / 2;
      this.level.world.add(x - ex, y, z - ez, x + ex, y + size.y, z + ez, { mat: spec.snd === 'hard' ? 'concrete' : 'metal', occ: false });
    }
    return item;
  }

  layoutScans() {
    let n = 0;
    for (const [id, x, y, z, yaw] of SCAN_LAYOUT(F1)) if (this.placeScan(id, x, y, z, yaw)) n++;
    this.level.world.build();
    this.scanned = n;
  }

  // ---------- per-run state ----------

  reset() {
    if (!this.w) return;
    for (const it of this.items) {
      const b = it.body;
      b.setEnabled(true);
      b.setTranslation(it.home.p, true); b.setRotation(it.home.q, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      it.broken = false; it.spent = false; it.vent = 0; it.last.set(0, 0, 0); it.mesh.visible = true;
      this.sync(it, true);
    }
    for (const c of this.charges) this.clearCharge(c);
    for (const p of this.pushers) p.setEnabled(false);
    this.quiet = 1;
  }

  sync(it, light) {
    const t = it.body.translation(), q = it.body.rotation();
    it.mesh.position.set(t.x, t.y, t.z); it.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    if (light) { it.ambT = 0.25; this.level.lightFor(t.x, t.y, t.z, it.mats); }
  }

  // Kinematic capsules that shove loose objects out of the way of the player and hostiles.
  pusher(i, pos, h) {
    let b = this.pushers[i];
    if (!b) {
      b = this.pushers[i] = this.w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
      this.w.createCollider(R.ColliderDesc.capsule(0.45, 0.33).setFriction(0.2).setCollisionGroups(grp(G_PUSH, G_PROP)), b);
    }
    if (!pos) { if (b.isEnabled()) b.setEnabled(false); return; }
    const t = b.translation(), y = pos.y + h;
    if (!b.isEnabled() || Math.hypot(t.x - pos.x, t.y - y, t.z - pos.z) > 1.2) { b.setEnabled(true); b.setTranslation({ x: pos.x, y, z: pos.z }, true); }
    else b.setNextKinematicTranslation({ x: pos.x, y, z: pos.z });
  }

  step(dt, g) {
    if (!this.w) return;
    const pl = g.player, en = g.enemies;
    this.pusher(0, pl.dead ? null : pl.feet, pl.crouching ? 0.62 : 0.85);
    for (let i = 0; i < en.length; i++) this.pusher(i + 1, en[i].dead ? null : en[i].pos, 0.85);
    for (let i = en.length + 1; i < this.pushers.length; i++) this.pusher(i, null, 0);

    // punctured extinguishers fly on their own jet
    for (const it of this.items) {
      if (it.vent <= 0 || it.broken) continue;
      it.vent -= dt;
      const b = it.body, t = b.translation(), q = b.rotation();
      _q.set(q.x, q.y, q.z, q.w);
      _v.copy(it.ventP).applyQuaternion(_q); _v.x += t.x; _v.y += t.y; _v.z += t.z;
      _n.copy(it.ventN).applyQuaternion(_q);
      const J = 62 * dt * Math.min(1, it.vent / 0.6);
      b.applyImpulseAtPoint({ x: -_n.x * J, y: -_n.y * J, z: -_n.z * J }, _v, true);
      this.fx.puff(_v, _n);
    }

    this.w.timestep = Math.min(1 / 30, Math.max(1 / 240, dt));
    this.w.step();
    if (this.quiet > 0) this.quiet -= dt;

    for (const it of this.items) {
      if (it.broken || it.fixed) continue;
      const b = it.body;
      if (b.isSleeping()) { it.last.set(0, 0, 0); continue; }
      const v = b.linvel();
      const dv = Math.hypot(v.x - it.last.x, v.y - it.last.y, v.z - it.last.z);
      it.last.set(v.x, v.y, v.z);
      it.ambT -= dt;
      this.sync(it, it.ambT <= 0);
      it.cool -= dt;
      if (dv > 1.1 && it.cool <= 0 && this.quiet <= 0) {
        it.cool = 0.14;
        if (it.K.fragile && dv > 4.2) { this.shatter(it); continue; }
        this.sfx.knock(it.mesh.position, Math.min(1, dv / 6) * Math.min(1, 0.35 + it.K.m / 12), it.K.snd);
      }
      if (it.mesh.position.y < -8) { it.broken = true; b.setEnabled(false); it.mesh.visible = false; }
    }

    for (const c of this.charges) {
      if (!c.body) continue;
      c.t += dt;
      const t = c.body.translation(), v = c.body.linvel();
      c.mesh.position.set(t.x, t.y, t.z);
      if (Math.hypot(v.x - c.last.x, v.y - c.last.y, v.z - c.last.z) > 2.5) this.sfx.knock(c.mesh.position, 0.6, 'tin');
      c.last.set(v.x, v.y, v.z);
      this.fx.spawn(t.x, t.y, t.z, 0, 0.1, 0, 0.5, 0.03, 0.14, 0.5, 0.45, 0.4, 0.16, -0.1, 2);
      let boom = c.t > 1.5 || t.y < -6;
      if (!boom && c.t > 0.08) for (const e of en) if (!e.dead && Math.hypot(e.pos.x - t.x, e.pos.y + 1 - t.y, e.pos.z - t.z) < 1.1) { boom = true; break; }
      if (boom) { const p = c.mesh.position.clone(); this.clearCharge(c); this.blast(p, g); }
    }
  }

  // ---------- bullets ----------

  // Nearest loose object along a ray. Returns a shared hit record or null.
  raycast(ox, oy, oz, dx, dy, dz, maxT, skip = null) {
    if (!this.w || maxT <= 0) return null;
    const r = this.ray;
    r.origin.x = ox; r.origin.y = oy; r.origin.z = oz; r.dir.x = dx; r.dir.y = dy; r.dir.z = dz;
    const h = this.w.castRayAndGetNormal(r, maxT, true, undefined, grp(0xffff, G_PROP), undefined, skip || undefined);
    if (!h) return null;
    const item = this.byCollider.get(h.collider.handle);
    if (!item) return null;
    const o = this.hit, t = h.timeOfImpact;
    o.t = t; o.x = ox + dx * t; o.y = oy + dy * t; o.z = oz + dz * t;
    o.nx = h.normal.x; o.ny = h.normal.y; o.nz = h.normal.z; o.item = item;
    return o;
  }

  // A bullet carrying J newton-seconds strikes the object in a hit record.
  shot(h, dir, J, quiet) {
    const it = h.item, p = _v.set(h.x, h.y, h.z);
    if (it.K.fragile) { this.shatter(it); return; }
    it.body.applyImpulseAtPoint({ x: dir.x * J, y: dir.y * J, z: dir.z * J }, p, true);
    const s = it.K.snd;
    this.fx.impact(p, { x: h.nx, y: h.ny, z: h.nz }, s === 'wood' || s === 'soft' ? 'wood' : s === 'hard' ? 'concrete' : 'metal', false);
    if (!quiet) this.sfx.knock(p, 0.9, s);
    if (it.K.vent && !it.spent) this.puncture(it, p, _n.set(h.nx, h.ny, h.nz));
  }

  puncture(it, p, n) {
    const t = it.body.translation(), q = it.body.rotation();
    _q.set(q.x, q.y, q.z, q.w).invert();
    it.ventP.set(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(_q);
    it.ventN.copy(n).applyQuaternion(_q);
    it.spent = true; it.vent = 2.8;
    this.sfx.hiss(p, 2.8);
  }

  shatter(it) {
    it.broken = true; it.body.setEnabled(false); it.mesh.visible = false;
    const c = it.mats[0].color;
    this.fx.shatter(it.mesh.position, c.r, c.g, c.b);
    this.sfx.glass(it.mesh.position);
  }

  // ---------- concussion charges ----------

  launch(pos, vel) {
    if (!this.w) return;
    const c = this.charges.find((x) => !x.body) || this.charges[0];
    this.clearCharge(c);
    c.body = this.w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinvel(vel.x, vel.y, vel.z).setCcdEnabled(true).setLinearDamping(0.02));
    this.w.createCollider(R.ColliderDesc.ball(0.045).setMass(0.3).setRestitution(0.5).setFriction(0.6).setCollisionGroups(grp(G_CHARGE, G_STATIC | G_PROP)), c.body);
    c.t = 0; c.last.copy(vel); c.mesh.position.copy(pos); c.mesh.visible = true;
  }

  clearCharge(c) {
    if (c.body) { this.w.removeRigidBody(c.body); c.body = null; }
    c.mesh.visible = false;
  }

  // A shockwave: throws loose objects and bodies, hurts whoever has line of sight to it.
  blast(c, g) {
    const world = this.level.world, cy = c.y + 0.12;
    const clear = (x, y, z, d) => d < 0.5 || !world.blocked(c.x, cy, c.z, (x - c.x) / d, (y - cy) / d, (z - c.z) / d, d - 0.3, 'ray');
    this.fx.blast(c); this.sfx.boom(c);
    g.noise(c);
    for (const it of this.items) {
      if (it.broken || it.fixed) continue;
      const t = it.body.translation(), dx = t.x - c.x, dy = t.y - cy, dz = t.z - c.z, d = Math.hypot(dx, dy, dz);
      if (d > BLAST_R || !clear(t.x, t.y, t.z, d)) continue;
      const f = 1 - d / BLAST_R;
      if (it.K.fragile) { this.shatter(it); continue; }
      const m = it.K.m, dv = Math.min(16, (22 * f) / Math.cbrt(m)), k = (dv * m) / (d + 0.15);
      it.body.applyImpulseAtPoint({ x: dx * k, y: (dy + 0.35 * d + 0.1) * k, z: dz * k },
        { x: t.x + (this.rand() - 0.5) * 0.2, y: t.y + (this.rand() - 0.5) * 0.2, z: t.z + (this.rand() - 0.5) * 0.2 }, true);
      if (it.K.vent && !it.spent && f > 0.3) this.puncture(it, _v.set(t.x, t.y + 0.1, t.z), _n.set(dx, 0, dz).normalize().multiplyScalar(-1));
    }
    for (const e of g.enemies) e.blast(c, BLAST_R, g);
    const pl = g.player, e = pl.eye, d = Math.hypot(e.x - c.x, e.y - cy, e.z - c.z);
    pl.trauma = Math.min(1, pl.trauma + 0.9 * Math.max(0, 1 - d / 16));
    if (!pl.dead && d < BLAST_R && clear(e.x, e.y, e.z, d)) {
      const f = 1 - d / BLAST_R;
      pl.damage(8 + 80 * f * f, _v.set(e.x - c.x, 0, e.z - c.z).normalize());
    }
  }
}
