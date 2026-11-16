// Static collision world made of axis-aligned boxes.
// Used by the player controller, bullets, AI line of sight, ragdolls and the light bake.

export class World {
  constructor() {
    this.boxes = [];
    this.cell = 2;
    this.grid = new Map();
    this.stamp = 1;
    this._q = [];
    this.n = { x: 0, y: 1, z: 0 }; // normal of the last pushSphere contact
  }

  add(x0, y0, z0, x1, y1, z1, o = {}) {
    const b = {
      x0, y0, z0, x1, y1, z1,
      solid: o.solid !== false, // blocks the player
      ray: o.ray !== false,     // blocks bullets, sight and ragdolls
      occ: o.occ !== false,     // blocks light in the bake
      mat: o.mat || 'concrete',
      s: 0,
    };
    this.boxes.push(b);
    return b;
  }

  build() {
    this.grid.clear();
    const c = this.cell;
    for (const b of this.boxes) {
      const i0 = Math.floor(b.x0 / c), i1 = Math.floor(b.x1 / c);
      const j0 = Math.floor(b.z0 / c), j1 = Math.floor(b.z1 / c);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = (i + 512) * 2048 + (j + 512);
          let a = this.grid.get(k);
          if (!a) this.grid.set(k, (a = []));
          a.push(b);
        }
      }
    }
  }

  // Boxes whose XZ cells touch the given rectangle. Returns a shared array.
  query(x0, z0, x1, z1) {
    const out = this._q;
    out.length = 0;
    const st = ++this.stamp, c = this.cell;
    const i0 = Math.floor(x0 / c), i1 = Math.floor(x1 / c);
    const j0 = Math.floor(z0 / c), j1 = Math.floor(z1 / c);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const a = this.grid.get((i + 512) * 2048 + (j + 512));
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const b = a[k];
          if (b.s !== st) { b.s = st; out.push(b); }
        }
      }
    }
    return out;
  }

  // Nearest hit along a ray. Fills hit = {t, box, nx, ny, nz}.
  raycast(ox, oy, oz, dx, dy, dz, maxT, hit) {
    if (dx === 0) dx = 1e-9;
    if (dy === 0) dy = 1e-9;
    if (dz === 0) dz = 1e-9;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    let best = maxT, bb = null, bax = 0;
    const boxes = this.boxes;
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      if (!b.ray) continue;
      let t1 = (b.x0 - ox) * ix, t2 = (b.x1 - ox) * ix, t;
      if (t1 > t2) { t = t1; t1 = t2; t2 = t; }
      let tn = t1, tf = t2, ax = 0;
      t1 = (b.y0 - oy) * iy; t2 = (b.y1 - oy) * iy;
      if (t1 > t2) { t = t1; t1 = t2; t2 = t; }
      if (t1 > tn) { tn = t1; ax = 1; }
      if (t2 < tf) tf = t2;
      if (tn > tf) continue;
      t1 = (b.z0 - oz) * iz; t2 = (b.z1 - oz) * iz;
      if (t1 > t2) { t = t1; t1 = t2; t2 = t; }
      if (t1 > tn) { tn = t1; ax = 2; }
      if (t2 < tf) tf = t2;
      if (tn > tf || tn < 0 || tn >= best) continue;
      best = tn; bb = b; bax = ax;
    }
    if (!bb) return false;
    hit.t = best; hit.box = bb;
    hit.nx = hit.ny = hit.nz = 0;
    if (bax === 0) hit.nx = dx > 0 ? -1 : 1;
    else if (bax === 1) hit.ny = dy > 0 ? -1 : 1;
    else hit.nz = dz > 0 ? -1 : 1;
    return true;
  }

  // True if anything with the given flag lies on the segment. Early exit.
  blocked(ox, oy, oz, dx, dy, dz, maxT, flag = 'ray') {
    if (dx === 0) dx = 1e-9;
    if (dy === 0) dy = 1e-9;
    if (dz === 0) dz = 1e-9;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const boxes = this.boxes;
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      if (!b[flag]) continue;
      let t1 = (b.x0 - ox) * ix, t2 = (b.x1 - ox) * ix, t;
      if (t1 > t2) { t = t1; t1 = t2; t2 = t; }
      let tn = t1, tf = t2;
      t1 = (b.y0 - oy) * iy; t2 = (b.y1 - oy) * iy;
      if (t1 > t2) { t = t1; t1 = t2; t2 = t; }
      if (t1 > tn) tn = t1;
      if (t2 < tf) tf = t2;
      if (tn > tf) continue;
      t1 = (b.z0 - oz) * iz; t2 = (b.z1 - oz) * iz;
      if (t1 > t2) { t = t1; t1 = t2; t2 = t; }
      if (t1 > tn) tn = t1;
      if (t2 < tf) tf = t2;
      if (tn > tf || tf < 0 || tn >= maxT) continue;
      return true;
    }
    return false;
  }

  inside(x, y, z, flag = 'occ') {
    const q = this.query(x, z, x, z);
    for (let k = 0; k < q.length; k++) {
      const b = q[k];
      if (b[flag] && x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1) return true;
    }
    return false;
  }

  // First solid box overlapping the given AABB, or null.
  overlap(x0, y0, z0, x1, y1, z1) {
    const q = this.query(x0, z0, x1, z1);
    for (let k = 0; k < q.length; k++) {
      const b = q[k];
      if (!b.solid) continue;
      if (x1 > b.x0 && x0 < b.x1 && y1 > b.y0 && y0 < b.y1 && z1 > b.z0 && z0 < b.z1) return b;
    }
    return null;
  }

  // Push a sphere out of every box it touches. Mutates p, stores the contact normal in this.n.
  pushSphere(p, r) {
    const q = this.query(p.x - r, p.z - r, p.x + r, p.z + r);
    let hit = false;
    const n = this.n;
    for (let k = 0; k < q.length; k++) {
      const b = q[k];
      if (!b.ray) continue;
      const cx = p.x < b.x0 ? b.x0 : p.x > b.x1 ? b.x1 : p.x;
      const cy = p.y < b.y0 ? b.y0 : p.y > b.y1 ? b.y1 : p.y;
      const cz = p.z < b.z0 ? b.z0 : p.z > b.z1 ? b.z1 : p.z;
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2), push = r - d;
        n.x = dx / d; n.y = dy / d; n.z = dz / d;
        p.x += n.x * push; p.y += n.y * push; p.z += n.z * push;
      } else {
        // centre is inside the box: leave through the nearest face
        const ex0 = p.x - b.x0, ex1 = b.x1 - p.x;
        const ey0 = p.y - b.y0, ey1 = b.y1 - p.y;
        const ez0 = p.z - b.z0, ez1 = b.z1 - p.z;
        const m = Math.min(ex0, ex1, ey0, ey1, ez0, ez1);
        n.x = n.y = n.z = 0;
        if (m === ey1) { p.y = b.y1 + r; n.y = 1; }
        else if (m === ex0) { p.x = b.x0 - r; n.x = -1; }
        else if (m === ex1) { p.x = b.x1 + r; n.x = 1; }
        else if (m === ez0) { p.z = b.z0 - r; n.z = -1; }
        else if (m === ez1) { p.z = b.z1 + r; n.z = 1; }
        else { p.y = b.y0 - r; n.y = -1; }
      }
      hit = true;
    }
    return hit;
  }
}

// Closest approach between a ray (o + t*d, d unit, t >= 0) and a segment a-b.
// Returns the distance and writes the ray parameter to out.t and segment parameter to out.s.
export function raySegment(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, out) {
  const vx = bx - ax, vy = by - ay, vz = bz - az;
  const wx = ox - ax, wy = oy - ay, wz = oz - az;
  const B = dx * vx + dy * vy + dz * vz;
  const C = vx * vx + vy * vy + vz * vz;
  const D = dx * wx + dy * wy + dz * wz;
  const E = vx * wx + vy * wy + vz * wz;
  const den = C - B * B;
  let s, t;
  if (C < 1e-9) { s = 0; t = -D; }
  else if (den < 1e-9) { s = Math.min(1, Math.max(0, E / C)); t = s * B - D; }
  else {
    s = Math.min(1, Math.max(0, (E - B * D) / den));
    t = s * B - D;
  }
  if (t < 0) { t = 0; s = C < 1e-9 ? 0 : Math.min(1, Math.max(0, E / C)); }
  const px = ox + dx * t - (ax + vx * s);
  const py = oy + dy * t - (ay + vy * s);
  const pz = oz + dz * t - (az + vz * s);
  out.t = t; out.s = s;
  return Math.sqrt(px * px + py * py + pz * pz);
}
