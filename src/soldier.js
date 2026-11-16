// A rigged, textured soldier model whose bones are driven by the 15-particle skeleton in
// enemy.js, so the same particles animate it while alive and ragdoll it when dead.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '../vendor/jsm/utils/SkeletonUtils.js';
import { litMaterial } from './level.js';

// particle indices (must match enemy.js)
const HEAD = 0, NECK = 1, LSH = 2, RSH = 3, LHIP = 4, RHIP = 5, LELB = 7, RELB = 8, LHAND = 9, RHAND = 10,
  LKNEE = 11, RKNEE = 12, LFOOT = 13, RFOOT = 14;

let SRC = null;
export async function loadSoldier(url = './assets/models/Soldier.glb') {
  const g = await new GLTFLoader().loadAsync(url);
  SRC = g.scene;
  // The model's armour texture is a bright sci-fi tan. Repaint it once, keeping all its detail, as faded olive drab
  // so the men read as soldiers in field kit. The visor keeps its own texture.
  const done = new Map();
  SRC.traverse((o) => {
    if (!o.isMesh || !o.material.map || /visor/i.test(o.material.name || '') || /visor/i.test(o.name || '')) return;
    const src = o.material.map;
    if (!done.has(src)) {
      const img = src.image, c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const l = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
        p[i] = l * 0.74 + p[i] * 0.1; p[i + 1] = l * 0.76 + p[i + 1] * 0.08; p[i + 2] = l * 0.62 + p[i + 2] * 0.08;
      }
      x.putImageData(d, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.flipY = src.flipY; t.colorSpace = src.colorSpace; t.wrapS = src.wrapS; t.wrapT = src.wrapT; t.anisotropy = 4;
      done.set(src, t);
    }
    o.material.map = done.get(src);
  });
}
export const soldierReady = () => !!SRC;

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const _v = new THREE.Vector3(), _t = new THREE.Vector3();
const _D = new THREE.Quaternion(), _Wp = new THREE.Quaternion(), _cand = new THREE.Quaternion(), _delta = new THREE.Quaternion(), _inv = new THREE.Quaternion();

// Orientation of a torso from its shoulder line and spine.
function basisQ(xr, yr, out) {
  _x.copy(xr).normalize(); _y.copy(yr).normalize();
  _z.crossVectors(_x, _y).normalize();
  _x.crossVectors(_y, _z).normalize();
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

export class Rig {
  constructor(parent) {
    const root = (this.root = cloneSkinned(SRC));
    parent.add(root);
    root.updateMatrixWorld(true);
    const bone = (n) => root.getObjectByName('mixamorig' + n);
    const wp = (n) => bone(n).getWorldPosition(new THREE.Vector3());

    // The model's own textures and surface settings, as the Unreal build draws them; only the brightness varies a little
    // between men. The glass visor keeps its own glossy look.
    const shade = 0.88 + Math.random() * 0.12;
    this.mats = []; this.meshes = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      this.meshes.push(o);
      const src = o.material;
      const visor = /visor/i.test(src.name || '') || /visor/i.test(o.name || '');
      const m = litMaterial({
        map: src.map, normalMap: src.normalMap, roughnessMap: src.roughnessMap, metalnessMap: src.metalnessMap, aoMap: src.aoMap,
        // darkened a little and matte, like nylon and ceramic plate rather than painted plastic
        color: (src.color ? src.color.clone() : new THREE.Color(1, 1, 1)).multiplyScalar(visor ? 1 : 0.7 * shade),
        roughness: visor ? 0.12 : 0.85, metalness: visor ? 0.7 : 0.05,
        transparent: src.transparent, opacity: src.opacity, side: src.side,
      });
      o.material = m; this.mats.push(m);
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    });

    const hips = (this.hips = bone('Hips'));
    this.parentInv = hips.parent.matrixWorld.clone().invert();
    this.parentQInv = hips.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.R0 = hips.getWorldQuaternion(new THREE.Quaternion());
    const la = wp('LeftArm'), ra = wp('RightArm'), neck = wp('Neck'), mid = wp('LeftUpLeg').add(wp('RightUpLeg')).multiplyScalar(0.5);
    this.QB0inv = basisQ(ra.clone().sub(la), neck.clone().sub(mid), new THREE.Quaternion()).invert();
    this.d0 = wp('Hips').sub(mid);
    this.Wh = new THREE.Quaternion();

    const drive = (name, anc, child, a, b) => {
      const bn = bone(name), prefix = new THREE.Quaternion(), chain = [];
      const top = bone(anc);
      for (let p = bn.parent; p !== top; p = p.parent) chain.unshift(p);
      for (const c of chain) prefix.multiply(c.quaternion);
      return { bone: bn, rest: bn.quaternion.clone(), dir: bone(child).position.clone().normalize(), prefix, anc: null, W: new THREE.Quaternion(), a, b };
    };
    const D = (this.driven = {
      neck: drive('Neck', 'Hips', 'Head', NECK, HEAD),
      lArm: drive('LeftArm', 'Hips', 'LeftForeArm', LSH, LELB), lFore: drive('LeftForeArm', 'LeftArm', 'LeftHand', LELB, LHAND),
      rArm: drive('RightArm', 'Hips', 'RightForeArm', RSH, RELB), rFore: drive('RightForeArm', 'RightArm', 'RightHand', RELB, RHAND),
      lUp: drive('LeftUpLeg', 'Hips', 'LeftLeg', LHIP, LKNEE), lLeg: drive('LeftLeg', 'LeftUpLeg', 'LeftFoot', LKNEE, LFOOT),
      rUp: drive('RightUpLeg', 'Hips', 'RightLeg', RHIP, RKNEE), rLeg: drive('RightLeg', 'RightUpLeg', 'RightFoot', RKNEE, RFOOT),
      lFoot: drive('LeftFoot', 'LeftLeg', 'LeftToeBase', -1, -1), rFoot: drive('RightFoot', 'RightLeg', 'RightToeBase', -1, -1),
    });
    D.lFore.anc = D.lArm; D.rFore.anc = D.rArm; D.lLeg.anc = D.lUp; D.rLeg.anc = D.rUp; D.lFoot.anc = D.lLeg; D.rFoot.anc = D.rLeg;
    this.order = [D.neck, D.lArm, D.lFore, D.rArm, D.rFore, D.lUp, D.lLeg, D.rUp, D.rLeg];
    this.feet = [D.lFoot, D.rFoot];
    this.footDir = [wp('LeftToeBase').sub(wp('LeftFoot')).normalize(), wp('RightToeBase').sub(wp('RightFoot')).normalize()];
    this.rHand = bone('RightHand'); this.lHand = bone('LeftHand');
  }

  // A second copy of the body on the same skeleton, drawn through walls by the echo pulse.
  ghost(mat) {
    return this.meshes.map((o) => {
      const m = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, mat) : new THREE.Mesh(o.geometry, mat);
      if (o.isSkinnedMesh) m.bind(o.skeleton, o.bindMatrix);
      m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
      m.frustumCulled = false; m.renderOrder = 9; m.visible = false;
      o.parent.add(m);
      return m;
    });
  }

  solve(d, target) {
    _Wp.copy(d.anc ? d.anc.W : this.Wh).multiply(d.prefix);
    _cand.copy(_Wp).multiply(d.rest);
    _v.copy(d.dir).applyQuaternion(_cand);
    _delta.setFromUnitVectors(_v, target);
    d.W.copy(_delta).multiply(_cand);
    d.bone.quaternion.copy(_inv.copy(_Wp).invert()).multiply(d.W);
  }

  // P: the 15 particle positions. flatFeet keeps the soles level while standing.
  apply(P, flatFeet) {
    const hx = (P[LHIP].x + P[RHIP].x) / 2, hy = (P[LHIP].y + P[RHIP].y) / 2, hz = (P[LHIP].z + P[RHIP].z) / 2;
    basisQ(_v.subVectors(P[RSH], P[LSH]), _t.set(P[NECK].x - hx, P[NECK].y - hy, P[NECK].z - hz), _D);
    _D.multiply(this.QB0inv);
    this.Wh.copy(_D).multiply(this.R0);
    this.hips.quaternion.copy(this.parentQInv).multiply(this.Wh);
    _v.copy(this.d0).applyQuaternion(_D);
    this.hips.position.set(hx + _v.x, hy + _v.y, hz + _v.z).applyMatrix4(this.parentInv);
    for (const d of this.order) {
      _t.subVectors(P[d.b], P[d.a]);
      if (_t.lengthSq() < 1e-8) continue;
      this.solve(d, _t.normalize());
    }
    for (let i = 0; i < 2; i++) {
      const d = this.feet[i];
      if (flatFeet) this.solve(d, _t.copy(this.footDir[i]).applyQuaternion(_D).normalize());
      else d.bone.quaternion.copy(d.rest);
    }
    this.root.updateMatrixWorld(true);
  }
}
