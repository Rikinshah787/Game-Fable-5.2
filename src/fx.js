// Short-lived visuals: dust and debris particles, bullet holes, stains, tracers, shell casings, muzzle flashes.
import * as THREE from 'three';
import { litMaterial } from './level.js';

const N = 800;
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v3 = new THREE.Vector3();

export function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,250,235,1)'); g.addColorStop(0.18, 'rgba(255,214,140,0.9)');
  g.addColorStop(0.5, 'rgba(255,140,50,0.28)'); g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3, l = 40 + (i % 3) * 12;
    const lg = ctx.createLinearGradient(64, 64, 64 + Math.cos(a) * l, 64 + Math.sin(a) * l);
    lg.addColorStop(0, 'rgba(255,235,190,0.9)'); lg.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.strokeStyle = lg; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(64 + Math.cos(a) * l, 64 + Math.sin(a) * l); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Fx {
  constructor(scene, level, sfx) {
    this.scene = scene; this.level = level; this.sfx = sfx; this.world = level.world;
    this.amb = new THREE.Color();

    // particles
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3); this.data = new Float32Array(N * 4);
    this.life = new Float32Array(N); this.max = new Float32Array(N);
    this.s0 = new Float32Array(N); this.s1 = new Float32Array(N); this.a0 = new Float32Array(N);
    this.grav = new Float32Array(N); this.drag = new Float32Array(N);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aData', new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage));
    this.pMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute vec4 aData; attribute vec3 aColor; uniform float uScale;
        varying vec3 vColor; varying float vAlpha; varying float vAdd;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aData.x * uScale / max(0.05, -mv.z);
          vColor = aColor; vAlpha = aData.y; vAdd = aData.z;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha; varying float vAdd;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, d) * vAlpha;
          gl_FragColor = vec4(vColor * a, a * (1.0 - vAdd));
        }`,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.points = new THREE.Points(g, this.pMat);
    this.points.frustumCulled = false; this.points.renderOrder = 6;
    scene.add(this.points);

    // bullet holes
    this.holes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: level.tex.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false }), 180);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < 180; i++) this.holes.setMatrixAt(i, zero);
    this.holes.frustumCulled = false; this.holes.renderOrder = 2;
    this.holeNext = 0;
    scene.add(this.holes);

    // stains under bodies
    this.pools = [];
    this.poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

    // tracers
    this.tracers = [];
    const tg = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(7, 5, 2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.visible = false; m.frustumCulled = false; m.renderOrder = 5;
      scene.add(m);
      this.tracers.push({ m, life: 0 });
    }
    this.tracerNext = 0;

    // shell casings
    this.casingMat = litMaterial({ color: 0xb08d3c, metalness: 0.85, roughness: 0.35 });
    const cg = new THREE.CylinderGeometry(0.0065, 0.0065, 0.03, 6);
    this.casings = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(cg, this.casingMat);
      m.visible = false; m.receiveShadow = true;
      scene.add(m);
      this.casings.push({ m, v: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, rest: false, bounced: false });
    }
    this.casingNext = 0;

    // enemy muzzle flashes (fixed light count so shaders never recompile mid-game)
    const ft = flashTexture();
    this.flashes = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42),
        new THREE.MeshBasicMaterial({ map: ft, color: new THREE.Color().setRGB(9, 7, 4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.visible = false; m.renderOrder = 7;
      const l = new THREE.PointLight(new THREE.Color(1, 0.78, 0.5), 0, 14, 2);
      scene.add(m, l);
      this.flashes.push({ m, l, life: 0 });
    }
    this.flashNext = 0;
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4(); this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, alpha, grav, drag, add = 0) {
    const i = this.next; this.next = (i + 1) % N;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.life[i] = this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = alpha;
    this.grav[i] = grav; this.drag[i] = drag; this.data[i * 4 + 2] = add;
  }

  lightAt(p) {
    this.level.ambientAt(p.x, p.y, p.z, this.amb);
    return this.amb;
  }

  // Bullet striking masonry.
  impact(p, n, mat, decal = true) {
    const a = this.lightAt(p), k = 2.2;
    const br = (a.r * k + 0.03), bg = (a.g * k + 0.03), bb = (a.b * k + 0.03);
    const tint = mat === 'wood' ? [0.6, 0.45, 0.3] : mat === 'metal' ? [0.45, 0.45, 0.45] : [0.72, 0.7, 0.66];
    for (let i = 0; i < 9; i++) {
      const sp = 0.4 + Math.random() * 1.8;
      this.spawn(p.x, p.y, p.z, n.x * sp + (Math.random() - 0.5) * 1.3, n.y * sp + (Math.random() - 0.3) * 1.2, n.z * sp + (Math.random() - 0.5) * 1.3,
        0.7 + Math.random() * 1.1, 0.05, 0.35 + Math.random() * 0.4, br * tint[0], bg * tint[1], bb * tint[2], 0.35, -0.15, 2.6);
    }
    for (let i = 0; i < 7; i++) {
      const sp = 1.5 + Math.random() * 3.5;
      this.spawn(p.x, p.y, p.z, n.x * sp + (Math.random() - 0.5) * 3, n.y * sp + Math.random() * 2, n.z * sp + (Math.random() - 0.5) * 3,
        0.5 + Math.random() * 0.5, 0.018, 0.012, br * 0.5, bg * 0.5, bb * 0.5, 1, 9.8, 0.4);
    }
    if (mat !== 'wood') {
      for (let i = 0; i < 3; i++) {
        const sp = 3 + Math.random() * 6;
        this.spawn(p.x, p.y, p.z, n.x * sp + (Math.random() - 0.5) * 5, n.y * sp + (Math.random() - 0.5) * 5, n.z * sp + (Math.random() - 0.5) * 5,
          0.08 + Math.random() * 0.12, 0.02, 0.008, 9, 6, 2.5, 1, 4, 1, 1);
      }
    }
    if (!decal) return; // moving objects cannot carry a hole
    const i = this.holeNext; this.holeNext = (i + 1) % 180;
    this._v.set(n.x, n.y, n.z);
    this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._v);
    this._q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28));
    const s = 0.07 + Math.random() * 0.05;
    this._m.compose(this._p.set(p.x + n.x * 0.006, p.y + n.y * 0.006, p.z + n.z * 0.006), this._q, this._s.set(s, s, s));
    this.holes.setMatrixAt(i, this._m);
    this.holes.instanceMatrix.needsUpdate = true;
  }

  // Bullet striking a body.
  bodyHit(p, d) {
    const a = this.lightAt(p), k = 2.4;
    for (let i = 0; i < 7; i++) {
      const sp = 0.6 + Math.random() * 2.2;
      this.spawn(p.x, p.y, p.z, d.x * sp + (Math.random() - 0.5) * 1.2, d.y * sp + (Math.random() - 0.2) * 1.2, d.z * sp + (Math.random() - 0.5) * 1.2,
        0.35 + Math.random() * 0.4, 0.03, 0.14 + Math.random() * 0.12, (a.r * k + 0.02) * 0.34, (a.g * k + 0.02) * 0.03, (a.b * k + 0.02) * 0.03, 0.6, 5, 2.4);
    }
    for (let i = 0; i < 4; i++) {
      this.spawn(p.x, p.y, p.z, -d.x * 0.6 + (Math.random() - 0.5), 0.4 + Math.random(), -d.z * 0.6 + (Math.random() - 0.5),
        0.5 + Math.random() * 0.5, 0.04, 0.3, (a.r * k + 0.03) * 0.55, (a.g * k + 0.03) * 0.52, (a.b * k + 0.03) * 0.48, 0.28, -0.1, 3);
    }
  }

  muzzleSmoke(p, d) {
    const a = this.lightAt(p);
    for (let i = 0; i < 3; i++) {
      const sp = 0.6 + Math.random() * 1.6;
      this.spawn(p.x, p.y, p.z, d.x * sp + (Math.random() - 0.5) * 0.4, d.y * sp + 0.15 + Math.random() * 0.3, d.z * sp + (Math.random() - 0.5) * 0.4,
        0.5 + Math.random() * 0.6, 0.05, 0.4 + Math.random() * 0.3, a.r * 2 + 0.05, a.g * 2 + 0.05, a.b * 2 + 0.05, 0.16, -0.25, 3.2);
    }
  }

  pool(x, y, z) {
    if (this.pools.length >= 14) return;
    const a = this.level.ambientAt(x, y + 0.3, z, this.amb);
    const c = new THREE.Color().setRGB((this.amb.r * 2.2 + 0.02) * 0.3, (this.amb.g * 2.2 + 0.02) * 0.018, (this.amb.b * 2.2 + 0.02) * 0.018);
    const m = new THREE.Mesh(this.poolGeo, new THREE.MeshBasicMaterial({ map: this.level.tex.pool, color: c, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false }));
    m.position.set(x, y + 0.004, z);
    m.rotation.y = Math.random() * 6.28;
    m.scale.setScalar(0.05);
    m.renderOrder = 2;
    this.scene.add(m);
    this.pools.push({ m, size: 0.05, target: 0.7 + Math.random() * 0.5 });
  }

  tracer(a, b) {
    const t = this.tracers[this.tracerNext]; this.tracerNext = (this.tracerNext + 1) % this.tracers.length;
    const len = a.distanceTo(b);
    if (len < 0.5) return;
    t.m.position.copy(a).add(b).multiplyScalar(0.5);
    t.m.lookAt(b);
    t.m.scale.set(0.01, 0.01, len);
    t.m.material.opacity = 0.55;
    t.m.visible = true;
    t.life = 0.055;
  }

  // A spent magazine let go from the gun: a copy of its mesh, re-centred so it tumbles about its own middle,
  // falls under gravity, clatters and stays where it lands. The oldest ones are recycled.
  dropMag(src, v) {
    this.mags = this.mags || []; this.magGeo = this.magGeo || new Map();
    let e = this.magGeo.get(src.geometry);
    if (!e) {
      src.geometry.computeBoundingBox();
      const c = src.geometry.boundingBox.getCenter(new THREE.Vector3());
      e = { geo: src.geometry.clone().translate(-c.x, -c.y, -c.z), c };
      this.magGeo.set(src.geometry, e);
    }
    let d = this.mags.length >= 12 ? this.mags.shift() : null;
    if (!d) { d = { m: new THREE.Mesh(), v: new THREE.Vector3(), spin: new THREE.Vector3() }; d.m.castShadow = true; d.m.receiveShadow = true; this.scene.add(d.m); }
    d.m.geometry = e.geo; d.m.material = src.material; d.m.visible = true;
    src.updateMatrixWorld(true);
    d.m.position.copy(e.c).applyMatrix4(src.matrixWorld);
    src.getWorldQuaternion(d.m.quaternion);
    d.v.copy(v); d.spin.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 8);
    d.rest = false; d.hits = 0; d.life = 6;
    this.mags.push(d);
  }

  casing(p, v) {
    const c = this.casings[this.casingNext]; this.casingNext = (this.casingNext + 1) % this.casings.length;
    c.m.position.copy(p); c.v.copy(v);
    c.spin.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);
    c.life = 8; c.rest = false; c.bounced = false; c.m.visible = true;
  }

  flash(p, power = 1, size = 1) {
    const f = this.flashes[this.flashNext]; this.flashNext = (this.flashNext + 1) % this.flashes.length;
    f.m.position.copy(p); f.m.rotation.z = Math.random() * 6.28;
    f.m.scale.setScalar((0.8 + Math.random() * 0.6) * size);
    f.m.visible = true;
    f.l.position.copy(p); f.l.intensity = 160 * power;
    f.life = size > 1 ? 0.1 : 0.05;
  }

  // Concussion charge going off: a hard flash, a ball of dust and flung grit.
  blast(p) {
    const a = this.lightAt(p), k = 2.4, br = a.r * k + 0.04, bg = a.g * k + 0.04, bb = a.b * k + 0.04;
    this.flash(p, 6, 5);
    for (let i = 0; i < 8; i++) {
      this.spawn(p.x, p.y + 0.1, p.z, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 0.1 + Math.random() * 0.08, 0.5, 1.8, 12, 8, 3.5, 0.8, 0, 1, 1);
    }
    for (let i = 0; i < 46; i++) {
      const th = Math.random() * 6.283, y = Math.random() * 1.3 - 0.3, r = Math.sqrt(Math.max(0, 1 - Math.min(1, y * y))), sp = 2 + Math.random() * 8;
      this.spawn(p.x, p.y + 0.1, p.z, Math.cos(th) * r * sp, y * sp * 0.7 + 0.6, Math.sin(th) * r * sp,
        1.3 + Math.random() * 1.8, 0.2, 1.0 + Math.random() * 0.9, br * 0.7, bg * 0.68, bb * 0.64, 0.34, -0.12, 2.6);
    }
    for (let i = 0; i < 30; i++) {
      const th = Math.random() * 6.283, sp = 5 + Math.random() * 12;
      this.spawn(p.x, p.y + 0.1, p.z, Math.cos(th) * sp, Math.random() * 9, Math.sin(th) * sp, 0.35 + Math.random() * 0.6, 0.03, 0.012, 10, 6, 2.2, 1, 9.8, 0.7, 1);
    }
  }

  // A glass bottle bursting.
  shatter(p, r, g, b) {
    const a = this.lightAt(p), k = 5;
    for (let i = 0; i < 22; i++) {
      const sp = 1 + Math.random() * 3.5, th = Math.random() * 6.283;
      this.spawn(p.x, p.y, p.z, Math.cos(th) * sp, Math.random() * 3.2, Math.sin(th) * sp, 0.6 + Math.random() * 0.6, 0.022, 0.014,
        (a.r * k + 0.05) * (r + 0.35), (a.g * k + 0.05) * (g + 0.35), (a.b * k + 0.05) * (b + 0.35), 1, 9.8, 0.5);
    }
  }

  // Dry powder jetting out of a punctured extinguisher.
  puff(p, n) {
    const a = this.lightAt(p), k = 2.6;
    for (let i = 0; i < 2; i++) {
      const sp = 3 + Math.random() * 4;
      this.spawn(p.x, p.y, p.z, n.x * sp + (Math.random() - 0.5) * 1.2, n.y * sp + (Math.random() - 0.5) * 1.2, n.z * sp + (Math.random() - 0.5) * 1.2,
        1.6 + Math.random() * 2.2, 0.08, 0.9 + Math.random() * 0.8, a.r * k + 0.07, a.g * k + 0.07, a.b * k + 0.07, 0.3, -0.05, 3.2);
    }
  }

  update(dt, camera, viewH) {
    this.pMat.uniforms.uScale.value = viewH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) { this.data[i * 4] = 0; this.data[i * 4 + 1] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.max[i];
      const k = Math.exp(-this.drag[i] * dt), o = i * 3;
      this.vel[o] *= k; this.vel[o + 1] = this.vel[o + 1] * k - this.grav[i] * dt; this.vel[o + 2] *= k;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      this.data[i * 4] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.data[i * 4 + 1] = this.a0[i] * Math.pow(1 - t, 1.4);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aData.needsUpdate = true; g.attributes.aColor.needsUpdate = true;

    for (const t of this.tracers) {
      if (!t.m.visible) continue;
      t.life -= dt;
      t.m.material.opacity = Math.max(0, t.life / 0.055) * 0.55;
      if (t.life <= 0) t.m.visible = false;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.m.quaternion.copy(camera.quaternion);
      if (f.life <= 0) { f.m.visible = false; f.l.intensity = 0; }
    }
    for (const c of this.casings) {
      if (!c.m.visible || c.rest) continue;
      c.life -= dt;
      c.v.y -= 9.8 * dt;
      const p = c.m.position;
      p.addScaledVector(c.v, dt);
      c.m.rotation.x += c.spin.x * dt; c.m.rotation.y += c.spin.y * dt; c.m.rotation.z += c.spin.z * dt;
      if (this.world.pushSphere(p, 0.012)) {
        const n = this.world.n, vn = c.v.x * n.x + c.v.y * n.y + c.v.z * n.z;
        if (vn < 0) {
          c.v.x -= 1.45 * vn * n.x; c.v.y -= 1.45 * vn * n.y; c.v.z -= 1.45 * vn * n.z;
          c.v.multiplyScalar(0.7); c.spin.multiplyScalar(0.6);
          if (!c.bounced) { c.bounced = true; this.sfx.casing(p); }
          if (c.v.lengthSq() < 0.15 && n.y > 0.7) { c.rest = true; c.m.rotation.set(Math.PI / 2, 0, Math.random() * 6.28); }
        }
      }
      if (c.life <= 0) c.rest = true;
    }
    if (this.mags) for (const d of this.mags) {
      if (d.rest) continue;
      d.life -= dt;
      d.v.y -= 9.8 * dt;
      const p = d.m.position;
      p.addScaledVector(d.v, dt);
      _e.set(d.spin.x * dt, d.spin.y * dt, d.spin.z * dt); _q.setFromEuler(_e); d.m.quaternion.multiply(_q);
      if (this.world.pushSphere(p, 0.03)) {
        const n = this.world.n, vn = d.v.x * n.x + d.v.y * n.y + d.v.z * n.z;
        if (vn < 0) {
          d.v.x -= 1.3 * vn * n.x; d.v.y -= 1.3 * vn * n.y; d.v.z -= 1.3 * vn * n.z;
          d.v.multiplyScalar(0.5); d.spin.multiplyScalar(0.45);
          if (d.hits++ < 3 && vn < -0.6) this.sfx.magDrop(p, Math.min(1, -vn / 4));
          if (n.y > 0.7 && d.v.lengthSq() < 0.3) {
            // settle flat on the floor, keeping its heading
            d.rest = true;
            _v3.set(1, 0, 0).applyQuaternion(d.m.quaternion);
            d.m.quaternion.setFromEuler(_e.set(0, Math.atan2(-_v3.z, _v3.x), Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1), 'YXZ'));
            p.y += 0.004;
          }
        }
      }
      if (d.life <= 0) d.rest = true;
    }
    for (const pl of this.pools) {
      if (pl.size < pl.target) { pl.size += dt * 0.07 * (1.2 - pl.size / pl.target); pl.m.scale.setScalar(pl.size); }
    }
  }
}
