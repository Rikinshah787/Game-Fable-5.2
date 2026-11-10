import * as THREE from 'three';

const PAINTS = [0xb0121b, 0xf2f2f0, 0x0c0d10, 0x1f4fa8, 0xe8a013, 0x0f7a5a, 0x8a8d92, 0xff5a1f, 0x5a1f8a, 0x19b6c9, 0xd9d2c0, 0xf23d8a];

export function createCarFactory(A) {
  const src = A.models.car;
  const details = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.42 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0e11, metalness: 0.9, roughness: 0.03, transparent: true, opacity: 0.78, envMapIntensity: 1.6 });
  const shadowMat = new THREE.MeshBasicMaterial({ map: A.carShadow, blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, premultipliedAlpha: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const shadowGeo = new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4).rotateX(-Math.PI / 2);
  let tris = 0;
  src.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  console.log('[car] triangles', Math.round(tris));

  // parts that only matter up close
  const DETAIL = new Set(['interior_light', 'leather', 'interior_dark', 'carpet', 'trim', 'brakes', 'carbon_fibre_trim', 'carbon_fibre', 'wipers', 'blue', 'yellow_trim', 'plastic_gray', 'metal']);
  const WHEEL_DETAIL = /^(wheel|brake|nuts|centre)/;
  // low-poly silhouette: casts the shadow for every car and stands in for the whole car far away
  const prof = [[-2.2, 0.22], [-2.25, 0.62], [-1.5, 0.95], [-0.55, 1.0], [-0.25, 1.17], [0.45, 1.12], [1.25, 0.78], [2.1, 0.6], [2.25, 0.3], [2.1, 0.18]];
  const shp = new THREE.Shape(); prof.forEach(([z, y], i) => (i ? shp.lineTo(z, y) : shp.moveTo(z, y))); shp.closePath();
  const proxyGeo = new THREE.ExtrudeGeometry(shp, { depth: 1.86, bevelEnabled: false });
  proxyGeo.translate(0, 0, -0.93); proxyGeo.rotateY(-Math.PI / 2);          // shape X -> car +Z
  const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

  return function makeCar(colorHex) {
    const model = src.clone(true);
    const paint = new THREE.MeshPhysicalMaterial({
      color: colorHex ?? PAINTS[Math.floor(Math.random() * PAINTS.length)],
      metalness: 0.9, roughness: 0.38, clearcoat: 1.0, clearcoatRoughness: 0.035, envMapIntensity: 1.35,
    });
    const set = (name, mat) => { const o = model.getObjectByName(name); if (o) o.material = mat; };
    set('body', paint);
    for (const n of ['rim_fl', 'rim_fr', 'rim_rr', 'rim_rl', 'trim']) set(n, details);
    set('glass', glass);
    const wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map((n) => model.getObjectByName(n));
    for (const w of wheels) if (w) w.rotation.order = 'YXZ';
    const detail = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = true;
      const inWheel = o.parent && /^wheel_/.test(o.parent.name);
      if (DETAIL.has(o.name) || (inWheel && WHEEL_DETAIL.test(o.name)) || (o.parent && o.parent.name === 'steering_wheel')) detail.push(o);
    });
    const tail = model.getObjectByName('lights_red');
    let tailMat = null;
    if (tail) { tailMat = tail.material = tail.material.clone(); tailMat.emissive = new THREE.Color(1, 0.04, 0.02); tailMat.emissiveIntensity = 0.4; }
    const sh = new THREE.Mesh(shadowGeo, shadowMat);
    sh.position.y = 0.012; sh.renderOrder = 2;
    const proxy = new THREE.Mesh(proxyGeo, shadowOnly);
    proxy.castShadow = true;
    const far = new THREE.Mesh(proxyGeo, new THREE.MeshStandardMaterial({ color: paint.color, metalness: 0.6, roughness: 0.4 }));
    far.visible = false;
    const root = new THREE.Group();        // position + heading
    const body = new THREE.Group();        // roll / pitch
    model.rotation.y = Math.PI;            // the source model faces -Z; our cars drive toward +Z
    body.add(model, proxy, far);
    root.add(body, sh);
    let lod = 0;
    const setLod = (l) => {
      if (l === lod) return; lod = l;
      for (const o of detail) o.visible = l === 0;
      model.visible = l < 2; far.visible = l === 2;
    };
    return { root, body, model, wheels, paint, shadow: sh, setLod, tail, tailMat, farMat: far.material };
  };
}

const _c = { x: 0, z: 0 };

export class Car {
  constructor(parts, x, z, heading) {
    Object.assign(this, parts);
    this.x = x; this.z = z; this.y = 0; this.h = heading;
    this.vx = 0; this.vz = 0;
    this.steer = 0; this.spin = 0; this.roll = 0; this.pitch = 0;
    this.health = 100; this.speed = 0; this.vF = 0; this.yawRate = 0; this.lastImpact = 0; this.slip = 0;
    this.radius = 1.05; this.driver = null;
    this.sync(0);
  }
  get fx() { return Math.sin(this.h); }
  get fz() { return Math.cos(this.h); }

  // input: { throttle: -1..1, steer: -1..1 (right +), handbrake: bool }
  update(dt, input, city, others) {
    const fx = Math.sin(this.h), fz = Math.cos(this.h), rx = -fz, rz = fx;
    let vF = this.vx * fx + this.vz * fz, vR = this.vx * rx + this.vz * rz;
    const TOP = 68, REV = 14;
    const thr = input.throttle;
    let acc = 0;
    if (thr > 0) acc = vF >= -0.5 ? 15.5 * thr * Math.max(0, 1 - Math.pow(Math.max(vF, 0) / TOP, 2.2)) + (vF < 6 ? 3 * thr : 0) : 26 * thr;
    else if (thr < 0) acc = vF > 0.5 ? 27 * thr : 8 * thr * Math.max(0, 1 + vF / REV);
    if (this.tailMat) this.tailMat.emissiveIntensity = (thr < 0 && vF > 0.5) || input.handbrake ? 7 : 0.4;
    vF += acc * dt;
    vF += 9.81 * Math.sin(this.gp || 0) * dt;                 // hills: roll back on the way up, pick up speed going down
    // rolling resistance + aero drag
    const dragF = 0.35 + 0.0038 * vF * vF + (thr === 0 ? 1.2 : 0);
    vF -= Math.sign(vF) * Math.min(Math.abs(vF), dragF * dt);
    if (input.handbrake) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 9 * dt);

    // steering: less lock at speed
    const maxLock = 0.58 / (1 + Math.pow(Math.abs(vF) / 21, 1.25));
    const target = input.steer * maxLock;
    this.steer += (target - this.steer) * Math.min(1, dt * (Math.abs(target) > Math.abs(this.steer) ? 7 : 10));
    let yaw = -(vF * Math.tan(this.steer)) / 2.65;
    // lateral grip; handbrake or heavy cornering breaks traction
    const latDemand = Math.abs(yaw * vF);
    let grip = input.handbrake ? 1.6 : 9.5;
    if (!input.handbrake && latDemand > 15) grip = Math.max(3.2, 9.5 - (latDemand - 15) * 0.45);
    if (input.handbrake && Math.abs(vF) > 6) yaw *= 1.55;
    vR *= Math.exp(-grip * dt);
    this.slip = Math.abs(vR);
    this.yawRate = yaw;
    this.h += yaw * dt;

    const nfx = Math.sin(this.h), nfz = Math.cos(this.h), nrx = -nfz, nrz = nfx;
    this.vx = nfx * vF + nrx * vR; this.vz = nfz * vF + nrz * vR;
    this.x += this.vx * dt; this.z += this.vz * dt;

    this.lastImpact = 0;
    this.collide(city, others);

    this.vF = this.vx * nfx + this.vz * nfz;
    this.speed = Math.hypot(this.vx, this.vz);
    // body motion
    const latAcc = yaw * vF, lonAcc = acc;
    this.roll += (THREE.MathUtils.clamp(latAcc * 0.0045, -0.07, 0.07) - this.roll) * Math.min(1, dt * 6);
    this.pitch += (THREE.MathUtils.clamp(-lonAcc * 0.0028, -0.045, 0.045) - this.pitch) * Math.min(1, dt * 5);
    this.spin += (this.vF / 0.34) * dt;
    this.sync(dt, city);
  }

  collide(city, others) {
    const fx = Math.sin(this.h), fz = Math.cos(this.h), r = this.radius;
    const boxes = city.collidersNear(this.x, this.z);
    for (const off of [1.35, 0, -1.35]) {
      let cx = this.x + fx * off, cz = this.z + fz * off;
      for (const b of boxes) {
        const px = Math.max(b.x0, Math.min(cx, b.x1)), pz = Math.max(b.z0, Math.min(cz, b.z1));
        let dx = cx - px, dz = cz - pz;
        let d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let nx, nz, pen;
        if (d2 < 1e-8) {
          // centre is inside the box: leave through the nearest face
          const l = cx - b.x0, rr = b.x1 - cx, t = cz - b.z0, bt = b.z1 - cz, m = Math.min(l, rr, t, bt);
          if (m === l) { nx = -1; nz = 0; } else if (m === rr) { nx = 1; nz = 0; } else if (m === t) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
          pen = m + r;
        } else { const d = Math.sqrt(d2); nx = dx / d; nz = dz / d; pen = r - d; }
        this.x += nx * pen; this.z += nz * pen; cx += nx * pen; cz += nz * pen;
        const vn = this.vx * nx + this.vz * nz;
        if (vn < 0) {
          this.vx -= vn * nx * 1.25; this.vz -= vn * nz * 1.25;
          this.vx *= 0.94; this.vz *= 0.94;
          this.lastImpact = Math.max(this.lastImpact, -vn);
          // glancing hits swing the nose away from the wall
          const side = fx * nz - fz * nx;
          this.h += THREE.MathUtils.clamp(side * -vn * 0.012 * Math.sign(off || 1), -0.08, 0.08);
        }
      }
    }
    if (others) for (const o of others) {
      if (o === this) continue;
      const dx = this.x - o.x, dz = this.z - o.z, d2 = dx * dx + dz * dz, rr = 2.15;
      if (d2 > rr * rr || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = rr - d;
      this.x += nx * pen * 0.5; this.z += nz * pen * 0.5; o.x -= nx * pen * 0.5; o.z -= nz * pen * 0.5;
      const rel = (this.vx - o.vx) * nx + (this.vz - o.vz) * nz;
      if (rel < 0) {
        const j = -rel * 0.8;
        this.vx += nx * j; this.vz += nz * j; o.vx -= nx * j; o.vz -= nz * j;
        this.lastImpact = Math.max(this.lastImpact, -rel); o.lastImpact = Math.max(o.lastImpact || 0, -rel);
      }
    }
    // shoreline, bridge rails, pier edges
    const imp = city.confine(this, 1.15);
    if (imp > 0) this.lastImpact = Math.max(this.lastImpact, imp);
  }

  sync(dt, city) {
    const fx = Math.sin(this.h), fz = Math.cos(this.h), rx = -fz, rz = fx;
    let gy = 0, gp = 0, gr = 0;
    if (city) {
      const s = (a, b) => city.groundY(this.x + fx * a + rx * b, this.z + fz * a + rz * b);
      const fl = s(1.3, -0.8), fr = s(1.3, 0.8), rl = s(-1.3, -0.8), rr = s(-1.3, 0.8);
      gy = (fl + fr + rl + rr) / 4;
      gp = Math.atan2((rl + rr) / 2 - (fl + fr) / 2, 2.6);
      gr = Math.atan2((fl + rl) / 2 - (fr + rr) / 2, 1.6);
      const k = Math.min(1, (dt || 1) * 14);
      this.y += (gy - this.y) * k;
      this.gp = (this.gp || 0) + (gp - (this.gp || 0)) * k;
      this.gr = (this.gr || 0) + (gr - (this.gr || 0)) * k;
    }
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.y = this.h;
    this.body.rotation.x = this.pitch + (this.gp || 0);
    this.body.rotation.z = this.roll - (this.gr || 0);
    const w = this.wheels;
    if (w[0]) { w[0].rotation.set(-this.spin, -this.steer, 0); w[1].rotation.set(-this.spin, -this.steer, 0); w[2].rotation.set(-this.spin, 0, 0); w[3].rotation.set(-this.spin, 0, 0); }
  }
}
