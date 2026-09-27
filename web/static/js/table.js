/* Customer app: premium landing & motion, accounts & memory, setup studio, realtime voice (VAD → WAV),
   playback queue, cart, orders, bill with AI minutes meter. */
(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const TABLE_ID = parseInt(params.get("t") || "1", 10);
  const PREFS_KEY = "cafe-companion-prefs";
  const G = window.gsap;
  const getJSON = window.CafeErrors.getJSON;
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DESKTOP = matchMedia("(min-width: 901px) and (hover: hover)").matches;

  let OPTIONS = null;
  let ws = null;
  let started = false;
  let state = "idle";          // idle | listening | transcribing | thinking | speaking
  let muted = false;
  let currency = "₹";
  let me = null;               // logged-in customer profile (null for guests)
  let lenis = null;
  let screen = "landing";

  const prefs = {
    name: "", language: "en-IN", persona: "chai_buddy", persona_name: "", mood: "cheerful",
    topics: ["Just chatting"], custom: "", voice: "priya", pace: 1.0, output: "default", mode: "handsfree",
    speak_replies: true,
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} },
  };
  try { Object.assign(prefs, JSON.parse(store.get(PREFS_KEY) || "{}")); } catch (_) {}
  // Older versions switched to "Type only" (and saved it) whenever the mic was blocked once, which left
  // the conversation stuck in typing mode on every later visit. Reset that once; a real choice sticks after.
  function migratePrefs() { if ((prefs.mode_v || 0) < 2) { if (prefs.mode === "text") prefs.mode = "handsfree"; prefs.mode_v = 2; } }
  migratePrefs();
  let micBlocked = false;      // runtime only — never saved, so tapping the mic can always try again

  // companion → [emoji, glow, orb palette]; category → [emoji, pastel background]
  const PERSONA_LOOK = {
    chai_buddy: ["☕", "rgba(255,122,69,.55)", ["#FFD2B0", "#FF7A45", "#FFB38A"]],
    wise_elder: ["🪷", "rgba(94,156,106,.5)", ["#D9F2DE", "#6FB585", "#FFE6A7"]],
    filmy_friend: ["🎬", "rgba(226,68,122,.5)", ["#FFC3CF", "#E2447A", "#FFB38A"]],
    cricket_fanatic: ["🏏", "rgba(61,123,255,.45)", ["#CFE3FF", "#4F86FF", "#9FE3D6"]],
    motivator: ["🔥", "rgba(255,140,66,.55)", ["#FFE7A3", "#FF8C42", "#FFB38A"]],
    good_listener: ["🌙", "rgba(139,108,240,.5)", ["#E7DAFF", "#9B7BF2", "#FFC6E0"]],
    barista: ["🧑‍🍳", "rgba(184,112,63,.5)", ["#FFE2C2", "#C07A45", "#F5C8A0"]],
  };
  const CAT_LOOK = {
    "Hot Drinks": ["☕", "#FFF1E8"], "Cold Drinks": ["🥤", "#EAF6FF"], "Snacks": ["🥟", "#FFF7E0"],
    "Meals": ["🍛", "#FFEFE8"], "Desserts": ["🍮", "#FBEFFF"], "Breakfast": ["🥞", "#FFF4DC"],
    "Hyderabadi Specials": ["🕌", "#FBE3CF"], "Trending Now": ["🔥", "#FFE3E3"],
  };
  // the order categories appear in (anything new goes at the end)
  const CAT_ORDER = ["Trending Now", "Hyderabadi Specials", "Hot Drinks", "Cold Drinks", "Breakfast", "Snacks", "Meals", "Desserts"];
  const catRank = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 99 : i; };
  const sortMenu = (list) => [...list].sort((a, b) => catRank(a.category) - catRank(b.category) || a.name.localeCompare(b.name));
  const WARM = [[242, 100, 28], [255, 181, 71], [255, 214, 170], [15, 138, 69], [255, 240, 225]];
  // photos come from the server (/api/menu → photo) — only when we have a real picture of that exact dish
  const personaLook = (k) => PERSONA_LOOK[k] || PERSONA_LOOK.chai_buddy;
  // the companion's name: shown styled (Ch·Ai·mate, "Ai" in chai orange); a customer's nickname replaces it
  const nameHTML = (n) => esc(n).replace(/ai/i, (m) => `<span class="ai-mark">${m}</span>`);
  const companionName = () => prefs.persona_name || (OPTIONS && OPTIONS.companion_name) || "ChAimate";
  const look = (cat) => CAT_LOOK[cat] || ["🍽️", "#F6F6F7"];

  // ------------------------------------------------------------------ small helpers
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => `${currency}${Math.round(n).toLocaleString("en-IN")}`;
  function toast(msg, ms = 3500) {
    const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
    t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
  }
  const anim = (target, vars) => (G && !REDUCED ? G.from(target, vars) : null);

  // ------------------------------------------------------------------ motion system
  function initMotion() {
    if (!G || REDUCED) { document.body.classList.remove("is-loading"); $("preloader").remove(); return; }
    G.registerPlugin(window.ScrollTrigger);
    if (window.Lenis) {
      lenis = new window.Lenis({ duration: 1.15, smoothWheel: true });
      lenis.on("scroll", window.ScrollTrigger.update);
      G.ticker.add((t) => lenis.raf(t * 1000));
      G.ticker.lagSmoothing(0);
    }
    // reveal on scroll
    G.utils.toArray(".reveal").forEach((el) => G.from(el, { y: 50, opacity: 0, duration: 1.1, ease: "expo.out", scrollTrigger: { trigger: el, start: "top 88%" } }));
    window.ScrollTrigger.batch(".reveal-card", {
      start: "top 88%",
      onEnter: (els) => G.from(els, { y: 80, opacity: 0, rotateX: -12, duration: 1.2, ease: "expo.out", stagger: 0.12 }),
    });
    // the hero photo slowly settles as you scroll, like a camera pulling back
    G.to("#hero3d", { yPercent: 14, opacity: .35, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
    // topbar hides on scroll down
    let lastY = 0;
    window.addEventListener("scroll", () => {
      const y = window.scrollY; $("topbar").classList.toggle("hide", y > lastY && y > 200 && screen === "landing");
      $("topbar").classList.toggle("scrolled", y > 10); lastY = y;
    }, { passive: true });
    // offer ring
    window.ScrollTrigger.create({ trigger: ".offer", start: "top 75%", once: true, onEnter: () => {
      const free = OPTIONS ? OPTIONS.free_minutes : 10;
      $("offerRing").style.strokeDashoffset = "0";
      const o = { v: 0 }; G.to(o, { v: free, duration: 1.4, ease: "power2.out", onUpdate: () => ($("offerNum").textContent = Math.round(o.v)) });
    } });
    initMagnetic();
  }

  // ------------------------------------------------------------------ 3D (js/scene3d.js) with 2D fallbacks (js/fx.js)
  let heroOrb = null, chatOrb = null;
  // the 3D module is an ES module that loads in parallel; wait for it briefly, then fall back
  function withScene3D(cb) {
    if (window.Scene3D) return cb(window.Scene3D);
    let done = false;
    const go = () => { if (!done) { done = true; cb(window.Scene3D || null); } };
    window.addEventListener("scene3d-ready", go, { once: true });
    setTimeout(go, 4000);
  }
  function initLandingFX() {
    withScene3D((S3) => {
      const tier = S3 ? S3.qualityTier() : "none";
      if (tier === "none") { $("hero3d").classList.add("hidden"); $("heroFallback").classList.remove("hidden"); return; }
      // the kulhad sits to the right of the copy on wide screens, centred above it on phones
      heroOrb = new S3.KulhadScene($("hero3d"), { mode: "hero", quality: tier,
        layout: (w, h) => w > 960 ? { x: Math.min(3.1, 1.6 + w / 1000), y: -0.1, scale: .92 } : { x: 0, y: 0.05, scale: .82 } });
      document.body.dataset.quality = tier;
    });
  }
  function initChatFX() {
    if (chatOrb) return;
    withScene3D((S3) => {
      if (chatOrb) return;
      const tier = S3 ? S3.qualityTier() : "none";
      // ChAimate's face: the living 3D kulhad; the 2D glowing orb where 3D isn't available
      if (tier !== "none") chatOrb = new S3.KulhadScene($("orb"), { mode: "avatar", quality: tier, layout: (w) => ({ x: 0, y: -0.1, scale: w < 520 ? .62 : .76 }) });
      else if (window.FX) chatOrb = FX.GlowOrb($("orb"), { state: "idle", palette: personaLook(prefs.persona)[2] });
      if (chatOrb) chatOrb.setState(state === "transcribing" ? "thinking" : state);
    });
  }
  let preOrb = null;
  if (window.FX) preOrb = FX.GlowOrb($("preOrb"), { state: "thinking", palette: ["#F3D2B5", "#D9531E", "#E9A23B"] });
  function heroIntro() {
    document.body.classList.remove("is-loading");
    document.body.classList.add("on-landing");
    if (!G || REDUCED) { $("preloader")?.remove(); preOrb && preOrb.stop(); return; }
    const tl = G.timeline({ delay: .6 });
    tl.to("#preloader", { opacity: 0, duration: .6, ease: "power2.inOut" })
      .add(() => { $("preloader").remove(); preOrb && preOrb.stop(); })
      .from("#hero3d, #heroFallback", { y: 40, opacity: 0, duration: 1.4, ease: "expo.out" }, "-=.2")
      .from(".hero-title .line > span", { yPercent: 110, duration: 1.1, ease: "expo.out", stagger: .1 }, "-=.8")
      .from(".reveal-up", { y: 18, opacity: 0, duration: .8, ease: "expo.out", stagger: .07 }, "-=.8");
  }

  function initMagnetic() {
    if (!DESKTOP) return;
    document.querySelectorAll(".magnetic").forEach((b) => {
      b.addEventListener("pointermove", (e) => {
        const r = b.getBoundingClientRect();
        G.to(b, { x: (e.clientX - r.left - r.width / 2) * .25, y: (e.clientY - r.top - r.height / 2) * .35, duration: .4, ease: "power3.out" });
      });
      b.addEventListener("pointerleave", () => G.to(b, { x: 0, y: 0, duration: .7, ease: "elastic.out(1, .4)" }));
    });
  }
  // click ripple on every button
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest("button"); if (!b || REDUCED) return;
    const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height);
    const span = document.createElement("span"); span.className = "ripple";
    Object.assign(span.style, { width: s + "px", height: s + "px", left: e.clientX - r.left - s / 2 + "px", top: e.clientY - r.top - s / 2 + "px" });
    b.appendChild(span); setTimeout(() => span.remove(), 700);
  });

  // ------------------------------------------------------------------ landing content
  function buildLanding() {
    currency = OPTIONS.currency;
    $("cafeName").textContent = OPTIONS.cafe_name;
    document.title = `${OPTIONS.companion_name} · ${OPTIONS.cafe_name} · Table ${TABLE_ID}`;
    document.querySelectorAll("[data-cname]").forEach((el) => { el.innerHTML = nameHTML(OPTIONS.companion_name); });
    $("tableLabel").textContent = `Table ${TABLE_ID}`; $("tableLabel").classList.remove("hidden");
    $("freeMins").textContent = $("freeMins2").textContent = OPTIONS.free_minutes;
    $("offerNum").textContent = G && !REDUCED ? 0 : OPTIONS.free_minutes;
    $("perMin").textContent = money(OPTIONS.price_per_minute);


    $("personaTrack").innerHTML = Object.entries(OPTIONS.personas).map(([k, p]) => {
      const [emoji, glow, pal] = personaLook(k);
      return `<button class="p-card card" data-k="${k}">
        <span class="mini-orb" style="--glow:${glow};background:radial-gradient(circle at 32% 28%, ${pal[0]}, ${pal[1]} 60%, ${pal[2]})"><span class="p-emoji">${emoji}</span></span>
        <b>${esc(p.label)}</b><small>${esc(p.desc)}</small></button>`;
    }).join("");
    $("personaTrack").onclick = (e) => {
      const c = e.target.closest(".p-card"); if (!c) return;
      prefs.persona = c.dataset.k; paintSetup(); beginJourney();
    };
  }

  // one menu fetch serves the landing rows, the menu sheet and the cart
  let MENU = null;
  async function loadMenu(force = false) {
    if (!MENU || force) MENU = sortMenu(await getJSON("/api/menu"));
    return MENU;
  }
  const menuItem = (id) => (MENU || []).find((m) => m.id === id);
  function dishPic(m, cls) {
    return m.photo ? `<img class="${cls}" src="${m.photo}" alt="" loading="lazy" decoding="async" />`
                   : `<div class="${cls}" style="background:${look(m.category)[1]}">${look(m.category)[0]}</div>`;
  }
  // ADD → − n + : the same control everywhere a dish appears
  function addControl(m) {
    const n = qtyInCart(m.id);
    return n ? `<span class="stepper" data-id="${m.id}"><button data-step="-1" aria-label="One less">−</button><b>${n}</b><button data-step="1" aria-label="One more">+</button></span>`
             : `<button class="add" data-add="${m.id}">ADD</button>`;
  }

  async function buildHighlights() {
    const items = await loadMenu();
    const cats = [...new Set(items.map((m) => m.category))];
    $("catRow").innerHTML = cats.map((c) => {
      const pic = items.find((m) => m.category === c && m.photo);
      return `<button class="cat" data-cat="${esc(c)}"><span class="cat-img" style="${pic ? `background-image:url(${pic.photo})` : `background:${look(c)[1]}`}">${pic ? "" : look(c)[0]}</span>${esc(c)}</button>`;
    }).join("");
    // bestsellers first, then dishes we have photos of
    const picks = [...items].sort((a, b) => (b.bestseller - a.bestseller) || (!!b.photo - !!a.photo)).slice(0, 8);
    $("heroChips").innerHTML = picks.filter((m) => m.photo).slice(0, 2).map((m) =>
      `<div class="hero-chip"><img src="${m.photo}" alt="" /><span>${esc(m.name)}<small>${money(m.price)}${m.bestseller ? " · Bestseller" : ""}</small></span></div>`).join("");
    if (G && !REDUCED) G.from(".hero-chip", { y: 20, opacity: 0, duration: .8, ease: "back.out(1.7)", stagger: .12, delay: .3 });
    $("menuHighlights").innerHTML = picks.map((m) => `
      <div class="pop reveal-card" data-dish="${m.id}">
        ${dishPic(m, "pop-photo")}
        <div class="pop-body">
          ${m.bestseller ? `<span class="tag-best">★ Bestseller</span>` : ""}
          <b>${esc(m.name)}</b>
          <div class="pop-foot"><span class="price">${money(m.price)}</span><span class="ctl-slot">${addControl(m)}</span></div>
        </div>
      </div>`).join("");
    if (G && !REDUCED) {
      window.ScrollTrigger.batch(".reveal-card", { start: "top 92%", onEnter: (els) => G.from(els, { y: 40, opacity: 0, duration: .9, ease: "expo.out", stagger: .06 }) });
      window.ScrollTrigger.refresh();
    }
  }
  $("catRow").onclick = (e) => { const c = e.target.closest("[data-cat]"); if (c) showMenu(c.dataset.cat); };
  $("btnSeeMenu").onclick = () => showMenu();
  $("menuHighlights").onclick = (e) => cartClick(e);

  function heroForReturning() {
    if (!me) return;
    const first = esc(me.customer.name.split(" ")[0]);
    $("heroTitle").innerHTML = `<span class="line"><span>Welcome back,</span></span><span class="line"><span><em>${first}.</em></span></span>`;
    $("btnHeroLogin").classList.add("hidden");
    const companion = companionName();
    $("heroEyebrow").innerHTML = `<span class="dot"></span> Table ${TABLE_ID} · ${nameHTML(companion)} missed you`;
    $("heroSub").textContent = me.messages.length
      ? `${companion} remembers ${me.memories.length ? me.memories.length + " little things about you" : "your last chat"} and is ready to pick up right where you left off.`
      : `${companion} is ready to meet you. Pull up a chair.`;
    $("heroCta").classList.add("hidden"); $("heroWelcome").classList.remove("hidden");
  }

  // ------------------------------------------------------------------ screens
  function go(next) {
    if (screen === next) return;
    const from = $(screen), to = $(next);
    const swap = () => {
      from.classList.add("hidden"); to.classList.remove("hidden"); screen = next;
      document.body.classList.toggle("on-landing", next === "landing");
      document.body.classList.toggle("on-chat", next === "chat");
      // keep smooth scrolling on for every screen — a stopped Lenis locks page scroll, which on a phone
      // hides everything below the fold (e.g. the "Start talking" button on the setup screen)
      window.scrollTo(0, 0); if (lenis) { lenis.start(); lenis.scrollTo(0, { immediate: true }); }
      $("topbar").classList.remove("hide");
      if (G && !REDUCED) G.fromTo(to, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .9, ease: "expo.out", clearProps: "transform" });
      if (window.ScrollTrigger) window.ScrollTrigger.refresh();
    };
    if (G && !REDUCED) G.to(from, { opacity: 0, y: -20, duration: .45, ease: "power2.in", onComplete: () => { G.set(from, { clearProps: "all" }); swap(); } });
    else swap();
  }
  function openOverlay(id) {
    const o = $(id); o.classList.remove("hidden"); if (lenis) lenis.stop();
    if (G && !REDUCED) {
      G.fromTo(o, { opacity: 0 }, { opacity: 1, duration: .3 });
      const panel = o.querySelector(".sheet, .panel"), phone = matchMedia("(max-width: 960px)").matches;
      if (panel) G.fromTo(panel, panel.classList.contains("sheet") ? { y: 40, scale: .97, opacity: 0 } : phone ? { yPercent: 100 } : { xPercent: 100 },
        { x: 0, y: 0, xPercent: 0, yPercent: 0, scale: 1, opacity: 1, duration: .55, ease: "expo.out" });
    }
  }
  function closeOverlay(id) {
    const o = $(id);
    const done = () => { o.classList.add("hidden"); if (lenis) lenis.start(); };
    if (id === "menuOverlay" && started && ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "menu_done" }));
    if (G && !REDUCED) G.to(o, { opacity: 0, duration: .3, onComplete: done }); else done();
  }
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-close]"); if (c) closeOverlay(c.dataset.close);
    if (e.target.classList && e.target.classList.contains("overlay")) closeOverlay(e.target.id);
  });

  // entry points from the landing page
  // one tap: straight into the conversation (guests too). Persona, voice and mood can be changed from the chat.
  function beginJourney() {
    if (started) { go("chat"); return; }
    start();
  }
  $("btnHeroStart").onclick = beginJourney;
  $("btnFooterStart").onclick = beginJourney;
  $("btnHeroLogin").onclick = () => openOverlay("authOverlay");
  $("brandLink").onclick = (e) => { e.preventDefault(); if (!started) go("landing"); };

  // ------------------------------------------------------------------ setup studio
  let step = 0;
  function showSetup() { paintSetup(); setStep(0); go("setup"); }
  function setStep(i) {
    const steps = document.querySelectorAll(".studio-step");
    const prev = step; step = Math.max(0, Math.min(i, steps.length - 1));
    steps.forEach((s, n) => s.classList.toggle("hidden", n !== step));
    document.querySelectorAll("#stepsNav span").forEach((s, n) => { s.classList.toggle("on", n === step); s.classList.toggle("done", n < step); });
    $("btnBack").style.visibility = step === 0 ? "hidden" : "visible";
    $("btnNext").classList.toggle("hidden", step === steps.length - 1);
    $("btnStart").classList.toggle("hidden", step !== steps.length - 1);
    if (G && !REDUCED) G.fromTo(steps[step], { x: (step >= prev ? 60 : -60), opacity: 0 }, { x: 0, opacity: 1, duration: .7, ease: "expo.out" });
  }
  $("btnNext").onclick = () => { readSetup(); setStep(step + 1); };
  $("btnBack").onclick = () => setStep(step - 1);

  function buildSetup() {
    $("language").innerHTML = Object.entries(OPTIONS.languages).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
    $("voice").innerHTML = OPTIONS.voice_mode === "sarvam"
      ? Object.entries(OPTIONS.voices).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")
      : `<option value="browser">Device voice</option>`;
    $("personas").innerHTML = Object.entries(OPTIONS.personas).map(([k, p]) =>
      `<div class="persona" data-k="${k}"><span class="pe" style="background:radial-gradient(circle at 32% 28%, ${personaLook(k)[2][0]}, ${personaLook(k)[2][1]})">${personaLook(k)[0]}</span><b>${esc(p.label)}</b><small>${esc(p.desc)}</small></div>`).join("");
    $("moods").innerHTML = Object.keys(OPTIONS.moods).map((m) => `<span class="chip" data-k="${m}">${m}</span>`).join("");
    $("quickMoods").innerHTML = $("moods").innerHTML;
    $("topics").innerHTML = OPTIONS.topics.map((t) => `<span class="chip" data-k="${esc(t)}">${esc(t)}</span>`).join("");

    $("personas").onclick = (e) => {
      const el = e.target.closest(".persona"); if (!el) return;
      prefs.persona = el.dataset.k; paintSetup();
      if (chatOrb && chatOrb.setPalette) chatOrb.setPalette(personaLook(prefs.persona)[2]); if (started) tintChat();
    };
    $("moods").onclick = (e) => { const el = e.target.closest(".chip"); if (el) { prefs.mood = el.dataset.k; paintSetup(); } };
    $("quickMoods").onclick = (e) => {
      const el = e.target.closest(".chip"); if (!el) return;
      prefs.mood = el.dataset.k; paintSetup(); savePrefs(); sendPrefs(); toast(`Mood switched to ${prefs.mood}`);
    };
    $("topics").onclick = (e) => {
      const el = e.target.closest(".chip"); if (!el) return;
      const k = el.dataset.k, i = prefs.topics.indexOf(k);
      i >= 0 ? prefs.topics.splice(i, 1) : prefs.topics.push(k);
      paintSetup();
    };
  }

  function paintSetup() {
    $("name").value = prefs.name; $("language").value = prefs.language; $("personaName").value = prefs.persona_name;
    $("custom").value = prefs.custom; $("pace").value = String(parseFloat(prefs.pace) || 1); $("mode").value = prefs.mode;
    if ([...$("voice").options].some((o) => o.value === prefs.voice)) $("voice").value = prefs.voice;
    if ([...$("output").options].some((o) => o.value === prefs.output)) $("output").value = prefs.output;
    document.querySelectorAll("#personas .persona").forEach((el) => el.classList.toggle("on", el.dataset.k === prefs.persona));
    document.querySelectorAll("#moods .chip, #quickMoods .chip").forEach((el) => el.classList.toggle("on", el.dataset.k === prefs.mood));
    document.querySelectorAll("#topics .chip").forEach((el) => el.classList.toggle("on", prefs.topics.includes(el.dataset.k)));
    const persona = (OPTIONS && OPTIONS.personas[prefs.persona] || {}).label;
    $("companionName").innerHTML = nameHTML(companionName()) + (persona ? `<span class="persona-tag">${esc(persona)}</span>` : "");
  }
  function readSetup() {
    prefs.name = $("name").value.trim(); prefs.language = $("language").value;
    prefs.persona_name = $("personaName").value.trim(); prefs.custom = $("custom").value.trim();
    prefs.voice = $("voice").value; prefs.pace = parseFloat($("pace").value) || 1;
    prefs.output = $("output").value; prefs.mode = $("mode").value;
  }
  function savePrefs() {
    store.set(PREFS_KEY, JSON.stringify(prefs));
    if (me) fetch("/api/customer/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prefs) }).catch(() => {});
  }
  function sendPrefs() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "prefs", prefs: wirePrefs() })); }
  // hearing the AI is independent of how you talk to it (typing, or a blocked mic, must not silence replies)
  function wirePrefs() { return { ...prefs, speak_replies: prefs.speak_replies !== false }; }

  $("btnPreview").onclick = async () => {
    readSetup();
    const lang = prefs.language;
    if (OPTIONS.voice_mode !== "sarvam") {
      const u = new SpeechSynthesisUtterance("Hi! I'm Chaimate, your chai-mate for today."); u.lang = lang; speechSynthesis.speak(u); return;
    }
    $("btnPreview").disabled = true;
    try {
      const r = await fetch(`/api/voice/preview?voice=${encodeURIComponent(prefs.voice)}&lang=${encodeURIComponent(lang)}&pace=${prefs.pace}`);
      if (!r.ok) throw new Error();
      const { audio } = await r.json();
      const a = new Audio("data:audio/mpeg;base64," + audio);
      if (prefs.output !== "default" && a.setSinkId) a.setSinkId(prefs.output).catch(() => {});
      await a.play();
    } catch (_) { toast("Couldn't play the preview"); }
    finally { $("btnPreview").disabled = false; }
  };

  // Output device picker (Chrome/Edge/Android support setSinkId; iOS routes to AirPods automatically)
  async function listOutputs() {
    if (!("setSinkId" in HTMLMediaElement.prototype) || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      // some phones never answer this until a permission is granted — never let it hold up the UI
      const devices = await Promise.race([navigator.mediaDevices.enumerateDevices(),
                                          new Promise((r) => setTimeout(() => r([]), 1500))]);
      const outs = devices.filter((d) => d.kind === "audiooutput" && d.deviceId !== "default");
      $("output").innerHTML = `<option value="default">This device / connected AirPods</option>` +
        outs.map((d, i) => `<option value="${d.deviceId}">${esc(d.label || "Speaker " + (i + 1))}</option>`).join("");
    } catch (_) {}
  }

  // ------------------------------------------------------------------ conversation state & orb
  const STATE_TEXT = {
    idle: "Mic paused — tap to talk", listening: "Listening…", transcribing: "Got it…",
    thinking: "Thinking…", speaking: "Speaking · talk anytime",
  };
  function setState(s) {
    state = s;
    $("orb").setAttribute("class", "orb " + s);
    $("orb").parentElement.className = "orb-wrap " + s;
    $("stateLabel").innerHTML = (s !== "idle" ? '<span class="dot"></span> ' : "") + (muted && s === "listening" ? "Mic off — tap to talk" : (STATE_TEXT[s] || s));
    $("stateLabel").classList.toggle("live", s !== "idle");
    if (chatOrb) chatOrb.setState(s === "transcribing" ? "thinking" : s);
    $("chat").dataset.state = s;
    if (s === "thinking" || s === "transcribing") lastBusyAt = Date.now();
    if (s === "listening") armNudge(); else clearTimeout(nudgeTimer);
    paintTalk();
  }
  let lastBusyAt = 0;
  function setCaption(text, who = "ai") {
    const c = $("caption"); if (!c) return;
    c.dataset.who = who; c.textContent = text || "";
    c.classList.toggle("on", !!text);
  }
  // mic level (listening) and voice level (speaking) both drive the particle orb
  function orbPulse(rms) {
    const v = Math.min(1, rms * 9);
    if (chatOrb) chatOrb.setLevel(v);
    if (state !== "speaking") $("btnTalk").style.setProperty("--lvl", v.toFixed(3));
  }

  function bubble(kind, text, extra = "") {
    const el = document.createElement("div");
    el.className = "bubble " + kind + (extra ? " " + extra : ""); el.textContent = text;
    $("transcript").appendChild(el);
    $("transcript").scrollTop = $("transcript").scrollHeight;
    if (kind !== "sys" && !extra) anim(el, { y: 18, opacity: 0, scale: .96, duration: .6, ease: "expo.out", transformOrigin: kind === "user" ? "100% 100%" : "0% 100%" });
    return el;
  }

  // ------------------------------------------------------------------ audio playback (Web Audio API)
  // One AudioContext, unlocked by the customer's tap, plays every clip. Unlike a new <audio> element per clip,
  // this keeps working on iPhone/Safari after the first tap, and lets us detect a blocked speaker.
  const Speaker = {
    ctx: null, gain: null, blocked: false,
    unlock() {                                   // call inside a user gesture (tap/click)
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          this.ctx = new AC();
          this.gain = this.ctx.createGain();
          this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 512;
          this.gain.connect(this.analyser); this.analyser.connect(this.ctx.destination);
          this.levels = new Uint8Array(this.analyser.fftSize);
          if (prefs.output !== "default" && this.ctx.setSinkId) this.ctx.setSinkId(prefs.output).catch(() => {});
        }
        if (this.ctx.state === "suspended") this.ctx.resume();
        // a silent 1-sample buffer finishes the iOS unlock
        const b = this.ctx.createBuffer(1, 1, 22050), src = this.ctx.createBufferSource();
        src.buffer = b; src.connect(this.gain); src.start(0);
        speechSynthesis.speak(new SpeechSynthesisUtterance(""));
        this.setBlocked(false);
      } catch (e) { window.CafeErrors.report("audio unlock failed: " + e.message, "speaker"); }
    },
    setBlocked(v) {
      this.blocked = v;
      $("soundPrompt").classList.toggle("hidden", !v);
    },
    async play(b64) {                            // resolves when the clip has finished playing
      if (!this.ctx) this.unlock();
      if (this.ctx.state !== "running") {
        try { await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 400))]); } catch (_) {}
        if (this.ctx.state !== "running") { this.setBlocked(true); throw new Error("audio blocked by the browser"); }
      }
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const buf = await this.ctx.decodeAudioData(bytes.buffer);
      return new Promise((resolve) => {
        const src = this.ctx.createBufferSource();
        src.buffer = buf; src.connect(this.gain);
        src.onended = () => { if (currentSource === src) currentSource = null; resolve(); };
        currentSource = src;
        src.start(0);
        const meter = () => {                          // the orb pulses with the AI's own voice
          if (currentSource !== src) { orbPulse(0); return; }
          this.analyser.getByteTimeDomainData(this.levels);
          let sum = 0; for (const v of this.levels) sum += (v - 128) * (v - 128);
          orbPulse(Math.sqrt(sum / this.levels.length) / 128);
          requestAnimationFrame(meter);
        };
        requestAnimationFrame(meter);
      });
    },
  };
  let currentSource = null;

  const playQueue = [];
  let currentAudio = null;
  let turnDone = true;

  function enqueueAudio(msg) {
    playQueue.push(msg);
    if (!currentAudio && !speechSynthesis.speaking) playNext();
  }
  // "Hmm." / "Achha." — a tiny listening noise when the reply takes a moment, like a person thinking.
  // Clips are made once per voice & language on the server and cached; played at most once per turn.
  let bcClips = [], bcTimer = null, bcLast = -1;
  async function loadBackchannels() {
    bcClips = [];
    if (OPTIONS.voice_mode !== "sarvam") return;
    try { bcClips = (await getJSON(`/api/voice/backchannels?voice=${encodeURIComponent(prefs.voice)}&lang=${encodeURIComponent(prefs.language)}`)).clips || []; }
    catch (_) { bcClips = []; }
  }
  function armBackchannel() {
    clearTimeout(bcTimer);
    if (!bcClips.length || prefs.speak_replies === false || Math.random() < 0.35) return;
    bcTimer = setTimeout(() => {
      if (currentAudio || playQueue.length || state === "speaking" || state === "listening") return;
      let i = Math.floor(Math.random() * bcClips.length); if (i === bcLast) i = (i + 1) % bcClips.length; bcLast = i;
      currentAudio = "backchannel";
      Speaker.play(bcClips[i].audio).catch(() => {}).finally(() => {
        if (currentAudio === "backchannel") currentAudio = null;
        if (playQueue.length) playNext();
      });
    }, 850);
  }
  function playNext() {
    const msg = playQueue.shift();
    if (!msg) { currentAudio = null; if (turnDone) afterSpeaking(); return; }
    setState("speaking");
    if (msg.text) setCaption(msg.text, "ai");
    if (prefs.speak_replies === false) { playNext(); return; }
    if (msg.data) {
      currentAudio = "webaudio";
      Speaker.play(msg.data)
        .catch((e) => {
          console.warn("voice playback failed:", e.message);
          if (!Speaker.blocked) window.CafeErrors.report("voice playback failed: " + e.message, "speaker");
          if (!Speaker.blocked) return browserSpeak(msg);          // decode issue: read it with the device voice
        })
        .finally(() => { currentAudio = null; playNext(); });
    } else if (msg.text && (OPTIONS.voice_mode !== "sarvam" || msg.tts_failed)) {
      // browser voice: when the server has no Sarvam key, or Sarvam failed for this sentence
      const u = new SpeechSynthesisUtterance(msg.text);
      u.lang = msg.lang || prefs.language; u.rate = prefs.pace;
      const v = speechSynthesis.getVoices().find((x) => x.lang.replace("_", "-").startsWith(u.lang.slice(0, 2)));
      if (v) u.voice = v;
      currentAudio = u;
      u.onend = u.onerror = () => { currentAudio = null; playNext(); };
      speechSynthesis.speak(u);
    } else {
      playNext();
    }
  }
  function browserSpeak(msg) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(msg.text || "");
      u.lang = msg.lang || prefs.language; u.rate = prefs.pace;
      u.onend = u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }
  function stopPlayback() {
    playQueue.length = 0;
    if (currentSource) { try { currentSource.onended = null; currentSource.stop(); } catch (_) {} currentSource = null; }
    if (currentAudio instanceof HTMLAudioElement) { currentAudio.pause(); currentAudio.src = ""; }
    speechSynthesis.cancel();
    currentAudio = null;
  }
  function afterSpeaking() {
    if (!started) return;
    setCaption("");
    setState(handsFree() ? "listening" : "idle");
    if (browserSTT) browserSTT.resume();
  }

  // ------------------------------------------------------------------ mic capture with VAD (→ 16 kHz WAV)
  const Mic = {
    ctx: null, stream: null, node: null,
    recording: false, chunks: [], preroll: [], noise: 0.01,
    speechMs: 0, silenceMs: 0, forced: false,

    // Call synchronously inside the tap: an AudioContext made after an await (the permission prompt) starts
    // "suspended" on iPhone/Safari and never delivers a single frame — the mic looks on but hears nothing.
    prepare() {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    },
    async init() {
      this.prepare();
      if (this.stream) return;
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.node = this.ctx.createScriptProcessor(4096, 1, 1);
      src.connect(this.node); this.node.connect(this.ctx.destination);
      this.node.onaudioprocess = (e) => this.onFrame(e.inputBuffer.getChannelData(0));
    },

    onFrame(input) {
      const frame = new Float32Array(input);
      const frameMs = (frame.length / this.ctx.sampleRate) * 1000;
      let sum = 0; for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
      const rms = Math.sqrt(sum / frame.length);
      if (state === "listening" || this.forced) orbPulse(rms);

      if (this.forced) { this.chunks.push(frame); return; }                 // push-to-talk
      if (!handsFree() || state === "transcribing") { this.preroll = []; this.speechMs = 0; return; }

      // Stricter while the AI's own voice is playing, so speaker echo can't cut it off — a real voice still can.
      const speaking = state === "speaking";
      const threshold = speaking ? Math.max(0.045, this.noise * 6) : Math.max(0.014, this.noise * 3);

      if (!this.recording) {
        if (rms < threshold) this.noise = Math.min(0.03, this.noise * 0.95 + rms * 0.05);   // adapt to room noise
        this.preroll.push(frame); if (this.preroll.length > 5) this.preroll.shift();
        if (rms > threshold) {
          this.speechMs += frameMs;
          if (this.speechMs > (speaking ? 320 : 200)) {
            this.recording = true; this.silenceMs = 0; this.voicedMs = this.speechMs; this.chunks = [...this.preroll];
            if (state === "speaking" || state === "thinking") bargeIn();
            userSpeaking(true);
          }
        } else this.speechMs = Math.max(0, this.speechMs - frameMs);
        return;
      }

      this.chunks.push(frame);
      if (rms >= threshold * 0.8) { this.silenceMs = 0; this.voicedMs += frameMs; } else this.silenceMs += frameMs;
      const totalMs = this.chunks.length * frameMs;
      // End of turn: ~1 s of quiet (people pause mid-thought; 0.75 s cut them off), a bit longer after a
      // very short burst ("umm…"), and a 30 s ceiling — the same shape as OpenJarvis's record_until_silence.
      const endAfter = this.voicedMs < 600 ? 1300 : 1000;
      if (this.silenceMs > endAfter || totalMs > 30000) this.finish();
    },

    startForced() { this.chunks = []; this.forced = true; },
    stopForced() { this.forced = false; this.finish(); },

    finish() {
      this.recording = false; this.speechMs = 0;
      const chunks = this.chunks, voiced = this.voicedMs || 0; this.chunks = []; this.voicedMs = 0;
      if (chunks.length < 3 || (!this.forced && voiced < 250)) { userSpeaking(false); return; }   // a cough, a cup
      sendAudio(encodeWav(chunks, this.ctx.sampleRate, 16000));
    },
  };

  function encodeWav(chunks, inRate, outRate) {
    const len = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(len); let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    const ratio = inRate / outRate, outLen = Math.floor(len / ratio);
    const buf = new ArrayBuffer(44 + outLen * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + outLen * 2, true); w(8, "WAVE"); w(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, outRate, true); v.setUint32(28, outRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, "data"); v.setUint32(40, outLen * 2, true);
    for (let i = 0; i < outLen; i++) {
      const s = Math.max(-1, Math.min(1, merged[Math.floor(i * ratio)]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buf);
  }
  function toB64(bytes) {
    let s = ""; const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return btoa(s);
  }
  // a live bubble while the customer is talking, filled in with what we heard — the chat reads end to end
  let liveBubble = null;
  function userSpeaking(on) {
    if (on) {
      clearTimeout(nudgeTimer);
      if (!liveBubble) { liveBubble = bubble("user", "", "live"); liveBubble.innerHTML = '<i></i><i></i><i></i><i></i><i></i>'; }
      setCaption("…", "you");
    } else if (liveBubble) { liveBubble.remove(); liveBubble = null; setCaption(""); }
  }
  function fillUserBubble(text) {
    if (liveBubble) { liveBubble.classList.remove("live"); liveBubble.textContent = text; liveBubble = null; }
    else bubble("user", text);
    setCaption("");
    $("transcript").scrollTop = $("transcript").scrollHeight;
  }
  function sendAudio(wavBytes) {
    if (!ws || ws.readyState !== 1) { userSpeaking(false); return; }
    setState("transcribing");
    ws.send(JSON.stringify({ type: "audio", mime: "audio/wav", data: toB64(wavBytes) }));
  }
  function bargeIn() {
    stopPlayback();
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "interrupt" }));
    setState("listening");
  }

  function handsFree() { return started && prefs.mode === "handsfree" && !muted && !micBlocked; }
  async function enableMic() {                    // call from a tap
    Mic.prepare();
    try {
      if (OPTIONS.voice_mode === "sarvam") await Mic.init();
      else if (!browserSTT) setupBrowserSTT(); else browserSTT.resume();
      micBlocked = false; return true;
    } catch (e) {
      micBlocked = true;
      window.CafeErrors.report("microphone unavailable: " + (e.name || e.message), "mic");
      toast(!window.isSecureContext ? "The mic needs a secure (https://) link on phones — type for now; you'll still hear replies."
            : "Mic is blocked — allow it in the browser's site settings, then tap the mic again. You can type meanwhile.", 7000);
      return false;
    } finally { paintTalk(); }
  }
  function paintTalk() {
    const t = $("btnTalk"); if (!t) return;
    const off = micBlocked || prefs.mode === "text", live = handsFree() && state === "listening";
    t.classList.toggle("muted", muted || off);
    t.classList.toggle("live", live);
    t.dataset.mode = off ? "off" : prefs.mode;
    t.title = off ? "Tap to talk with your voice" : prefs.mode === "ptt" ? "Hold to talk" : muted ? "Mic muted — tap to unmute" : "Listening — tap to mute";
    $("talkHint") && ($("talkHint").textContent = off ? "Tap to talk" : prefs.mode === "ptt" ? "Hold to talk" : muted ? "Muted" : "Mic on");
  }
  // A real friend fills a long silence now and then. After ~45 s of quiet the browser asks the companion to
  // check in (the server allows two in a row, then waits for the customer) — the OpenJarvis "proactive" idea.
  let nudgeTimer = null;
  function armNudge() {
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
      if (state === "listening" && !Mic.recording && document.visibilityState === "visible" && ws && ws.readyState === 1)
        ws.send(JSON.stringify({ type: "nudge" }));
    }, 45000);
  }
  // never leave the customer staring at "Thinking…" if a reply got lost on a flaky connection
  setInterval(() => {
    if ((state === "thinking" || state === "transcribing") && !aiBubble && Date.now() - lastBusyAt > 25000) {
      userSpeaking(false); afterSpeaking(); toast("That took too long — say it again?");
    }
  }, 2000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Mic.ctx) Mic.ctx.resume().catch(() => {}); });
  document.addEventListener("pointerdown", () => { if (Mic.ctx && Mic.ctx.state === "suspended") Mic.ctx.resume().catch(() => {}); }, { passive: true });

  // ------------------------------------------------------------------ browser speech recognition fallback
  let browserSTT = null;
  function setupBrowserSTT() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("Voice input isn't supported in this browser — type instead."); return; }
    const r = new SR(); r.lang = prefs.language; r.continuous = true; r.interimResults = false;
    let paused = false;
    r.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      if (!res.isFinal) return;
      const text = res[0].transcript.trim(); if (!text) return;
      if (state === "speaking") bargeIn();
      fillUserBubble(text); sendText(text, false);
    };
    r.onend = () => { if (!paused && !muted && started) try { r.start(); } catch (_) {} };
    browserSTT = {
      start() { paused = false; try { r.start(); } catch (_) {} },
      pause() { paused = true; try { r.stop(); } catch (_) {} },
      resume() { if (handsFree()) this.start(); },
    };
    browserSTT.start();
  }

  // ------------------------------------------------------------------ websocket
  let aiBubble = null;
  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws/table/${TABLE_ID}`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start", prefs: wirePrefs() }));
      while (pendingCart.length) ws.send(JSON.stringify(pendingCart.shift()));   // ADD taps made while connecting
    };
    ws.onclose = () => { setState("idle"); $("stateLabel").textContent = "Reconnecting…"; setTimeout(reconnect, 2000); };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { window.CafeErrors.report("bad websocket message", "ws"); return; }
      try { handle(m); } catch (err) { console.error(err); window.CafeErrors.report(err.message, `ws:${m.type}`, err.stack); }
    };
    ws.onerror = () => console.warn("websocket error — will reconnect");
  }
  function reconnect() { if (started && (!ws || ws.readyState === 3)) connect(); }

  function handle(m) {
    switch (m.type) {
      case "status":
        if (m.state === "listening") { userSpeaking(false); afterSpeaking(); } else setState(m.state);
        break;
      case "transcript":
        fillUserBubble(m.text);
        armBackchannel();
        break;
      case "activity": activity(m); break;
      case "assistant_delta":
        clearTimeout(nudgeTimer);
        if (!aiBubble) { aiBubble = bubble("ai", "", ""); aiBubble.classList.add("typing"); turnDone = false; }
        aiBubble.textContent += m.text;
        $("transcript").scrollTop = $("transcript").scrollHeight;
        break;
      case "audio":
        clearTimeout(bcTimer);
        enqueueAudio(m);
        break;
      case "assistant_done":
        if (aiBubble) {
          aiBubble.classList.remove("typing");
          // tidy any markdown the model slipped in (**bold**, "- " bullets)
          aiBubble.textContent = aiBubble.textContent.replace(/\*\*/g, "").replace(/^\s*[-•*]\s+/gm, "");
          if (m.interrupted) aiBubble.textContent += " …";
          if (!aiBubble.textContent.trim()) aiBubble.remove();
        }
        aiBubble = null; turnDone = true;
        if (!currentAudio && playQueue.length === 0) afterSpeaking();
        break;
      case "meter": renderMeter(m); break;
      case "cart": {
        const before = cartCount; renderCart(m.cart, m.total);
        cartChange(m.change);
        const sheetOpen = !$("menuOverlay").classList.contains("hidden") || !$("cartOverlay").classList.contains("hidden");
        if (cartCount > before && window.FX && screen === "chat" && !sheetOpen && !$("cartBar").classList.contains("hidden")) {
          FX.Particles.attract($("orb"), $("cartBar"), { count: 18, colors: WARM });   // from the companion into the cart
        }
        break;
      }
      case "order_placed":
        toast(`Order sent to the kitchen 🎉`); refreshBill();
        if (!$("cartOverlay").classList.contains("hidden")) closeOverlay("cartOverlay");
        if (window.FX) FX.Particles.burstAt($("orb"), { count: 70, colors: WARM });
        break;
      case "order_update":
        if (m.announce) { toast(m.announce, 5000); bubble("sys", m.announce); }
        refreshBill();
        break;
      case "settled": toast("Bill settled. Thank you for visiting! 🙏", 6000); refreshBill(); break;
      case "staff_request": toast("Staff has been notified 👍"); break;
      case "memory_saved":
        if (me) { me.memories.push(m.memory); renderMemories(); }
        if (window.FX) FX.Particles.burstAt($("orb"), { count: 26, power: 240, gravity: 0, colors: [[201, 167, 255], [255, 179, 138], [255, 255, 255]] });
        toast("💭 I'll remember that");
        break;
      case "memory_deleted":
        if (me) { me.memories = me.memories.filter((x) => x.id !== m.memory_id); renderMemories(); }
        break;
      case "error": toast(m.message); userSpeaking(false); afterSpeaking(); break;
    }
  }

  // what the companion is doing, as a small line in the chat (OpenJarvis shows tool calls the same way)
  const ACTIVITY = {
    web_search: ["🔎", "Checking the web", "Checked the web"], order_status: ["🧾", "Looking at your table", "Checked your table"],
    add_to_cart: ["🛒", "Adding to your cart", "Added to your cart"], remove_from_cart: ["🛒", "Updating your cart", "Cart updated"],
    place_order: ["👩‍🍳", "Sending to the kitchen", "Sent to the kitchen"], call_staff: ["🙋", "Calling the staff", "Staff are on their way"],
    remember: ["💭", "Noting that down", "Noted"],
  };
  const activities = {};
  function activity(m) {
    const a = ACTIVITY[m.tool]; if (!a) return;
    if (m.phase === "start" && m.tool === "web_search") {
      const chip = document.createElement("div"); chip.className = "act";
      chip.innerHTML = `<span class="spin"></span><span>${esc(a[1])}${m.detail ? ` · “${esc(m.detail.slice(0, 40))}”` : ""}</span>`;
      activities._chip = chip; showAct(chip, 0);
    } else if (m.tool === "web_search" && activities._chip) { activities._chip.remove(); activities._chip = null; }
    if (m.phase === "start") {
      const el = bubble("act", "", "act");
      el.innerHTML = `<span class="ic">${a[0]}</span><span class="tx">${esc(a[1])}${m.detail ? ` <em>“${esc(m.detail)}”</em>` : ""}</span><span class="spin"></span>`;
      activities[m.tool] = el;
    } else {
      const el = activities[m.tool]; delete activities[m.tool];
      if (!el) return;
      el.classList.add(m.ok ? "done" : "fail");
      el.querySelector(".tx").textContent = m.ok ? a[2] : "Couldn't reach it just now";
    }
  }

  function sendText(text, show = true) {
    if (!text || !ws || ws.readyState !== 1) return;
    stopPlayback();
    if (show) bubble("user", text);
    ws.send(JSON.stringify({ type: "text", text, lang: prefs.language }));
    setState("thinking");
  }

  // ------------------------------------------------------------------ meter, cart, bill, menu
  function renderMeter(m) {
    const card = document.querySelector(".meter-card");
    const C = 170;
    if (m.free_left > 0) {
      card.classList.remove("paid");
      $("meterNum").textContent = m.free_left;
      $("meterRing").style.strokeDashoffset = String(C * (m.free_left / m.free_minutes));
      $("meterTitle").textContent = `${m.free_left} free minute${m.free_left === 1 ? "" : "s"} left`;
      $("meterSub").textContent = `Then ${money(m.price_per_minute)}/min · only minutes you actually talk count.`;
    } else {
      card.classList.add("paid");
      $("meterNum").textContent = m.billable_minutes;
      $("meterRing").style.strokeDashoffset = "0";
      $("meterTitle").textContent = `${money(m.amount)} on your bill`;
      $("meterSub").textContent = `${m.billable_minutes} paid min · ${money(m.price_per_minute)}/min after ${m.free_minutes} free.`;
    }
    $("meterMini").textContent = m.free_left > 0 ? `${m.free_left} free min left` : `${money(m.amount)} on bill`;
    $("aiMin").textContent = m.minutes; $("aiAmt").textContent = m.amount ? money(m.amount) : "free";
    $("aiLine").classList.toggle("hidden", !m.minutes);
  }

  let cartCount = 0, CART = [];
  const qtyInCart = (id) => CART.filter((c) => c.menu_item_id === id).reduce((n, c) => n + c.qty, 0);
  const pendingCart = [];                          // taps before the conversation has connected
  function setQty(id, qty, by = "menu") {
    const msg = { type: "cart_set", menu_item_id: id, qty: Math.max(0, qty), by };
    if (!started) { pendingCart.push(msg); start(); return; }
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); else pendingCart.push(msg);
  }
  // one handler for every ADD / − / + in the app (landing rows, menu sheet, cart sheet)
  function cartClick(e) {
    const add = e.target.closest("[data-add]");
    if (add) { const id = +add.dataset.add; setQty(id, qtyInCart(id) + 1); pop(add); return true; }
    const st = e.target.closest("[data-step]");
    if (st) { const id = +st.closest(".stepper").dataset.id; setQty(id, qtyInCart(id) + (+st.dataset.step)); pop(st); return true; }
    return false;
  }
  const pop = (el) => G && !REDUCED && G.fromTo(el, { scale: .85 }, { scale: 1, duration: .45, ease: "back.out(3)" });
  function refreshControls() {
    document.querySelectorAll("[data-dish]").forEach((row) => {
      const m = menuItem(+row.dataset.dish), slot = row.querySelector(".ctl-slot");
      if (m && slot) slot.innerHTML = addControl(m);
    });
  }
  function renderCart(cart, total) {
    CART = cart;
    cartCount = cart.reduce((n, c) => n + c.qty, 0);
    const label = `${cartCount} item${cartCount === 1 ? "" : "s"}`;
    ["cartBar", "menuCartBar"].forEach((id) => $(id).classList.toggle("hidden", !cartCount));
    $("cartBarCount").textContent = $("menuCartCount").textContent = label;
    $("cartBarTotal").textContent = $("menuCartTotal").textContent = money(total);
    refreshControls();
    if (!cart.length) {
      $("cart").innerHTML = `<p class="muted small">Empty — just say what you'd like, or add from the menu.</p>`;
      $("cartTotal").textContent = ""; $("btnConfirm").classList.add("hidden"); return;
    }
    $("cart").innerHTML = cart.map((c) => {
      const m = menuItem(c.menu_item_id);
      return `<div class="cart-line"><span class="vmark ${m && !m.veg ? "nv" : ""}"></span>
        <span><b>${esc(c.name)}</b>${c.notes ? `<small>${esc(c.notes)}</small>` : ""}</span>
        <span class="stepper" data-id="${c.menu_item_id}"><button data-step="-1">−</button><b>${c.qty}</b><button data-step="1">+</button></span>
        <span class="price">${money(c.qty * c.price)}</span></div>`;
    }).join("");
    $("cartTotal").textContent = money(total);
    $("btnConfirm").classList.remove("hidden");
    $("btnConfirm").disabled = false; $("btnConfirm").textContent = `Place order · ${money(total)}`;
    if (G && !REDUCED) G.fromTo("#cartBar", { scale: .96 }, { scale: 1, duration: .5, ease: "back.out(3)" });
  }
  $("cart").onclick = (e) => cartClick(e);
  // "Added 1 × Irani Chai · Undo" — every change the companion makes is visible and reversible
  function cartChange(ch) {
    if (!ch || ch.by === "undo" || ch.before === ch.after) return;
    const added = ch.after > ch.before, n = Math.abs(ch.after - ch.before);
    const text = ch.after === 0 ? `Removed ${ch.name}` : `${added ? "Added" : "Removed"} ${n} × ${ch.name}`;
    const el = document.createElement("div");
    el.className = "act done";
    el.innerHTML = `<span>${added ? "🛒" : "↩︎"} ${esc(text)}</span><button>Undo</button>`;
    el.querySelector("button").onclick = () => { setQty(ch.menu_item_id, ch.before, "undo"); el.remove(); };
    showAct(el, 6000);
  }
  function showAct(el, ms) {
    const box = $("acts");
    while (box.children.length > 1) box.firstChild.remove();
    box.appendChild(el);
    if (ms) setTimeout(() => { if (el.isConnected) { el.style.transition = "opacity .4s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 400); } }, ms);
  }

  const STAGES = ["new", "preparing", "ready", "served"];
  async function refreshBill() {
    let bill;
    try { bill = await getJSON(`/api/tables/${TABLE_ID}/bill`); }
    catch (err) { console.warn("bill refresh failed:", err.message); return; }
    $("orders").innerHTML = bill.orders.length ? bill.orders.map((o) => {
      const idx = STAGES.indexOf(o.status);
      return `<div class="line-item" style="display:block">
        <div class="row" style="justify-content:space-between"><b>Order #${o.id}</b><span class="badge ${o.status}">${o.status}</span></div>
        <div class="timeline">${STAGES.map((_, i) => `<i class="${i <= idx ? "on" : ""}"></i>`).join("")}</div>
        ${o.items.map((i) => `<div class="row small" style="justify-content:space-between"><span>${i.qty} × ${esc(i.name)}</span><span>${money(i.qty * i.unit_price)}</span></div>`).join("")}
      </div>`;
    }).join("") : `<p class="muted small">No orders yet.</p>`;
    if (bill.ai) renderMeter(bill.ai);
    $("billTotal").textContent = bill.grand_total ? money(bill.grand_total) : "—";
  }

  let vegOnly = false, menuQuery = "";
  async function showMenu(cat) {
    try { await loadMenu(); } catch (err) { toast(err.message); return; }
    const cats = [...new Set(MENU.map((m) => m.category))];
    $("catTabs").innerHTML = cats.map((c) => `<span class="chip" data-cat="${esc(c)}">${look(c)[0]} ${esc(c)}</span>`).join("");
    renderMenu();
    openOverlay("menuOverlay");
    if (cat) setTimeout(() => jumpTo(cat), 350);
  }
  function renderMenu() {
    const q = menuQuery.trim().toLowerCase();
    const list = MENU.filter((m) => (!vegOnly || m.veg) && (!q || (m.name + " " + m.description + " " + m.category).toLowerCase().includes(q)));
    const cats = [...new Set(list.map((m) => m.category))];
    $("menu").innerHTML = list.length ? cats.map((c) => `<h3 class="menu-cat" id="cat-${esc(c).replace(/\s/g, "")}">${esc(c)}</h3>` +
      list.filter((m) => m.category === c).map((m) => `
        <div class="dish" data-dish="${m.id}">
          <div class="dish-info">
            <div class="dish-top"><span class="vmark ${m.veg ? "" : "nv"}" title="${m.veg ? "Veg" : "Non-veg"}"></span>${m.bestseller ? `<span class="tag-best">★ Bestseller</span>` : ""}${m.spicy ? `<span title="Spicy">🌶️</span>` : ""}</div>
            <span class="dish-name">${esc(m.name)}</span>
            <span class="price">${money(m.price)}</span>
            <p class="dish-desc">${esc(m.description)}</p>
          </div>
          <div class="dish-media">${dishPic(m, "dish-photo")}<span class="ctl-slot">${addControl(m)}</span></div>
        </div>`).join("")).join("")
      : `<p class="menu-empty">Nothing matches “${esc(menuQuery)}”. Just ask ${esc(companionName())} — they know the menu.</p>`;
  }
  function jumpTo(cat) {
    document.querySelectorAll("#catTabs .chip").forEach((x) => x.classList.toggle("on", x.dataset.cat === cat));
    const h = document.getElementById("cat-" + cat.replace(/\s/g, ""));
    if (h) $("menu").scrollTo({ top: h.offsetTop - $("menu").offsetTop - 6, behavior: "smooth" });
  }
  $("catTabs").onclick = (e) => { const c = e.target.closest("[data-cat]"); if (c) jumpTo(c.dataset.cat); };
  $("menu").onclick = (e) => cartClick(e);
  $("menuSearch").oninput = (e) => { menuQuery = e.target.value; renderMenu(); };
  $("vegOnly").onchange = (e) => { vegOnly = e.target.checked; renderMenu(); };
  $("menuCartBar").onclick = () => { closeOverlay("menuOverlay"); setTimeout(() => openOverlay("cartOverlay"), 250); };
  $("cartBar").onclick = () => { refreshBill(); openOverlay("cartOverlay"); };

  async function staffRequest(kind) {
    try {
      await getJSON(`/api/tables/${TABLE_ID}/request`, { method: "POST", body: JSON.stringify({ kind }) });
    } catch (err) { toast(`Couldn't call staff: ${err.message}`); return; }
    toast(kind === "bill" ? "Bill requested — staff is on the way 🧾" : "A waiter is on the way 🙋");
  }

  // ------------------------------------------------------------------ accounts & memory
  function applyProfile(data) {
    me = data;
    Object.assign(prefs, me.customer.prefs || {}); migratePrefs();
    prefs.name = me.customer.name;
    $("whoami").textContent = `Hi, ${me.customer.name.split(" ")[0]}`;
    $("btnLogout").classList.remove("hidden");
    renderMemories();
  }
  async function loadMe() {
    const r = await fetch("/api/customer/me");
    if (!r.ok) return false;
    applyProfile(await r.json());
    return true;
  }

  let authMode = "login";
  $("authTabs").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    authMode = b.dataset.mode;
    document.querySelectorAll("#authTabs button").forEach((x) => x.classList.toggle("on", x === b));
    $("signupName").classList.toggle("hidden", authMode !== "signup");
    $("btnAuth").textContent = authMode === "signup" ? "Create account" : "Log in";
    $("authMsg").textContent = "";
    anim("#signupName", { height: 0, opacity: 0, duration: .5, ease: "expo.out" });
  };
  async function doAuth() {
    Speaker.unlock(); Mic.prepare();          // inside the tap, before any await (iPhone audio rules)
    const body = { phone: $("authPhone").value, pin: $("authPin").value };
    if (authMode === "signup") body.name = $("authName").value.trim();
    $("btnAuth").disabled = true; $("authMsg").textContent = "";
    try {
      const r = await fetch("/api/customer/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        $("authMsg").textContent = (await r.json()).detail || "Something went wrong";
        if (G && !REDUCED) G.fromTo("#auth", { x: -10 }, { x: 0, duration: .5, ease: "elastic.out(1, .3)" });
        return;
      }
      await loadMe();
      closeOverlay("authOverlay");
      heroForReturning(); toast(`Welcome${authMode === "signup" ? "" : " back"}, ${me.customer.name.split(" ")[0]}! ☕`);
      start();
    } finally { $("btnAuth").disabled = false; }
  }
  $("btnAuth").onclick = doAuth;
  $("authPin").onkeydown = (e) => { if (e.key === "Enter") doAuth(); };
  $("btnGuest").onclick = (e) => { e.preventDefault(); me = null; closeOverlay("authOverlay"); start(); };
  $("btnContinue").onclick = () => start();
  $("btnCustomise").onclick = () => showSetup();
  $("btnLogout").onclick = async () => {
    await fetch("/api/customer/logout", { method: "POST" });
    store.del(PREFS_KEY);
    location.reload();
  };

  function renderMemories() {
    if (!me) { $("memoryCard").classList.add("hidden"); return; }
    $("memoryCard").classList.remove("hidden");
    $("memories").innerHTML = me.memories.length
      ? me.memories.map((m) => `<div class="line-item"><span>${esc(m.fact)}</span><button class="ghost" data-forget="${m.id}" title="Forget this">✕</button></div>`).join("")
      : `<p class="muted small">Nothing yet — just chat, and I'll remember what matters to you.</p>`;
    $("favWrap").classList.toggle("hidden", !me.favourites.length);
    $("favourites").innerHTML = me.favourites.map((f) => `<span class="chip" data-usual="${esc(f.name)}">🔁 ${esc(f.name)}</span>`).join("");
  }
  $("memories").onclick = async (e) => {
    const b = e.target.closest("[data-forget]"); if (!b) return;
    const id = parseInt(b.dataset.forget, 10);
    try { await getJSON(`/api/customer/memories/${id}`, { method: "DELETE" }); }
    catch (err) { toast(err.message); return; }
    me.memories = me.memories.filter((m) => m.id !== id); renderMemories();
  };
  $("favourites").onclick = (e) => {
    const c = e.target.closest("[data-usual]"); if (c) sendText(`Can I get my usual ${c.dataset.usual}?`);
  };
  $("btnForgetAll").onclick = async () => {
    if (!confirm(`Delete everything ${companionName()} remembers and all past chats? This can't be undone.`)) return;
    try { await getJSON("/api/customer/data", { method: "DELETE" }); }
    catch (err) { toast(err.message); return; }
    me.memories = []; me.messages = []; renderMemories();
    toast("Done — I've forgotten everything. Fresh start! 🌱");
  };
  function renderPastMessages() {
    if (!me || !me.messages.length) return;
    bubble("sys", "earlier");
    me.messages.forEach((m) => bubble(m.role === "user" ? "user" : "ai", m.text, "past"));
    bubble("sys", "today");
  }

  // the chat takes the chosen companion's colours; a call clock makes it feel like a live conversation
  function tintChat() {
    const pal = personaLook(prefs.persona)[2], chat = $("chat");
    chat.style.setProperty("--p1", pal[0]); chat.style.setProperty("--p2", pal[1]); chat.style.setProperty("--p3", pal[2]);
    $("stageTable").textContent = `Table ${TABLE_ID}`;
  }
  let callClock = null;
  function startCallClock() {
    const t0 = Date.now(); clearInterval(callClock);
    callClock = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000), h = Math.floor(s / 3600), mm = String(Math.floor(s / 60) % 60).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
      $("callTime").textContent = h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    }, 1000);
  }

  // ------------------------------------------------------------------ start / controls
  async function start() {
    if (screen === "setup") readSetup();
    savePrefs();
    if (started) {   // "Apply changes" from the Customise screen
      sendPrefs(); paintSetup(); tintChat(); loadBackchannels(); go("chat");
      toast(`Updated! ${companionName()} will adapt from the next reply.`); return;
    }
    $("btnStart").disabled = true; $("btnContinue").disabled = true; $("setupMsg").textContent = "Starting…";
    ["btnHeroStart", "btnFooterStart"].forEach((id) => { $(id).disabled = true; });

    // Unlock sound inside this tap — browsers (especially iPhone Safari) only allow audio after a user gesture.
    Speaker.unlock();

    started = true;
    if (prefs.mode !== "text") await enableMic();     // a blocked mic no longer switches (and saves) "Type only"
    await listOutputs();
    paintSetup();
    go("chat");
    $("btnSettings").classList.remove("hidden");
    $("btnStart").disabled = false; $("btnStart").textContent = "Apply changes"; $("setupMsg").textContent = "";
    renderPastMessages();
    initChatFX(); tintChat(); setState("idle"); startCallClock();
    connect(); refreshBill(); loadMenu().catch(() => {}); loadBackchannels();
    if (G && !REDUCED) {
      G.from(".orb-wrap", { scale: .4, opacity: 0, duration: 1.4, ease: "expo.out", delay: .2 });
      G.from(".controls .ctl", { y: 30, opacity: 0, duration: .8, ease: "expo.out", stagger: .06, delay: .3 });
    }
  }

  $("btnStart").onclick = start;
  function paintSpeaker() {
    const on = prefs.speak_replies !== false;
    $("btnSpeaker").innerHTML = on ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>' : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 10l4 4M20 10l-4 4"/></svg>';
    $("btnSpeaker").classList.toggle("off", !on);
    $("speakerHint").textContent = on ? "Voice on" : "Muted";
    $("btnSpeaker").title = on ? "Voice replies on — tap to mute" : "Voice replies muted — tap to hear them";
  }
  $("btnSpeaker").onclick = () => {
    prefs.speak_replies = prefs.speak_replies === false;
    if (prefs.speak_replies) Speaker.unlock(); else stopPlayback();
    paintSpeaker(); savePrefs(); sendPrefs();
    toast(prefs.speak_replies ? "Voice replies on 🔊" : "Voice replies muted 🔇");
  };
  $("soundPrompt").onclick = () => { Speaker.unlock(); toast("Sound on 🔊"); };
  paintSpeaker();
  $("btnSettings").onclick = () => { paintSetup(); setStep(0); go("setup"); };
  $("btnSend").onclick = () => { const t = $("textInput").value.trim(); $("textInput").value = ""; sendText(t); };
  $("textInput").onkeydown = (e) => { if (e.key === "Enter") $("btnSend").click(); };
  $("btnConfirm").onclick = () => {
    if (!ws || ws.readyState !== 1) return;
    $("btnConfirm").disabled = true; $("btnConfirm").textContent = "Placing…";   // no double orders
    stopPlayback();
    ws.send(JSON.stringify({ type: "confirm_order" }));
  };
  $("btnWaiter").onclick = () => staffRequest("waiter");
  $("btnBill").onclick = () => staffRequest("bill");
  $("btnMenu").onclick = () => showMenu();
  $("btnTable").onclick = () => { closeOverlay("moreOverlay"); refreshBill(); setTimeout(() => openOverlay("cartOverlay"), 250); };
  $("btnMore").onclick = () => openOverlay("moreOverlay");
  $("btnSettings2").onclick = () => { closeOverlay("moreOverlay"); paintSetup(); setStep(1); go("setup"); };
  // conversation: a pull-up sheet on phones, always visible beside the call on desktop
  const setConvo = (open) => { $("convo").classList.toggle("open", open); $("btnChat").classList.toggle("on", open);
    if (open) $("transcript").scrollTop = $("transcript").scrollHeight; };
  $("btnChat").onclick = () => setConvo(!$("convo").classList.contains("open"));
  $("btnChatClose").onclick = () => setConvo(false);
  $("btnEnd").onclick = () => {
    if (!confirm("End the chat? Your order and bill stay with the table.")) return;
    muted = true; stopPlayback();
    try { Mic.stream && Mic.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    started = false; if (ws) { ws.onclose = null; ws.close(); }
    location.reload();
  };

  // Talk button: hands-free → mute toggle; hold-to-talk → press & hold
  const talk = $("btnTalk");
  talk.onclick = async () => {
    if (prefs.mode === "ptt" && !micBlocked) return;
    if (micBlocked || prefs.mode === "text" || (!Mic.stream && !browserSTT)) {
      // typing mode or a blocked mic: one tap switches to hands-free voice
      if (!(await enableMic())) return;
      prefs.mode = "handsfree"; muted = false; savePrefs(); sendPrefs();
      toast("I'm listening — just talk 🎙️");
      if (state === "idle" || state === "listening") setState("listening");
      return;
    }
    muted = !muted;
    Mic.prepare();
    if (browserSTT) muted ? browserSTT.pause() : browserSTT.resume();
    if (state === "listening" || state === "idle") setState(muted ? "idle" : "listening");
    paintTalk();
  };
  $("btnKeyboard") && ($("btnKeyboard").onclick = () => { $("textInput").focus(); });
  const pttDown = (e) => {
    if (prefs.mode !== "ptt") return; e.preventDefault();
    if (state === "speaking" || state === "thinking") bargeIn();
    talk.classList.add("rec");
    if (Mic.stream) { Mic.prepare(); Mic.startForced(); userSpeaking(true); } else if (browserSTT) browserSTT.start();
  };
  const pttUp = (e) => {
    if (prefs.mode !== "ptt" || !talk.classList.contains("rec")) return; e.preventDefault();
    talk.classList.remove("rec");
    if (Mic.stream) Mic.stopForced(); else if (browserSTT) setTimeout(() => browserSTT.pause(), 600);
  };
  talk.addEventListener("pointerdown", pttDown);
  talk.addEventListener("pointerup", pttUp);
  talk.addEventListener("pointerleave", pttUp);

  // ------------------------------------------------------------------ boot
  (async () => {
    try {
      const [opts] = await Promise.all([getJSON("/api/options"), loadMe().catch(() => false)]);
      OPTIONS = opts;
      buildLanding(); buildSetup(); paintSetup();
      heroForReturning();
      initMotion();
      initLandingFX();
      heroIntro();
      buildHighlights().catch(() => {});
    } catch (e) {
      console.error(e); window.CafeErrors.report(e.message, "boot", e.stack);
      heroIntro(); toast("Couldn't reach the café server — please refresh in a moment.", 6000);
    }
  })();
})();
