import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const TEX = ['asphalt_02', 'concrete_pavement', 'brick_wall_001', 'white_stucco', 'painted_plaster_wall',
  'rectangular_facade_tiles', 'concrete_tile_facade', 'roof_09', 'coast_sand_01', 'concrete_floor_worn_001',
  'plastered_wall_04', 'corrugated_iron_02', 'container_side', 'sparse_grass', 'wood_planks_grey'];

const GEN = { vic: 10, fac: 16, ad: 9 };

// average colour of a patch of an image, as linear RGB (used to paint the side walls to match a facade photo)
function sampleColor(img, u, v, w, h) {
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const x = c.getContext('2d');
  x.drawImage(img, img.width * u, img.height * v, img.width * w, img.height * h, 0, 0, 8, 8);
  const d = x.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4, lin = (s) => Math.pow(s / n / 255, 2.2);
  return [lin(r), lin(g), lin(b)];
}

export async function loadAssets(renderer, onProgress, skyName = 'day') {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_u, done, total) => onProgress(done / total);
  const texLoader = new THREE.TextureLoader(manager);
  const gltf = new GLTFLoader(manager);
  const draco = new DRACOLoader(manager); draco.setDecoderPath('./vendor/draco/');
  gltf.setDRACOLoader(draco);
  const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());

  const tex = (url, srgb) => texLoader.loadAsync(url).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  });

  const A = { tex: {}, models: {} };
  const jobs = [];
  for (const n of TEX) {
    A.tex[n] = {};
    jobs.push(tex(`./assets/tex/${n}_diff.jpg`, true).then((t) => { A.tex[n].map = t; }));
    jobs.push(tex(`./assets/tex/${n}_nor.jpg`, false).then((t) => { A.tex[n].normalMap = t; }));
    jobs.push(tex(`./assets/tex/${n}_arm.jpg`, false).then((t) => { A.tex[n].arm = t; }));
  }
  jobs.push(tex('./assets/waternormals.jpg', false).then((t) => { A.waterNormals = t; }));
  jobs.push(texLoader.loadAsync('./assets/ferrari_ao.png').then((t) => { A.carShadow = t; }));
  jobs.push(new HDRLoader(manager).loadAsync(`./assets/sky_${skyName}_4k.hdr`).then((t) => { A.sky = t; }));
  jobs.push(gltf.loadAsync('./assets/ferrari.glb').then((g) => { A.models.car = g.scene; }));
  jobs.push(gltf.loadAsync('./assets/Soldier.glb').then((g) => { A.models.soldier = g; }));
  jobs.push(gltf.loadAsync('./assets/Michelle.glb').then((g) => { A.models.michelle = g; }).catch((e) => console.warn('michelle failed', e)));
  jobs.push(gltf.loadAsync('./assets/rpm.glb').then((g) => { A.models.rpm = g; }).catch((e) => console.warn('rpm failed', e)));
  for (const m of []) {
    jobs.push(gltf.loadAsync(`./assets/models/${m}/${m}.gltf`).then((g) => { A.models[m] = g.scene; }).catch((e) => console.warn('model failed', m, e)));
  }
  // AI-generated facade photos and billboards (assets/gen). Missing files are skipped.
  A.gen = { vic: [], fac: [], ad: [] };
  for (const k in GEN) for (let i = 0; i < GEN[k]; i++) {
    jobs.push(texLoader.loadAsync(`./assets/gen/${k}${i}.jpg`).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
      if (k === 'fac') t.wrapS = THREE.MirroredRepeatWrapping;      // mirrored tiling hides the seam between bays
      t.userData.wall = sampleColor(t.image, 0.54, 0.30, 0.08, 0.08);
      A.gen[k][i] = t;
    }).catch(() => {}));
  }
  await Promise.all(jobs);
  for (const k in A.gen) A.gen[k] = A.gen[k].filter(Boolean);
  return A;
}

// Find the sun in an equirect HDR and summarise the sky colours.
export function analyseSky(tex) {
  const { data, width, height } = tex.image;
  const ch = data.length / (width * height);
  const half = data instanceof Uint16Array;
  const val = half ? (v) => THREE.DataUtils.fromHalfFloat(v) : (v) => v;
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const i = (y * width + x) * ch;
    const l = val(data[i]) + val(data[i + 1]) + val(data[i + 2]);
    if (l > best) { best = l; bx = x; by = y; }
  }
  // three's equirect lookup: u = atan(dir.z, dir.x) / 2pi + 0.5, v = asin(dir.y) / pi + 0.5, and row 0 of the data is v = 0
  const u = (bx + 0.5) / width, v = (by + 0.5) / height;
  const phi = (u - 0.5) * Math.PI * 2;
  let theta = (v - 0.5) * Math.PI;
  const flipped = theta < 0;                 // sun must be above the horizon; if not, rows are stored top-down
  if (flipped) theta = -theta;
  const sunDir = new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi));
  const avg = (row0, row1) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = row0; y < row1; y += 2) for (let x = 0; x < width; x += 8) {
      const i = (y * width + x) * ch;
      r += Math.min(3, val(data[i])); g += Math.min(3, val(data[i + 1])); b += Math.min(3, val(data[i + 2])); n++;
    }
    return new THREE.Color(r / n, g / n, b / n);
  };
  const mid = Math.floor(height / 2), band = Math.floor(height * 0.025);
  const up = flipped ? [mid - band * 3, mid - band] : [mid + band, mid + band * 3];
  return { sunDir, horizon: avg(up[0], up[1]), peak: best };
}
