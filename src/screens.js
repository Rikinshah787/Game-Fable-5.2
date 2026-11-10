import * as THREE from 'three';
import { cityUniforms } from './city.js';

// Indices of adverts that also have a video file at assets/gen/ad<N>.mp4. A listed video replaces the still on every
// screen. Empty until clips exist, so nothing is requested that is not there.
const VIDEO_ADS = [];

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Big LED video wall: slow push-in on each advert, cross-fade to the next, visible pixel grid up close.
const FRAG = /* glsl */`
  uniform sampler2D tA, tB;
  uniform float uK, uTime, uGain;
  uniform vec2 uRes;
  varying vec2 vUv;
  vec2 push(vec2 uv, float k, float dir) { return (uv - 0.5) / (1.0 + 0.07 * k) + 0.5 + vec2(0.010 * dir * k, 0.0); }
  void main() {
    vec3 a = texture2D(tA, push(vUv, uK, 1.0)).rgb;
    vec3 b = texture2D(tB, push(vUv, 0.0, -1.0)).rgb;
    float w = smoothstep(0.90, 1.0, uK);
    // the new advert sweeps in from the left behind a bright leading edge
    float edge = w * 1.25 - 0.12;
    float m = smoothstep(edge + 0.02, edge - 0.02, vUv.x);
    vec3 col = mix(a, b, m);
    col += vec3(1.0, 0.95, 0.9) * exp(-pow((vUv.x - edge) * 26.0, 2.0)) * w * (1.0 - w) * 3.0;
    // LED modules: square emitters with dark gaps, dissolving to a flat panel once they are smaller than a pixel
    vec2 cell = fract(vUv * uRes) - 0.5;
    float led = smoothstep(0.5, 0.30, max(abs(cell.x), abs(cell.y)));
    float fw = max(fwidth(vUv.x * uRes.x), fwidth(vUv.y * uRes.y));
    led = mix(led, 0.74, smoothstep(0.25, 0.9, fw));
    float flicker = 1.0 + 0.025 * sin(uTime * 47.0 + vUv.y * 60.0);
    gl_FragColor = vec4(col * led * flicker * uGain, 1.0);
  }`;

export function buildScreens(A, scene, city) {
  const ads = (A.gen && A.gen.ad ? A.gen.ad : []).slice();
  if (!ads.length) return null;
  for (const i of VIDEO_ADS) {
    const v = document.createElement('video');
    v.src = `./assets/gen/ad${i}.mp4`; v.loop = true; v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous';
    v.addEventListener('canplay', () => { const t = new THREE.VideoTexture(v); t.colorSpace = THREE.SRGBColorSpace; ads[i] = t; v.play().catch(() => {}); }, { once: true });
  }
  const group = new THREE.Group();
  scene.add(group);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.5, metalness: 0.6 });

  // big-city blocks only: tall commercial buildings and the podiums at their feet
  const cand = city.buildings.filter((b) => !b.vic && !b.special && !b.base && (b.style === 'glass' || b.style === 'office') && b.x1 - b.x0 > 22 && b.z1 - b.z0 > 22);
  const count = Math.min(7, cand.length);
  for (let k = 0; k < count; k++) {
    const b = cand[Math.floor(((k + 0.5) / count) * cand.length)], blk = b.blk;
    // face whichever street the building stands closest to
    const side = [[b.z1, blk.z1 - b.z1, 0, 1, b.x1 - b.x0], [b.z0, b.z0 - blk.z0, 0, -1, b.x1 - b.x0], [b.x1, blk.x1 - b.x1, 1, 0, b.z1 - b.z0], [b.x0, b.x0 - blk.x0, -1, 0, b.z1 - b.z0]].sort((p, q) => p[1] - q[1])[0];
    const nx = side[2], nz = side[3], wall = side[4];
    const w = Math.min(19, wall - 3), h = w * 9 / 16, tall = b.h > h + 16;
    // on the wall if the building is tall enough, otherwise standing on its roof edge
    const cy = tall ? b.gy + Math.min(b.h - h / 2 - 3, 9 + h / 2 + (k % 3) * 4) : b.top + 1.4 + h / 2;
    const out = tall ? 0.45 : -0.7;
    const px = nx ? side[0] + nx * out : (b.x0 + b.x1) / 2, pz = nz ? side[0] + nz * out : (b.z0 + b.z1) / 2;
    const u = {
      tA: { value: ads[0] }, tB: { value: ads[0] }, uK: { value: 0 }, uTime: { value: 0 }, uGain: { value: 2.3 },
      uRes: { value: new THREE.Vector2(Math.round(w * 13), Math.round(h * 13)) },
    };
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG }));
    screen.position.set(px, cy, pz);
    screen.rotation.y = Math.atan2(nx, nz);
    const phase = k * 0.37, n = ads.length;
    screen.onBeforeRender = () => {
      const t = cityUniforms.uTime.value * 0.15 + phase, i = Math.floor(t) % n;
      u.tA.value = ads[i]; u.tB.value = ads[(i + 1) % n]; u.uK.value = t % 1; u.uTime.value = cityUniforms.uTime.value;
    };
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, h + 0.7, 0.5), frameMat);
    frame.position.set(px - nx * 0.3, cy, pz - nz * 0.3);
    frame.rotation.y = screen.rotation.y; frame.castShadow = true;
    group.add(screen, frame);
    if (!tall) for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.5), frameMat);
      post.position.set(px + (nz ? s * w * 0.3 : -nx * 0.3), b.top + 0.8, pz + (nx ? s * w * 0.3 : -nz * 0.3));
      group.add(post);
    }
  }
  return group;
}
