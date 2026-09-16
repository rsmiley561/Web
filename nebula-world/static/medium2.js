// Phase 1b — the medium with authored cloud plates.
// Generated cloud plates (real alpha) form the walls, ceiling and columns of a corridor with
// true parallax. Raymarched mist fills the space between them and stops at their surfaces via
// an alpha-to-depth pre-pass. Warm pocket lights sit behind domes so the glow is backlit.
// Bloom, ordered dither, ACES. No data, no UI beyond tuning. Judged on the iPad.
import * as THREE from 'three';

const P = { mist: 0.16, mistScale: 0.02, grain: 0.7, absorb: 0.7, lightI: 18, falloff: 0.0012, g1: 0.6, g2: -0.3, gmix: 0.5, plate: 1.3, fog: 0.003, bloom: 0.55, threshold: 0.7, exposure: 1.05, steps: 48, drift: 1, scale2: 0.5 };
const hp = new URLSearchParams(location.hash.slice(1)); for (const k of Object.keys(P)) if (hp.has(k)) P[k] = Number(hp.get(k));
const writeHash = () => history.replaceState(null, '', '#' + Object.entries(P).filter(([k]) => k !== 'scale2').map(([k, v]) => k + '=' + (+v.toFixed(4))).join('&'));
const status = document.getElementById('status'); status.textContent = 'Opening the clouds…';

// ---------- corridor ---------------------------------------------------------------------------------
const pathAt = t => new THREE.Vector3(Math.sin(t * 0.9) * 70, Math.sin(t * 0.55) * 28, -t * 85);
const pathDir = t => pathAt(t + 0.02).sub(pathAt(t)).normalize();
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const LIGHTS = [1.6, 3.9, 6.3].map(t => { const c = pathAt(t), d = pathDir(t), side = new THREE.Vector3(-d.z, 0, d.x).normalize(); return c.addScaledVector(side, 46 * (rnd() < .5 ? 1 : -1)).add(new THREE.Vector3(0, 14 + rnd() * 10, 0)); });

// ---------- renderer / targets ------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({antialias: false, alpha: false, powerPreference: 'high-performance'});
renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping; renderer.autoClear = false;
document.getElementById('stage').appendChild(renderer.domElement);
const cam = new THREE.PerspectiveCamera(64, 1, 0.5, 900);
const quad = new THREE.PlaneGeometry(2, 2), ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const FOG = new THREE.Color(0.012, 0.034, 0.026);
let rtScene, rtVol, rtBright, rtBlurA, rtBlurB;
function makeTargets() {
  const w = innerWidth, h = innerHeight;
  rtScene?.dispose(); rtVol?.dispose(); rtBright?.dispose(); rtBlurA?.dispose(); rtBlurB?.dispose();
  rtScene = new THREE.WebGLRenderTarget(w, h, {type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType), depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter});
  const vw = Math.max(96, Math.round(w * P.scale2)), vh = Math.max(96, Math.round(h * P.scale2));
  rtVol = new THREE.WebGLRenderTarget(vw, vh, {type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter});
  const bw = Math.max(64, w >> 2), bh = Math.max(64, h >> 2); const o = {type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter};
  rtBright = new THREE.WebGLRenderTarget(bw, bh, o); rtBlurA = new THREE.WebGLRenderTarget(bw, bh, o); rtBlurB = new THREE.WebGLRenderTarget(bw, bh, o);
}

// ---------- plates ---------------------------------------------------------------------------------------
const loader = new THREE.TextureLoader();
const loadTex = url => new Promise((res, rej) => loader.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; res(t); }, undefined, rej));
const PLATE_VERT = /* glsl */`
  in float iTint; in float iFlip; out vec2 vUv; out vec3 vWorld; out float vTint;
  void main(){ vUv = vec2(iFlip > 0.5 ? 1.0 - uv.x : uv.x, uv.y); vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vWorld = w.xyz; vTint = iTint; gl_Position = projectionMatrix * viewMatrix * w; }`;
const PLATE_FRAG = /* glsl */`
  precision highp float; in vec2 vUv; in vec3 vWorld; in float vTint; out vec4 outColor;
  uniform sampler2D uMap; uniform vec3 uFog; uniform float uFogD, uBright, uFalloff, uLightI, uCut; uniform vec3 uCam; uniform vec3 uLights[3];
  void main(){
    vec4 c = texture(uMap, vUv);
    if (c.a < uCut) discard;
    float lit = 0.22;
    for (int i = 0; i < 3; i++) { float d = distance(vWorld, uLights[i]); lit += uLightI * 0.06 / (1.0 + d * d * uFalloff); }
    vec3 col = c.rgb * vTint * uBright * lit;
    float dist = distance(vWorld, uCam); float f = exp(-dist * uFogD);
    col = mix(uFog * 0.7, col, f);
    outColor = vec4(col, c.a);
  }`;
const plateScene = new THREE.Scene();
function plateMaterial(map, depthOnly) {
  return new THREE.ShaderMaterial({glslVersion: THREE.GLSL3, vertexShader: PLATE_VERT, fragmentShader: PLATE_FRAG, transparent: !depthOnly, depthWrite: depthOnly, depthTest: true, colorWrite: !depthOnly, side: THREE.DoubleSide,
    uniforms: {uMap: {value: map}, uFog: {value: FOG}, uFogD: {value: P.fog}, uBright: {value: P.plate}, uFalloff: {value: P.falloff}, uLightI: {value: P.lightI}, uCut: {value: depthOnly ? 0.42 : 0.01}, uCam: {value: new THREE.Vector3()}, uLights: {value: LIGHTS}}});
}
const plateMats = [];
function buildPlates(textures) {   // textures: {column, dome, ridge, overhang}
  const kinds = Object.keys(textures), placements = {column: [], dome: [], ridge: [], overhang: []};
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 64; i++) {
    const t = rnd() * 7.6 + 0.2, c = pathAt(t), d = pathDir(t), side = new THREE.Vector3(-d.z, 0, d.x).normalize();
    const ang = rnd() * Math.PI * 2, r = 44 + rnd() * 26;
    const pos = c.clone().addScaledVector(side, Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r * 0.85);
    const kind = Math.sin(ang) > 0.55 ? 'overhang' : Math.sin(ang) < -0.55 ? 'ridge' : rnd() < 0.55 ? 'column' : 'ridge';
    const normal = c.clone().sub(pos).normalize();                       // faces the corridor
    Q.setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, pos.clone().add(normal), up));
    const s = 58 + rnd() * 62; S.set(s, s, 1);
    placements[kind].push({m: new THREE.Matrix4().compose(pos, Q, S), tint: 0.8 + rnd() * 0.3, flip: rnd() < 0.5 ? 1 : 0});
  }
  // far domes: big, beyond the walls, one behind each light so the light is backlit
  for (const L of LIGHTS) { const pos = L.clone().add(new THREE.Vector3((rnd() - .5) * 20, -6, -22)); const normal = pathAt(3).sub(pos).normalize(); Q.setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, pos.clone().add(normal), up)); S.set(150, 150, 1); placements.dome.push({m: new THREE.Matrix4().compose(pos, Q, S), tint: 0.9, flip: 0}); }
  for (let i = 0; i < 6; i++) { const t = rnd() * 8, c = pathAt(t); const pos = c.clone().add(new THREE.Vector3((rnd() - .5) * 260, (rnd() - .5) * 120, (rnd() - .5) * 60 - 90)); const normal = c.sub(pos).normalize(); Q.setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, pos.clone().add(normal), up)); const s = 160 + rnd() * 120; S.set(s, s, 1); placements.dome.push({m: new THREE.Matrix4().compose(pos, Q, S), tint: 0.55 + rnd() * 0.2, flip: rnd() < .5 ? 1 : 0}); }
  const geo = new THREE.PlaneGeometry(1, 1);
  for (const kind of kinds) {
    const list = placements[kind]; if (!list.length) continue;
    for (const depthOnly of [true, false]) {
      const mat = plateMaterial(textures[kind], depthOnly); plateMats.push(mat);
      const mesh = new THREE.InstancedMesh(geo, mat, list.length); mesh.frustumCulled = false; mesh.renderOrder = depthOnly ? 0 : 1;
      const tint = new Float32Array(list.length), flip = new Float32Array(list.length);
      list.forEach((p, i) => { mesh.setMatrixAt(i, p.m); tint[i] = p.tint; flip[i] = p.flip; });
      mesh.geometry = geo.clone(); mesh.geometry.setAttribute('iTint', new THREE.InstancedBufferAttribute(tint, 1)); mesh.geometry.setAttribute('iFlip', new THREE.InstancedBufferAttribute(flip, 1));
      mesh.instanceMatrix.needsUpdate = true; plateScene.add(mesh);
    }
  }
}

// ---------- mist (raymarched, depth-clipped) --------------------------------------------------------------
const VERT = /* glsl */`out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const MIST = /* glsl */`
precision highp float; precision highp sampler3D; in vec2 vUv; out vec4 outColor;
uniform sampler3D uNoise; uniform sampler2D uGrain, uDepth; uniform float uTime, uNear, uFar, uTanHalfFov, uAspect;
uniform vec3 uCamPos, uCamFwd, uCamRight, uCamUp, uFog, uLights[3];
uniform float uMist, uMistScale, uGrainK, uAbsorb, uLightI, uFalloff, uG1, uG2, uGmix, uDrift; uniform int uSteps;
float hg(float c, float g){ float g2 = g*g; return (1.0 - g2) / (4.0*3.14159265 * pow(1.0 + g2 - 2.0*g*c, 1.5)); }
float ign(vec2 p){ return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y)); }
float grain(vec3 p){ vec3 n = vec3(0.5); // triplanar sample of the authored tile
  float x = texture(uGrain, p.yz * 0.016).r, y = texture(uGrain, p.xz * 0.016).r, z = texture(uGrain, p.xy * 0.016).r; return (x + y + z) / 3.0; }
float mist(vec3 p){
  vec3 q = p * uMistScale + vec3(0.02, 0.01, 0.015) * uTime * uDrift;
  float base = texture(uNoise, q).r; float clump = texture(uNoise, q * 0.31 + vec3(0.4)).b;
  float d = smoothstep(0.58, 0.90, base * 0.6 + clump * 0.5);          // mostly clear; wisps where the noise peaks
  d *= mix(1.0, grain(p) * 1.6, uGrainK);
  return d * uMist;
}
void main(){
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uCamFwd + uCamRight * ndc.x * uTanHalfFov * uAspect + uCamUp * ndc.y * uTanHalfFov);
  float z = texture(uDepth, vUv).r;                                   // where the plates are
  float ndcZ = z * 2.0 - 1.0; float viewZ = (2.0 * uNear * uFar) / ((uFar - uNear) * ndcZ - (uFar + uNear));
  float tHit = z >= 0.9999 ? 600.0 : -viewZ / max(dot(rd, uCamFwd), 0.05);
  float T = 1.0; vec3 col = vec3(0.0);
  float t = 0.6 + ign(gl_FragCoord.xy) * 1.2;
  for (int i = 0; i < 96; i++) {
    if (i >= uSteps || t > tHit) break;
    float dt = max(1.2, t * 0.055);
    vec3 p = uCamPos + rd * t;
    float d = mist(p);
    if (d > 0.003) {
      vec3 S = uFog * 0.55 * d;
      for (int k = 0; k < 3; k++) {
        vec3 L = uLights[k] - p; float dl = length(L); L /= dl;
        float sh = mist(p + L * 4.0) + mist(p + L * 10.0);
        float phase = mix(hg(dot(rd, L), uG1), hg(dot(rd, L), uG2), uGmix);
        S += vec3(1.0, 0.93, 0.78) * (uLightI / (1.0 + dl * dl * uFalloff)) * exp(-sh * 3.0 * uAbsorb) * phase * vec3(0.45, 0.85, 0.66) * d;
      }
      float sigma = d * uAbsorb; float stepT = exp(-sigma * dt);
      col += T * (S - S * stepT) / max(sigma, 1e-4); T *= stepT;
      if (T < 0.03) break;
    }
    t += dt;
  }
  // the lights themselves, seen through whatever mist remains, only if not behind a plate
  for (int k = 0; k < 3; k++) { vec3 toL = uLights[k] - uCamPos; float dl = length(toL); if (dl < tHit) { float a = max(dot(rd, toL / dl), 0.0); col += T * vec3(1.0, 0.93, 0.78) * pow(a, 900.0) * uLightI * 0.35; } }
  outColor = vec4(col, T);
}`;
const COMPOSE = /* glsl */`
precision highp float; in vec2 vUv; out vec4 outColor; uniform sampler2D uScene, uVol, uBloom, uDepthDbg; uniform vec3 uFog; uniform float uExposure, uBloomK; uniform int uDebug;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
void main(){
  vec4 s = texture(uScene, vUv); vec4 v = texture(uVol, vUv);
  vec3 back = mix(uFog * 0.5, s.rgb, s.a);                            // plates over the deep fog colour
  vec3 c = back * v.a + v.rgb + texture(uBloom, vUv).rgb * uBloomK;
  if (uDebug == 1) c = back; else if (uDebug == 2) c = v.rgb + vec3(v.a) * 0.15; else if (uDebug == 3) { float z = texture(uDepthDbg, vUv).r; c = vec3(z >= 0.9999 ? 0.0 : 1.0 - pow(z, 40.0)); }
  c *= uExposure; c = aces(c);
  float vg = smoothstep(1.55, 0.4, length(vUv - 0.5)); c *= 0.84 + 0.16 * vg;
  outColor = vec4(pow(c, vec3(1.0/2.2)), 1.0);
}`;
const BRIGHT = /* glsl */`precision highp float; in vec2 vUv; out vec4 outColor; uniform sampler2D uScene, uVol; uniform float uThr; uniform vec3 uFog;
void main(){ vec4 s = texture(uScene, vUv); vec4 v = texture(uVol, vUv); vec3 c = mix(uFog*0.5, s.rgb, s.a) * v.a + v.rgb; float l = dot(c, vec3(0.3, 0.59, 0.11)); outColor = vec4(c * smoothstep(uThr, uThr + 0.6, l), 1.0); }`;
const BLUR = /* glsl */`precision highp float; in vec2 vUv; out vec4 outColor; uniform sampler2D uTex; uniform vec2 uDir;
void main(){ vec3 c = vec3(0.0); float w[5] = float[](0.227, 0.194, 0.121, 0.054, 0.016); c += texture(uTex, vUv).rgb * w[0]; for (int i = 1; i < 5; i++) { c += texture(uTex, vUv + uDir * float(i)).rgb * w[i]; c += texture(uTex, vUv - uDir * float(i)).rgb * w[i]; } outColor = vec4(c, 1.0); }`;

// ---------- small 3D noise for mist clumps -----------------------------------------------------------------
function bakeNoise(N = 40) {
  const data = new Uint8Array(N * N * N * 4); const hash = (x, y, z, s) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1103515245) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const sm = t => t * t * (3 - 2 * t); const value = (x, y, z, Pd, s) => { const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi); const H = (a, b, c) => hash(((xi + a) % Pd + Pd) % Pd, ((yi + b) % Pd + Pd) % Pd, ((zi + c) % Pd + Pd) % Pd, s); const l = (a, b, t) => a + (b - a) * t; return l(l(l(H(0,0,0), H(1,0,0), xf), l(H(0,1,0), H(1,1,0), xf), yf), l(l(H(0,0,1), H(1,0,1), xf), l(H(0,1,1), H(1,1,1), xf), yf), zf); };
  const fbm = (u, v, w, s, base, oct) => { let a = .5, f = base, sum = 0, norm = 0; for (let o = 0; o < oct; o++) { sum += a * value(u * f, v * f, w * f, f, s + o * 7); norm += a; a *= .5; f *= 2; } return sum / norm; };
  let i = 0; for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const u = x / N, v = y / N, w = z / N; data[i++] = fbm(u, v, w, 1, 2, 4) * 255; data[i++] = 0; data[i++] = fbm(u, v, w, 9, 3, 3) * 255; data[i++] = 255; }
  const t = new THREE.Data3DTexture(data, N, N, N); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}

// ---------- assemble --------------------------------------------------------------------------------------
const [column, dome, ridge, overhang, grain] = await Promise.all(['column', 'dome', 'ridge', 'overhang'].map(k => loadTex(`assets/plate-${k}.png`)).concat([loadTex('assets/tile-a.png')]));
grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.colorSpace = THREE.NoColorSpace;
buildPlates({column, dome, ridge, overhang});
const noise = bakeNoise(40);
const mistMat = new THREE.ShaderMaterial({glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: MIST, depthTest: false, depthWrite: false, uniforms: {
  uNoise: {value: noise}, uGrain: {value: grain}, uDepth: {value: null}, uTime: {value: 0}, uNear: {value: cam.near}, uFar: {value: cam.far}, uTanHalfFov: {value: Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))}, uAspect: {value: 1},
  uCamPos: {value: new THREE.Vector3()}, uCamFwd: {value: new THREE.Vector3()}, uCamRight: {value: new THREE.Vector3()}, uCamUp: {value: new THREE.Vector3()}, uFog: {value: FOG}, uLights: {value: LIGHTS},
  uMist: {value: P.mist}, uMistScale: {value: P.mistScale}, uGrainK: {value: P.grain}, uAbsorb: {value: P.absorb}, uLightI: {value: P.lightI}, uFalloff: {value: P.falloff}, uG1: {value: P.g1}, uG2: {value: P.g2}, uGmix: {value: P.gmix}, uDrift: {value: P.drift}, uSteps: {value: P.steps}}});
const composeMat = new THREE.ShaderMaterial({glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: COMPOSE, depthTest: false, depthWrite: false, uniforms: {uScene: {value: null}, uVol: {value: null}, uBloom: {value: null}, uDepthDbg: {value: null}, uFog: {value: FOG}, uExposure: {value: P.exposure}, uBloomK: {value: P.bloom}, uDebug: {value: Number(hp.get('debug') || 0)}}});
const brightMat = new THREE.ShaderMaterial({glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: BRIGHT, depthTest: false, depthWrite: false, uniforms: {uScene: {value: null}, uVol: {value: null}, uThr: {value: P.threshold}, uFog: {value: FOG}}});
const blurMat = new THREE.ShaderMaterial({glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: BLUR, depthTest: false, depthWrite: false, uniforms: {uTex: {value: null}, uDir: {value: new THREE.Vector2()}}});
const pass = mat => { const s = new THREE.Scene(); s.add(new THREE.Mesh(quad, mat)); return s; };
const mistScene = pass(mistMat), composeScene = pass(composeMat), brightScene = pass(brightMat), blurScene = pass(blurMat);
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px'; cam.aspect = w / h; cam.updateProjectionMatrix(); mistMat.uniforms.uAspect.value = w / h; makeTargets(); }
addEventListener('resize', resize); resize();

// ---------- fly camera with corridor drift ------------------------------------------------------------------
const fly = {yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, vel: new THREE.Vector3(), pos: pathAt(0.15).add(new THREE.Vector3(0, 2, 0)), lastInput: performance.now(), auto: true, tFollow: 0.15};
const el = renderer.domElement; let drag = null, pinch = null; const touched = () => { fly.lastInput = performance.now(); };
el.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') return; drag = {x: e.clientX, y: e.clientY}; touched(); });
addEventListener('pointermove', e => { if (!drag) return; fly.vyaw -= (e.clientX - drag.x) * 0.0018; fly.vpitch -= (e.clientY - drag.y) * 0.0018; drag = {x: e.clientX, y: e.clientY}; touched(); });
addEventListener('pointerup', () => drag = null);
el.addEventListener('wheel', e => { e.preventDefault(); fly.vel.addScaledVector(forward(), -e.deltaY * 0.02); touched(); }, {passive: false});
el.addEventListener('touchstart', e => { touched(); if (e.touches.length === 1) drag = {x: e.touches[0].clientX, y: e.touches[0].clientY}; else if (e.touches.length === 2) { drag = null; pinch = dist(e.touches); } }, {passive: true});
el.addEventListener('touchmove', e => { e.preventDefault(); touched(); if (e.touches.length === 1 && drag) { const t = e.touches[0]; fly.vyaw -= (t.clientX - drag.x) * 0.0011; fly.vpitch -= (t.clientY - drag.y) * 0.0011; drag = {x: t.clientX, y: t.clientY}; } else if (e.touches.length === 2 && pinch != null) { const d = dist(e.touches); fly.vel.addScaledVector(forward(), (d - pinch) * 0.022); pinch = d; } }, {passive: false});
el.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; if (!e.touches.length) drag = null; });
const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const keys = new Set(); addEventListener('keydown', e => { keys.add(e.key.toLowerCase()); touched(); }); addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
function forward() { return new THREE.Vector3(-Math.sin(fly.yaw) * Math.cos(fly.pitch), Math.sin(fly.pitch), -Math.cos(fly.yaw) * Math.cos(fly.pitch)); }
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
function stepFly(dt) {
  const f = forward(), r = new THREE.Vector3(f.z, 0, -f.x).normalize(), u = new THREE.Vector3().crossVectors(r, f), a = 22 * dt;
  if (keys.has('w') || keys.has('arrowup')) fly.vel.addScaledVector(f, a); if (keys.has('s') || keys.has('arrowdown')) fly.vel.addScaledVector(f, -a);
  if (keys.has('a')) fly.vel.addScaledVector(r, -a); if (keys.has('d')) fly.vel.addScaledVector(r, a); if (keys.has('q')) fly.vel.addScaledVector(u, -a); if (keys.has('e')) fly.vel.addScaledVector(u, a);
  if (fly.auto && performance.now() - fly.lastInput > 2500) {        // idle: glide down the corridor
    fly.tFollow = Math.min(7.6, fly.tFollow + dt * 0.022);
    const target = pathAt(fly.tFollow + 0.35), to = target.clone().sub(fly.pos), d = to.length(); to.normalize();
    fly.vel.addScaledVector(to, Math.min(3.0, d * 0.08) * dt * 4.0);
    const wantYaw = Math.atan2(-to.x, -to.z), wantPitch = Math.asin(THREE.MathUtils.clamp(to.y, -1, 1)) * 0.6;
    fly.vyaw += wrapAngle(wantYaw - fly.yaw) * 0.22 * dt; fly.vpitch += (wantPitch - fly.pitch) * 0.22 * dt;
  }
  fly.yaw += fly.vyaw; fly.pitch = THREE.MathUtils.clamp(fly.pitch + fly.vpitch, -1.3, 1.3); fly.vyaw *= Math.pow(0.05, dt); fly.vpitch *= Math.pow(0.05, dt);
  if (fly.vel.length() > 40) fly.vel.setLength(40); fly.pos.addScaledVector(fly.vel, dt); fly.vel.multiplyScalar(Math.pow(0.10, dt));
}

// ---------- loop --------------------------------------------------------------------------------------------
const clock = new THREE.Clock(); let time = 0, frames = 0, acc = 0, fps = 0, paused = false;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta()); if (!paused) time += dt; stepFly(dt);
  const f = forward(), r = new THREE.Vector3(f.z, 0, -f.x).normalize(), u = new THREE.Vector3().crossVectors(r, f);
  cam.position.copy(fly.pos); cam.lookAt(fly.pos.clone().add(f)); cam.updateMatrixWorld();
  for (const m of plateMats) m.uniforms.uCam.value.copy(fly.pos);
  const mu = mistMat.uniforms; mu.uCamPos.value.copy(fly.pos); mu.uCamFwd.value.copy(f); mu.uCamRight.value.copy(r); mu.uCamUp.value.copy(u); mu.uTime.value = time; mu.uDepth.value = rtScene.depthTexture;
  renderer.setRenderTarget(rtScene); renderer.setClearColor(0x000000, 0); renderer.clear(true, true, false); renderer.render(plateScene, cam);
  renderer.setRenderTarget(rtVol); renderer.clear(); renderer.render(mistScene, ortho);
  brightMat.uniforms.uScene.value = rtScene.texture; brightMat.uniforms.uVol.value = rtVol.texture; renderer.setRenderTarget(rtBright); renderer.render(brightScene, ortho);
  blurMat.uniforms.uTex.value = rtBright.texture; blurMat.uniforms.uDir.value.set(1 / rtBright.width, 0); renderer.setRenderTarget(rtBlurA); renderer.render(blurScene, ortho);
  blurMat.uniforms.uTex.value = rtBlurA.texture; blurMat.uniforms.uDir.value.set(0, 1 / rtBright.height); renderer.setRenderTarget(rtBlurB); renderer.render(blurScene, ortho);
  composeMat.uniforms.uScene.value = rtScene.texture; composeMat.uniforms.uVol.value = rtVol.texture; composeMat.uniforms.uBloom.value = rtBlurB.texture; composeMat.uniforms.uDepthDbg.value = rtScene.depthTexture; renderer.setRenderTarget(null); renderer.render(composeScene, ortho);
  acc += dt; frames++;
  if (acc >= 1) { fps = Math.round(frames / acc); frames = 0; acc = 0;
    if (fps < 26 && P.scale2 > 0.3) { P.scale2 = Math.max(0.3, P.scale2 - 0.08); makeTargets(); } else if (fps > 52 && P.scale2 < 0.75) { P.scale2 = Math.min(0.75, P.scale2 + 0.05); makeTargets(); }
    status.textContent = `${fps} fps · ${Math.round(P.scale2 * 100)}% · ${P.steps} steps`; }
}
requestAnimationFrame(loop);

// ---------- tuning ---------------------------------------------------------------------------------------------
const SL = [['mist', 0, 2, 0.05], ['mistScale', 0.005, 0.06, 0.001], ['grain', 0, 1, 0.05], ['absorb', 0.2, 3, 0.05], ['lightI', 0, 60, 1], ['falloff', 0.0002, 0.006, 0.0001], ['g1', 0, 0.9, 0.02], ['g2', -0.9, 0, 0.02], ['gmix', 0, 1, 0.05], ['plate', 0.2, 2.5, 0.05], ['fog', 0, 0.012, 0.0002], ['bloom', 0, 2, 0.05], ['threshold', 0.2, 1.5, 0.05], ['exposure', 0.4, 2.5, 0.05], ['steps', 24, 96, 4], ['drift', 0, 2, 0.1]];
const panel = document.getElementById('tune');
panel.innerHTML = SL.map(([k, a, b, s]) => `<label><span>${k}</span><input type="range" name="${k}" min="${a}" max="${b}" step="${s}" value="${P[k]}"><output>${P[k]}</output></label>`).join('') + `<button id="reset" type="button">Reset</button><button id="copy" type="button">Copy settings</button>`;
panel.oninput = e => { const k = e.target.name; if (!k) return; P[k] = Number(e.target.value); e.target.nextElementSibling.textContent = P[k];
  const U = {mist: 'uMist', mistScale: 'uMistScale', grain: 'uGrainK', absorb: 'uAbsorb', lightI: 'uLightI', falloff: 'uFalloff', g1: 'uG1', g2: 'uG2', gmix: 'uGmix', drift: 'uDrift', steps: 'uSteps'};
  if (U[k]) mistMat.uniforms[U[k]].value = k === 'steps' ? Math.round(P[k]) : P[k];
  if (k === 'lightI' || k === 'falloff' || k === 'plate' || k === 'fog') for (const m of plateMats) { m.uniforms.uLightI.value = P.lightI; m.uniforms.uFalloff.value = P.falloff; m.uniforms.uBright.value = P.plate; m.uniforms.uFogD.value = P.fog; }
  if (k === 'exposure') composeMat.uniforms.uExposure.value = P[k]; if (k === 'bloom') composeMat.uniforms.uBloomK.value = P[k]; if (k === 'threshold') brightMat.uniforms.uThr.value = P[k]; writeHash(); };
document.getElementById('reset').onclick = () => { location.hash = ''; location.reload(); };
document.getElementById('copy').onclick = () => { navigator.clipboard?.writeText(location.href); status.textContent = 'Settings link copied'; };
document.getElementById('tune-toggle').onclick = () => panel.classList.toggle('open');
document.getElementById('pause').onclick = e => { paused = !paused; fly.auto = !paused; e.target.textContent = paused ? 'Resume' : 'Pause'; };
writeHash();
window.MEDIUM = {get fps() { return fps; }, get scale() { return P.scale2; }, P, pos: () => fly.pos.toArray(), renderer};
