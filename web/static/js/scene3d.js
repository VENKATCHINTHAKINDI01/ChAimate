/* The Studio Kulhad 3D scene (three.js) — one module for three places:
     mode "hero"   : landing page — the kulhad of chai with steam and orbiting spices, follows the pointer
     mode "avatar" : ChAimate's face on the call screen — listens (breathes), thinks (spices whirl),
                     speaks (steam puffs and the chai ripples with the voice level)
     mode "mini"   : a small, calm version for the staff login
   Quality adapts to the device: "full" on laptops, "lite" on phones / low-memory devices (no real-time shadows,
   fewer particles, lower pixel ratio), "static" (a single rendered frame) for reduced-motion or data-saver users.
   If the frame rate drops, it steps down on its own. It pauses while off-screen or when the tab is hidden. */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

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

const TAU = Math.PI * 2;
const PALETTE = { clay: 0x7a3e22, chai: 0xc08a55, foam: 0xe8c9a0, pod: 0x7d8a55, cinnamon: 0x7a3e1c, anise: 0x5a2a17, ginger: 0xe2c07a };

function steamTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,.85)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function blobShadowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(42,26,18,.28)"); r.addColorStop(1, "rgba(42,26,18,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** A hand-thrown clay cup: lathe profile (outer wall → lip → inner wall) with a subtle wobble and throwing rings. */
function kulhadGeometry(segments) {
  const pts = [], n = 36;
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector2(.78 + Math.sin(t * Math.PI) * .12 + t * .22, -1.25 + t * 2.3)); }
  pts.push(new THREE.Vector2(1.05, 1.08));
  for (let i = n; i >= 0; i--) { const t = i / n; pts.push(new THREE.Vector2(.72 + Math.sin(t * Math.PI) * .1 + t * .22, -1.1 + t * 2.15)); }
  const geo = new THREE.LatheGeometry(pts, segments);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const w = 1 + Math.sin(a * 3 + y * 2) * .012 + Math.sin(y * 40) * .004;
    p.setX(i, x * w); p.setZ(i, z * w);
  }
  geo.computeVertexNormals();
  return geo;
}

export class KulhadScene {
  constructor(canvas, { mode = "hero", quality = qualityTier(), layout = null } = {}) {
    this.canvas = canvas; this.mode = mode; this.quality = quality; this.layout = layout;
    this.state = mode === "avatar" ? "idle" : "listening"; this.level = 0; this._level = 0;
    this.pointer = { x: 0, y: 0 }; this.running = false; this.visible = true; this._frames = []; this._t = 0;
    const lite = quality !== "full";

    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite || devicePixelRatio < 2, alpha: true, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(devicePixelRatio, lite ? 1.5 : 2));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
    r.shadowMap.enabled = !lite; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = this.scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(mode === "avatar" ? 28 : 30, 1, 0.1, 100);
    this.camera.position.set(0, mode === "avatar" ? 1.6 : 2.2, mode === "avatar" ? 8.2 : 9.5);

    const key = this.key = new THREE.DirectionalLight(0xfff1e0, 2.6); key.position.set(-4, 7, 5);
    if (!lite) { key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 8;
      Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 25 }); }
    scene.add(key, new THREE.HemisphereLight(0xfff7ee, 0xd9b9a0, .9));

    // floor: real soft shadow on laptops, a painted blob shadow on phones
    this.world = new THREE.Group(); scene.add(this.world);
    if (!lite) {
      const floor = this.floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: .17 }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -1.3; floor.receiveShadow = true; this.world.add(floor);
    } else {
      const blob = this.floor = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2; blob.position.y = -1.29; this.world.add(blob);
    }

    // cup + chai (with a surface that can ripple) + a slow latte swirl
    const cup = this.cup = new THREE.Group(); this.world.add(cup);
    const kulhad = new THREE.Mesh(kulhadGeometry(lite ? 56 : 96), new THREE.MeshStandardMaterial({ color: PALETTE.clay, roughness: .9 }));
    kulhad.castShadow = !lite; kulhad.receiveShadow = !lite; cup.add(kulhad);
    // the chai: a disc built from rings of vertices so it can ripple
    const surface = this.surface = new THREE.Mesh(new THREE.RingGeometry(0.001, .96, lite ? 48 : 96, lite ? 10 : 18),
      new THREE.MeshPhysicalMaterial({ color: PALETTE.chai, roughness: .25, clearcoat: .8 }));
    surface.rotation.x = -Math.PI / 2; surface.position.y = .82; cup.add(surface);
    this._surfaceBase = surface.geometry.attributes.position.array.slice();
    const swirl = this.swirl = new THREE.Mesh(new THREE.RingGeometry(.2, .7, 64, 1, 0, Math.PI * 1.4), new THREE.MeshBasicMaterial({ color: PALETTE.foam, transparent: true, opacity: .45 }));
    swirl.rotation.x = -Math.PI / 2; swirl.position.y = .835; cup.add(swirl);

    // steam
    const tex = steamTexture();
    this.steam = Array.from({ length: lite ? 14 : 28 }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      s.userData = { t: Math.random(), seed: Math.random() * 10 }; this.world.add(s); return s;
    });

    // orbiting spices
    const mk = (geo, color, rough = .8) => { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: rough })); m.castShadow = !lite; return m; };
    const makers = {
      pod: () => { const g = new THREE.SphereGeometry(.13, 20, 14); g.scale(1, 1.8, 1); return mk(g, PALETTE.pod); },
      cinnamon: () => mk(new THREE.CylinderGeometry(.07, .07, .9, 16, 1, true), PALETTE.cinnamon),
      anise: () => { const g = new THREE.Group(); for (let i = 0; i < 8; i++) { const p = mk(new THREE.ConeGeometry(.06, .28, 8), PALETTE.anise);
        p.rotation.z = Math.PI / 2; p.position.x = .14; const h = new THREE.Group(); h.add(p); h.rotation.y = i * Math.PI / 4; g.add(h); } return g; },
      ginger: () => mk(new THREE.CylinderGeometry(.2, .2, .05, 20), PALETTE.ginger, .6),
    };
    const order = ["pod", "cinnamon", "anise", "ginger", "pod", "cinnamon", "pod", "anise", "ginger", "pod"].slice(0, lite ? 6 : 10);
    this.spices = new THREE.Group(); this.world.add(this.spices);
    order.forEach((k, i) => { const m = makers[k](); m.userData = { a: i / order.length * TAU, r: 1.85 + (i % 3) * .26, y: -0.4 + (i % 4) * .45, spin: .5 + Math.random() }; this.spices.add(m); });

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
    if (quality === "static") { this._step(1 / 60, 2.2); this.renderer.render(this.scene, this.camera); }
    else this.start();
  }

  setState(s) { this.state = s; if (this.quality === "static") this.renderOnce(); }
  setLevel(v) { this.level = Math.max(0, Math.min(1, v)); }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    // where the cup sits: the page decides (hero: right on laptops, centred on phones)
    const place = this.layout ? this.layout(w, h) : { x: 0, y: 0, scale: 1 };
    this.world.position.set(place.x, place.y, 0); this.world.scale.setScalar(place.scale);
    if (this.quality === "static") this.renderOnce();
  }

  renderOnce() { this._step(1 / 60, this._t || 2.2); this.renderer.render(this.scene, this.camera); }
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

  // step down when the device can't keep up: full → lite settings → a still frame
  _watchPerformance(dt) {
    this._frames.push(dt); if (this._frames.length < 90) return;
    const avg = this._frames.reduce((a, b) => a + b, 0) / this._frames.length; this._frames = [];
    if (avg > 0.034 && this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(1); this.renderer.shadowMap.enabled = false; this.resize();
    } else if (avg > 0.05) { this.frozen = true; this.stop(); }
  }

  _step(dt, t) {
    const s = this.state, speaking = s === "speaking", thinking = s === "thinking" || s === "transcribing";
    const idle = s === "idle";
    this._level += ((speaking ? this.level : 0) - this._level) * Math.min(1, dt * 12);
    const lv = this._level;

    // cup: slow turn; follows the pointer on the landing; a small bounce with the voice
    const spin = this.mode === "avatar" ? (thinking ? .5 : idle ? .08 : .16) : .18;
    this.cup.rotation.y += dt * spin;
    if (this.mode === "hero") { this.cup.rotation.x = this.pointer.y * .08; this.camera.position.x += (this.pointer.x * .8 - this.camera.position.x) * .04; }
    this.cup.position.y = Math.sin(t * (speaking ? 3 : 1.2)) * (speaking ? .025 + lv * .05 : .015);
    this.camera.lookAt(this.world.position.x * (this.mode === "hero" ? .45 : 1), this.world.position.y * .5 + (this.mode === "avatar" ? .1 : 0), 0);
    this.swirl.rotation.z -= dt * (thinking ? 1.6 : .6);

    // chai surface ripples outward with the voice
    const pos = this.surface.geometry.attributes.position, base = this._surfaceBase, amp = .004 + lv * .045;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1], r = Math.hypot(x, y);
      pos.setZ(i, Math.sin(r * 14 - t * 7) * amp * (1 - r));
    }
    pos.needsUpdate = true;

    // spices orbit: calm while listening, a whirl while thinking
    const orbit = thinking ? .9 : idle ? .12 : .22;
    this.spices.children.forEach((m) => {
      const d = m.userData; d.a += dt * orbit;
      m.position.set(Math.cos(d.a) * d.r, d.y + Math.sin(t * .9 + d.a * 3) * .15, Math.sin(d.a) * d.r * .9);
      m.rotation.x += dt * .6 * d.spin; m.rotation.z += dt * .5 * d.spin;
    });

    // steam: gentle while listening, puffs when speaking, faint when idle
    const rise = speaking ? .35 + lv * .5 : idle ? .15 : .24, dens = idle ? .25 : speaking ? .55 + lv * .35 : .45;
    this.steam.forEach((p) => {
      p.userData.t += dt * rise; if (p.userData.t > 1) p.userData.t -= 1;
      const k = p.userData.t;
      p.position.set(this.cup.position.x + Math.sin(k * 5 + p.userData.seed) * .35 * k, .9 + k * 2.4 + this.cup.position.y, Math.cos(k * 4 + p.userData.seed) * .2);
      p.scale.setScalar(.35 + k * 1.2); p.material.opacity = Math.sin(k * Math.PI) * dens;
    });
  }

  destroy() {
    this.stop(); this._ro.disconnect(); this._io.disconnect();
    document.removeEventListener("visibilitychange", this._vis);
    if (this._move) removeEventListener("pointermove", this._move);
    this.renderer.dispose();
  }
}

// available to the non-module app scripts
window.Scene3D = { KulhadScene, qualityTier };
window.dispatchEvent(new Event("scene3d-ready"));
