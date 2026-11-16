// Weapon definitions and the first-person models for everything except the rifle
// (which lives in player.js). Guns point down -Z with the bore on the y = 0 axis.
import * as THREE from 'three';

// A side-profile polygon (distance forward from the butt, height) extruded to a thickness.
export function profile(points, depth, bevel = 0.003) {
  const s = new THREE.Shape();
  points.forEach(([f, y], i) => (i ? s.lineTo(f, y) : s.moveTo(f, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1 });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  g.rotateY(Math.PI / 2); // forward distance -> -Z, thickness -> X
  return g;
}

// dmg multiplies the per-body-part damage in enemy.js; impulse is in newton-seconds per projectile.
export const WEAPONS = [
  { id: 'rifle', name: 'AKR', auto: true, cool: 0.1, mag: 30, reserve: 150, dmg: 1, pellets: 1, spread: [0.014, 0.0035], kick: 0.034, kickMax: 0.09, flip: 1,
    camKick: 0.011, rise: 0.0055, yawJit: 0.007, trauma: 0.2, flash: 240, impulse: 16, reloadT: 2.3, hip: [0.085, -0.215, -0.06], ads: [0, -0.069, -0.1],
    len: 0.95, fov: 78, sound: 'rifle', casing: true, torch: [-0.036, 0, -0.68] },
  { id: 'pistol', name: 'P9', auto: false, cool: 0.13, mag: 15, reserve: 75, dmg: 0.7, pellets: 1, spread: [0.02, 0.006], kick: 0.045, kickMax: 0.1, flip: 2.2,
    camKick: 0.008, rise: 0.008, yawJit: 0.009, trauma: 0.14, flash: 150, impulse: 8, reloadT: 1.5, hip: [0.07, -0.165, -0.4], ads: [0, -0.026, -0.44],
    len: 0.32, fov: 84, sound: 'pistol', casing: true, torch: [0, -0.03, -0.16] },
  { id: 'shotgun', name: 'M12 PUMP', auto: false, cool: 0.85, mag: 6, reserve: 30, dmg: 0.36, pellets: 9, spread: [0.085, 0.07], kick: 0.09, kickMax: 0.12, flip: 1.4,
    camKick: 0.03, rise: 0.02, yawJit: 0.014, trauma: 0.45, flash: 330, impulse: 4.5, shells: 0.5, hip: [0.085, -0.215, -0.06], ads: [0, -0.044, -0.1],
    len: 0.98, fov: 82, sound: 'shotgun', pump: true, torch: [-0.03, -0.018, -0.9] },
  { id: 'thumper', name: 'THUMPER', auto: false, cool: 0.4, mag: 1, reserve: 5, projectile: 26, pellets: 0, kick: 0.07, kickMax: 0.1, flip: 1.5,
    camKick: 0.02, rise: 0.012, yawJit: 0.006, trauma: 0.35, flash: 50, reloadT: 1.9, hip: [0.085, -0.2, -0.06], ads: [0, -0.066, -0.2],
    len: 0.62, fov: 86, sound: 'thump', torch: [-0.045, 0, -0.5] },
];

function kit(g) {
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const box = (w, h, d, x, y, f, mat, parent) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, -f, parent);
  const tube = (r, f0, f1, y, mat, parent) => add(new THREE.CylinderGeometry(r, r, f1 - f0, 14).rotateX(Math.PI / 2), mat, 0, y, -(f0 + f1) / 2, parent);
  const arm = (a, b, r, mat) => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), len = va.distanceTo(vb);
    const m = add(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
    return m;
  };
  const point = (x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); g.add(o); return o; };
  return { add, box, tube, arm, point };
}

function pistol(g, m) {
  const { add, box, tube, arm, point } = kit(g);
  box(0.027, 0.03, 0.185, 0, 0.004, 0.0925, m.steel);                                                        // slide
  box(0.025, 0.02, 0.15, 0, -0.02, 0.085, m.poly);                                                           // frame
  add(profile([[0.0, -0.028], [0.052, -0.028], [0.034, -0.135], [-0.022, -0.125]], 0.028, 0.005), m.poly);   // grip
  const mag = box(0.022, 0.012, 0.05, 0, -0.137, 0.006, m.steel);                                            // magazine base
  box(0.008, 0.004, 0.05, 0, -0.058, 0.082, m.poly); box(0.008, 0.03, 0.004, 0, -0.044, 0.107, m.poly);      // trigger guard
  box(0.004, 0.007, 0.006, -0.007, 0.0225, 0.01, m.steel); box(0.004, 0.007, 0.006, 0.007, 0.0225, 0.01, m.steel);
  box(0.003, 0.007, 0.006, 0, 0.0225, 0.176, m.steel);                                                       // front sight
  tube(0.0065, 0.18, 0.196, 0.004, m.steel);                                                                 // barrel
  const rh = add(new THREE.CapsuleGeometry(0.033, 0.05, 4, 10), m.glove, 0.004, -0.088, -0.012);
  rh.rotation.x = -0.18; rh.scale.set(1.05, 1, 0.95);
  const lh = add(new THREE.CapsuleGeometry(0.032, 0.05, 4, 10), m.glove, -0.024, -0.098, -0.022);
  lh.rotation.x = -0.18; lh.rotation.z = -0.35;
  arm([0.016, -0.11, 0.01], [0.2, -0.3, 0.56], 0.042, m.sleeve);
  arm([-0.036, -0.115, 0.0], [-0.25, -0.3, 0.52], 0.042, m.sleeve);
  return { group: g, mag, muzzle: point(0, 0.004, -0.2), port: point(0.02, 0.016, -0.1), stock: new THREE.Object3D() };
}

function shotgun(g, m) {
  const { add, box, tube, arm, point } = kit(g);
  const stock = add(profile([[0, -0.12], [0, 0.0], [0.03, 0.012], [0.26, 0.014], [0.26, -0.04], [0.18, -0.058], [0.05, -0.125]], 0.036, 0.005), m.poly);
  add(profile([[0.25, -0.05], [0.25, 0.034], [0.47, 0.034], [0.47, -0.045]], 0.044), m.steel);               // receiver
  add(profile([[0.265, -0.05], [0.31, -0.05], [0.29, -0.14], [0.25, -0.135]], 0.03, 0.005), m.poly);         // grip
  box(0.012, 0.004, 0.055, 0, -0.088, 0.34, m.steel); box(0.012, 0.04, 0.004, 0, -0.068, 0.366, m.steel);    // trigger guard
  tube(0.0115, 0.47, 1.0, 0.012, m.steel);                                                                   // barrel
  tube(0.0125, 0.47, 0.93, -0.018, m.steel);                                                                 // magazine tube
  box(0.012, 0.02, 0.014, 0, -0.003, 0.92, m.steel);                                                         // barrel clamp
  box(0.007, 0.004, 0.52, 0, 0.0255, 0.73, m.steel);                                                         // rib
  box(0.004, 0.007, 0.004, 0, 0.031, 0.99, m.steel);                                                         // bead
  box(0.002, 0.03, 0.07, 0.0232, 0.006, 0.39, m.poly);                                                       // ejection port
  const pump = new THREE.Group(); g.add(pump);
  add(new THREE.CylinderGeometry(0.024, 0.024, 0.19, 14).rotateX(Math.PI / 2), m.poly, 0, -0.018, -0.69, pump);
  for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.05, 0.004, 0.012), m.poly, 0, -0.04, -0.62 - i * 0.035, pump);
  const lh = add(new THREE.CapsuleGeometry(0.033, 0.07, 4, 10).rotateX(Math.PI / 2), m.glove, 0, -0.055, -0.69, pump);
  lh.scale.set(1.2, 0.8, 1);
  const rh = add(new THREE.CapsuleGeometry(0.034, 0.05, 4, 10), m.glove, 0.002, -0.105, -0.283);
  rh.rotation.x = 0.25; rh.scale.set(1.05, 1, 0.9);
  arm([0.014, -0.115, -0.255], [0.19, -0.39, 0.14], 0.043, m.sleeve);
  arm([-0.014, -0.08, -0.66], [-0.22, -0.43, -0.2], 0.043, m.sleeve);
  return { group: g, mag: new THREE.Object3D(), muzzle: point(0, 0.012, -1.01), port: point(0.03, 0.01, -0.39), stock, pump };
}

// An original break-action launcher for concussion charges.
function thumper(g, m) {
  const { add, box, tube, arm, point } = kit(g);
  const stock = add(profile([[0, -0.11], [0, 0.0], [0.03, 0.012], [0.2, 0.014], [0.2, -0.04], [0.14, -0.055], [0.05, -0.115]], 0.036, 0.005), m.poly);
  add(profile([[0.2, -0.05], [0.2, 0.032], [0.33, 0.038], [0.33, -0.05]], 0.054), m.steel);                  // receiver
  add(profile([[0.225, -0.05], [0.27, -0.05], [0.25, -0.15], [0.208, -0.143]], 0.03, 0.005), m.poly);        // grip
  box(0.012, 0.004, 0.05, 0, -0.088, 0.295, m.steel); box(0.012, 0.04, 0.004, 0, -0.068, 0.32, m.steel);     // trigger guard
  tube(0.031, 0.33, 0.62, 0, m.steel);                                                                       // barrel
  tube(0.0328, 0.352, 0.378, 0, m.band); tube(0.0328, 0.39, 0.4, 0, m.band);                                 // warning bands
  tube(0.035, 0.598, 0.626, 0, m.steel);                                                                     // muzzle ring
  for (let i = 0; i < 4; i++) tube(0.0322, 0.43 + i * 0.035, 0.445 + i * 0.035, 0, m.poly);                  // cooling ribs
  box(0.02, 0.012, 0.2, 0, -0.037, 0.47, m.steel);                                                           // rail
  box(0.03, 0.085, 0.036, 0, -0.085, 0.5, m.poly);                                                           // foregrip
  box(0.004, 0.034, 0.004, 0, 0.052, 0.36, m.steel); box(0.014, 0.004, 0.004, 0, 0.068, 0.36, m.steel);      // leaf sight
  box(0.004, 0.03, 0.004, 0, 0.05, 0.6, m.steel);                                                            // front post
  const rh = add(new THREE.CapsuleGeometry(0.034, 0.05, 4, 10), m.glove, 0.002, -0.105, -0.243);
  rh.rotation.x = 0.25; rh.scale.set(1.05, 1, 0.9);
  const lh = add(new THREE.CapsuleGeometry(0.033, 0.05, 4, 10), m.glove, 0, -0.09, -0.5);
  lh.scale.set(1.1, 1, 1);
  arm([0.014, -0.115, -0.215], [0.19, -0.39, 0.14], 0.043, m.sleeve);
  arm([-0.014, -0.11, -0.48], [-0.22, -0.43, -0.1], 0.043, m.sleeve);
  return { group: g, mag: new THREE.Object3D(), muzzle: point(0, 0, -0.63), port: point(0.03, 0.02, -0.3), stock };
}

export function buildWeapon(id, mats) {
  const g = new THREE.Group();
  return id === 'pistol' ? pistol(g, mats) : id === 'shotgun' ? shotgun(g, mats) : thumper(g, mats);
}
