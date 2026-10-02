/* The Steam Spirit 3D scene (three.js) — one module for three places:
     mode "hero"   : landing page — a large swirl of glowing chai steam that follows the pointer
     mode "avatar" : ChAimate's face on the call screen — idles (dim, slow drift), listens (brightens and gathers),
                     thinks (spirals into a vortex), speaks (the core pulses and steam puffs rise with the voice level)
     mode "mini"   : a small, calm version for the staff login (drawn without glow, for the light background)
   Every particle is moved on the GPU (one draw call), so it stays smooth on phones. Colours follow the persona
   (setPalette). Quality adapts to the device: "full" on laptops, "lite" on phones / low-memory devices (fewer
   particles, lower pixel ratio), "static" (a single rendered frame) for reduced-motion or data-saver users.
   If the frame rate drops, it steps down on its own. It pauses while off-screen or when the tab is hidden. */
import * as THREE from "three";

export function qualityTier() {
  try {
    const c = document.createElement("canvas");
    if (!(c.getContext("webgl2") || c.getContext("webgl"))) return "none";
  } catch (_) { return "none"; }
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return "static";
  if (navigator.connection && navigator.connection.saveData) return "static";
  const phone = matchMedia("(pointer: coarse)").matches || innerWidth < 800;
  const lowMem = (navigator.deviceMemory || 8) <= 4;
  return phone || lowMem ? "lite" : "full";
}

// [light, main, accent] — the same shape as the persona palettes in table.js
const CHAI = ["#F6DFC2", "#E08A4A", "#F2B872"];
const KIND = { body: 0, plume: 1, mote: 2, ribbon: 3 };

// what each state looks like; the scene eases towards these
const LOOK = {
  idle:      { bright: .55, vortex: 0, plume: .45, gather: 0, spin: .45 },
  listening: { bright: .9,  vortex: 0, plume: .75, gather: 1, spin: .7 },
  thinking:  { bright: 1,   vortex: 1, plume: .35, gather: 0, spin: 1 },
  speaking:  { bright: 1,   vortex: 0, plume: 1,   gather: 0, spin: .8 },
};

const VERT = /* glsl */ `
  attribute vec3 aDir;    // a random direction (body particles)
  attribute vec4 aRand;   // x: depth in the cloud, y: phase, z: speed, w: size
  attribute float aKind;  // 0 body, 1 plume, 2 spice mote, 3 ribbon
  uniform float uTime, uSwirl, uRise, uLevel, uVortex, uGather, uPlume, uBright, uProj, uScale, uLight;
  uniform vec3 uColA, uColB, uColC;
  varying vec3 vColor; varying float vAlpha;

  vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
  vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
  vec3 rotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }

  void main() {
    float t = uTime;
    vec3 p, col; float size, alpha;
    if (aKind < .5) {
      // the body: a soft cloud, denser towards the centre; the inside turns faster than the edge
      float r0 = .2 + pow(aRand.x, 1.4) * 1.05;
      float r = r0 * (1. + .045 * sin(t * 1.2 + aRand.y * 6.2832));
      r *= 1. - uGather * .12 * aRand.x;                                              // listening: draws in
      r *= 1. + uLevel * (.22 + .18 * sin(t * 9. + aRand.y * 12.)) * aRand.x;         // speaking: pulses out
      r *= mix(1., .5 + .5 * aRand.x, uVortex);                                       // thinking: pulled inwards
      p = aDir * r;
      p.y *= mix(1., .28, uVortex);                                                   // ...and flattened into a disc
      p = rotY(p, uSwirl * (.25 + aRand.z * .35) / (.45 + r0 * .55));
      // drifting wisps
      p += .13 * vec3(sin(p.y * 2.3 + t * .7 + aRand.y * 6.), sin(p.z * 2.1 + t * .6), cos(p.x * 2.2 + t * .8));
      size = mix(.035, .12, aRand.w * aRand.w);
      alpha = .2 + .55 * (1. - aRand.x);
      col = mix(uColA, uColB, smoothstep(.15, .95, aRand.x));
      col = mix(col, uColC, step(.86, aRand.w) * .8);
    } else if (aKind > 2.5) {
      // ribbons: wisps of steam looping around the heart, each tilted its own way, brighter in travelling streaks
      float id = floor(aRand.x * 7.), s = aRand.y * 6.2832;
      float R = (.95 + .22 * sin(id * 2.1)) * (1. + .05 * sin(t * 1.2 + id));
      R *= 1. - uGather * .1;
      R *= 1. + uLevel * (.2 + .15 * sin(t * 8. + id * 3.));
      R *= mix(1., .6, uVortex);
      float a = s + uSwirl * (.5 + id * .07);
      p = vec3(cos(a), 0., sin(a)) * (R + .16 * sin(3. * s + t * .9 + id));
      p.y = .12 * sin(2. * s + t * .7 + id * 1.7);
      p = rotZ(rotX(p, mix(id * .9 + .35, .12 * sin(id), uVortex)), mix(id * 1.7, 0., uVortex));
      p += aDir * (.035 + .08 * aRand.w);
      float streak = pow(.5 + .5 * sin(s * 1.5 - uSwirl * 1.4 + id * 2.), 3.);
      size = mix(.03, .085, aRand.w);
      alpha = .15 + .85 * streak;
      col = mix(uColB, uColA, streak);
    } else if (aKind < 1.5) {
      // the plume: big soft puffs rising off the top like steam
      float k = fract(aRand.y + uRise * (.55 + .9 * aRand.z));
      float sway = sin(k * 5. + aRand.x * 10. + t * .5);
      p = vec3(sway * .4 * k + (aRand.x - .5) * .45, .55 + k * 2.1, cos(k * 4. + aRand.x * 7.) * .3 * k);
      size = mix(.25, .85, k) * (.7 + .6 * aRand.w);
      alpha = sin(k * 3.14159) * .065 * uPlume;
      col = mix(uColA, vec3(1.), .2);
    } else {
      // spice motes: a few warm sparks orbiting further out, twinkling
      float r = 1.85 + aRand.x * .75;
      float a = aRand.y * 6.2832 + uSwirl * (.12 + aRand.z * .1);
      p = vec3(cos(a) * r, (aRand.w - .5) * 1.7 + sin(t * .8 + aRand.y * 9.) * .15, sin(a) * r * .9);
      p.y *= mix(1., .35, uVortex);
      size = .05 + aRand.w * .05;
      alpha = .5 + .45 * sin(t * 2. + aRand.y * 20.);
      col = uColC;
    }
    // on a light page there is no glow to lean on: deepen the colours instead
    col = mix(col, col * vec3(.62, .45, .36), uLight);
    vec4 mv = modelViewMatrix * vec4(p, 1.);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = size * uScale * uProj / -mv.z;
    vColor = col; vAlpha = alpha * uBright;
  }`;

const FRAG = /* glsl */ `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - .5);
    float a = smoothstep(.5, 0., d); a *= a;
    if (a * vAlpha < .003) discard;
    gl_FragColor = vec4(vColor, a * vAlpha);
  }`;

function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(.25, "rgba(255,255,255,.45)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function particleGeometry(counts) {
  const n = counts.body + counts.ribbon + counts.plume + counts.mote;
  const dir = new Float32Array(n * 3), rand = new Float32Array(n * 4), kind = new Float32Array(n), pos = new Float32Array(n * 3);
  let i = 0;
  const add = (k, count) => {
    for (let j = 0; j < count; j++, i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      dir.set([s * Math.cos(a), u, s * Math.sin(a)], i * 3);
      rand.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      kind[i] = k;
    }
  };
  add(KIND.body, counts.body); add(KIND.ribbon, counts.ribbon); add(KIND.plume, counts.plume); add(KIND.mote, counts.mote);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));   // computed in the shader
  geo.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
  geo.setAttribute("aRand", new THREE.BufferAttribute(rand, 4));
  geo.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, .8, 0), 4);
  return geo;
}

export class SpiritScene {
  constructor(canvas, { mode = "hero", quality = qualityTier(), layout = null, palette = CHAI } = {}) {
    this.canvas = canvas; this.mode = mode; this.quality = quality; this.layout = layout;
    this.state = mode === "avatar" ? "idle" : "listening"; this.level = 0; this._level = 0;
    this.pointer = { x: 0, y: 0 }; this.running = false; this.visible = true; this._frames = []; this._t = 0;
    this._swirl = 0; this._rise = .5;
    this._look = { ...LOOK[this.state] };
    const lite = quality !== "full", light = mode === "mini";

    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(devicePixelRatio, lite ? 1.5 : 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(mode === "avatar" ? 28 : 30, 1, 0.1, 100);
    this.camera.position.set(0, mode === "avatar" ? 1.2 : 1.6, mode === "avatar" ? 8.2 : 9.5);
    this.world = new THREE.Group(); this.scene.add(this.world);
    this.spirit = new THREE.Group(); this.world.add(this.spirit);

    // the glowing heart of the steam
    const blending = light ? THREE.NormalBlending : THREE.AdditiveBlending, tex = glowTexture();
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending, transparent: true, depthWrite: false }));
    this.heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending, transparent: true, depthWrite: false }));
    this.spirit.add(this.halo, this.heart);

    // the steam itself
    const counts = mode === "mini" ? { body: lite ? 500 : 900, ribbon: lite ? 900 : 1600, plume: 60, mote: 10 }
      : lite ? { body: 1100, ribbon: 1600, plume: 110, mote: 14 } : { body: 2800, ribbon: 4200, plume: 240, mote: 24 };
    this.uniforms = {
      uTime: { value: 0 }, uSwirl: { value: 0 }, uRise: { value: .5 }, uLevel: { value: 0 }, uVortex: { value: 0 },
      uGather: { value: 0 }, uPlume: { value: 1 }, uBright: { value: 1 }, uProj: { value: 1 }, uScale: { value: 1 },
      uLight: { value: light ? 1 : 0 },
      uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() }, uColC: { value: new THREE.Color() },
    };
    this.points = new THREE.Points(particleGeometry(counts), new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending,
    }));
    this.spirit.add(this.points);
    this.setPalette(palette);

    this._resize = () => this.resize();
    this._ro = new ResizeObserver(this._resize); this._ro.observe(canvas);
    this._io = new IntersectionObserver((e) => { this.visible = e[0].isIntersecting; this._kick(); }, { threshold: 0 }); this._io.observe(canvas);
    this._vis = () => this._kick(); document.addEventListener("visibilitychange", this._vis);
    if (mode === "hero") {
      this._move = (e) => { this.pointer.x = e.clientX / innerWidth - .5; this.pointer.y = e.clientY / innerHeight - .5; };
      addEventListener("pointermove", this._move, { passive: true });
    }
    this.resize();
    this.clock = new THREE.Clock();
    if (quality === "static") this.renderOnce();
    else this.start();
  }

  setState(s) { this.state = s; if (this.quality === "static") this.renderOnce(); }
  setLevel(v) { this.level = Math.max(0, Math.min(1, v)); }
  setPalette(p) {
    const [a, b, c] = p && p.length >= 3 ? p : CHAI, u = this.uniforms;
    u.uColA.value.set(a); u.uColB.value.set(b); u.uColC.value.set(c);
    this.halo.material.color.set(b); this.heart.material.color.set(a);
    if (this.quality === "static") this.renderOnce();
  }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    // point sizes are in device pixels: world size → pixels at distance 1
    this.uniforms.uProj.value = h * this.renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    // where the spirit sits: the page decides (hero: right on laptops, centred on phones)
    const place = this.layout ? this.layout(w, h) : { x: 0, y: 0, scale: 1 };
    this.world.position.set(place.x, place.y, 0); this.world.scale.setScalar(place.scale);
    this.uniforms.uScale.value = place.scale;
    if (this.quality === "static") this.renderOnce();
  }

  renderOnce() { this._step(1 / 60, this._t || 2.2, true); this.renderer.render(this.scene, this.camera); }
  start() { if (this.running) return; this.running = true; this.clock.getDelta(); this.renderer.setAnimationLoop(() => this._frame()); }
  stop() { this.running = false; this.renderer.setAnimationLoop(null); }
  _kick() {
    const shouldRun = this.quality !== "static" && this.visible && document.visibilityState === "visible" && !this.frozen;
    shouldRun ? this.start() : this.stop();
  }

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this._t += dt;
    this._watchPerformance(dt);
    this._step(dt, this._t);
    this.renderer.render(this.scene, this.camera);
  }

  // step down when the device can't keep up: lower pixel ratio → a still frame
  _watchPerformance(dt) {
    this._frames.push(dt); if (this._frames.length < 90) return;
    const avg = this._frames.reduce((a, b) => a + b, 0) / this._frames.length; this._frames = [];
    if (avg > 0.034 && this.renderer.getPixelRatio() > 1) { this.renderer.setPixelRatio(1); this.resize(); }
    else if (avg > 0.05) { this.frozen = true; this.stop(); }
  }

  _step(dt, t, snap = false) {
    const s = LOOK[this.state] ? this.state : this.state === "transcribing" ? "thinking" : "listening";
    const speaking = s === "speaking", look = this._look, target = LOOK[s], ease = snap ? 1 : Math.min(1, dt * 3);
    for (const k in target) look[k] += (target[k] - look[k]) * ease;
    this._level += ((speaking ? this.level : 0) - this._level) * Math.min(1, dt * 12);
    const lv = this._level;

    // motion is integrated here, so changing speed never makes the particles jump
    this._swirl += dt * look.spin * (1 + look.vortex * 4);
    this._rise += dt * (.1 + look.plume * .08 + lv * .35);

    const u = this.uniforms;
    u.uTime.value = t; u.uSwirl.value = this._swirl; u.uRise.value = this._rise; u.uLevel.value = lv;
    u.uVortex.value = look.vortex; u.uGather.value = look.gather; u.uPlume.value = look.plume + lv * .4;
    u.uBright.value = (look.bright + lv * .3) * (this.mode === "mini" ? 1.5 : 1);

    // the heart breathes, and swells with the voice
    const breath = 1 + Math.sin(t * 1.3) * .05, light = this.mode === "mini";
    this.halo.scale.setScalar((2.6 + look.gather * .3 - look.vortex * .5) * breath * (1 + lv * .35));
    this.heart.scale.setScalar((.9 + look.vortex * .25) * breath * (1 + lv * .6));
    this.halo.material.opacity = (light ? .14 : .32) * u.uBright.value;
    this.heart.material.opacity = (light ? .25 : .55) * u.uBright.value;

    // a gentle float; follows the pointer on the landing
    this.spirit.position.y = Math.sin(t * 1.1) * .04;
    this.spirit.rotation.z = Math.sin(t * .4) * .04;
    if (this.mode === "hero") { this.spirit.rotation.x = this.pointer.y * .15; this.camera.position.x += (this.pointer.x * .8 - this.camera.position.x) * .04; }
    this.camera.lookAt(this.world.position.x * (this.mode === "hero" ? .45 : 1), this.world.position.y * .5 + (this.mode === "avatar" ? .25 : .2), 0);
  }

  destroy() {
    this.stop(); this._ro.disconnect(); this._io.disconnect();
    document.removeEventListener("visibilitychange", this._vis);
    if (this._move) removeEventListener("pointermove", this._move);
    this.points.geometry.dispose(); this.points.material.dispose();
    this.renderer.dispose();
  }
}

// available to the non-module app scripts
window.Scene3D = { SpiritScene, qualityTier };
window.dispatchEvent(new Event("scene3d-ready"));
