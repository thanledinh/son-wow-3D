import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

/**
 * The page's look: the car as Sketchfab's viewer shows it, rebuilt from the model's public viewer settings
 * (sketchfab.com/i/models/{uid}/options) and the formulas the public viewer works by, written here as our own code.
 * The values are those of the 911 (uid 597734ea…), whose model units are 0.0462 m in our world.
 * - shading: Sketchfab's PBR as three's, less three's extras (patchShading)
 * - lighting: the environment (Trinitatis Church, Unity's HDRI pack, CC0) at exposure 0.6, the model's three lights and
 *   the environment's own light (its brightest window), which casts the shadows
 * - post: SSAO, then colour balance and filmic tone mapping, then (ours) FXAA, then sharpen, vignette and grain
 *   (createSfPost)
 * - the ground: Sketchfab's baked ambient occlusion under the car, baked here (bakeGroundAO)
 */
export const SF = {
  envIntensity: 0.6,
  // its environment rotation (3.92699 rad) in our world and three's lat-long origin: the brightest window then lies
  // where the environment's light says it does
  envRotation: Math.PI / 4,
  // a light of intensity 1 (Sketchfab's diffuse is not divided by pi)
  lightIntensity: Math.PI,
  // the three lights: the direction each comes from (Sketchfab world (x, y, z) is our (-x, z, y))
  lights: [[0.8375, 0.3299, 0.4356], [-0.3919, 0.9156, 0.09], [-0.9083, 0.4184, 0]],
  // the environment's light: colour normalised, intensity pi × lightIntensity 5 × exposure 0.6 / brightness 1.05
  sun: { from: [0.712, 0.498, 0.495], color: [0.4914, 0.5607, 0.6665], intensity: Math.PI * 2.857 },
  // (bias: Sketchfab's 0.0256 m drew the facets of a gently curved door or bonnet as faint stripes, which its temporal
  // AA averages away and nothing here does; twice that keeps the occlusion in gaps and arches without them)
  ao: { radius: 0.256, bias: 0.05, intensity: 0.2 },
  tone: { exposure: 1, brightness: -0.25, contrast: 0, saturation: 1.4 },
  balance: { low: [0.075, 0.075, 0.1], mid: [0.075, 0.075, 0.1], high: [0, 0, 0] },
  vignette: [0.25, 0.725],
  grain: 0.15,
  sharpen: 0.25,
};

/**
 * Sketchfab's shading in three's physical material (before anything compiles): a clear coat reflects 8% at its
 * reflectivity 1 and shows no highlight of a light at roughness 0; no multiple-scattering compensation; the diffuse
 * layer is not reduced by what the specular one reflects.
 * (sfCoatLight: a material that sets this uniform gets its lights' highlights in the clear coat back, so far as it says:
 * the car paint under the sun in the swirl test. Unset it stays 0, as on Sketchfab.)
 */
export function patchShading() {
  const C = THREE.ShaderChunk;
  const swap = (chunk, from, to) => {
    if (!C[chunk].includes(from)) console.warn('sflook: three changed, not patched:', chunk, from);
    else C[chunk] = C[chunk].replace(from, to);
  };
  swap('lights_physical_fragment', 'material.clearcoatF0 = vec3( 0.04 );', 'material.clearcoatF0 = vec3( 0.08 );');
  C.lights_physical_pars_fragment = `uniform float sfCoatLight;\n${C.lights_physical_pars_fragment}`;
  swap('lights_physical_pars_fragment', 'clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat(', 'clearcoatSpecularDirect += sfCoatLight * ccIrradiance * BRDF_GGX_Clearcoat(');
  swap('lights_physical_pars_fragment', 'irradiance * specularBRDF * material.multiScatteringCompensation;', 'irradiance * specularBRDF;');
  swap('lights_physical_pars_fragment', 'BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );', 'BRDF_Lambert( material.diffuseContribution );');
  swap('lights_physical_pars_fragment', 'indirectSpecular += multiScattering * cosineWeightedIrradiance;', '');
  swap('lights_physical_pars_fragment', 'vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );', 'vec3 diffuse = material.diffuseContribution;');
}

/** the model's three lights and the environment's light (shadows on), added to the scene on layers 0 and 1 */
export function addSfLights(scene, at, layer = 1) {
  const out = [];
  const place = (l, from, dist) => {
    l.position.copy(at).addScaledVector(new THREE.Vector3(...from).normalize(), dist);
    l.target.position.copy(at);
    l.layers.enable(layer);
    scene.add(l, l.target);
    out.push(l);
  };
  SF.lights.forEach((from) => place(new THREE.DirectionalLight(0xffffff, SF.lightIntensity), from, 20));
  const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(...SF.sun.color), SF.sun.intensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 30 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.015;
  sun.shadow.radius = 3;
  place(sun, SF.sun.from, 15);
  return out;
}

const COMMON = /* glsl */ `
float sfIGN(vec2 p, float frame) {   // interleaved gradient noise, shifted per frame
  p += frame * vec2(32.665, 11.815);
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
float sfHash12(vec2 p) {             // hash without sine
  vec3 q = fract(p.xyx * 0.1031);
  q += dot(q, q.yzx + 19.19);
  return fract((q.x + q.y) * q.z);
}
float sfToSRGB(float v) { return v <= 0.0031308 ? 12.92 * v : 1.055 * pow(v, 1.0 / 2.4) - 0.055; }
vec3 sfToSRGB(vec3 c) { c = max(c, vec3(0.0)); return vec3(sfToSRGB(c.r), sfToSRGB(c.g), sfToSRGB(c.b)); }
float sfToLinear(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
vec3 sfToLinear(vec3 c) { return vec3(sfToLinear(c.r), sfToLinear(c.g), sfToLinear(c.b)); }
`;

// (at half resolution: each texel stands for the full-size pixels around px = gl_FragCoord * uScale)
const AO_EXTRACT = /* glsl */ `
#define TAPS 12
uniform sampler2D tDepth; uniform mat4 uProjInv; uniform vec2 uTex; uniform vec2 uVp; uniform float uScale;
uniform float uProjScale; uniform float uRadius; uniform float uBias; uniform float uIntensity; uniform float uFrame;
${COMMON}
vec3 viewPos(vec2 px) {
  float d = texture2D(tDepth, px / uTex).r;
  vec4 v = uProjInv * vec4(px / uVp * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
void main() {
  vec2 px = gl_FragCoord.xy * uScale;
  float d = texture2D(tDepth, px / uTex).r;
  if (d >= 1.0) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
  vec3 P = viewPos(px);
  // the normal from the nearer neighbour each way (screen derivatives across the outline took the far plane for part of
  // the surface, which darkened a stair-stepped ring inside it)
  vec2 ox = vec2(uScale, 0.0), oy = vec2(0.0, uScale), lo = vec2(0.5), hi = uVp - 0.5;
  vec3 ex = viewPos(clamp(px + ox, lo, hi)) - P, wx = P - viewPos(clamp(px - ox, lo, hi));
  vec3 ny = viewPos(clamp(px + oy, lo, hi)) - P, sy = P - viewPos(clamp(px - oy, lo, hi));
  vec3 n = normalize(cross(abs(ex.z) < abs(wx.z) ? ex : wx, abs(ny.z) < abs(sy.z) ? ny : sy));
  if (dot(n, P) > 0.0) n = -n;                      // facing the camera
  float ssR = uProjScale * uRadius / -P.z;         // the radius on screen (px)
  float ao = 1.0;
  if (ssR >= 1.0) {
    float spin = 6.2831853 * sfIGN(px, uFrame);
    float sum = 0.0;
    for (int i = 0; i < TAPS; i++) {
      float a = (float(i) + 0.5) / float(TAPS);
      float ang = a * 3.0 * 6.2831853 + spin;
      vec2 q = clamp(px + vec2(cos(ang), sin(ang)) * max(0.75, a * ssR), vec2(0.5), uVp - 0.5);
      vec3 v = viewPos(q) - P;
      float vv = dot(v, v);
      sum += max(0.0, 1.0 - vv / (uRadius * uRadius)) * max(0.0, (dot(v, n) - uBias) / sqrt(vv + 1e-8));
    }
    float nF = mix(1.0, max(0.0, 1.5 * n.z), 0.35);
    float A = max(0.0, 1.0 - sqrt(sum / float(TAPS) * nF));
    ao = mix(1.0, pow(A, 10.0 * uIntensity), clamp(ssR - 1.0, 0.0, 1.0));
  }
  gl_FragColor = vec4(ao, -P.z, 0.0, 1.0);
}`;

const AO_BLUR = /* glsl */ `
uniform sampler2D tAO; uniform vec2 uTex; uniform vec2 uVp; uniform vec2 uDir;
void main() {
  vec2 px = gl_FragCoord.xy;
  vec4 c = texture2D(tAO, px / uTex);
  if (c.g <= 0.0) { gl_FragColor = c; return; }
  float s = 0.0, ws = 0.0;
  for (int i = -3; i <= 3; i++) {
    int k = i < 0 ? -i : i;
    float w = (k == 0 ? 0.153 : k == 1 ? 0.145 : k == 2 ? 0.123 : 0.093) + 0.3;
    vec4 t = texture2D(tAO, clamp(px + uDir * float(i), vec2(0.5), uVp - 0.5) / uTex);   // (a half-size texel: 2 px)
    w *= max(0.0, 1.0 - abs(t.g - c.g) / (0.006 * c.g)) * step(1e-5, t.g);
    s += t.r * w;
    ws += w;
  }
  gl_FragColor = vec4(s / max(ws, 1e-4), c.g, 0.0, 1.0);
}`;

const quadVert = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';
const WHITE = (() => { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t; })();
const pass = (fragmentShader, uniforms) => new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms, vertexShader: quadVert, fragmentShader, depthTest: false, depthWrite: false,
}));

/**
 * Sketchfab's SSAO (scalable ambient obscurance on the depth buffer, then a depth-aware blur), for a depth texture
 * rendered by `camera` into the lower-left vw × vh of a tw × th target. Returns the AO texture (r; 1 = open) at half
 * that size, covering the same corner (so the same uv reads it).
 * Half size and 12 samples: at full size with 22, as Sketchfab's high setting, it cost about 8 ms of GPU a frame at
 * 1920 × 1080 (twice in the opening shot, for the laptop's screen and for the page).
 */
export function createSfAO() {
  const opts = { type: THREE.HalfFloatType, depthBuffer: false };
  const a = new THREE.WebGLRenderTarget(16, 16, opts), b = new THREE.WebGLRenderTarget(16, 16, opts);
  const extract = pass(AO_EXTRACT, {
    tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uTex: { value: new THREE.Vector2() }, uVp: { value: new THREE.Vector2() },
    uScale: { value: 2 }, uProjScale: { value: 1 }, uRadius: { value: SF.ao.radius }, uBias: { value: SF.ao.bias },
    uIntensity: { value: SF.ao.intensity }, uFrame: { value: 0 },
  });
  const blur = pass(AO_BLUR, { tAO: { value: null }, uTex: { value: new THREE.Vector2() }, uVp: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2() } });
  const frame = 0;
  return {
    uniforms: extract.material.uniforms,
    render(renderer, depth, camera, tw, th, vw, vh) {
      const hw = Math.ceil(tw / 2), hh = Math.ceil(th / 2), hvw = Math.ceil(vw / 2), hvh = Math.ceil(vh / 2);
      if (a.width !== hw || a.height !== hh) { a.setSize(hw, hh); b.setSize(hw, hh); }
      a.viewport.set(0, 0, hvw, hvh);
      b.viewport.set(0, 0, hvw, hvh);
      const e = extract.material.uniforms;
      e.tDepth.value = depth;
      e.uProjInv.value.copy(camera.projectionMatrixInverse);
      e.uTex.value.set(tw, th);
      e.uVp.value.set(vw, vh);
      e.uProjScale.value = 0.5 * vh * camera.projectionMatrix.elements[5];
      // (Sketchfab turns the sample pattern every frame for its temporal AA to average; with no such AA here a
      // pattern that moves would shimmer, so it holds still)
      e.uFrame.value = frame;
      if (!e.uIntensity.value) return WHITE;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(b);
      extract.render(renderer);
      const u = blur.material.uniforms;
      u.uTex.value.set(hw, hh);
      u.uVp.value.set(hvw, hvh);
      u.tAO.value = b.texture;
      u.uDir.value.set(1, 0);
      renderer.setRenderTarget(a);
      blur.render(renderer);
      u.tAO.value = a.texture;
      u.uDir.value.set(0, 1);
      renderer.setRenderTarget(b);
      blur.render(renderer);
      renderer.setRenderTarget(prev);
      return b.texture;
    },
  };
}

const GRADE = /* glsl */ `
uniform sampler2D tHDR; uniform sampler2D tAO; uniform vec2 uTex; uniform float uGrade;
uniform float uTmExposure; uniform float uTmBrightness; uniform float uTmContrast; uniform float uTmSaturation;
uniform vec3 uCbLow; uniform vec3 uCbMid; uniform vec3 uCbHigh;
${COMMON}
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// colour balance: shadows / midtones / highlights by HSL lightness, an added tint, the colour's length kept
vec3 colorBalance(vec3 c) {
  float len0 = length(c);
  if (len0 < 1e-5) return c;
  float l = 0.5 * (max(c.r, max(c.g, c.b)) + min(c.r, min(c.g, c.b)));
  l = 1.5 * l / (l + 0.5);
  float wLow = clamp(0.5 - 4.0 * (l - 0.333), 0.0, 1.0);
  float wMid = clamp(0.5 + 4.0 * (l - 0.333), 0.0, 1.0) * clamp(0.5 - 4.0 * (l - 0.667), 0.0, 1.0);
  float wHigh = clamp(0.5 + 4.0 * (l - 0.667), 0.0, 1.0);
  vec3 s = max(c + 0.7 * (wLow * uCbLow + wMid * uCbMid + wHigh * uCbHigh), vec3(0.0));
  float len1 = length(s);
  return len1 < 1e-5 ? s * len0 : s * (len0 / len1);
}
// exposure and brightness as gains, saturation round the luma, contrast round 0.5, then the filmic curve
// (Hejl / Burgess-Dawson, gamma-encoded, back to linear)
vec3 toneMap(vec3 c) {
  c *= uTmExposure * (1.0 + uTmBrightness);
  float y = dot(c, LUMA);
  c = vec3(y) + uTmSaturation * (c - vec3(y));
  c = max(c * (1.0 + uTmContrast) - 0.5 * uTmContrast, vec3(0.0));
  vec3 x = max(c - 0.004, vec3(0.0));
  c = (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);
  return pow(c, vec3(2.2));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uTex;
  vec3 c = texture2D(tHDR, uv).rgb * texture2D(tAO, uv).r;
  // (uGrade 0: the light as it is, clipped, as Sketchfab's viewer shows it with its post off)
  gl_FragColor = vec4(clamp(sfToSRGB(uGrade > 0.5 ? toneMap(colorBalance(c)) : c), 0.0, 1.0), 1.0);
}`;

const FINISH = /* glsl */ `
uniform sampler2D tLDR; uniform vec2 uTex; uniform float uPr;
uniform float uSharpen; uniform vec2 uVignette; uniform float uGrain; uniform float uSeed; uniform float uFrame;
${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uTex;
  vec3 s = texture2D(tLDR, uv).rgb;
  // sharpen (display values, the four diagonal neighbours one CSS pixel away), kept within the five samples' range
  // (as AMD's CAS): unclamped, it drew a bright line round the car's outline and stair-stepped its anti-aliased edge
  if (uSharpen > 0.0) {
    vec2 o = uPr / uTex;
    vec3 a = texture2D(tLDR, uv - o).rgb, b = texture2D(tLDR, uv + o).rgb;
    vec3 c = texture2D(tLDR, uv + vec2(o.x, -o.y)).rgb, d = texture2D(tLDR, uv + vec2(-o.x, o.y)).rgb;
    vec3 lo = min(s, min(min(a, b), min(c, d))), hi = max(s, max(max(a, b), max(c, d)));
    s = clamp(s + uSharpen * (4.0 * s - (a + b + c + d)), lo, hi);
  }
  // vignette (screen uv, not aspect-corrected; multiplies in linear light; dithered)
  float amount = uVignette.x, hardness = uVignette.y;
  if (amount >= 0.0 && hardness - amount <= 0.70710678) {
    float outer = 2.0 - amount - hardness;
    float inner = min(hardness - amount, outer - 1e-4);
    float dither = (sfIGN(gl_FragCoord.xy, uFrame) - 0.5) * 0.07 * (outer - inner) * (outer + inner);
    float f = 1.0 - smoothstep(inner, outer, distance(uv, vec2(0.5)) + dither);
    s = sfToSRGB(sfToLinear(s) * f);
  }
  // grain (triangular noise, strongest in the mid-tones)
  if (uGrain >= 5e-4) {
    float v = sfHash12(gl_FragCoord.xy + 1000.0 * uSeed) * 2.0 - 1.0;
    float g = v >= 0.0 ? 0.5 * sqrt(v) : 1.0 - 0.5 * sqrt(-v);
    s += uGrain * (2.0 * g - 1.0) * s * (1.0 - s);
  }
  gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
}`;

/**
 * The page's frame through Sketchfab's chain: the scene into a linear HDR target (MSAA, with depth), SSAO multiplied
 * in, colour balance and tone mapping into display values, FXAA (ours: Sketchfab's temporal AA has nothing to settle
 * on in a page that scrolls), then sharpen, vignette and grain onto the canvas.
 * ?grain=0 turns the grain off (for comparing pictures), ?aa=0 the FXAA.
 */
export function createSfPost(renderer) {
  const hdr = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(16, 16) });
  const ldr = new THREE.WebGLRenderTarget(16, 16, { depthBuffer: false });
  const ao = createSfAO();
  const t = SF.tone, b = SF.balance;
  const grade = pass(GRADE, {
    tHDR: { value: hdr.texture }, tAO: { value: null }, uTex: { value: new THREE.Vector2() }, uGrade: { value: 1 },
    uTmExposure: { value: t.exposure }, uTmBrightness: { value: t.brightness }, uTmContrast: { value: t.contrast }, uTmSaturation: { value: t.saturation },
    uCbLow: { value: new THREE.Vector3(...b.low) }, uCbMid: { value: new THREE.Vector3(...b.mid) }, uCbHigh: { value: new THREE.Vector3(...b.high) },
  });
  const grainOff = new URLSearchParams(location.search).get('grain') === '0';
  const finish = pass(FINISH, {
    tLDR: { value: ldr.texture }, uTex: { value: new THREE.Vector2() }, uPr: { value: 1 },
    uSharpen: { value: SF.sharpen }, uVignette: { value: new THREE.Vector2(...SF.vignette) }, uGrain: { value: grainOff ? 0 : SF.grain },
    uSeed: { value: 0 }, uFrame: { value: 0 },
  });
  const frame = 0;
  // FXAA on the graded picture (display values, before the sharpen and grain) where a pixel is big enough for what 4x
  // MSAA leaves of an edge to show (under 1.5 device pixels a CSS pixel): the steps of an outline, and of a bright
  // reflection's edge most of all, whose samples are averaged before the tone map. About 0.5 ms at 1920 × 1080.
  // At half its sub-pixel blending, which softens fine detail such as the laptop app's text. ?aa=0 leaves it out.
  const aaOff = new URLSearchParams(location.search).get('aa') === '0';
  const ldrAA = new THREE.WebGLRenderTarget(16, 16, { depthBuffer: false });
  if (!FXAAShader.fragmentShader.includes('_SubpixelBlending = 1.0')) console.warn('sflook: three changed, FXAA not tuned');
  const fxaa = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: ldr.texture }, resolution: { value: new THREE.Vector2() } },
    vertexShader: FXAAShader.vertexShader, depthTest: false, depthWrite: false,
    fragmentShader: FXAAShader.fragmentShader.replace('_SubpixelBlending = 1.0', '_SubpixelBlending = 0.5'),
  }));
  const aa = { on: false };
  // ?sfpost=0: the light as it is (no SSAO, grading, sharpen, vignette or grain), as Sketchfab's viewer with its post off
  if (new URLSearchParams(location.search).get('sfpost') === '0') {
    grade.material.uniforms.uGrade.value = 0;
    ao.uniforms.uIntensity.value = 0;
    finish.material.uniforms.uSharpen.value = 0;
    finish.material.uniforms.uGrain.value = 0;
    finish.material.uniforms.uVignette.value.x = -1;
  }
  return {
    hdr,
    ao,
    // (live handles, for comparing piece by piece: grade.uGrade, finish.uSharpen / uVignette / uGrain, ao.uIntensity,
    // aa.on until the next resize)
    uniforms: { grade: grade.material.uniforms, finish: finish.material.uniforms, ao: ao.uniforms },
    aa,
    setSize(w, h, pixelRatio) {
      hdr.setSize(w, h);
      ldr.setSize(w, h);
      ldrAA.setSize(w, h);
      fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
      aa.on = !aaOff && pixelRatio < 1.5;
      grade.material.uniforms.uTex.value.set(w, h);
      finish.material.uniforms.uTex.value.set(w, h);
      finish.material.uniforms.uPr.value = Math.min(1.5, pixelRatio);
    },
    // withAO: false where the frame has nothing for it to darken (the car not in it), which saves its passes
    render(scene, camera, seconds, withAO = true) {
      renderer.setRenderTarget(hdr);
      renderer.render(scene, camera);
      grade.material.uniforms.tAO.value = withAO ? ao.render(renderer, hdr.depthTexture, camera, hdr.width, hdr.height, hdr.width, hdr.height) : WHITE;
      renderer.setRenderTarget(ldr);
      grade.render(renderer);
      if (aa.on) {
        renderer.setRenderTarget(ldrAA);
        fxaa.render(renderer);
      }
      const f = finish.material.uniforms;
      f.tLDR.value = aa.on ? ldrAA.texture : ldr.texture;
      f.uSeed.value = (Math.floor(seconds * 1000 / 64) * 0.618034) % 1;   // the grain moves every 64 ms
      f.uFrame.value = frame;
      renderer.setRenderTarget(null);
      finish.render(renderer);
    },
  };
}

/**
 * Sketchfab's ground under the car: ambient occlusion baked once onto the floor (1 = open). The car is taken as solid
 * between its lowest and highest surface over each point of the floor (two height maps, looking up and down), and
 * each floor texel casts cosine-weighted rays at it. Returns the texture and the floor rectangle it covers (centre
 * x, z, width along x, depth along z; v = 1 at the -z end).
 */
export function bakeGroundAO(renderer, root, { size = 512, margin = 1.4, rays = 96, steps = 28, reach = 3.2 } = {}) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const W = box.max.x - box.min.x + margin * 2, D = box.max.z - box.min.z + margin * 2;
  const rect = new THREE.Vector4(cx, cz, W, D);
  // (stored so that the cleared 0 reads as no car: lowest 10 - t, highest t - 10)
  const heights = (top) => {
    const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uRect: { value: rect } },
      vertexShader: /* glsl */ `
        uniform vec4 uRect; varying float vY;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vY = w.y;
          gl_Position = vec4((w.x - uRect.x) / (uRect.z * 0.5), -(w.z - uRect.y) / (uRect.w * 0.5), ${top ? '-' : ''}w.y / 10.0, 1.0);
        }`,
      fragmentShader: `varying float vY; void main() { gl_FragColor = vec4(${top ? 'vY + 10.0' : '10.0 - vY'}); }`,
    });
    const s = new THREE.Scene();
    s.overrideMaterial = mat;
    const parent = root.parent;
    s.add(root);
    const cam = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.01, 1000);
    cam.position.set(0, 500, 0);
    cam.lookAt(0, 0, 0);
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(s, cam);
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClear, prevAlpha);
    if (parent) parent.add(root); else s.remove(root);
    mat.dispose();
    return rt;
  };
  const lo = heights(false), hi = heights(true);
  const out = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: false });
  const out2 = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false });
  const bake = pass(/* glsl */ `
    uniform sampler2D tLo; uniform sampler2D tHi; uniform vec4 uRect; uniform float uSize; uniform float uReach;
    ${COMMON}
    void main() {
      vec2 uv = gl_FragCoord.xy / uSize;
      vec2 p = vec2(uRect.x + (uv.x - 0.5) * uRect.z, uRect.y - (uv.y - 0.5) * uRect.w);
      float spin = 6.2831853 * sfHash12(gl_FragCoord.xy);
      float hit = 0.0;
      for (int i = 0; i < ${rays}; i++) {
        float u1 = (float(i) + 0.5) / float(${rays});
        float phi = float(i) * 2.3999632 + spin;          // golden angle
        float r = sqrt(u1);
        vec3 dir = vec3(r * cos(phi), sqrt(1.0 - u1), r * sin(phi));
        for (int s = 0; s < ${steps}; s++) {
          float t = uReach * pow((float(s) + 0.5) / float(${steps}), 1.6);
          vec3 q = vec3(p.x, 0.0, p.y) + dir * t;
          vec2 tuv = vec2((q.x - uRect.x) / uRect.z + 0.5, 0.5 - (q.z - uRect.y) / uRect.w);
          if (tuv.x < 0.0 || tuv.x > 1.0 || tuv.y < 0.0 || tuv.y > 1.0) break;
          float l = 10.0 - texture2D(tLo, tuv).r, h = texture2D(tHi, tuv).r - 10.0;
          if (q.y >= l - 0.01 && q.y <= h) { hit += 1.0; break; }
        }
      }
      gl_FragColor = vec4(vec3(1.0 - hit / float(${rays})), 1.0);
    }`, { tLo: { value: lo.texture }, tHi: { value: hi.texture }, uRect: { value: rect }, uSize: { value: size }, uReach: { value: reach } });
  renderer.setRenderTarget(out);
  bake.render(renderer);
  // a light blur takes the ray noise out
  const blur = pass(/* glsl */ `
    uniform sampler2D tIn; uniform float uSize; uniform vec2 uDir;
    void main() {
      vec2 uv = gl_FragCoord.xy / uSize;
      float s = 0.0;
      for (int i = -4; i <= 4; i++) s += texture2D(tIn, uv + uDir * float(i) / uSize).r * (5.0 - abs(float(i)));
      gl_FragColor = vec4(vec3(s / 25.0), 1.0);
    }`, { tIn: { value: out.texture }, uSize: { value: size }, uDir: { value: new THREE.Vector2(1, 0) } });
  renderer.setRenderTarget(out2);
  blur.render(renderer);
  blur.material.uniforms.tIn.value = out2.texture;
  blur.material.uniforms.uDir.value.set(0, 1);
  const final = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false });
  renderer.setRenderTarget(final);
  blur.render(renderer);
  renderer.setRenderTarget(null);
  [lo, hi, out, out2].forEach((r) => r.dispose());
  [bake, blur].forEach((q) => { q.material.dispose(); q.dispose(); });
  return { texture: final.texture, rect };
}
