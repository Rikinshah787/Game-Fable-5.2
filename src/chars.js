import * as THREE from 'three';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { makePistol, makeSMG } from './guns.js';

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _S = new THREE.Vector3(), _dir = new THREE.Vector3(), _axis = new THREE.Vector3();
const _up = new THREE.Vector3(), _el = new THREE.Vector3(), _fd = new THREE.Vector3(), _T = new THREE.Vector3(), _mid = new THREE.Vector3();
const _aim = new THREE.Vector3(), _right = new THREE.Vector3(), _pole = new THREE.Vector3(), _zax = new THREE.Vector3(), _xax = new THREE.Vector3();
const _m = new THREE.Matrix4(), _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
export const MODEL_YAW = { value: Math.PI };       // source model faces -Z
// how the gun sits in the right hand (bone space, metres) and how far the fingers close around it
export const GRIP = { x: 0, y: 0.09, z: -0.025, roll: -Math.PI / 2 };
export const CURL = { axis: 'z', r: 1.0, l: -1.0 };

// Two-bone IK. Bones run along their local +Y. Puts the lower bone's tip at T, bending the joint toward `pole`.
// Returns the lower bone's world quaternion in _q2.
function solveLimb(upper, lower, T, a, b, pole) {
  upper.getWorldPosition(_S);
  _dir.subVectors(T, _S);
  const d = clamp(_dir.length(), Math.abs(a - b) + 0.01, a + b - 0.004);
  _dir.normalize();
  const A = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  _axis.crossVectors(_dir, pole);
  if (_axis.lengthSq() < 1e-6) _axis.set(1, 0, 0);
  _axis.normalize();
  _up.copy(_dir).applyAxisAngle(_axis, A);
  _el.copy(_S).addScaledVector(_up, a);
  _fd.subVectors(T, _el).normalize();
  _q1.setFromUnitVectors(Y, _up);                         // upper bone, world
  upper.parent.getWorldQuaternion(_qp).invert();
  upper.quaternion.copy(_qp).multiply(_q1);
  _q2.setFromUnitVectors(Y, _fd);                         // lower bone, world
  lower.quaternion.copy(_q1).invert().multiply(_q2);
  return _q2;
}

// Re-use the soldier's Idle / Walk / Run clips on the civilian rigs. All three are Mixamo-compatible skeletons, so
// joint rotations carry over; only the hips need converting between the rigs' different armature frames.
function retarget(clip, mode, k) {
  const tracks = [];
  const RX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), q = new THREE.Quaternion();
  for (const t of clip.tracks) {
    const [bone, prop] = t.name.split('.');
    const hips = bone === 'mixamorigHips';
    if (prop === 'scale' || (prop === 'position' && !hips)) continue;
    const name = (mode === 'rpm' ? bone.replace('mixamorig', '') : bone) + '.' + prop;
    const v = Float32Array.from(t.values);
    if (prop === 'position') {
      for (let i = 0; i < v.length; i += 3) {
        const x = v[i], y = v[i + 1], z = v[i + 2];
        if (mode === 'rpm') { v[i] = x * 0.01 * k; v[i + 1] = z * 0.01 * k; v[i + 2] = -y * 0.01 * k; }
        else { v[i] = x * k; v[i + 1] = y * k; v[i + 2] = z * k; }
      }
      tracks.push(new THREE.VectorKeyframeTrack(name, t.times, v));
    } else {
      if (mode === 'rpm' && hips) for (let i = 0; i < v.length; i += 4) { q.set(v[i], v[i + 1], v[i + 2], v[i + 3]).premultiply(RX); v[i] = q.x; v[i + 1] = q.y; v[i + 2] = q.z; v[i + 3] = q.w; }
      tracks.push(new THREE.QuaternionKeyframeTrack(name, t.times, v));
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

const SHIRTS = [0xffffff, 0xd94c4c, 0x3f7fd9, 0xf2c14e, 0x2fa37a, 0xe07fb0, 0x8a8f98, 0x202428, 0xf08a3c, 0x7a5cd6];
const PANTS = [0xffffff, 0x9aa7c4, 0x55606e, 0xc9b48a, 0x2b2f38, 0x6f7f5a];

export function createCharFactory(A) {
  const base = A.models.soldier.animations;
  const names = ['Idle', 'Walk', 'Run'];
  const pick = (clips) => Object.fromEntries(names.map((n) => [n, clips.find((c) => c.name === n)]));
  const rigs = {
    soldier: { src: A.models.soldier.scene, prefix: 'mixamorig', clips: pick(base), headY: 1.68 },
  };
  if (A.models.michelle) rigs.michelle = { src: A.models.michelle.scene, prefix: 'mixamorig', clips: pick(base.map((c) => retarget(c, 'michelle', 0.97))), headY: 1.52, fixRot: true };
  if (A.models.rpm) rigs.rpm = { src: A.models.rpm.scene, prefix: '', clips: pick(base.map((c) => retarget(c, 'rpm', 0.96))), headY: 1.7 };
  const civ = ['rpm', 'michelle'].filter((n) => rigs[n]);

  // role: 'player' | 'ped' | 'cop'
  return function make(role, variant = 0) {
    const rigName = role === 'cop' || !civ.length ? 'soldier' : role === 'player' ? civ[0] : civ[variant % civ.length];
    const rig = rigs[rigName];
    const model = skClone(rig.src);
    if (rig.fixRot) { const c = model.getObjectByName('Character'); if (c) c.rotation.x = -Math.PI / 2; }
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false;
      const mn = o.material.name || '';
      let tint = null;
      if (rigName === 'soldier') tint = role === 'cop' ? 0x3a4a78 : null;
      else if (rigName === 'rpm' && role === 'player') tint = /Outfit_Top/.test(mn) ? 0x46546a : /Outfit_Bottom/.test(mn) ? 0x3a3d46 : /Headwear/.test(mn) ? 0x30343c : null;
      else if (rigName === 'rpm' && role === 'ped') tint = /Outfit_Top/.test(mn) ? SHIRTS[(variant * 7 + 3) % SHIRTS.length] : /Outfit_Bottom/.test(mn) ? PANTS[(variant * 5 + 1) % PANTS.length] : null;
      else if (rigName === 'michelle' && role === 'ped') tint = [0xffffff, 0xffe2d6, 0xe6ecff, 0xf2ffe0, 0xffe9f4][variant % 5];
      if (tint !== null && tint !== 0xffffff) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(tint)); }
    });
    const root = new THREE.Group(), tilt = new THREE.Group();
    model.rotation.y = MODEL_YAW.value;
    tilt.add(model); root.add(tilt);
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    for (const n of names) { const a = mixer.clipAction(rig.clips[n]); a.play(); a.setEffectiveWeight(n === 'Idle' ? 1 : 0); actions[n] = a; }
    const bone = (n) => model.getObjectByName(rig.prefix + n);
    const bones = {
      rArm: bone('RightArm'), rFore: bone('RightForeArm'), rHand: bone('RightHand'),
      lArm: bone('LeftArm'), lFore: bone('LeftForeArm'), lHand: bone('LeftHand'),
      spine: bone('Spine1'), neck: bone('Neck'), lUpLeg: bone('LeftUpLeg'), rUpLeg: bone('RightUpLeg'),
    };
    const fingers = (side) => ['Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3].map((j) => bone(`${side}Hand${f}${j}`))).filter(Boolean);
    bones.rFingers = fingers('Right'); bones.lFingers = fingers('Left');
    const ch = new Char({ root, tilt, model, mixer, actions, bones });
    ch.headY = rig.headY; ch.rig = rigName;
    return ch;
  };
}

export class Char {
  constructor(p) {
    Object.assign(this, p);
    this.x = 0; this.y = 0; this.z = 0; this.h = 0; this.vy = 0;
    this.speed = 0; this.health = 100; this.dead = false; this.deadT = 0; this.fall = 0;
    this.w = { Idle: 1, Walk: 0, Run: 0 };
    this.aiming = false; this.aim = new THREE.Vector3(0, 0, 1);
    this.lvx = 0; this.lvz = 0; this.radius = 0.36; this.gun = null; this.kind = 'ped';
    this.recoil = 0; this.long = false; this.limp = null;
  }
  giveGun(long) {
    if (this.gun) this.gun.parent.remove(this.gun);
    const hand = this.bones.rHand;
    this.long = long;
    this.gun = long ? makeSMG() : makePistol();
    hand.add(this.gun);
    this.root.updateMatrixWorld(true);
    hand.getWorldScale(_s);
    const k = 1 / _s.x;
    this.gun.scale.setScalar(k);
    this.gun.position.set(GRIP.x * k, GRIP.y * k, GRIP.z * k);   // grip in the palm
    this.gun.rotation.y = GRIP.roll;
    this.gun.visible = false;
    const sl = this.gun.userData.slide;
    if (sl) sl.userData.y0 = sl.position.y;
    // limb lengths for the aiming IK, measured on this rig
    const len = (a, b) => a.getWorldPosition(_v).distanceTo(b.getWorldPosition(_S));
    const B = this.bones;
    this.armLen = [len(B.rArm, B.rFore), len(B.rFore, B.rHand), len(B.lArm, B.lFore), len(B.lFore, B.lHand)];
  }
  muzzle(out) { this.gun.updateWorldMatrix(true, false); return out.copy(this.gun.userData.muzzle).applyMatrix4(this.gun.matrixWorld); }
  ejectPort(out) { this.gun.updateWorldMatrix(true, false); return out.copy(this.gun.userData.eject || this.gun.userData.muzzle).applyMatrix4(this.gun.matrixWorld); }
  kick() { this.recoil = 1; }
  place(x, z, h, y = 0) { this.x = x; this.z = z; this.h = h; this.y = y; this.sync(); }
  sync() { this.root.position.set(this.x, this.y, this.z); this.root.rotation.y = this.h; }
  revive() {
    this.dead = false; this.fall = 0; this.limp = null; this.health = 100; this.lvx = this.lvz = 0;
    this.tilt.rotation.x = 0; this.tilt.position.y = 0;
  }

  kill(lvx = 0, lvz = 0, lvy = 0) {
    if (this.dead) return;
    this.dead = true; this.health = 0; this.deadT = 0; this.aiming = false;
    this.lvx = lvx; this.lvz = lvz; this.vy = lvy;
    this.fallDir = Math.random() < 0.5 ? 1 : -1;
    if (this.gun) this.gun.visible = false;
    // go limp: remember the pose at the moment of death and let the joints sag from there
    const r = (a) => (Math.random() * 2 - 1) * a, B = this.bones;
    this.limp = [];
    const add = (b, x, y, z) => { if (b) this.limp.push({ b, q0: b.quaternion.clone(), e: [x, y, z] }); };
    add(B.spine, r(0.45), r(0.3), r(0.35)); add(B.neck, r(0.6), r(0.5), r(0.4));
    add(B.lArm, r(1.1), r(0.6), r(1.0)); add(B.rArm, r(1.1), r(0.6), r(1.0));
    add(B.lUpLeg, r(0.35), r(0.3), r(0.45)); add(B.rUpLeg, r(0.35), r(0.3), r(0.45));
  }

  update(dt, groundY) {
    if (this.dead) {
      this.deadT += dt;
      this.fall = Math.min(1, this.fall + dt * 3.2);
      const f = 1 - Math.pow(1 - this.fall, 3);
      this.tilt.rotation.x = this.fallDir * (Math.PI / 2) * f;
      this.x += this.lvx * dt; this.z += this.lvz * dt;
      this.vy -= 18 * dt; this.y += this.vy * dt;
      if (this.y <= groundY) { this.y = groundY; this.vy = 0; const k = Math.max(0, 1 - dt * 5); this.lvx *= k; this.lvz *= k; }
      this.tilt.position.y = 0.18 * this.fall;
      if (this.limp) for (const l of this.limp) l.b.quaternion.copy(l.q0).multiply(_q3.setFromEuler(_e.set(l.e[0] * f, l.e[1] * f, l.e[2] * f)));
      this.sync();
      return;
    }
    const sp = this.speed;
    const tw = sp < 0.25 ? 'Idle' : sp < 3.0 ? 'Walk' : 'Run';
    const k = Math.min(1, dt * 9);
    for (const n in this.w) { this.w[n] += ((n === tw ? 1 : 0) - this.w[n]) * k; this.actions[n].setEffectiveWeight(this.w[n]); }
    this.actions.Walk.timeScale = clamp(sp / 1.7, 0.6, 1.6);
    this.actions.Run.timeScale = clamp(sp / 5.2, 0.7, 1.5);
    this.mixer.update(dt);
    this.sync();
    this.recoil = Math.max(0, this.recoil - dt * 8);
    if (this.gun) this.gun.visible = this.aiming;
    if (this.aiming && this.gun) this.aimPose();
  }

  // Two-handed firing stance: the right hand carries the gun on the sight line, the left hand supports it.
  aimPose() {
    const B = this.bones, L = this.armLen, rc = this.recoil;
    this.root.updateMatrixWorld(true);
    _aim.copy(this.aim).normalize();
    _right.set(-_aim.z, 0, _aim.x);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();
    _aim.applyAxisAngle(_right, -0.07 * rc).normalize();                 // muzzle climb
    // where the right wrist goes: out in front of the chest (pistol) or tucked in with the stock near the shoulder (SMG)
    B.rArm.getWorldPosition(_mid).add(B.lArm.getWorldPosition(_v)).multiplyScalar(0.5);
    const reach = (this.long ? 0.34 : 0.50) - 0.05 * rc;
    _T.copy(_mid).addScaledVector(_aim, reach).addScaledVector(_right, this.long ? 0.13 : 0.06);
    _T.y += (this.long ? -0.10 : -0.03) + 0.03 * rc;
    _pole.set(0, -0.8, 0).addScaledVector(_right, 0.55);
    const qFore = solveLimb(B.rArm, B.rFore, _T, L[0], L[1], _pole);
    // hand: fingers (bone +Y) along the aim line, back of the hand (bone +Z) facing out to the right
    _zax.copy(_right);
    _xax.crossVectors(_aim, _zax);
    _q3.setFromRotationMatrix(_m.makeBasis(_xax, _aim, _zax));
    B.rHand.quaternion.copy(qFore).invert().multiply(_q3);
    B.rArm.updateWorldMatrix(false, true);
    const sl = this.gun.userData.slide;
    if (sl) sl.position.y = sl.userData.y0 - 0.03 * rc;
    // support hand
    const lg = this.gun.userData.leftGrip;
    if (lg) {
      _T.copy(lg).applyMatrix4(this.gun.matrixWorld);
      _pole.set(0, -0.8, 0).addScaledVector(_right, -0.55);
      solveLimb(B.lArm, B.lFore, _T, L[2], L[3], _pole);
      B.lHand.quaternion.identity();
    }
    // close both hands around the weapon
    _e.set(0, 0, 0); _e[CURL.axis] = CURL.r; _q3.setFromEuler(_e);
    for (const f of B.rFingers) f.quaternion.multiply(_q3);
    _e.set(0, 0, 0); _e[CURL.axis] = CURL.l; _q3.setFromEuler(_e);
    for (const f of B.lFingers) f.quaternion.multiply(_q3);
  }
}
