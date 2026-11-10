// guns.js - procedural firearm models built from Three.js primitives.
//
// Coordinate convention (metres, local space of the returned group):
//   +Y  barrel direction      +Z  top of the gun (sights)      -Z  grip hangs down
//   +X  the gun's right-hand side
//   Origin: the centre of the pistol grip, roughly where the web of the hand sits.
//
// Both factories return a THREE.Group with:
//   userData.muzzle    Vector3  muzzle point
//   userData.eject     Vector3  ejection port, right side
//   userData.slide     Object3D reciprocating parts (move along -Y by ~0.03 on recoil)
//   userData.leftGrip  Vector3  where a supporting left hand should hold
//
// Generic original designs; no logos, no text, no real manufacturer or model.
import * as THREE from 'three';

// ---------------------------------------------------------------- materials
const steelMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.9, roughness: 0.38 });
const polymerMat = new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.05, roughness: 0.72 });
const wornMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.95, roughness: 0.3 });
const boreMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

// ---------------------------------------------------------------- helpers
// Box sized (x, y, z) and centred at (px, py, pz).
function box(sx, sy, sz, px, py, pz, mat, shadow) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(px, py, pz);
  if (shadow) m.castShadow = true;
  return m;
}

// Cylinder of radius r (rTop optional for a taper) and length len, with its axis along 'x', 'y' or 'z'.
function cyl(r, len, seg, px, py, pz, mat, axis, shadow, rTop) {
  const geo = new THREE.CylinderGeometry(rTop === undefined ? r : rTop, r, len, seg);
  if (axis === 'x') geo.rotateZ(-Math.PI / 2); // +Y -> +X
  else if (axis === 'z') geo.rotateX(Math.PI / 2); // +Y -> +Z
  const m = new THREE.Mesh(geo, mat);
  m.position.set(px, py, pz);
  if (shadow) m.castShadow = true;
  return m;
}

// Half-loop trigger guard in the Y-Z plane that bulges toward +Y (forward).
// R: radius (spans +/-R in Z), sx/sy: stretch to flatten/lengthen it, (cy, cz): centre of the loop.
function triggerGuard(R, tube, sx, sy, cy, cz, mat) {
  const geo = new THREE.TorusGeometry(R, tube, 6, 12, Math.PI);
  geo.rotateY(Math.PI / 2); // ring plane XY -> YZ, the arc bulges toward +Y
  geo.scale(sx, sy, 1);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(0, cy, cz);
  m.castShadow = true;
  return m;
}

// Side-profile prism: pts are [y, z] pairs, extruded across X (total width), centred on x = 0.
// holes: optional array of [y, z] point arrays cut through the profile.
function sideProfile(pts, width, mat, holes) {
  const shape = new THREE.Shape();
  pts.forEach((p, i) => (i === 0 ? shape.moveTo(p[0], p[1]) : shape.lineTo(p[0], p[1])));
  shape.closePath();
  if (holes) {
    for (const h of holes) {
      const path = new THREE.Path();
      h.forEach((p, i) => (i === 0 ? path.moveTo(p[0], p[1]) : path.lineTo(p[0], p[1])));
      path.closePath();
      shape.holes.push(path);
    }
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 4 });
  geo.translate(0, 0, -width / 2);
  // shape x -> world Y, shape y -> world Z, extrusion depth -> world X (cyclic permutation, no flip)
  geo.applyMatrix4(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0))
  );
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

// Dark disc facing +Y used for the bore at a muzzle.
function boreDisc(r, py, pz) {
  const geo = new THREE.CircleGeometry(r, 10);
  geo.rotateX(-Math.PI / 2); // normal +Z -> +Y
  const m = new THREE.Mesh(geo, boreMat);
  m.position.set(0, py, pz);
  return m;
}

// ================================================================ PISTOL
export function makePistol() {
  const g = new THREE.Group();
  g.name = 'pistol';

  const BORE_Z = 0.045; // barrel axis height
  const SLIDE_FRONT = 0.16;
  const MUZZLE_Y = 0.165;

  // ---- fixed: frame -------------------------------------------------------
  g.add(box(0.026, 0.082, 0.022, 0, 0.004, 0.021, polymerMat, true)); // main frame under the slide
  g.add(box(0.024, 0.08, 0.018, 0, 0.085, 0.023, polymerMat, true)); // dust cover

  // accessory rail under the dust cover, with cross slots
  g.add(box(0.018, 0.072, 0.005, 0, 0.086, 0.0115, polymerMat));
  for (let i = 0; i < 4; i++) {
    g.add(box(0.0192, 0.0035, 0.0052, 0, 0.062 + i * 0.016, 0.0115, boreMat));
  }

  // trigger guard (half torus) + trigger
  g.add(triggerGuard(0.0155, 0.0022, 1.5, 1.9, 0.018, -0.004, polymerMat));
  const trigger = box(0.005, 0.005, 0.02, 0, 0.027, -0.004, wornMat);
  trigger.rotation.x = 0.25;
  g.add(trigger);

  // slide stop lever (left) with a small stub on the right, and magazine release
  g.add(box(0.0025, 0.026, 0.0045, -0.0143, 0.012, 0.0215, wornMat));
  g.add(cyl(0.0025, 0.002, 8, 0.0138, 0.003, 0.0215, wornMat, 'x'));

  // ---- fixed: barrel --------------------------------------------------------
  g.add(cyl(0.0052, 0.145, 10, 0, 0.0925, BORE_Z, wornMat, 'y'));
  g.add(boreDisc(0.0032, MUZZLE_Y + 0.0001, BORE_Z));

  // ---- fixed: grip (raked back) ----------------------------------------------
  const grip = new THREE.Group();
  grip.rotation.x = -0.2; // bottom of the grip swings toward -Y
  g.add(grip);

  grip.add(box(0.03, 0.044, 0.1, 0, 0, -0.02, polymerMat, true)); // z -0.070 .. 0.030
  grip.add(box(0.032, 0.05, 0.005, 0, 0, -0.0725, wornMat)); // magazine baseplate
  grip.add(box(0.02, 0.005, 0.045, 0, -0.0225, -0.012, polymerMat)); // backstrap swell

  // side ridges (texture)
  for (let i = 0; i < 7; i++) {
    const z = -0.064 + i * 0.0082;
    grip.add(box(0.0008, 0.034, 0.0016, 0.0154, 0, z, polymerMat));
    grip.add(box(0.0008, 0.034, 0.0016, -0.0154, 0, z, polymerMat));
  }
  // front strap ridges
  for (let i = 0; i < 5; i++) {
    grip.add(box(0.018, 0.0008, 0.002, 0, 0.0224, -0.062 + i * 0.009, polymerMat));
  }
  // magazine release button (left side)
  grip.add(cyl(0.0035, 0.004, 8, -0.017, 0.008, 0.008, wornMat, 'x'));

  // ---- moving: slide ---------------------------------------------------------
  const slide = new THREE.Group();
  slide.name = 'pistolSlide';
  g.add(slide);

  slide.add(box(0.028, 0.2, 0.03, 0, 0.06, 0.045, steelMat, true)); // slide body
  slide.add(box(0.02, 0.2, 0.004, 0, 0.06, 0.062, steelMat)); // rounded top shoulder
  slide.add(cyl(0.0075, 0.003, 10, 0, SLIDE_FRONT + 0.0015, BORE_Z, wornMat, 'y')); // muzzle bushing

  // ejection port (dark inset on the right) and a lip above it
  slide.add(box(0.0012, 0.04, 0.014, 0.0142, 0.05, 0.048, boreMat));
  slide.add(box(0.0008, 0.044, 0.0012, 0.0143, 0.05, 0.0562, wornMat));

  // rear cocking serrations (thin raised strips, both sides)
  for (let i = 0; i < 6; i++) {
    const y = -0.032 + i * 0.0045;
    slide.add(box(0.001, 0.0014, 0.022, 0.01445, y, 0.046, wornMat));
    slide.add(box(0.001, 0.0014, 0.022, -0.01445, y, 0.046, wornMat));
  }
  // forward serrations (a few, both sides)
  for (let i = 0; i < 3; i++) {
    const y = 0.138 + i * 0.0045;
    slide.add(box(0.001, 0.0014, 0.018, 0.01445, y, 0.046, wornMat));
    slide.add(box(0.001, 0.0014, 0.018, -0.01445, y, 0.046, wornMat));
  }

  // sights: rear notch (two blocks), front post
  slide.add(box(0.005, 0.008, 0.0065, 0.0045, -0.03, 0.06725, steelMat));
  slide.add(box(0.005, 0.008, 0.0065, -0.0045, -0.03, 0.06725, steelMat));
  slide.add(box(0.004, 0.006, 0.0055, 0, 0.15, 0.06675, steelMat));

  // ---- userData ---------------------------------------------------------------
  g.userData.muzzle = new THREE.Vector3(0, MUZZLE_Y, BORE_Z);
  g.userData.eject = new THREE.Vector3(0.015, 0.05, 0.048);
  g.userData.slide = slide;
  g.userData.leftGrip = new THREE.Vector3(0, 0.03, -0.04);
  return g;
}

// ================================================================ SMG
export function makeSMG() {
  const g = new THREE.Group();
  g.name = 'smg';

  const BORE_Z = 0.025;
  const MUZZLE_Y = 0.27;

  // ---- receivers ---------------------------------------------------------------
  g.add(box(0.038, 0.21, 0.042, 0, -0.005, 0.025, steelMat, true)); // upper receiver y -0.110 .. 0.100
  g.add(box(0.034, 0.188, 0.02, 0, 0.004, -0.004, polymerMat, true)); // lower receiver
  g.add(box(0.032, 0.04, 0.012, 0, 0.077, -0.012, polymerMat, true)); // magwell
  g.add(box(0.036, 0.008, 0.04, 0, -0.114, 0.024, steelMat)); // rear end cap

  // worn top edges of the upper receiver
  g.add(box(0.0012, 0.2, 0.0012, 0.0188, -0.005, 0.0455, wornMat));
  g.add(box(0.0012, 0.2, 0.0012, -0.0188, -0.005, 0.0455, wornMat));

  // ejection port (dark inset, right side) with a lip
  g.add(box(0.0012, 0.06, 0.016, 0.0192, 0.02, 0.032, boreMat));
  g.add(box(0.001, 0.064, 0.0012, 0.0192, 0.02, 0.0412, wornMat));
  // charging handle slot (fixed, dark)
  g.add(box(0.0012, 0.058, 0.004, 0.0192, -0.062, 0.032, boreMat));

  // safety / selector lever (left)
  g.add(box(0.004, 0.022, 0.005, -0.0185, -0.03, -0.003, wornMat));

  // ---- top rail with teeth ------------------------------------------------------
  g.add(box(0.02, 0.305, 0.0035, 0, 0.0475, 0.04775, steelMat)); // y -0.105 .. 0.200
  for (let i = 0; i < 25; i++) {
    g.add(box(0.022, 0.006, 0.0025, 0, -0.1 + i * 0.012, 0.05075, steelMat));
  }

  // flip-up rear aperture sight
  g.add(box(0.018, 0.014, 0.004, 0, -0.085, 0.054, steelMat));
  g.add(box(0.003, 0.008, 0.016, 0.0075, -0.085, 0.064, steelMat));
  g.add(box(0.003, 0.008, 0.016, -0.0075, -0.085, 0.064, steelMat));
  g.add(box(0.014, 0.008, 0.003, 0, -0.085, 0.0575, steelMat));
  {
    const ringGeo = new THREE.TorusGeometry(0.0042, 0.0014, 5, 10);
    ringGeo.rotateX(Math.PI / 2); // ring plane XY -> XZ, aperture looks along Y
    const ring = new THREE.Mesh(ringGeo, wornMat);
    ring.position.set(0, -0.0875, 0.0645);
    g.add(ring);
  }
  // flip-up front post with protective ears
  g.add(box(0.016, 0.016, 0.004, 0, 0.188, 0.054, steelMat));
  g.add(box(0.003, 0.003, 0.014, 0, 0.188, 0.063, steelMat));
  g.add(box(0.003, 0.01, 0.012, 0.006, 0.188, 0.062, steelMat));
  g.add(box(0.003, 0.01, 0.012, -0.006, 0.188, 0.062, steelMat));

  // ---- barrel, handguard, muzzle device ----------------------------------------------
  g.add(cyl(0.0075, 0.145, 10, 0, 0.1725, BORE_Z, steelMat, 'y')); // y 0.100 .. 0.245
  g.add(cyl(0.0095, 0.006, 10, 0, 0.215, BORE_Z, wornMat, 'y')); // front collar

  // ventilated handguard (lighter finish so the dark slots read)
  g.add(box(0.038, 0.1, 0.044, 0, 0.15, 0.024, wornMat, true)); // y 0.100 .. 0.200
  g.add(box(0.04, 0.008, 0.044, 0, 0.204, 0.024, steelMat)); // end cap
  for (let r = 0; r < 2; r++) {
    const z = 0.014 + r * 0.018;
    for (let i = 0; i < 4; i++) {
      const y = 0.12 + i * 0.022;
      g.add(box(0.0012, 0.016, 0.006, 0.0192, y, z, boreMat));
      g.add(box(0.0012, 0.016, 0.006, -0.0192, y, z, boreMat));
    }
  }

  // muzzle device: two rings, four bars, dark core between them
  g.add(cyl(0.0108, 0.008, 10, 0, 0.239, BORE_Z, steelMat, 'y'));
  g.add(cyl(0.0108, 0.008, 10, 0, 0.266, BORE_Z, steelMat, 'y'));
  g.add(cyl(0.0085, 0.019, 10, 0, 0.2525, BORE_Z, boreMat, 'y'));
  g.add(box(0.0035, 0.019, 0.0035, 0.0092, 0.2525, BORE_Z, steelMat));
  g.add(box(0.0035, 0.019, 0.0035, -0.0092, 0.2525, BORE_Z, steelMat));
  g.add(box(0.0035, 0.019, 0.0035, 0, 0.2525, BORE_Z + 0.0092, steelMat));
  g.add(box(0.0035, 0.019, 0.0035, 0, 0.2525, BORE_Z - 0.0092, steelMat));
  g.add(boreDisc(0.0055, MUZZLE_Y + 0.0001, BORE_Z));

  // ---- stubby vertical foregrip ---------------------------------------------------------
  g.add(box(0.022, 0.034, 0.008, 0, 0.16, -0.002, steelMat)); // mount block
  g.add(cyl(0.018, 0.075, 10, 0, 0.16, -0.0435, polymerMat, 'z', true, 0.015)); // z -0.006 .. -0.081
  for (let i = 0; i < 3; i++) {
    const z = -0.03 - i * 0.017;
    const r = 0.015 + (0.003 * (-z - 0.006)) / 0.075;
    const ringGeo = new THREE.TorusGeometry(r, 0.0016, 5, 10);
    const ring = new THREE.Mesh(ringGeo, polymerMat); // axis Z by default
    ring.position.set(0, 0.16, z);
    g.add(ring);
  }

  // ---- pistol grip (raked back), trigger guard, trigger --------------------------------------
  const grip = new THREE.Group();
  grip.rotation.x = -0.3;
  g.add(grip);
  grip.add(box(0.034, 0.036, 0.105, 0, 0, -0.0325, polymerMat, true)); // z -0.085 .. 0.020
  grip.add(box(0.036, 0.04, 0.004, 0, 0, -0.087, wornMat)); // grip cap
  for (let i = 0; i < 6; i++) {
    const z = -0.072 + i * 0.0095;
    grip.add(box(0.0008, 0.026, 0.0016, 0.0174, 0, z, polymerMat));
    grip.add(box(0.0008, 0.026, 0.0016, -0.0174, 0, z, polymerMat));
  }

  g.add(triggerGuard(0.016, 0.0022, 1.5, 2.0, 0.008, -0.0275, polymerMat));
  const trigger = box(0.005, 0.005, 0.02, 0, 0.016, -0.026, wornMat);
  trigger.rotation.x = 0.25;
  g.add(trigger);

  // ---- magazine: straight box, in front of the trigger guard ---------------------------------------
  g.add(box(0.024, 0.026, 0.135, 0, 0.077, -0.0775, steelMat, true)); // z -0.145 .. -0.010
  g.add(box(0.027, 0.029, 0.004, 0, 0.077, -0.147, polymerMat)); // baseplate
  g.add(box(0.026, 0.028, 0.004, 0, 0.077, -0.0095, wornMat)); // feed lips
  for (let i = 0; i < 3; i++) {
    const z = -0.045 - i * 0.03;
    g.add(box(0.0008, 0.018, 0.0025, 0.0124, 0.077, z, wornMat));
    g.add(box(0.0008, 0.018, 0.0025, -0.0124, 0.077, z, wornMat));
  }
  g.add(box(0.004, 0.0008, 0.11, 0, 0.0904, -0.075, wornMat)); // front rib
  g.add(cyl(0.003, 0.004, 8, -0.0175, 0.05, -0.012, wornMat, 'x')); // magazine catch button

  // ---- collapsed stock + butt plate -------------------------------------------------------------------
  g.add(
    sideProfile(
      [
        [-0.222, 0.044],
        [-0.12, 0.041],
        [-0.11, 0.04],
        [-0.11, 0.006],
        [-0.15, 0.002],
        [-0.185, -0.018],
        [-0.222, -0.027],
      ],
      0.03,
      polymerMat,
      [
        [
          [-0.212, 0.034],
          [-0.13, 0.032],
          [-0.13, 0.012],
          [-0.205, 0.008],
        ],
      ]
    )
  );
  g.add(box(0.034, 0.008, 0.077, 0, -0.226, 0.0085, wornMat, true)); // butt plate y -0.230 .. -0.222
  for (let i = 0; i < 6; i++) {
    g.add(box(0.028, 0.0008, 0.0025, 0, -0.23, -0.022 + i * 0.0115, steelMat));
  }

  // ---- moving: charging handle (reciprocating) ---------------------------------------------------------
  const slide = new THREE.Group();
  slide.name = 'smgBolt';
  g.add(slide);
  slide.add(box(0.0037, 0.008, 0.006, 0.02065, -0.045, 0.032, wornMat)); // stem through the slot
  slide.add(cyl(0.0055, 0.004, 8, 0.0245, -0.045, 0.032, wornMat, 'x')); // knob

  // ---- userData ------------------------------------------------------------------------------------------------
  g.userData.muzzle = new THREE.Vector3(0, MUZZLE_Y, BORE_Z);
  g.userData.eject = new THREE.Vector3(0.0195, 0.02, 0.032);
  g.userData.slide = slide;
  g.userData.leftGrip = new THREE.Vector3(0, 0.16, -0.045);
  return g;
}
