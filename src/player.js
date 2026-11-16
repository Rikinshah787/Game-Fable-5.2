// First-person controller filmed from a chest-mounted camera: the weapon is aimed with the
// mouse and the camera trails behind it, with handheld shake, step bob, lean and recoil.
// Four weapons: rifle, pistol, pump shotgun and the Thumper concussion launcher.
import * as THREE from 'three';
import { litMaterial } from './level.js';
import { flashTexture } from './fx.js';
import { WEAPONS, profile, buildWeapon } from './weapons.js';

const HW = 0.28, STAND = 1.75, CROUCH = 1.15;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const nz = (t, s) => Math.sin(t * 1.31 + s) * 0.5 + Math.sin(t * 2.93 + s * 2.1) * 0.3 + Math.sin(t * 6.17 + s * 3.7) * 0.2;
const _hit = { t: 0, box: null, nx: 0, ny: 0, nz: 0 };
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q2 = new THREE.Quaternion();

function buildRifle(mats) {
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const box = (w, h, d, x, y, f, mat) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, -f);
  const tube = (r, f0, f1, y, mat, x = 0) => add(new THREE.CylinderGeometry(r, r, f1 - f0, 12).rotateX(Math.PI / 2), mat, x, y, -(f0 + f1) / 2);
  const arm = (a, b, r, mat) => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), len = va.distanceTo(vb);
    const m = add(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
    m.position.copy(va).add(vb).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
    return m;
  };
  const { steel, wood, glove, sleeve } = mats;
  const stock = add(profile([[0, -0.12], [0, 0.0], [0.03, 0.012], [0.24, 0.014], [0.24, -0.04], [0.17, -0.058], [0.05, -0.125]], 0.036, 0.005), wood);
  add(profile([[0.235, -0.052], [0.235, 0.03], [0.5, 0.03], [0.5, -0.044], [0.43, -0.05], [0.3, -0.056]], 0.042), steel);  // receiver
  tube(0.021, 0.255, 0.49, 0.03, steel);                                                                                  // top cover
  add(profile([[0.262, -0.05], [0.305, -0.05], [0.285, -0.155], [0.243, -0.148]], 0.03, 0.005), steel);                   // grip
  const mag = add(profile([[0.355, -0.05], [0.425, -0.05], [0.44, -0.11], [0.47, -0.18], [0.495, -0.232], [0.44, -0.255], [0.412, -0.2], [0.385, -0.125]], 0.026), steel);
  box(0.012, 0.004, 0.055, 0, -0.09, 0.335, steel);                                                                       // trigger guard
  box(0.012, 0.04, 0.004, 0, -0.07, 0.362, steel);
  add(profile([[0.5, -0.042], [0.5, 0.014], [0.735, 0.01], [0.735, -0.028], [0.71, -0.042]], 0.05, 0.006), wood);         // lower handguard
  tube(0.0195, 0.515, 0.7, 0.032, wood);                                                                                  // upper handguard
  tube(0.0085, 0.7, 0.775, 0.032, steel);                                                                                 // gas tube
  box(0.02, 0.046, 0.028, 0, 0.014, 0.775, steel);                                                                        // gas block
  tube(0.0085, 0.5, 0.935, 0, steel);                                                                                     // barrel
  tube(0.003, 0.735, 0.93, -0.014, steel);                                                                                // cleaning rod
  box(0.012, 0.058, 0.02, 0, 0.03, 0.865, steel);                                                                         // front sight base
  box(0.003, 0.022, 0.012, -0.008, 0.066, 0.865, steel); box(0.003, 0.022, 0.012, 0.008, 0.066, 0.865, steel);
  box(0.003, 0.016, 0.003, 0, 0.063, 0.865, steel);
  box(0.02, 0.012, 0.03, 0, 0.052, 0.505, steel);                                                                         // rear sight
  box(0.004, 0.012, 0.006, -0.007, 0.062, 0.495, steel); box(0.004, 0.012, 0.006, 0.007, 0.062, 0.495, steel);
  tube(0.0125, 0.935, 0.985, 0, steel);                                                                                   // muzzle device
  box(0.022, 0.008, 0.012, 0.031, 0.012, 0.4, steel);                                                                     // charging handle
  box(0.002, 0.012, 0.09, 0.0222, 0.0, 0.34, steel);                                                                      // selector
  box(0.022, 0.028, 0.07, -0.037, 0.0, 0.64, steel);                                                                      // laser unit
  const rh = add(new THREE.CapsuleGeometry(0.034, 0.05, 4, 10), glove, 0.002, -0.105, -0.278);                            // firing hand
  rh.rotation.x = 0.25; rh.scale.set(1.05, 1, 0.9);
  arm([0.014, -0.115, -0.25], [0.19, -0.39, 0.14], 0.043, sleeve);
  const lh = add(new THREE.CapsuleGeometry(0.033, 0.07, 4, 10).rotateX(Math.PI / 2), glove, 0, -0.055, -0.62);            // support hand
  lh.scale.set(1.15, 0.8, 1);
  arm([-0.014, -0.08, -0.6], [-0.22, -0.43, -0.2], 0.043, sleeve);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -0.99); g.add(muzzle);
  const port = new THREE.Object3D(); port.position.set(0.03, 0.02, -0.4); g.add(port);
  return { group: g, mag, muzzle, port, stock };
}

// A soft sky-over-floor reflection for the rifle's metal and oiled wood.
function gunEnvironment(renderer) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const ctx = c.getContext('2d'), gr = ctx.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, '#c9d0d8'); gr.addColorStop(0.45, '#8a9098'); gr.addColorStop(0.55, '#4a4c50'); gr.addColorStop(1, '#1c1c1e');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#ffffff';
  for (const [x, w] of [[12, 10], [52, 14], [96, 8]]) ctx.fillRect(x, 18, w, 12);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromEquirectangular(t).texture;
  pm.dispose(); t.dispose();
  return env;
}

export class Player {
  constructor(scene, camera, level, fx, sfx, renderer) {
    this.scene = scene; this.camera = camera; this.level = level; this.world = level.world; this.fx = fx; this.sfx = sfx;
    this.feet = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.eye = new THREE.Vector3();
    this.mats = {
      steel: litMaterial({ color: 0x1c1d1f, roughness: 0.5, metalness: 0.75 }),   // dark phosphate finish
      wood: litMaterial({ color: 0x2e1d12, roughness: 0.62, metalness: 0 }),      // oiled walnut
      glove: litMaterial({ color: 0x151515, roughness: 0.9, metalness: 0 }),
      sleeve: litMaterial({ color: 0x22241f, roughness: 0.95, metalness: 0 }),
      poly: litMaterial({ color: 0x1b1c1e, roughness: 0.62, metalness: 0.1 }),
      band: litMaterial({ color: 0xb4571a, roughness: 0.5, metalness: 0.2 }),
    };
    const env = gunEnvironment(renderer);
    this.mats.steel.envMap = env; this.mats.wood.envMap = env; fx.casingMat.envMap = env;
    this.matList = [...Object.values(this.mats), fx.casingMat];
    this.guns = WEAPONS.map((w) => {
      const b = w.id === 'rifle' ? buildRifle(this.mats) : buildWeapon(w.id, this.mats);
      b.group.visible = false;
      camera.add(b.group);
      return b;
    });
    this.inv = WEAPONS.map((w) => ({ ammo: w.mag, reserve: w.reserve }));
    this.wi = 0; this.wp = WEAPONS[0]; this.gun = null;
    scene.add(camera);

    const ft = flashTexture();
    this.flash = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({ map: ft, color: new THREE.Color().setRGB(10, 8, 5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      if (i === 1) m.rotation.y = Math.PI / 2;
      if (i === 2) { m.rotation.x = Math.PI / 2; }
      this.flash.add(m);
    }
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(new THREE.Color(1, 0.8, 0.52), 0, 18, 2);

    this.torch = new THREE.SpotLight(new THREE.Color(0.95, 0.97, 1), 0, 32, 0.42, 0.65, 2);
    this.torchOn = false;
    this.equip(0);

    this.dot = new THREE.Mesh(new THREE.CircleGeometry(1, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.12, 2.6, 0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
    this.dot.renderOrder = 8;
    scene.add(this.dot);
    this.laserOn = true;
    this.reset();
  }

  reset(start = { p: [4, 0, 14.6], yaw: 0 }) {
    this.feet.set(...start.p); this.vel.set(0, 0, 0);
    this.aimYaw = this.camYaw = start.yaw; this.aimPitch = this.camPitch = 0;
    this.hp = 100; this.dead = false; this.deadT = 0; this.lastHit = -10;
    this.inv = WEAPONS.map((w) => ({ ammo: w.mag, reserve: w.reserve }));
    this.equip(0);
    this.reloading = false; this.reloadT = 0; this.reloadStage = 0; this.rw = 0; this.swapTo = -1; this.swapT = 0; this.pumpC = 9;
    this.cool = 0; this.onGround = true; this.crouching = false; this.height = STAND;
    this.eyeH = 1.5; this.viewY = this.feet.y; this.lean = 0; this.adsT = 0; this.sprintT = 0; this.retract = 0;
    this.phase = 0; this.steps = 0; this.trauma = 0; this.hurt = 0; this.glitch = 0;
    this.kick = 0; this.camKick = 0; this.flashT = 0; this.speed = 0; this.shots = 0; this.hits = 0;
    this.strafe = 0; this.landDip = 0; this.triggerHeld = false; this.magBump = 0; this.boltBump = 0; this.tactical = false;
    this.gun.visible = true; this.mag.visible = true; this.stock.visible = true;
    this.gun.position.set(...this.wp.hip); this.gun.rotation.set(0, 0, 0);
    this.dot.visible = false; this.flash.visible = false; this.flashLight.intensity = 0;
    this.updateCamera(0, 0);
  }

  get ammo() { return this.inv[this.wi].ammo; }
  set ammo(v) { this.inv[this.wi].ammo = v; }
  get reserve() { return this.inv[this.wi].reserve; }
  set reserve(v) { this.inv[this.wi].reserve = v; }

  // Bring weapon i to hand; the flash, light and torch move to its muzzle.
  equip(i) {
    if (this.gun) this.gun.visible = false;
    this.wi = i; this.wp = WEAPONS[i];
    const b = this.guns[i], mz = b.muzzle.position, t = this.wp.torch;
    this.gun = b.group; this.mag = b.mag; this.muzzle = b.muzzle; this.port = b.port; this.stock = b.stock; this.pump = b.pump || null;
    this.gun.add(this.flash, this.flashLight, this.torch, this.torch.target);
    this.flash.position.set(0, mz.y, mz.z - 0.07); this.flashLight.position.set(0, mz.y + 0.05, mz.z - 0.11);
    this.torch.position.set(t[0], t[1], t[2]); this.torch.target.position.set(t[0], t[1], t[2] - 6);
    this.gun.visible = !this.dead; this.mag.visible = true;
    if (this.pump) this.pump.position.z = 0;
    if (this.mag.isMesh && !b.magRest) {
      // a gloved hand and forearm that hold the magazine by its base during a reload
      b.magRest = this.mag.position.clone();
      this.mag.geometry.computeBoundingBox();
      const bb = this.mag.geometry.boundingBox, base = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.min.y + 0.012, (bb.min.z + bb.max.z) / 2);
      const hand = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.05, 4, 10).rotateZ(Math.PI / 2), this.mats.glove);
      palm.position.copy(base); palm.scale.set(1, 1.1, 1.25); hand.add(palm);
      const end = base.clone().add(new THREE.Vector3(-0.2, -0.34, 0.34)), len = end.distanceTo(base);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.043, len, 4, 10), this.mats.sleeve);
      fore.position.copy(base).add(end).multiplyScalar(0.5);
      fore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(base).normalize());
      hand.add(fore);
      for (const m of hand.children) { m.castShadow = true; m.receiveShadow = true; }
      hand.visible = false; this.mag.add(hand); b.magHand = hand;
    }
    this.magRest = b.magRest || null; this.magHand = b.magHand || null;
    if (this.magRest) { this.mag.position.copy(this.magRest); this.magHand.visible = false; }
  }

  aimDir(out) {
    const cp = Math.cos(this.aimPitch);
    return out.set(-Math.sin(this.aimYaw) * cp, Math.sin(this.aimPitch), -Math.cos(this.aimYaw) * cp);
  }

  box(x, y, z, h) { return this.world.overlap(x - HW, y, z - HW, x + HW, y + h, z + HW); }

  damage(d, dir) {
    if (this.dead) return;
    this.hp -= d; this.hurt = 1; this.glitch = 1; this.trauma = Math.min(1, this.trauma + 0.65);
    this.lastHit = this.time;
    this.aimPitch += (Math.random() - 0.3) * 0.05; this.aimYaw += (Math.random() - 0.5) * 0.06;
    this.sfx.hurt();
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.deadT = 0; this.gun.visible = false; this.dot.visible = false; this.torch.intensity = 0; }
  }

  move(dt, input) {
    const w = this.world, f = this.feet;
    // stance
    const wantCrouch = input.crouch;
    if (wantCrouch) this.crouching = true;
    else if (this.crouching && !this.box(f.x, f.y + 0.02, f.z, STAND)) this.crouching = false;
    this.height = this.crouching ? CROUCH : STAND;
    const sprinting = input.sprint && input.fwd > 0 && !this.crouching && !input.ads && this.onGround;
    this.sprinting = sprinting;
    const top = this.crouching ? 1.4 : sprinting ? 4.7 : input.ads ? 1.7 : 2.7;
    const sy = Math.sin(this.camYaw), cy = Math.cos(this.camYaw);
    let wx = -sy * input.fwd + cy * input.right, wz = -cy * input.fwd - sy * input.right;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const k = 1 - Math.exp(-dt * (this.onGround ? 11 : 2));
    this.vel.x += (wx * top - this.vel.x) * k; this.vel.z += (wz * top - this.vel.z) * k;
    if (input.jump && this.onGround && !this.crouching) { this.vel.y = 4.4; this.onGround = false; }
    input.jump = false;

    // horizontal, one axis at a time so we slide along walls; low ledges are stepped onto
    for (const axis of ['x', 'z']) {
      const d = this.vel[axis] * dt;
      if (d === 0) continue;
      f[axis] += d;
      const b = this.box(f.x, f.y + 0.02, f.z, this.height - 0.02);
      if (!b) continue;
      const rise = b.y1 - f.y;
      if (this.onGround && rise > 0 && rise <= 0.33 && !this.box(f.x, b.y1 + 0.005, f.z, this.height)) { f.y = b.y1 + 0.002; continue; }
      f[axis] -= d; this.vel[axis] = 0;
    }
    // vertical
    const wasGround = this.onGround, vy0 = this.vel.y;
    this.vel.y -= 16 * dt;
    f.y += this.vel.y * dt;
    let b, n = 0;
    while ((b = this.box(f.x, f.y, f.z, this.height)) && n++ < 4) {
      if (this.vel.y > 0 && b.y0 > f.y + this.height * 0.5) { f.y = b.y0 - this.height - 0.002; this.vel.y = 0; }
      else { f.y = b.y1; this.vel.y = 0; }
    }
    this.onGround = !!w.overlap(f.x - HW, f.y - 0.04, f.z - HW, f.x + HW, f.y + 0.03, f.z + HW);
    if (!this.onGround && wasGround && vy0 <= 0.01) {
      // walking down steps: stay glued to the ground
      for (let d = 0.06; d <= 0.3; d += 0.06) {
        const g = w.overlap(f.x - HW, f.y - d, f.z - HW, f.x + HW, f.y, f.z + HW);
        if (g) { f.y = g.y1; this.vel.y = 0; this.onGround = true; break; }
      }
    }
    if (this.onGround && !wasGround && vy0 < -3.5) { this.landDip = Math.min(0.2, -vy0 * 0.022); this.trauma = Math.min(1, this.trauma + 0.2); this.sfx.step(true); }
    if (f.y < -5) { f.set(4, 0, 14.6); this.vel.set(0, 0, 0); }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.strafe += (input.right * Math.min(1, this.speed / 2.7) - this.strafe) * (1 - Math.exp(-dt * 6));
  }

  updateCamera(dt, time) {
    const cam = this.camera, f = this.feet;
    const moveFrac = Math.min(1, this.speed / 2.7);
    const amp = 0.0045 + moveFrac * 0.011 + (this.sprinting ? 0.012 : 0) - this.adsT * 0.002;
    const sh = this.trauma * this.trauma;
    const bob = Math.abs(Math.sin(this.phase));
    const pitch = this.camPitch + this.camKick + nz(time * 1.1, 1) * amp + nz(time * 23, 3) * sh * 0.035 - bob * 0.008 * moveFrac;
    const yaw = this.camYaw + nz(time * 0.9, 5) * amp + nz(time * 19, 7) * sh * 0.03 + Math.sin(this.phase) * 0.006 * moveFrac;
    const roll = -this.lean * 0.2 - this.strafe * 0.022 + nz(time * 0.8, 9) * amp * 0.8 + Math.sin(this.phase) * 0.017 * moveFrac + nz(time * 21, 11) * sh * 0.045;
    this.viewY += (f.y - this.viewY) * (dt > 0 ? 1 - Math.exp(-dt * 16) : 1);
    const eyeT = this.crouching ? 0.98 : 1.5;
    this.eyeH += (eyeT - this.eyeH) * (dt > 0 ? 1 - Math.exp(-dt * 9) : 1);
    const cy = Math.cos(this.camYaw), sy = Math.sin(this.camYaw);
    const side = this.lean * 0.34 + Math.sin(this.phase) * 0.018 * moveFrac;
    cam.position.set(f.x + cy * side, this.viewY + this.eyeH - bob * 0.045 * moveFrac - this.landDip - Math.abs(this.lean) * 0.05, f.z - sy * side);
    cam.quaternion.setFromEuler(_e.set(pitch, yaw, roll));
    this.eye.copy(cam.position);
  }

  // One projectile along the aim, through anything thin enough, into whatever stops it.
  bullet(aim, spread, w, mz, g, quiet) {
    const dir = _v.copy(aim);
    dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread; dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    const o = this.eye;
    let tW = 140, wall = false;
    if (this.world.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, 140, _hit)) { tW = _hit.t; wall = true; }
    let best = null, bt = tW, be = null;
    for (const e of g.enemies) {
      const r = e.rayHit(o.x, o.y, o.z, dir.x, dir.y, dir.z, bt);
      if (r && r.t < bt) { bt = r.t; best = r; be = e; }
    }
    // loose objects in the way: thin ones are holed and slow the round, solid ones stop it
    let mult = w.dmg, t0 = 0, skip = null, stopped = false;
    for (let n = 0; n < 3; n++) {
      const ph = g.props.raycast(o.x + dir.x * t0, o.y + dir.y * t0, o.z + dir.z * t0, dir.x, dir.y, dir.z, bt - t0, skip);
      if (!ph) break;
      g.props.shot(ph, dir, (w.impulse * mult) / w.dmg, quiet);
      t0 += ph.t;
      if (!ph.item.pen) { bt = t0; stopped = true; break; }
      mult *= 0.7; skip = ph.item.body;
    }
    const point = _v2.copy(o).addScaledVector(dir, bt);
    let hit = false;
    if (!stopped) {
      if (best) { be.hit(best.part, dir, point, g, mult); hit = true; }
      else if (wall) { this.fx.impact(point, { x: _hit.nx, y: _hit.ny, z: _hit.nz }, _hit.box.mat); if (!quiet) this.sfx.impact(point); }
    }
    this.fx.tracer(mz, point);
    return hit;
  }

  eject(scale = 1) {
    const right = _v2.set(1, 0, 0).applyQuaternion(this.camera.quaternion), fwd = this.aimDir(_v5);
    const pp = this.port.getWorldPosition(new THREE.Vector3());
    this.fx.casing(pp, new THREE.Vector3(right.x * (2 + Math.random()) * scale + this.vel.x, 1.4 + Math.random() * 0.9 + this.vel.y, right.z * (2 + Math.random()) * scale + this.vel.z).addScaledVector(fwd, -0.5));
  }

  fire(g) {
    const w = this.wp, aim = this.aimDir(_v4), mz = this.muzzle.getWorldPosition(_v3), o = this.eye;
    this.shots++;
    if (w.projectile) {
      // lob a concussion charge: it bounces, then goes off on a short fuse or next to a hostile
      let t = 0.45;
      if (this.world.raycast(o.x, o.y, o.z, aim.x, aim.y, aim.z, 0.6, _hit)) t = Math.max(0.05, _hit.t - 0.12);
      g.props.launch(_v2.copy(o).addScaledVector(aim, t), _v.copy(aim).multiplyScalar(w.projectile).add(this.vel).setY(aim.y * w.projectile + 1.3));
      this.fx.muzzleSmoke(mz, aim); this.fx.muzzleSmoke(mz, aim);
    } else {
      const spread = lerp(w.spread[0], w.spread[1], this.adsT) + Math.min(0.02, this.speed * 0.004) + this.kick * 0.25;
      let any = false;
      for (let i = 0; i < w.pellets; i++) if (this.bullet(aim, spread, w, mz, g, i > 0)) any = true;
      if (any) this.hits++;
      this.fx.muzzleSmoke(mz, aim);
      if (w.casing) this.eject();
    }
    this.sfx.shot(null, w.sound);
    this.ammo--; this.cool = w.cool;
    if (w.pump) { this.pumpC = -0.2; this.pumpEject = true; }
    this.kick = Math.min(w.kickMax, this.kick + w.kick);
    this.camKick += w.camKick; this.aimPitch += w.rise + Math.random() * w.rise * 0.55; this.aimYaw += (Math.random() - 0.5) * w.yawJit;
    this.trauma = Math.min(1, this.trauma + w.trauma);
    this.flashT = 0.045;
    this.flash.visible = true; this.flash.rotation.z = Math.random() * 6.28; this.flash.scale.setScalar((0.8 + Math.random() * 0.7) * Math.sqrt(w.flash / 240));
    this.flashLight.intensity = w.flash;
    if (w.mag === 1 && this.reserve > 0) { this.reloading = true; this.reloadT = -0.25; this.reloadStage = 0; }
    g.noise(this.feet);
  }

  update(dt, input, g) {
    this.time = g.time;
    const time = g.time;
    if (this.dead) {
      // the camera goes down with its wearer
      this.deadT += dt;
      const t = Math.min(1, this.deadT / 0.7), e = t * t;
      const floor = this.feet.y + 0.2;
      this.camera.position.y = lerp(this.camera.position.y, floor, 1 - Math.exp(-dt * (2 + e * 9)));
      this.camera.quaternion.setFromEuler(_e.set(lerp(this.camPitch, 0.18, e), this.camYaw + e * 0.3, e * 1.38 + Math.sin(this.deadT * 40) * 0.01 * (1 - t)));
      this.eye.copy(this.camera.position);
      this.hurt = Math.max(0.5, this.hurt - dt);
      this.glitch = Math.max(0, 1 - this.deadT * 1.5) + (this.deadT > 2 ? 0.4 : 0);
      this.flashLight.intensity = 0; this.flash.visible = false;
      return;
    }

    // change weapon: lower the one in hand, raise the next
    if (input.weapon >= 0 || input.next) {
      const n = WEAPONS.length, to = input.weapon >= 0 ? input.weapon : (this.wi + input.next + n) % n;
      input.weapon = -1; input.next = 0;
      if (to < n && to !== this.wi && this.swapTo < 0) { this.swapTo = to; this.swapT = 0; this.reloading = false; this.mag.visible = true; }
    }
    let sw = 0;
    if (this.swapTo >= 0) {
      this.swapT += dt;
      if (this.swapT >= 0.16 && this.wi !== this.swapTo) { this.equip(this.swapTo); this.sfx.reload(1); this.kick = 0; }
      sw = this.swapT < 0.16 ? this.swapT / 0.16 : Math.max(0, 1 - (this.swapT - 0.16) / 0.2);
      if (this.swapT >= 0.36) this.swapTo = -1;
    }
    const w = this.wp;

    // look: the mouse steers the weapon, the camera follows
    const sens = 0.0021 * (1 - this.adsT * 0.35);
    this.aimYaw -= input.mx * sens; this.aimPitch = clamp(this.aimPitch - input.my * sens, -1.35, 1.35);
    input.mx = input.my = 0;
    const k = 1 - Math.exp(-dt * lerp(8, 22, this.adsT));
    this.camYaw += wrap(this.aimYaw - this.camYaw) * k; this.camPitch += (this.aimPitch - this.camPitch) * k;
    const dy = wrap(this.aimYaw - this.camYaw), dp = this.aimPitch - this.camPitch;
    if (Math.abs(dy) > 0.3) this.camYaw = this.aimYaw - Math.sign(dy) * 0.3;
    if (Math.abs(dp) > 0.22) this.camPitch = this.aimPitch - Math.sign(dp) * 0.22;

    this.move(dt, input);

    // lean, unless there is a wall there
    let leanT = (input.leanR ? 1 : 0) - (input.leanL ? 1 : 0);
    if (leanT !== 0) {
      const cy = Math.cos(this.camYaw), sy = Math.sin(this.camYaw), lx = this.feet.x + cy * leanT * 0.4, lz = this.feet.z - sy * leanT * 0.4, ly = this.feet.y + this.eyeH;
      if (this.world.overlap(lx - 0.14, ly - 0.12, lz - 0.14, lx + 0.14, ly + 0.12, lz + 0.14)) leanT = 0;
    }
    this.lean += (leanT - this.lean) * (1 - Math.exp(-dt * 9));

    // steps
    if (this.onGround && this.speed > 0.4) {
      this.phase += this.speed * dt * 2.4;
      const s = Math.floor(this.phase / Math.PI);
      if (s !== this.steps) { this.steps = s; this.sfx.step(this.sprinting); this.trauma = Math.min(1, this.trauma + (this.sprinting ? 0.16 : 0.07)); }
    }
    this.landDip *= Math.exp(-dt * 9);
    this.trauma = Math.max(0, this.trauma - dt * 2.2);
    this.hurt = Math.max(0, this.hurt - dt * 0.8);
    this.glitch = Math.max(0, this.glitch - dt * 4);
    this.kick *= Math.exp(-dt * 13); this.camKick *= Math.exp(-dt * 9);
    if (time - this.lastHit > 5 && this.hp < 100) this.hp = Math.min(100, this.hp + dt * 12);
    const lowHp = 1 - this.hp / 100;
    this.hurt = Math.max(this.hurt, lowHp * 0.7);

    const ads = input.ads && !this.sprinting && !this.reloading;
    this.adsT += ((ads ? 1 : 0) - this.adsT) * (1 - Math.exp(-dt * 12));
    this.sprintT += ((this.sprinting ? 1 : 0) - this.sprintT) * (1 - Math.exp(-dt * 9));
    const fov = lerp(95, w.fov, this.adsT);
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    this.updateCamera(dt, time);

    // keep the rifle out of walls
    const ad = this.aimDir(_v);
    let rt = 0;
    if (this.world.raycast(this.eye.x, this.eye.y, this.eye.z, ad.x, ad.y, ad.z, w.len + 0.05, _hit)) rt = clamp((w.len - _hit.t) / 0.5, 0, 1);
    this.retract += (rt - this.retract) * (1 - Math.exp(-dt * 12));

    // reload: a magazine swap, or one shell at a time for the shotgun
    if (input.reload && !this.reloading && this.ammo < w.mag && this.reserve > 0 && this.swapTo < 0) { this.reloading = true; this.reloadT = 0; this.reloadStage = 0; }
    input.reload = false;
    let rw = 0;
    if (this.reloading) {
      this.reloadT += dt;
      const T = this.reloadT;
      if (w.shells) {
        rw = 1;
        if (T > w.shells) {
          this.reloadT = 0; this.ammo++; this.reserve--; this.sfx.reload(1);
          if (this.ammo >= w.mag || this.reserve <= 0) { this.reloading = false; this.pumpC = -0.15; this.pumpEject = false; }
        }
      } else if (this.magRest) {
        // magazine change. A partly used magazine is kept (goes to the pouch) and the bolt is still forward,
        // so it is quicker; an empty one is dropped and the bolt has to be racked afterwards.
        if (this.reloadStage === 0 && T === dt) this.tactical = this.ammo > 0;
        const R = w.reloadT * (this.tactical ? 0.8 : 1), u = T / R, mp = this.mag.position, mr = this.magRest;
        const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
        let dy = 0, dz = 0, hand = false, show = true;
        if (this.reloadStage === 0 && u > 0.12) { this.reloadStage = 1; this.sfx.reload(0); this.magBump = 0.4; }
        if (u > 0.12 && u < 0.2) dy = -0.12 * ease((u - 0.12) / 0.08);                                // released, slides out of the well
        if (this.reloadStage === 1 && u >= 0.2) {
          this.reloadStage = 2;
          if (!this.tactical) {
            mp.set(mr.x, mr.y - 0.12, mr.z);
            const down = new THREE.Vector3(0, -1, 0).applyQuaternion(this.gun.getWorldQuaternion(_q2));
            this.fx.dropMag(this.mag, down.multiplyScalar(1.4).add(this.vel).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4)));
          }
        }
        if (u >= 0.2 && u < 0.34) {
          if (this.tactical) { hand = true; dy = -0.12 - 0.3 * ease((u - 0.2) / 0.14); dz = 0.08 * ease((u - 0.2) / 0.14); } // stripped out by hand
          else show = false;
        }
        if (u >= 0.34 && u < 0.6) {                                                                  // fresh magazine comes up and is angled in
          hand = true;
          const k = ease((u - 0.34) / 0.16);
          dy = -0.38 + 0.31 * k; dz = 0.06 * (1 - k);
          if (u > 0.5) { const s = ease((u - 0.5) / 0.08); dy = -0.07 * (1 - s); dz = 0; }
        }
        if (this.reloadStage === 2 && u >= 0.58) {                                                   // seated with a slap
          this.reloadStage = 3; this.sfx.reload(1); this.magBump = 1; this.trauma = Math.min(1, this.trauma + 0.14);
        }
        if (u >= 0.6 && u < 0.68) hand = true;                                                       // hand lets go
        if (!this.tactical && this.reloadStage === 3 && u > 0.8) { this.reloadStage = 4; this.sfx.reload(2); this.boltBump = 1; this.trauma = Math.min(1, this.trauma + 0.1); }
        mp.set(mr.x, mr.y + dy, mr.z + dz);
        this.mag.visible = show; this.magHand.visible = hand && show;
        if (T > R) {
          const need = Math.min(w.mag - this.ammo, this.reserve);
          this.ammo += need; this.reserve -= need; this.reloading = false;
          mp.copy(mr); this.mag.visible = true; this.magHand.visible = false;
        }
        rw = clamp(T / 0.25, 0, 1) * clamp((R - T) / 0.3, 0, 1);
        rw = rw * rw * (3 - 2 * rw);
      } else {
        const R = w.reloadT;
        if (this.reloadStage === 0 && T > R * 0.15) { this.reloadStage = 1; this.sfx.reload(0); this.mag.visible = false; }
        if (this.reloadStage === 1 && T > R * 0.54) { this.reloadStage = 2; this.sfx.reload(1); this.mag.visible = true; this.magBump = 1; }
        if (this.reloadStage === 2 && T > R * 0.8) { this.reloadStage = 3; this.sfx.reload(2); this.boltBump = 1; }
        if (T > R) {
          const need = Math.min(w.mag - this.ammo, this.reserve);
          this.ammo += need; this.reserve -= need; this.reloading = false;
        }
        rw = clamp(T / 0.25, 0, 1) * clamp((R - T) / 0.3, 0, 1);
        rw = rw * rw * (3 - 2 * rw);
      }
    }
    this.rw += (rw - this.rw) * (1 - Math.exp(-dt * 16));
    rw = this.rw;

    // the shotgun's fore-end is racked after each shot and after loading
    if (this.pumpC < 0.4) {
      const before = this.pumpC;
      this.pumpC += dt;
      const u = clamp(this.pumpC / 0.36, 0, 1);
      if (this.pump) this.pump.position.z = Math.sin(u * Math.PI) * 0.085;
      if (before < 0.16 && this.pumpC >= 0.16 && this.pump) { this.sfx.reload(2); if (this.pumpEject) this.eject(0.6); }
    }

    this.stock.visible = this.adsT < 0.45; // tucked into the shoulder, out of the lens
    // the slap that seats a magazine knocks the gun up; racking the bolt yanks it back and rolls it
    this.magBump = Math.max(0, this.magBump - dt * 6); this.boltBump = Math.max(0, this.boltBump - dt * 5);
    const mb = Math.sin(this.magBump * Math.PI) * this.magBump, bb = Math.sin(this.boltBump * Math.PI) * this.boltBump;
    // rifle pose in camera space
    const gun = this.gun, a = this.adsT, bobS = Math.sin(this.phase), bobA = Math.abs(bobS), mf = Math.min(1, this.speed / 2.7) * (1 - a * 0.7);
    gun.position.set(
      lerp(w.hip[0], w.ads[0], a) + bobS * 0.006 * mf + nz(time * 0.7, 20) * 0.002 - bb * 0.015,
      lerp(w.hip[1], w.ads[1], a) - bobA * 0.009 * mf - this.sprintT * 0.05 - rw * 0.04 - sw * 0.17 + nz(time * 0.9, 24) * 0.002 + mb * 0.025,
      lerp(w.hip[2], w.ads[2], a) + this.kick * 0.55 + this.retract * 0.1 + bb * 0.05
    );
    gun.rotation.set(
      dp * (1 - a * 0.5) + this.kick * 0.7 * w.flip - this.sprintT * 0.55 - this.retract * 0.85 + rw * 0.32 - sw * 0.95 + mb * 0.12 - bb * 0.06,
      dy * (1 - a * 0.5) + this.sprintT * 0.45 + nz(time * 0.6, 30) * 0.004 + bb * 0.1,
      -rw * 0.75 + this.lean * 0.12 + bobS * 0.012 * mf - bb * 0.25,
      'YXZ'
    );

    // trigger
    this.cool -= dt;
    if (input.fire && !this.triggerHeld && this.reloading && w.shells && this.ammo > 0) { this.reloading = false; this.pumpC = -0.05; this.pumpEject = false; this.cool = 0.45; } // stop loading and fight
    if (input.fire && this.cool <= 0 && !this.reloading && this.sprintT < 0.4 && this.swapTo < 0 && (w.auto || !this.triggerHeld)) {
      if (this.ammo > 0) {
        this.camera.updateMatrixWorld(true);
        this.fire(g);
      } else if (!this.triggerHeld) {
        this.sfx.dry(); this.cool = 0.25;
        if (this.reserve > 0) { this.reloading = true; this.reloadT = 0; this.reloadStage = 0; }
      }
    }
    this.triggerHeld = input.fire;
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) { this.flash.visible = false; this.flashLight.intensity = 0; }
    }

    // torch and laser
    if (input.torch) { this.torchOn = !this.torchOn; input.torch = false; this.sfx.beep(1800, 0.02, 0.05); }
    if (input.laser) { this.laserOn = !this.laserOn; input.laser = false; }
    this.torch.intensity = this.torchOn ? 520 : 0;
    const showDot = this.laserOn && this.sprintT < 0.5 && !this.reloading && this.swapTo < 0;
    this.dot.visible = false;
    if (showDot) {
      let t = 60;
      if (this.world.raycast(this.eye.x, this.eye.y, this.eye.z, ad.x, ad.y, ad.z, 60, _hit)) t = _hit.t;
      for (const e of g.enemies) { const r = e.rayHit(this.eye.x, this.eye.y, this.eye.z, ad.x, ad.y, ad.z, t); if (r) t = r.t; }
      const ph = g.props.raycast(this.eye.x, this.eye.y, this.eye.z, ad.x, ad.y, ad.z, t);
      if (ph) t = ph.t;
      if (t < 60) {
        this.dot.visible = true;
        this.dot.position.copy(this.eye).addScaledVector(ad, t - 0.02);
        this.dot.quaternion.copy(this.camera.quaternion);
        this.dot.scale.setScalar(0.0028 * t + 0.002);
      }
    }

    // light the rifle from the room it is in
    this.level.lightFor(this.eye.x, this.eye.y, this.eye.z, this.matList);
    const ac = this.mats.steel.userData.amb.value, al = ac.r * 0.3 + ac.g * 0.6 + ac.b * 0.1;
    this.mats.steel.envMapIntensity = al * 1.1; this.mats.wood.envMapIntensity = al * 0.9; this.fx.casingMat.envMapIntensity = al * 2.2;
  }
}
