import * as THREE from 'three';

export function makeGlowTexture(size = 128, power = 2) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
    const d = Math.min(1, Math.hypot(dx, dy));
    const a = Math.pow(1 - d, power) * (1 - d * d * d);
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Point particles. additive = fire / sparks; otherwise alpha-blended smoke and dust.
export class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.additive = additive;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.base = new Float32Array(max * 4);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aColor', this.aCol); g.setAttribute('aSize', this.aSize);
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 800 } },
      vertexShader: /* glsl */`
        attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vC;
        void main() {
          vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(aSize * uScale / max(-mv.z, 0.1), 900.0);
        }`,
      fragmentShader: additive ? /* glsl */`
        varying vec4 vC;
        void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = max(0.0, 1.0 - d); gl_FragColor = vec4(vC.rgb * a * a * vC.a, 1.0); }` : /* glsl */`
        varying vec4 vC;
        void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.25, d); gl_FragColor = vec4(vC.rgb, a * vC.a); }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a = 1, drag = 0, grav = 0) {
    const i = this.cursor; this.cursor = (i + 1) % this.max;
    const j = i * 3, k = i * 4;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.base[k] = r; this.base[k + 1] = g; this.base[k + 2] = b; this.base[k + 3] = a;
    this.life[i] = this.maxLife[i] = life;
    this.s0[i] = s0; this.s1[i] = s1; this.drag[i] = drag; this.grav[i] = grav;
  }
  update(dt) {
    const { pos, vel, col, base, life, maxLife, size, s0, s1, drag, grav } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (size[i] !== 0) size[i] = 0; continue; }
      life[i] -= dt;
      if (life[i] <= 0) { size[i] = 0; continue; }
      const t = 1 - life[i] / maxLife[i], j = i * 3, k = i * 4;
      const f = Math.max(0, 1 - drag[i] * dt);
      vel[j] *= f; vel[j + 1] = vel[j + 1] * f - grav[i] * dt; vel[j + 2] *= f;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      size[i] = s0[i] + (s1[i] - s0[i]) * t;
      col[k] = base[k]; col[k + 1] = base[k + 1]; col[k + 2] = base[k + 2];
      col[k + 3] = base[k + 3] * (this.additive ? (1 - t) * (1 - t) : Math.min(1, t * 8) * (1 - t));
    }
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
  }
}

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
function randDir(out) { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, s = Math.sqrt(1 - u * u); return out.set(Math.cos(a) * s, u, Math.sin(a) * s); }

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.fire = new Particles(scene, 3000, true);
    this.smoke = new Particles(scene, 2500, false);
    this.glow = makeGlowTexture(128, 2);
    this.shake = 0;
    this.flashes = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false; s.renderOrder = 7; scene.add(s);
      this.flashes.push({ s, t: 0, dur: 1, s0: 1, s1: 1, c: new THREE.Color() });
    }
    this.lights = [];
    for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xffb070, 0, 60, 2); scene.add(l); this.lights.push({ l, t: 0, dur: 1, i0: 0 }); }
    this.tracers = [];
    const tg = new THREE.BoxGeometry(0.025, 0.025, 1);
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.2, 1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      m.visible = false; m.frustumCulled = false; scene.add(m);
      this.tracers.push({ m, t: 0 });
    }
    this.fC = 0; this.lC = 0; this.tC = 0;
    // spent brass
    this.shellMax = 48; this.shells = []; this.sC = 0;
    this.shellMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.007, 0.007, 0.024, 6), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.28 }), this.shellMax);
    this.shellMesh.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.shellMax; i++) { this.shells.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), a: 0, s: 0 }); this.shellMesh.setMatrixAt(i, zero); }
    scene.add(this.shellMesh);
    this._zero = zero; this._sm = new THREE.Matrix4(); this._sq = new THREE.Quaternion(); this._se = new THREE.Euler(); this._ss = new THREE.Vector3(1.6, 1.6, 1.6);
  }
  shell(pos, vx, vy, vz) {
    const s = this.shells[this.sC]; this.sC = (this.sC + 1) % this.shellMax;
    s.life = 4; s.p.copy(pos); s.v.set(vx, vy, vz); s.a = Math.random() * 6; s.s = 14 + Math.random() * 18;
  }
  flash(pos, size, dur, r, g, b, grow = 1.5) {
    const f = this.flashes[this.fC]; this.fC = (this.fC + 1) % this.flashes.length;
    f.t = 0; f.dur = dur; f.s0 = size; f.s1 = size * grow; f.c.setRGB(r, g, b); f.s.position.copy(pos); f.s.visible = true;
  }
  light(pos, intensity, dur, color = 0xffb070, dist = 60) {
    const f = this.lights[this.lC]; this.lC = (this.lC + 1) % this.lights.length;
    f.t = 0; f.dur = dur; f.i0 = intensity; f.l.color.set(color); f.l.distance = dist; f.l.position.copy(pos);
  }
  tracer(from, to) {
    const t = this.tracers[this.tC]; this.tC = (this.tC + 1) % this.tracers.length;
    const len = from.distanceTo(to);
    t.m.position.copy(from).lerp(to, 0.5); t.m.lookAt(to); t.m.scale.set(1, 1, len); t.m.visible = true; t.t = 0.055;
  }
  muzzle(pos) {
    this.flash(pos, 0.9, 0.05, 9, 6, 2.5, 1.3); this.light(pos, 260, 0.06, 0xffc070, 22);
    for (let i = 0; i < 2; i++) this.smoke.spawn(pos.x, pos.y, pos.z, rnd(-0.3, 0.3), rnd(0.2, 0.6), rnd(-0.3, 0.3), rnd(0.5, 0.9), 0.06, rnd(0.35, 0.6), 0.75, 0.75, 0.75, 0.22, 1.5, -0.2);
  }
  // bullet hitting a hard surface
  impact(pos, n, r = 0.5, g = 0.48, b = 0.44) {
    for (let i = 0; i < 6; i++) { randDir(_v).multiplyScalar(1.6).addScaledVector(n, 2.2); this.smoke.spawn(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, rnd(0.5, 1.0), 0.12, rnd(0.6, 1.1), r, g, b, 0.5, 2.5, -0.3); }
    for (let i = 0; i < 5; i++) { randDir(_v).multiplyScalar(5).addScaledVector(n, 5); this.fire.spawn(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, rnd(0.1, 0.3), 0.07, 0, 6, 4, 1.5, 1, 1, 9); }
  }
  blood(pos) {
    for (let i = 0; i < 8; i++) { randDir(_v).multiplyScalar(1.8); this.smoke.spawn(pos.x, pos.y, pos.z, _v.x, _v.y + 0.8, _v.z, rnd(0.3, 0.6), 0.08, rnd(0.3, 0.5), 0.32, 0.02, 0.02, 0.75, 2, 6); }
  }
  tyreSmoke(x, y, z, amount) {
    if (Math.random() > amount) return;
    this.smoke.spawn(x + rnd(-0.2, 0.2), y + 0.1, z + rnd(-0.2, 0.2), rnd(-0.4, 0.4), rnd(0.3, 0.9), rnd(-0.4, 0.4), rnd(0.8, 1.6), 0.5, rnd(1.8, 3.0), 0.82, 0.82, 0.82, 0.22, 0.6, -0.2);
  }
  engineSmoke(x, y, z, dark) {
    const c = dark ? 0.06 : 0.55;
    this.smoke.spawn(x + rnd(-0.3, 0.3), y, z + rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(1.2, 2.4), rnd(-0.3, 0.3), rnd(1.2, 2.2), 0.4, rnd(1.6, 2.8), c, c, c, dark ? 0.6 : 0.3, 0.3, -0.4);
  }
  flame(x, y, z, s = 1) {
    this.fire.spawn(x + rnd(-0.5, 0.5) * s, y + rnd(0, 0.3), z + rnd(-0.5, 0.5) * s, rnd(-0.3, 0.3), rnd(1.5, 3.5), rnd(-0.3, 0.3), rnd(0.25, 0.55), rnd(0.9, 1.5) * s, 0.2, 4.2, 1.5, 0.25, 1, 0.5, -1);
  }
  explode(pos, size = 1) {
    const F = this.fire, S = this.smoke;
    for (let i = 0; i < 46; i++) { randDir(_v).multiplyScalar(rnd(2, 10) * size); _v.y = Math.abs(_v.y) + 1.5; F.spawn(pos.x + _v.x * 0.1, pos.y + 0.6, pos.z + _v.z * 0.1, _v.x, _v.y, _v.z, rnd(0.45, 1.0), rnd(2.2, 3.6) * size, rnd(4.5, 7) * size, 4.6, 1.9, 0.35, 1, 1.6, -1.5); }
    for (let i = 0; i < 60; i++) { randDir(_v).multiplyScalar(rnd(10, 34) * size); _v.y = Math.abs(_v.y); F.spawn(pos.x, pos.y + 0.6, pos.z, _v.x, _v.y, _v.z, rnd(0.5, 1.5), 0.16, 0, 8, 4.5, 1.2, 1, 0.6, 12); }
    for (let i = 0; i < 40; i++) { randDir(_v).multiplyScalar(rnd(1.5, 6) * size); S.spawn(pos.x + _v.x * 0.3, pos.y + 1 + Math.abs(_v.y), pos.z + _v.z * 0.3, _v.x, Math.abs(_v.y) + rnd(1.5, 4), _v.z, rnd(2.5, 5), 2.2 * size, rnd(6, 10) * size, 0.05, 0.05, 0.055, 0.8, 0.7, -0.8); }
    _a.copy(pos); _a.y += 1;
    this.flash(_a, 9 * size, 0.14, 12, 9, 6, 1.6);
    this.flash(_a, 16 * size, 0.5, 5, 2.2, 0.6, 1.8);
    this.light(_a, 9000 * size, 0.55, 0xffa050, 90);
    this.shake = Math.min(1.5, this.shake + 0.9);
  }
  update(dt, camera, renderer, groundY) {
    this.fire.update(dt); this.smoke.update(dt);
    for (let i = 0; i < this.shellMax; i++) {
      const s = this.shells[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { this.shellMesh.setMatrixAt(i, this._zero); continue; }
      s.v.y -= 9.8 * dt; s.p.addScaledVector(s.v, dt); s.a += s.s * dt;
      const gy = groundY ? groundY(s.p.x, s.p.z) + 0.012 : 0.012;
      if (s.p.y < gy) { s.p.y = gy; if (Math.abs(s.v.y) > 0.6) { s.v.y *= -0.35; s.v.x *= 0.5; s.v.z *= 0.5; s.s *= 0.5; } else { s.v.set(0, 0, 0); s.s = 0; } }
      this._sm.compose(s.p, this._sq.setFromEuler(this._se.set(s.a, s.a * 0.7, 1.2)), this._ss);
      this.shellMesh.setMatrixAt(i, this._sm);
    }
    this.shellMesh.instanceMatrix.needsUpdate = true;
    const sc = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    this.fire.material.uniforms.uScale.value = sc; this.smoke.material.uniforms.uScale.value = sc;
    for (const f of this.flashes) {
      if (!f.s.visible) continue;
      f.t += dt; const t = f.t / f.dur;
      if (t >= 1) { f.s.visible = false; continue; }
      const k = (1 - t) * (1 - t);
      f.s.scale.setScalar(f.s0 + (f.s1 - f.s0) * Math.sqrt(t));
      f.s.material.color.setRGB(f.c.r * k, f.c.g * k, f.c.b * k);
    }
    for (const f of this.lights) {
      if (f.i0 <= 0) continue;
      f.t += dt; const t = f.t / f.dur;
      if (t >= 1) { f.i0 = 0; f.l.intensity = 0; continue; }
      f.l.intensity = f.i0 * (1 - t) * (1 - t);
    }
    for (const t of this.tracers) { if (!t.m.visible) continue; t.t -= dt; if (t.t <= 0) t.m.visible = false; }
    this.shake = Math.max(0, this.shake - dt * 2.4);
  }
}
