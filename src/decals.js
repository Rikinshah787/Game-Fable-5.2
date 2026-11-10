// Decals: pooled bullet holes and tyre skid marks.
// Each kind is one InstancedMesh of unit quads used as a ring buffer
// (oldest mark is overwritten, nothing is allocated per mark).
import * as THREE from 'three';

const HOLE_POOL = 160;
const SKID_POOL = 420;
const SKID_WIDTH = 0.24;

// Reused temporaries (nothing is allocated inside hole() / skid()).
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _spin = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const _col = new THREE.Color();
const _zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
const _white = new THREE.Color(0xffffff);
const _dark = new THREE.Color(0x3a3a3a);
const _AXIS_Z = new THREE.Vector3(0, 0, 1);
const _AXIS_Y = new THREE.Vector3(0, 1, 0);

function makeHoleTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2, cy = S / 2;

  // Small deterministic PRNG so the texture is the same every run.
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // White = no change under multiply blending.
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);

  // Soft dirty halo, reaches pure white well before the edge (r = 54 of 64).
  const halo = g.createRadialGradient(cx, cy, 0, cx, cy, 54);
  halo.addColorStop(0.0, 'rgba(110,110,110,0.65)');
  halo.addColorStop(0.35, 'rgba(150,150,150,0.35)');
  halo.addColorStop(0.7, 'rgba(210,210,210,0.10)');
  halo.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(cx, cy, 54, 0, Math.PI * 2);
  g.fill();

  const blob = (r0, jitter, n) => {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = r0 * (1 - jitter + rnd() * jitter * 2);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
  };

  // Radial cracks (short, end well inside the falloff radius).
  g.lineCap = 'round';
  const cracks = 6;
  for (let i = 0; i < cracks; i++) {
    const a = (i / cracks) * Math.PI * 2 + rnd() * 0.6;
    const len = 30 + rnd() * 14; // up to 44 px from centre
    let x = cx + Math.cos(a) * 14;
    let y = cy + Math.sin(a) * 14;
    g.strokeStyle = 'rgba(70,70,70,0.85)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 3;
    for (let s = 1; s <= steps; s++) {
      const rr = 14 + ((len - 14) * s) / steps;
      const aa = a + (rnd() - 0.5) * 0.35;
      x = cx + Math.cos(aa) * rr;
      y = cy + Math.sin(aa) * rr;
      g.lineTo(x, y);
    }
    g.stroke();
  }

  // Mid-grey chipped ring.
  g.fillStyle = '#8c8c8c';
  blob(22, 0.28, 18);
  g.fill();
  g.fillStyle = '#5c5c5c';
  blob(16, 0.25, 16);
  g.fill();

  // Near-black core, about 18% of the width (23 px across -> r = 11.5).
  g.fillStyle = '#080808';
  blob(11.5, 0.2, 14);
  g.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeSkidTexture() {
  const W = 32, H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);

  let seed = 4242;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Per-column streak factor (constant along the length) plus per-row grain.
  const colStreak = new Float32Array(W);
  for (let x = 0; x < W; x++) colStreak[x] = 0.85 + rnd() * 0.15;
  const rowGrain = new Float32Array(H);
  for (let y = 0; y < H; y++) rowGrain[y] = 0.9 + rnd() * 0.1;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      // 0 at the left/right edges, 1 in the middle.
      let profile = Math.sin(Math.PI * u);
      profile = Math.pow(profile, 0.8);
      const streak = colStreak[x] * rowGrain[y] * (0.94 + 0.06 * Math.sin(y * 0.55 + x * 0.9));
      const dark = Math.min(1, profile * streak);
      // Mid-grey (~120) at full darkness, white (255) at the edges.
      const v = Math.round(255 - (255 - 120) * dark);
      const i = (y * W + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeMaterial(map) {
  return new THREE.MeshBasicMaterial({
    map,
    color: 0xffffff,
    blending: THREE.MultiplyBlending,
    premultipliedAlpha: true,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

function makePool(geometry, material, count) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < count; i++) {
    mesh.setMatrixAt(i, _zeroMat);
    mesh.setColorAt(i, _white);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

export class Decals {
  constructor(scene) {
    // Bullet holes: PlaneGeometry faces +Z (its normal is local +Z).
    this.holeGeo = new THREE.PlaneGeometry(1, 1);
    this.holeTex = makeHoleTexture();
    this.holeMat = makeMaterial(this.holeTex);
    this.holes = makePool(this.holeGeo, this.holeMat, HOLE_POOL);
    this.holes.name = 'decal-holes';
    this.holeIdx = 0;

    // Skid marks: quad baked flat (facing +Y). After rotateX(-PI/2) the
    // plane's local Y (texture v, the long axis) maps to -Z and its local X
    // stays X, so instance scale = (width, 1, length) and a Y rotation by the
    // heading points the long axis along the heading.
    this.skidGeo = new THREE.PlaneGeometry(1, 1);
    this.skidGeo.rotateX(-Math.PI / 2);
    this.skidTex = makeSkidTexture();
    this.skidMat = makeMaterial(this.skidTex);
    this.skids = makePool(this.skidGeo, this.skidMat, SKID_POOL);
    this.skids.name = 'decal-skids';
    this.skidIdx = 0;

    scene.add(this.holes);
    scene.add(this.skids);
  }

  // point: THREE.Vector3 (world), normal: unit THREE.Vector3.
  hole(point, normal) {
    const i = this.holeIdx;
    this.holeIdx = (i + 1) % HOLE_POOL;

    // Rotate the quad's local +Z (its normal) onto `normal`, then spin
    // around that normal (local Z after alignment) by a random angle.
    _quat.setFromUnitVectors(_AXIS_Z, normal);
    _spin.setFromAxisAngle(_AXIS_Z, Math.random() * Math.PI * 2);
    _quat.multiply(_spin);

    const s = 0.14 + Math.random() * 0.08;
    _scale.set(s, s, 1);
    _pos.copy(normal).multiplyScalar(0.02).add(point);

    _mat.compose(_pos, _quat, _scale);
    this.holes.setMatrixAt(i, _mat);
    this.holes.instanceMatrix.needsUpdate = true;
  }

  // One tyre-mark segment lying on the road. heading h: forward = (sin h, 0, cos h).
  skid(x, y, z, heading, length, strength) {
    const i = this.skidIdx;
    this.skidIdx = (i + 1) % SKID_POOL;

    _quat.setFromAxisAngle(_AXIS_Y, heading);
    _scale.set(SKID_WIDTH, 1, length);
    _pos.set(x, y + 0.03, z);
    _mat.compose(_pos, _quat, _scale);
    this.skids.setMatrixAt(i, _mat);

    const k = strength < 0 ? 0 : strength > 1 ? 1 : strength;
    _col.copy(_white).lerp(_dark, k);
    this.skids.setColorAt(i, _col);

    this.skids.instanceMatrix.needsUpdate = true;
    this.skids.instanceColor.needsUpdate = true;
  }
}
