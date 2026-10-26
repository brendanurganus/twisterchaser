// The storm: funnel, debris cloud, wall cloud and cloud deck, drawn with three.js
// inside MapLibre's own WebGL context (a "custom layer") so the terrain hides
// the funnel correctly and the camera is always MapLibre's camera.
//
// Scene axes: x = east, y = up (metres above sea level), z = south.
// Everything is procedural, with no textures to download.

import * as THREE from '../vendor/three/three.module.js';
import { CLOUD_BASE_M, WALL_BASE_M, LITE, REDUCED_MOTION } from './config.js';
import { clamp } from './geo.js';

const GLSL_NOISE = /* glsl */ `
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < OCT; i++) { v += a*vnoise(p); p = p*2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return v;
}
// Noise that tiles in x with the given integer period, so it wraps cleanly round a cylinder.
float pnoise(vec2 p, float per){
  vec2 i = floor(p), f = fract(p), u = f*f*(3.0-2.0*f);
  float x0 = mod(i.x, per), x1 = mod(i.x + 1.0, per);
  return mix(mix(hash(vec2(x0, i.y)), hash(vec2(x1, i.y)), u.x), mix(hash(vec2(x0, i.y+1.0)), hash(vec2(x1, i.y+1.0)), u.x), u.y);
}
float pfbm(vec2 p, float per){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < OCT; i++) { v += a*pnoise(p, per); p = p*vec2(2.0, 2.03) + vec2(0.0, 9.3); per *= 2.0; a *= 0.5; }
  return v;
}
`;

// ---- funnel ---------------------------------------------------------------
const FUNNEL_VS = /* glsl */ `
uniform float uTime, uH, uBaseR, uTopR, uSway;
uniform vec2 uLean;
attribute float aV;   // 0 at the ground, 1 at the cloud
attribute float aA;   // angle round the funnel
varying vec3 vW; varying vec3 vN; varying vec2 vUv;
void main(){
  float v = aV;
  float r = mix(uBaseR, uTopR, pow(v, 2.3));
  r *= 1.0 + 0.07*sin(uTime*1.9 + v*8.0 + aA*3.0);
  vec2 off = uLean*pow(v, 1.7)
           + uSway*vec2(sin(uTime*0.8 + v*3.4), cos(uTime*0.62 + v*2.6))*(uBaseR*0.35 + 5.0)*v;
  vec3 radial = vec3(cos(aA), 0.0, sin(aA));
  vec3 p = vec3(off.x, v*uH, off.y) + radial*r;
  float slope = (uTopR - uBaseR)*2.3*pow(v, 1.3)/uH;
  vN = normalize(radial + vec3(0.0, -slope, 0.0));
  vUv = vec2(aA/6.2831853, v);
  vec4 wp = modelMatrix*vec4(p, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`;
const FUNNEL_FS = /* glsl */ `
uniform float uTime, uVis;
uniform vec3 uCam, uFog;
uniform float uFogDens;
varying vec3 vW; varying vec3 vN; varying vec2 vUv;
${GLSL_NOISE}
void main(){
  float v = vUv.y, ang = vUv.x*6.2831853;
  vec3 V = normalize(uCam - vW);
  float ndv = abs(dot(normalize(vN), V));
  float spin = uTime*(1.5 - v*0.9);
  float u = vUv.x;
  float n = pfbm(vec2(u*4.0 + spin + v*5.0, v*4.0 - uTime*0.3), 4.0);
  float streak = pfbm(vec2(u*12.0 + spin*1.6, v*15.0), 12.0);
  float tone = clamp(n*0.95 + streak*0.55 - 0.18 + v*0.08, 0.0, 1.0);
  vec3 col = mix(vec3(0.11,0.115,0.125), vec3(0.64,0.655,0.67), tone);
  col = mix(col*0.5, col, smoothstep(0.1, 0.9, ndv));
  col *= mix(1.0, 0.5, smoothstep(0.65, 1.0, v));           // darker where it meets the wall cloud
  float a = smoothstep(0.0, 0.5, ndv)*(0.62 + 0.38*n);
  a *= 0.25 + 0.75*smoothstep(0.0, 0.1, v);                 // soften into the debris cloud
  float d = length(uCam - vW);
  float f = 1.0 - exp(-d*uFogDens);
  col = mix(col, uFog, f*0.85);
  gl_FragColor = vec4(col, a*uVis);
}`;

// ---- debris / dust cloud ---------------------------------------------------
const DEBRIS_VS = /* glsl */ `
uniform float uTime, uD, uBaseR;
attribute float aV; attribute float aA;
varying vec3 vW; varying vec3 vN; varying vec2 vUv;
void main(){
  float v = aV;
  float r = uBaseR*(1.05 + 2.4*pow(1.0 - v, 2.2)) + 6.0;
  r *= 1.0 + 0.18*sin(uTime*0.9 + aA*4.0 + v*3.0) + 0.1*sin(uTime*1.7 + aA*9.0);
  vec3 radial = vec3(cos(aA), 0.0, sin(aA));
  vec3 p = radial*r + vec3(0.0, v*uD, 0.0);
  vN = normalize(radial + vec3(0.0, 0.7, 0.0));
  vUv = vec2(aA/6.2831853, v);
  vec4 wp = modelMatrix*vec4(p, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`;
const DEBRIS_FS = /* glsl */ `
uniform float uTime, uVis;
uniform vec3 uCam, uFog;
uniform float uFogDens;
varying vec3 vW; varying vec3 vN; varying vec2 vUv;
${GLSL_NOISE}
void main(){
  float v = vUv.y, ang = vUv.x*6.2831853;
  vec3 V = normalize(uCam - vW);
  float ndv = abs(dot(normalize(vN), V));
  float swirl = uTime*1.1;
  float n = pfbm(vec2(vUv.x*6.0 + swirl + v*2.0, v*3.5 - uTime*0.25), 6.0);
  vec3 col = mix(vec3(0.17,0.145,0.12), vec3(0.42,0.37,0.31), n);
  float a = (0.18 + 0.7*n)*smoothstep(0.0, 0.5, ndv)*(1.0 - smoothstep(0.35, 1.0, v));
  a *= smoothstep(0.0, 0.04, v);
  float d = length(uCam - vW);
  col = mix(col, uFog, (1.0 - exp(-d*uFogDens))*0.8);
  gl_FragColor = vec4(col, a*uVis);
}`;

// ---- wall cloud (the lowering the funnel hangs from) -----------------------
const WALL_VS = /* glsl */ `
uniform vec3 uScale;
varying vec3 vW; varying vec3 vN; varying vec3 vL;
void main(){
  vL = position;
  vN = normalize(normal/uScale);
  vec4 wp = modelMatrix*vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`;
const WALL_FS = /* glsl */ `
uniform float uTime, uVis;
uniform vec3 uCam, uFog;
uniform float uFogDens;
varying vec3 vW; varying vec3 vN; varying vec3 vL;
${GLSL_NOISE}
void main(){
  float r = length(vL.xz), ang = atan(vL.z, vL.x);
  vec3 V = normalize(uCam - vW);
  float ndv = abs(dot(normalize(vN), V));
  float u = ang/6.2831853 + 0.5;
  float n = pfbm(vec2(u*8.0 + uTime*0.15 + r*3.75, vL.y*5.25 + r*3.0), 8.0);
  float m = pfbm(vec2(u*24.0 + uTime*0.4 + r*10.0, vL.y*14.0 + r*8.0 + 3.1), 24.0);
  vec3 col = mix(vec3(0.035,0.04,0.05), vec3(0.2,0.21,0.235), clamp(n*0.8 + m*0.35 - 0.1, 0.0, 1.0));
  col *= mix(0.65, 1.15, ndv);
  float a = 0.93*smoothstep(0.0, 0.3, ndv);
  float d = length(uCam - vW);
  col = mix(col, uFog, (1.0 - exp(-d*uFogDens))*0.7);
  gl_FragColor = vec4(col, a*uVis);
}`;

// ---- cloud deck ------------------------------------------------------------
const DECK_VS = /* glsl */ `
varying vec3 vW; varying vec2 vLocal;
void main(){
  vLocal = position.xz;
  vec4 wp = modelMatrix*vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`;
const DECK_FS = /* glsl */ `
uniform float uTime, uRadius, uVis;
uniform vec3 uHorizon;
varying vec3 vW; varying vec2 vLocal;
${GLSL_NOISE}
void main(){
  vec2 p = vW.xz*0.00022 + vec2(uTime*0.004, uTime*0.0027);
  float n = fbm(p);
  float n2 = fbm(p*3.3 + 7.3);
  float e = 0.03;
  float dx = fbm(p + vec2(e, 0.0)) - n, dz = fbm(p + vec2(0.0, e)) - n;
  vec3 N = normalize(vec3(-dx*16.0, -1.0, -dz*16.0));        // underside, bumpy
  float lit = clamp(dot(N, normalize(vec3(-0.55, -0.45, 0.45)))*0.5 + 0.5, 0.0, 1.0);
  float tone = clamp(n*0.62 + n2*0.38 + (lit - 0.5)*0.4, 0.0, 1.0);
  vec3 col = mix(vec3(0.06,0.068,0.082), vec3(0.2,0.21,0.235), smoothstep(0.3, 0.8, tone));
  float d = length(vLocal);
  col = mix(col, uHorizon, smoothstep(0.18*uRadius, uRadius, d)*0.72);
  float a = 0.98*(1.0 - smoothstep(0.7*uRadius, uRadius, d));
  gl_FragColor = vec4(col, a*uVis);
}`;

function gridGeometry(rows, segs) {
  const n = (rows + 1) * (segs + 1);
  const aV = new Float32Array(n), aA = new Float32Array(n), pos = new Float32Array(n * 3);
  let k = 0;
  for (let r = 0; r <= rows; r++) {
    for (let s = 0; s <= segs; s++, k++) { aV[k] = r / rows; aA[k] = (s / segs) * Math.PI * 2; }
  }
  const idx = [];
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * (segs + 1) + s, b = a + 1, c = a + segs + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aV', new THREE.BufferAttribute(aV, 1));
  g.setAttribute('aA', new THREE.BufferAttribute(aA, 1));
  g.setIndex(idx);
  return g;
}

export class StormLayer {
  constructor({ frame }) {
    this.id = 'storm';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.frame = frame;
    this.s = { visible: false, x: 0, y: 0, ground: 0, baseR: 30, topR: 90, leanX: 0, leanZ: 0, vis: 1 };
    this.t0 = performance.now();
    this.camY = 0;
    this.sway = REDUCED_MOTION ? 0.3 : 1;
  }

  // Called every frame by the app. x, y in local metres (east, north).
  update(state) { Object.assign(this.s, state); }

  onAdd(map, gl) {
    this.map = map;
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: false });
    this.renderer.autoClear = false;

    const defines = { OCT: LITE ? 3 : 5 };
    this.u = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uFog: { value: new THREE.Color(0.27, 0.285, 0.29) },
      uFogDens: { value: 0.00004 },
      uVis: { value: 1 },
    };
    const mk = (vs, fs, extra) => new THREE.ShaderMaterial({
      vertexShader: vs, fragmentShader: fs, defines,
      uniforms: { ...this.u, ...extra },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });

    this.group = new THREE.Group();
    this.scene.add(this.group);

    // funnel
    this.funnelU = {
      uH: { value: WALL_BASE_M }, uBaseR: { value: 30 }, uTopR: { value: 90 },
      uLean: { value: new THREE.Vector2() }, uSway: { value: 1 },
    };
    this.funnel = new THREE.Mesh(gridGeometry(LITE ? 18 : 40, LITE ? 20 : 44), mk(FUNNEL_VS, FUNNEL_FS, this.funnelU));
    this.funnel.renderOrder = 3;

    // debris cloud
    this.debrisU = { uD: { value: 120 }, uBaseR: { value: 30 } };
    this.debris = new THREE.Mesh(gridGeometry(LITE ? 6 : 12, LITE ? 24 : 40), mk(DEBRIS_VS, DEBRIS_FS, this.debrisU));
    this.debris.renderOrder = 4;

    // wall cloud: lower half of an ellipsoid hanging from the deck
    this.wallU = { uScale: { value: new THREE.Vector3(1900, CLOUD_BASE_M - WALL_BASE_M, 1900) } };
    this.wall = new THREE.Mesh(
      new THREE.SphereGeometry(1, LITE ? 32 : 56, LITE ? 10 : 18, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      mk(WALL_VS, WALL_FS, this.wallU));
    this.wall.renderOrder = 2;

    // cloud deck
    this.deckU = { uRadius: { value: LITE ? 28000 : 42000 }, uHorizon: { value: new THREE.Color(0.42, 0.41, 0.34) } };
    const deckGeo = new THREE.CircleGeometry(this.deckU.uRadius.value, LITE ? 64 : 128);
    deckGeo.rotateX(Math.PI / 2); // flat in the x-z plane
    this.deck = new THREE.Mesh(deckGeo, mk(DECK_VS, DECK_FS, this.deckU));
    this.deck.renderOrder = 1;
    this.deckVis = { value: 1 };
    this.deck.material.uniforms.uVis = this.deckVis;
    this.wallVis = { value: 1 };
    this.wall.material.uniforms.uVis = this.wallVis;

    this.group.add(this.funnel, this.debris);
    this.scene.add(this.wall, this.deck);
    for (const o of [this.funnel, this.debris, this.wall, this.deck]) o.frustumCulled = false;
  }

  onRemove() {
    this.renderer?.dispose();
  }

  render(gl, args) {
    const s = this.s;
    if (!s.visible) return;
    const t = ((performance.now() - this.t0) / 1000) * (REDUCED_MOTION ? 0.35 : 1);
    this.u.uTime.value = t;

    // camera position in scene axes
    const ll = this.map._camera.transform.getCameraLngLat();
    const alt = this.map._camera.transform.getCameraAltitude();
    const [cx, cy] = this.frame.toXY(ll.lng, ll.lat);
    this.u.uCam.value.set(cx, alt, -cy);
    this.camY = alt;

    // place things
    const gx = s.x, gz = -s.y;
    this.group.position.set(gx, s.ground, gz);
    this.funnelU.uBaseR.value = s.baseR;
    this.funnelU.uTopR.value = s.topR;
    this.funnelU.uLean.value.set(s.leanX, s.leanZ);
    this.funnelU.uSway.value = this.sway;
    this.debrisU.uBaseR.value = s.baseR;
    this.debrisU.uD.value = clamp(50 + s.baseR * 0.45, 70, 320);
    const wallR = Math.max(1900, s.topR * 1.8);
    this.wallU.uScale.value.set(wallR, CLOUD_BASE_M - WALL_BASE_M, wallR);
    this.wall.scale.set(wallR, CLOUD_BASE_M - WALL_BASE_M, wallR);
    this.wall.position.set(gx + s.leanX * 0.9, s.ground + CLOUD_BASE_M, gz + s.leanZ * 0.9);
    this.deck.position.set(gx, s.ground + CLOUD_BASE_M, gz);

    // the cloud deck and wall cloud fade out when the camera rises into or above them
    const fade = 1 - clamp((alt - (s.ground + CLOUD_BASE_M - 330)) / 300, 0, 1);
    this.deckVis.value = fade * s.vis;
    this.wallVis.value = fade * s.vis;
    this.u.uVis.value = s.vis;

    // MapLibre hands us world -> clip (mercator). Compose with scene -> mercator.
    // MapLibre 6: defaultProjectionData.mainMatrix takes mercator [0,1] coordinates and altitude in mercator units.
    const m = new THREE.Matrix4().fromArray(args.defaultProjectionData?.mainMatrix ?? args.modelViewProjectionMatrix);
    const sc = this.frame.s;
    const l = new THREE.Matrix4()
      .makeTranslation(this.frame.ox, this.frame.oy, 0)
      .scale(new THREE.Vector3(sc, -sc, sc))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    this.camera.projectionMatrix.copy(m).multiply(l);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    const c = this.map.getCanvas();
    this.renderer.resetState();
    this.renderer.setViewport(0, 0, c.width, c.height);
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }
}
