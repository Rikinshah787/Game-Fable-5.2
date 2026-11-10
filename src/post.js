import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Lens pass: works in linear HDR, before tone mapping.
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uAberration: { value: 0.0007 },
    uBoost: { value: 0 },
    uHit: { value: 0 },
    uFlash: { value: 0 },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uSunVis: { value: 0 },
    uDesat: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uAspect, uAberration, uBoost, uHit, uFlash, uSunVis, uDesat;
    uniform vec2 uSun;
    varying vec2 vUv;

    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

    vec3 sampleScene(vec2 uv) {
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      float ab = uAberration * (1.0 + uBoost * 3.0 + uHit * 4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * r2 * ab * 6.0).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * r2 * ab * 6.0).b;
      return col;
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      vec3 col = sampleScene(uv);

      // afterburner radial streaking
      if (uBoost > 0.01) {
        vec3 acc = col; float wsum = 1.0;
        float jitter = hash(uv * 800.0 + uTime);
        for (int i = 1; i <= 8; i++) {
          float t = (float(i) + jitter) / 8.0;
          float w = 1.0 - t * 0.6;
          acc += texture2D(tDiffuse, uv - c * t * 0.11 * uBoost * smoothstep(0.05, 0.6, length(c))).rgb * w;
          wsum += w;
        }
        col = acc / wsum;
      }

      // anamorphic sun flare + ghosts
      if (uSunVis > 0.001) {
        vec2 d = uv - uSun; d.x *= uAspect;
        float streak = exp(-abs(d.y) * 190.0) / (1.0 + d.x * d.x * 9.0);
        float halo = exp(-dot(d, d) * 14.0);
        vec3 flare = vec3(0.5, 0.65, 1.0) * streak * 0.10 + vec3(1.0, 0.72, 0.45) * halo * 0.10;
        vec2 axis = (vec2(0.5) - uSun);
        for (int i = 0; i < 4; i++) {
          float k = 0.55 + float(i) * 0.42;
          vec2 g = uv - (uSun + axis * k * 2.0); g.x *= uAspect;
          float rad = 0.022 + float(i) * 0.019;
          float ring = smoothstep(rad, rad * 0.82, length(g)) * (0.4 + 0.6 * smoothstep(rad * 0.3, rad, length(g)));
          vec3 tint = i == 0 ? vec3(0.3, 0.9, 1.0) : i == 1 ? vec3(1.0, 0.5, 0.3) : i == 2 ? vec3(0.5, 0.4, 1.0) : vec3(0.3, 1.0, 0.6);
          flare += tint * ring * 0.012;
        }
        col += flare * uSunVis;
      }

      // grade: gentle teal shadows / warm highlights
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(l), uDesat);
      col *= mix(vec3(0.96, 1.0, 1.05), vec3(1.04, 1.0, 0.96), smoothstep(0.0, 1.2, l));

      // vignette + damage pulse + white flash
      float v = smoothstep(1.05, 0.25, length(c * vec2(1.0, 0.82)) * 1.25);
      col *= mix(0.62, 1.0, v);
      col += vec3(1.0, 0.06, 0.04) * uHit * (1.0 - v) * 1.6;
      col += vec3(1.0, 0.95, 0.9) * uFlash;

      // film grain
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime) * 91.7) - 0.5;
      col += g * 0.018 * (0.25 + l);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.20, 0.5, 2.6);
  composer.addPass(bloom);

  const lens = new ShaderPass(LensShader);
  composer.addPass(lens);
  composer.addPass(new OutputPass());

  function setSize(w, h) {
    composer.setSize(w, h);
    bloom.resolution.set(w / 2, h / 2);
    lens.uniforms.uAspect.value = w / h;
  }
  setSize(size.x, size.y);

  return { composer, bloom, lens, setSize };
}
