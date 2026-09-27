/* Visual effects for the café UI — original vanilla-canvas implementations inspired by
   Originkit (Particle Saturn, Ribbon Glow, Cursor Ring Field) and ParticleEffectForUGUI (bursts, trails, attractors).
   Every effect: DPR-aware, pauses when off-screen or the tab is hidden, and renders a still frame for
   prefers-reduced-motion. Exposed as window.FX. */
(() => {
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------------------------------------------------------------- canvas plumbing
  function fitCanvas(cv, scale = 1) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
    const r = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { w, h, dpr };
  }

  /** Runs draw(t, dt) on requestAnimationFrame only while the canvas is visible. */
  function loop(cv, draw, { scale = 1 } = {}) {
    let raf = 0, last = 0, visible = true, running = false;
    const frame = (t) => {
      raf = 0;
      if (!running) return;
      const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
      const size = fitCanvas(cv, scale);
      draw(t / 1000, dt, size);
      if (!REDUCED) raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (running && visible && !document.hidden && !raf) { last = 0; raf = requestAnimationFrame(frame); } };
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); }).observe(cv);
    document.addEventListener("visibilitychange", kick);
    return {
      start() { running = true; kick(); return this; },
      stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
      redraw() { if (REDUCED) { running = true; requestAnimationFrame(frame); } },
    };
  }

  // ---------------------------------------------------------------- Particle Saturn orb (the AI's face)
  /**
   * A planet of particles with tilted rings. States:
   *   idle      — slow drift, dim
   *   listening — rings calm, dust is pulled into the planet (attractor), breathes with the mic level
   *   thinking  — fast spin, shimmering
   *   speaking  — pulses with the voice, ripples run out along the rings
   */
  function ParticleOrb(cv, opts = {}) {
    const ctx = cv.getContext("2d");
    const core = opts.core || [232, 105, 42], ring = opts.ring || [255, 196, 120], dust = opts.dust || [120, 220, 255];
    const N_SPHERE = opts.sphere || 900, N_RING = opts.rings || 1300;
    const pts = [];
    // Fibonacci sphere
    for (let i = 0; i < N_SPHERE; i++) {
      const y = 1 - (i / (N_SPHERE - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963;
      pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, k: 0, s: rand(0.6, 1.2) });
    }
    // rings (radius 1.35–2.1) with bands
    for (let i = 0; i < N_RING; i++) {
      const band = Math.random() < 0.55 ? rand(1.35, 1.7) : rand(1.78, 2.15);
      const a = Math.random() * TAU;
      pts.push({ x: Math.cos(a) * band, y: rand(-0.02, 0.02), z: Math.sin(a) * band, k: 1, s: rand(0.5, 1), band, a });
    }
    const motes = [];                                     // incoming dust for "listening"
    let state = opts.state || "idle", level = 0, smooth = 0, rot = 0, spin = 0.15, energy = 0.4, ripples = [];

    function draw(t, dt, { w, h }) {
      ctx.clearRect(0, 0, w, h);
      const target = { idle: [0.12, 0.35], listening: [0.2, 0.7], thinking: [1.6, 0.9], speaking: [0.35, 1] }[state] || [0.15, 0.4];
      spin += (target[0] - spin) * Math.min(1, dt * 2);
      energy += (target[1] - energy) * Math.min(1, dt * 2);
      smooth += (level - smooth) * Math.min(1, dt * 12);
      rot += spin * dt;
      const R = Math.min(w, h) * 0.2 * (1 + smooth * 0.22 + (state === "listening" ? Math.sin(t * 2) * 0.015 : 0));
      const cx = w / 2, cy = h / 2, tilt = 0.42, fov = 3.2;
      const cr = Math.cos(rot), sr = Math.sin(rot), ct = Math.cos(tilt), st = Math.sin(tilt);

      // soft core glow
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 2.4);
      g.addColorStop(0, `rgba(${core},${0.22 * energy + smooth * 0.2})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

      if (state === "speaking" && smooth > 0.18 && Math.random() < smooth * 0.5) ripples.push({ r: 1.3, life: 1 });
      ripples = ripples.filter((rp) => (rp.r += dt * 1.6, rp.life -= dt * 0.9) > 0);

      ctx.globalCompositeOperation = "lighter";
      for (const p of pts) {
        let { x, y, z } = p;
        if (p.k === 1) {                                  // rings rotate a little faster than the planet
          const a = p.a + rot * 0.6; x = Math.cos(a) * p.band; z = Math.sin(a) * p.band;
        }
        const X = x * cr - z * sr, Z0 = x * sr + z * cr;  // spin (y axis)
        const Y = y * ct - Z0 * st, Z = y * st + Z0 * ct; // tilt (x axis)
        const persp = fov / (fov + Z);
        const sx = cx + X * R * persp, sy = cy + Y * R * persp;
        const front = Z < 0 || p.k === 1 || Math.hypot(X, Y) > 0.98;
        let alpha = (p.k ? 0.55 : 0.85) * (0.45 + 0.55 * energy) * (Z < 0 ? 1 : 0.35) * p.s;
        if (p.k === 1) for (const rp of ripples) if (Math.abs(p.band - rp.r) < 0.12) alpha += rp.life * 0.8;
        if (state === "thinking") alpha *= 0.7 + 0.3 * Math.sin(t * 9 + p.s * 20);
        if (!front) alpha *= 0.5;
        const c = p.k ? ring : core;
        ctx.fillStyle = `rgba(${c},${Math.min(1, alpha)})`;
        const size = (p.k ? 1.1 : 1.4) * persp * (w / 400) * (1 + smooth * 0.4);
        ctx.fillRect(sx, sy, size, size);
      }

      // attractor dust while listening (ParticleEffect-style: particles pulled into a target)
      if (state === "listening" && motes.length < 90 && Math.random() < 0.6 + smooth) {
        const a = Math.random() * TAU, d = Math.max(w, h) * rand(0.45, 0.6);
        motes.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, v: rand(0.6, 1.2), life: 1 });
      }
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i], dx = cx - m.x, dy = cy - m.y, dist = Math.hypot(dx, dy);
        const sp = (60 + 260 * (1 - dist / Math.max(w, h))) * m.v * dt * (w / 400) * (1 + smooth * 2);
        const px = m.x, py = m.y;
        m.x += (dx / dist) * sp; m.y += (dy / dist) * sp;
        if (dist < R * 0.9 || state !== "listening") { motes.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(${dust},${0.5 * m.v})`; ctx.lineWidth = w / 500;
        ctx.beginPath(); ctx.moveTo(px - (dx / dist) * 6, py - (dy / dist) * 6); ctx.lineTo(m.x, m.y); ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }
    const lp = loop(cv, draw).start();
    return {
      setState(s) { state = s; lp.redraw(); },
      setLevel(v) { level = Math.max(0, Math.min(1, v)); },
      stop: () => lp.stop(),
    };
  }

  // ---------------------------------------------------------------- Glow Orb (warm, liquid) — the companion's face
  /**
   * A soft liquid sphere: coloured light blobs drifting inside a gently wobbling edge.
   *   idle — slow breathing · listening — ripples outward, reacts to the mic · thinking — swirls faster
   *   speaking — pulses with the voice and sends soft rings out.
   * palette: 3 hex colours (per persona).
   */
  const hexRgb = (h) => { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function GlowOrb(cv, opts = {}) {
    const ctx = cv.getContext("2d");
    let pal = (opts.palette || ["#FFB38A", "#FF7A45", "#C9A7FF"]).map(hexRgb);
    let state = opts.state || "idle", level = 0, smooth = 0, swirl = 0.25, t0 = Math.random() * 100, rings = [];
    const blobs = Array.from({ length: 5 }, (_, i) => ({ a: (i / 5) * TAU, r: rand(0.2, 0.55), s: rand(0.35, 0.6), sp: rand(0.25, 0.6) * (i % 2 ? 1 : -1), c: i % 3 }));
    function draw(t, dt, { w, h }) {
      t += t0;
      ctx.clearRect(0, 0, w, h);
      const target = { idle: 0.25, listening: 0.45, thinking: 1.6, speaking: 0.7 }[state] || 0.3;
      swirl += (target - swirl) * Math.min(1, dt * 2);
      smooth += (level - smooth) * Math.min(1, dt * 10);
      const cx = w / 2, cy = h / 2, edge = Math.min(w, h) / 2, base = edge * 0.5;
      const breathe = Math.sin(t * (state === "idle" ? 1.1 : 1.8)) * 0.025;
      const R = base * (1 + breathe + smooth * 0.22);

      // soft halo
      // (halo and rings always fade out before the canvas edge, so no hard square ever shows)
      const hr = Math.min(R * 1.9, edge * 0.98);
      const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, hr);
      halo.addColorStop(0, `rgba(${pal[0]},${0.35 + smooth * 0.3})`); halo.addColorStop(1, `rgba(${pal[0]},0)`);
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, hr, 0, TAU); ctx.fill();

      // rings (listening / speaking)
      if ((state === "speaking" && smooth > 0.12 && Math.random() < smooth * 0.18) || (state === "listening" && Math.random() < 0.012 + smooth * 0.1)) rings.push({ r: 1, a: 0.5 });
      rings = rings.filter((rg) => (rg.r += dt * 0.55, rg.a -= dt * 0.35) > 0);
      for (const rg of rings) {
        const rr = R * rg.r, fade = Math.max(0, Math.min(1, (edge * 0.97 - rr) / (edge * 0.15)));
        if (!fade) continue;
        ctx.strokeStyle = `rgba(${pal[1]},${rg.a * fade})`; ctx.lineWidth = Math.max(1, w / 400);
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
      }

      // liquid edge: circle deformed by a few slow sine waves
      ctx.save();
      ctx.beginPath();
      const N = 64, wob = 0.035 + smooth * 0.06 + (state === "thinking" ? 0.02 : 0);
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * TAU;
        const d = 1 + wob * (Math.sin(a * 3 + t * 1.3) * 0.6 + Math.sin(a * 5 - t * 1.7) * 0.4);
        const x = cx + Math.cos(a) * R * d, y = cy + Math.sin(a) * R * d;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.clip();
      // base fill
      const g = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      g.addColorStop(0, `rgb(${pal[0]})`); g.addColorStop(0.55, `rgb(${pal[1]})`); g.addColorStop(1, `rgb(${pal[2]})`);
      ctx.fillStyle = g; ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
      // drifting light blobs
      ctx.globalCompositeOperation = "screen";
      for (const b of blobs) {
        b.a += b.sp * swirl * dt;
        const bx = cx + Math.cos(b.a) * R * b.r, by = cy + Math.sin(b.a * 1.3) * R * b.r;
        const rr = R * b.s * (1 + smooth * 0.4);
        const bg = ctx.createRadialGradient(bx, by, 0, bx, by, rr);
        bg.addColorStop(0, `rgba(${pal[b.c]},0.95)`); bg.addColorStop(1, `rgba(${pal[b.c]},0)`);
        ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bx, by, rr, 0, TAU); ctx.fill();
      }
      // glassy highlight + soft inner shadow
      ctx.globalCompositeOperation = "source-over";
      const hl = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.45, 0, cx - R * 0.35, cy - R * 0.45, R * 0.8);
      hl.addColorStop(0, "rgba(255,255,255,.55)"); hl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hl; ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
      const sh = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R * 1.05);
      sh.addColorStop(0, "rgba(60,30,20,0)"); sh.addColorStop(1, "rgba(60,30,20,.18)");
      ctx.fillStyle = sh; ctx.fillRect(cx - R * 1.2, cy - R * 1.2, R * 2.4, R * 2.4);
      ctx.restore();
    }
    const lp = loop(cv, draw).start();
    return {
      setState(s) { state = s; lp.redraw(); },
      setLevel(v) { level = Math.max(0, Math.min(1, v)); },
      setPalette(p) { pal = p.map(hexRgb); lp.redraw(); },
      stop: () => lp.stop(),
    };
  }

  // ---------------------------------------------------------------- Voice Lines (flowing wave band)
  function WaveLines(cv, { colors = ["#C9A7FF", "#FFB38A"], lines = 26, amp = 0.28 } = {}) {
    const ctx = cv.getContext("2d");
    const [c1, c2] = colors.map(hexRgb);
    function draw(t, dt, { w, h, dpr }) {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < lines; i++) {
        const k = i / (lines - 1);
        const col = c1.map((v, j) => Math.round(v + (c2[j] - v) * k));
        ctx.strokeStyle = `rgba(${col},${0.25 + 0.5 * Math.sin(k * Math.PI)})`;
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 6 * dpr) {
          const u = x / w;
          const y = h * 0.5
            + Math.sin(u * 6.5 + t * 0.6 + k * 2.2) * h * amp * (0.4 + 0.6 * Math.sin(u * Math.PI))
            + Math.sin(u * 2.3 - t * 0.4 + k * 4) * h * amp * 0.35
            + (k - 0.5) * h * 0.35 * Math.cos(u * 3 + t * 0.2);
          x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    }
    return loop(cv, draw).start();
  }

  // ---------------------------------------------------------------- Cursor glow (soft light that follows the pointer)
  function CursorGlow(host, { color = "255,179,138", size = 520 } = {}) {
    if (REDUCED || !matchMedia("(hover: hover)").matches) return;
    const el = document.createElement("div");
    el.className = "cursor-glow";
    Object.assign(el.style, { position: "absolute", left: 0, top: 0, width: size + "px", height: size + "px", borderRadius: "50%",
      pointerEvents: "none", background: `radial-gradient(circle, rgba(${color},.35), rgba(${color},0) 65%)`, translate: "-50% -50%",
      transition: "opacity .4s", opacity: 0, zIndex: 0, mixBlendMode: "multiply" });
    host.appendChild(el);
    let x = 0, y = 0, tx = 0, ty = 0, raf = 0;
    const step = () => { x += (tx - x) * 0.12; y += (ty - y) * 0.12; el.style.transform = `translate(${x}px, ${y}px)`; raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.5 ? requestAnimationFrame(step) : 0; };
    host.addEventListener("pointermove", (e) => { const r = host.getBoundingClientRect(); tx = e.clientX - r.left; ty = e.clientY - r.top; el.style.opacity = 1; if (!raf) raf = requestAnimationFrame(step); });
    host.addEventListener("pointerleave", () => { el.style.opacity = 0; });
  }

  // ---------------------------------------------------------------- Ribbon Glow background
  function RibbonGlow(cv, { colors = [[232, 105, 42], [26, 159, 181], [139, 108, 240]], speed = 1 } = {}) {
    const ctx = cv.getContext("2d");
    const ribbons = colors.map((c, i) => ({ c, seed: i * 1.7 + Math.random(), width: rand(0.18, 0.3) }));
    function draw(t, dt, { w, h }) {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const rb of ribbons) {
        const s = rb.seed, tt = t * 0.12 * speed;
        const p = (k, a, b) => a + (b - a) * (0.5 + 0.5 * Math.sin(tt * (0.7 + k * 0.13) + s * (k + 1)));
        const x0 = -w * 0.1, y0 = p(1, h * 0.1, h * 0.9), x3 = w * 1.1, y3 = p(2, h * 0.1, h * 0.9);
        const x1 = p(3, w * 0.1, w * 0.5), y1 = p(4, -h * 0.3, h * 1.3), x2 = p(5, w * 0.5, w * 0.9), y2 = p(6, -h * 0.3, h * 1.3);
        ctx.lineCap = "round";
        for (let pass = 0; pass < 3; pass++) {           // wide soft glow → bright thin core
          ctx.lineWidth = Math.min(w, h) * rb.width * [1, 0.4, 0.06][pass];
          ctx.strokeStyle = `rgba(${rb.c},${[0.1, 0.18, 0.55][pass]})`;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3); ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = "source-over";
    }
    cv.style.filter = "blur(26px) saturate(1.2)";          // CSS blur works everywhere (canvas filters don't on Safari)
    return loop(cv, draw, { scale: 0.35 }).start();      // low resolution: it's all blur anyway
  }

  // ---------------------------------------------------------------- Cursor Ring Field
  function CursorField(cv, { gap = 26, color = [255, 255, 255], accent = [232, 105, 42] } = {}) {
    const ctx = cv.getContext("2d");
    let mx = -9999, my = -9999, tx = -9999, ty = -9999;
    const host = cv.parentElement;
    host.addEventListener("pointermove", (e) => { const r = cv.getBoundingClientRect(); tx = e.clientX - r.left; ty = e.clientY - r.top; });
    host.addEventListener("pointerleave", () => { tx = ty = -9999; });
    function draw(t, dt, { w, h, dpr }) {
      ctx.clearRect(0, 0, w, h);
      mx += (tx * dpr - mx) * Math.min(1, dt * 8); my += (ty * dpr - my) * Math.min(1, dt * 8);
      const G = gap * dpr, ring = 120 * dpr;
      for (let y = G / 2; y < h; y += G) {
        for (let x = G / 2; x < w; x += G) {
          const dx = x - mx, dy = y - my, d = Math.hypot(dx, dy);
          const wave = Math.sin(x * 0.012 + y * 0.018 + t * 1.2) * 0.5 + 0.5;
          let ox = 0, oy = 0, a = 0.08 + wave * 0.07, c = color, sz = 1.1 * dpr;
          if (d < ring * 1.6) {
            const f = 1 - Math.abs(d - ring) / (ring * 0.6);   // brightest on the ring around the cursor
            if (f > 0) { a += f * 0.6; sz += f * 1.6 * dpr; c = accent; }
            const push = Math.max(0, 1 - d / (ring * 1.6)) * 10 * dpr;
            ox = (dx / (d || 1)) * push; oy = (dy / (d || 1)) * push;
          }
          ctx.fillStyle = `rgba(${c},${a})`;
          ctx.fillRect(x + ox - sz / 2, y + oy - sz / 2, sz, sz);
        }
      }
    }
    return loop(cv, draw).start();
  }

  // ---------------------------------------------------------------- bursts & attractors overlay
  const Particles = (() => {
    let cv, ctx, parts = [], raf = 0;
    function ensure() {
      if (cv) return;
      cv = document.createElement("canvas");
      cv.className = "fx-overlay";
      Object.assign(cv.style, { position: "fixed", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: 150 });
      document.body.appendChild(cv); ctx = cv.getContext("2d");
    }
    function tick(t) {
      raf = 0;
      const { w, h, dpr } = fitCanvas(cv);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const dt = 1 / 60;
      parts = parts.filter((p) => {
        p.age += dt;
        if (p.target) {                                 // attractor: ease along a curve into the target, leaving a trail
          const k = Math.min(1, p.age / p.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          const mx = (p.x0 + p.target.x) / 2 + p.bend.x, my = (p.y0 + p.target.y) / 2 + p.bend.y;
          const nx = (1 - e) * (1 - e) * p.x0 + 2 * (1 - e) * e * mx + e * e * p.target.x;
          const ny = (1 - e) * (1 - e) * p.y0 + 2 * (1 - e) * e * my + e * e * p.target.y;
          p.trail.push([nx, ny]); if (p.trail.length > 8) p.trail.shift();
          p.x = nx; p.y = ny;
          if (k >= 1) { p.onArrive && p.onArrive(); return false; }
        } else {                                        // burst: velocity, drag, gravity
          p.vx *= 0.96; p.vy = p.vy * 0.96 + p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
          p.trail.push([p.x, p.y]); if (p.trail.length > 5) p.trail.shift();
          if (p.age > p.life) return false;
        }
        const a = p.target ? 0.9 : Math.max(0, 1 - p.age / p.life);
        ctx.strokeStyle = `rgba(${p.c},${a * 0.5})`; ctx.lineWidth = p.size * 0.6 * dpr;
        ctx.beginPath(); p.trail.forEach(([x, y], i) => (i ? ctx.lineTo(x * dpr, y * dpr) : ctx.moveTo(x * dpr, y * dpr))); ctx.stroke();
        ctx.fillStyle = `rgba(${p.c},${a})`;
        ctx.beginPath(); ctx.arc(p.x * dpr, p.y * dpr, p.size * dpr, 0, TAU); ctx.fill();
        return true;
      });
      ctx.globalCompositeOperation = "source-over";
      if (parts.length) raf = requestAnimationFrame(tick); else ctx.clearRect(0, 0, w, h);
    }
    const go = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const PALETTE = [[232, 105, 42], [255, 196, 120], [26, 159, 181], [139, 108, 240], [255, 255, 255]];
    const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    return {
      /** Explosion of sparks at (x, y) — orders placed, memories saved. */
      burst(x, y, { count = 40, colors = PALETTE, power = 420, gravity = 380 } = {}) {
        if (REDUCED) return; ensure();
        for (let i = 0; i < count; i++) {
          const a = Math.random() * TAU, v = rand(0.3, 1) * power;
          parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - power * 0.3, g: gravity, age: 0, life: rand(0.6, 1.2),
                       size: rand(1.2, 2.8), c: colors[i % colors.length], trail: [] });
        }
        go();
      },
      burstAt(el, opts) { const c = center(el); this.burst(c.x, c.y, opts); },
      /** Particles fly from one element into another (UIParticleAttractor) — e.g. item → cart. */
      attract(fromEl, toEl, { count = 18, colors = PALETTE, onArrive } = {}) {
        if (REDUCED || !fromEl || !toEl) { onArrive && onArrive(); return; }
        ensure();
        const a = center(fromEl), b = center(toEl);
        let arrived = 0;
        for (let i = 0; i < count; i++) {
          parts.push({ x0: a.x + rand(-30, 30), y0: a.y + rand(-12, 12), x: a.x, y: a.y, target: b, age: -i * 0.025,
                       dur: rand(0.55, 0.85), bend: { x: rand(-120, 120), y: rand(-160, -40) }, size: rand(1.4, 2.6),
                       c: colors[i % colors.length], trail: [],
                       onArrive: () => { if (++arrived === count && onArrive) onArrive(); } });
        }
        go();
      },
    };
  })();

  // ---------------------------------------------------------------- spotlight borders & text scramble
  function spotlight(root = document) {
    root.addEventListener("pointermove", (e) => {
      const el = e.target.closest && e.target.closest(".spot");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    }, { passive: true });
  }

  function scramble(el, { duration = 900 } = {}) {
    if (REDUCED || !el) return;
    const final = el.textContent, glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#*+—";
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / duration);
      el.textContent = final.split("").map((ch, i) => (ch === " " || i / final.length < k) ? ch : glyphs[(Math.random() * glyphs.length) | 0]).join("");
      if (k < 1) requestAnimationFrame(step); else el.textContent = final;
    };
    requestAnimationFrame(step);
  }

  window.FX = { ParticleOrb, GlowOrb, WaveLines, CursorGlow, RibbonGlow, CursorField, Particles, spotlight, scramble, REDUCED };
})();
