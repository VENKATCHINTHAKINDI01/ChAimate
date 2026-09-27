/* Staff app: role-based views. Kitchen & bar get their own tickets, waiters the floor, managers everything
   (including the live AI-usage monitor fed by Redis). */
(() => {
  const $ = (id) => document.getElementById(id);
  const G = window.gsap;
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const seen = new Set();   // ticket ids already animated in
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let currency = "₹";
  const money = (n) => `${currency}${Math.round(n).toLocaleString("en-IN")}`;
  let data = null, me = null, ws = null, view = null, refreshTimer = null;

  const ROLE_TABS = {
    manager: [["overview", "Overview"], ["analytics", "Analytics"], ["agent", "AI manager"], ["kitchen", "Kitchen"], ["bar", "Bar"], ["floor", "Floor"], ["tables", "Tables"],
              ["ai", "AI usage"], ["menu", "Menu"], ["staff", "Staff"], ["customers", "Customers"], ["qr", "QR codes"]],
    kitchen: [["kitchen", "Kitchen orders"]],
    bar: [["bar", "Bar orders"]],
    waiter: [["floor", "Floor"], ["tables", "Tables"]],
  };
  const STATION_ICON = { kitchen: "🍳", bar: "☕" };

  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 4000);
  }
  function chime() {
    try {
      const ctx = chime.ctx || (chime.ctx = new AudioContext());
      [660, 880].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.3);
        o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.3);
      });
    } catch (_) {}
  }
  const ago = (ts) => { const m = Math.floor((Date.now() / 1000 - ts) / 60); return m < 1 ? "just now" : `${m} min ago`; };
  const since = (ts) => {
    if (!ts) return "—";
    const d = Math.floor((Date.now() / 1000 - ts) / 86400);
    return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
  };

  async function api(path, opts = {}) {
    const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
    if (r.status === 401) { showLogin(); throw new Error("auth"); }
    if (!r.ok) {
      let body = {}; try { body = await r.json(); } catch (_) {}
      const err = new Error(body.detail || `Action failed (${r.status})`);
      if (r.status >= 500) window.CafeErrors.report(`${path} -> ${r.status} ${err.message}`, "api", `request_id=${body.request_id || "?"}`);
      throw err;
    }
    return r.status === 204 ? null : r.json();
  }

  // ---------------- auth
  function showLogin() { $("login").classList.remove("hidden"); $("app").classList.add("hidden"); $("btnLogout").classList.add("hidden"); $("tabs").innerHTML = ""; }
  async function login() {
    const r = await fetch("/api/staff/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: $("username").value.trim(), pin: $("pin").value }) });
    if (!r.ok) { $("loginMsg").textContent = (await r.json()).detail || "Login failed"; return; }
    $("pin").value = ""; boot();
  }
  $("btnLogin").onclick = login;
  $("pin").onkeydown = (e) => { if (e.key === "Enter") login(); };
  $("btnLogout").onclick = async () => { await fetch("/api/staff/logout", { method: "POST" }); location.reload(); };

  // ---------------- tabs
  function buildTabs() {
    const tabs = ROLE_TABS[me.role] || [];
    $("tabs").innerHTML = tabs.length > 1 ? tabs.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join("") : "";
    setView(tabs[0][0]);
  }
  const TITLES = { analytics: "Analytics", agent: "AI store manager", overview: "Overview", kitchen: "Kitchen", bar: "Bar", floor: "On the floor", tables: "Tables",
    ai: "AI usage", menu: "Menu", staff: "Team", customers: "Regulars", qr: "Table QR codes" };
  function setView(v) {
    view = v;
    $("viewTitle").textContent = TITLES[v] || v;
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === v));
    const section = v === "kitchen" || v === "bar" ? "station" : v;
    document.querySelectorAll("[data-view]").forEach((s) => s.classList.toggle("hidden", s.dataset.view !== section));
    if (data) render();
    if (v === "ai") refreshAI().catch(() => {});
    if (v === "analytics") loadAnalytics().catch((e) => toast(e.message));
    if (v === "agent") loadAgentSide().catch(() => {});
    if (G && !REDUCED) G.from("[data-view]:not(.hidden) > *", { y: 24, opacity: 0, duration: .7, ease: "expo.out", stagger: .06 });
  }
  $("tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) setView(b.dataset.tab); };

  // ---------------- render
  async function refresh() { data = await api("/api/staff/overview"); render(); }

  function itemsHtml(items) {
    return items.map((i) => `<div>${i.qty} × ${esc(i.name)}${i.notes ? ` <small class="muted">(${esc(i.notes)})</small>` : ""}</div>`).join("");
  }
  function stationBadges(o) {
    return Object.entries(o.stations).map(([st, s]) => `<span class="badge ${s === "queued" ? "new" : s}">${STATION_ICON[st] || ""} ${st}: ${s}</span>`).join(" ");
  }
  function ticketHead(o) {
    return `<div class="row"><b>#${o.id} · Table ${o.table_id}</b><small class="muted">${ago(o.created_at)}</small></div>
      ${o.customer_name ? `<small class="muted">${esc(o.customer_name)}</small>` : ""}`;
  }

  function render() {
    renderRequests();
    if (view === "overview") renderOverview();
    if (view === "kitchen" || view === "bar") renderStation(view);
    if (view === "floor") renderFloor();
    if (view === "tables") renderTables();
    if (view === "menu") renderMenu();
    if (view === "staff") renderStaff();
    if (view === "customers") renderCustomers();
    if (view === "qr") renderQr();
    animateNew();
  }

  function animateNew() {
    const fresh = [];
    document.querySelectorAll("[data-view]:not(.hidden) .ticket").forEach((t) => {
      const key = t.dataset.key || t.textContent.slice(0, 40);
      if (!seen.has(key)) { seen.add(key); fresh.push(t); }
    });
    if (G && !REDUCED && fresh.length && seen.size > fresh.length) G.from(fresh, { y: -20, opacity: 0, scale: .96, duration: .7, ease: "back.out(1.6)", stagger: .05 });
  }
  function countTo(el, value, fmt = (v) => Math.round(v)) {
    const from = parseFloat(el.dataset.v || "0");
    el.dataset.v = value;
    if (!G || REDUCED) { el.textContent = fmt(value); return; }
    const o = { v: from }; G.to(o, { v: value, duration: 1, ease: "power2.out", onUpdate: () => (el.textContent = fmt(o.v)) });
  }

  function renderOverview() {
    const s = data.sales_today;
    countTo($("kOrders"), s.orders); countTo($("kRevenue"), s.revenue, money);
    countTo($("kReturning"), s.returning_customers); countTo($("kLive"), data.live_tables.length);
    $("topItems").innerHTML = s.top_items.length
      ? s.top_items.map((t) => `<div class="line-item"><span>${esc(t.name)}</span><span>${t.qty} sold · ${money(t.revenue)}</span></div>`).join("")
      : "No sales yet today.";
    ["new", "preparing", "ready", "served"].forEach((st) => {
      $("col-" + st).innerHTML = data.orders.filter((o) => o.status === st).map((o) => `
        <div class="ticket" data-key="${o.id}-${o.status}">${ticketHead(o)}${itemsHtml(o.items)}
          <div style="margin:6px 0">${stationBadges(o)}</div>
          <div class="row"><b>${money(o.total)}</b>
            <span class="row">
              ${st !== "served" ? `<button class="danger ghost" data-status="cancelled" data-id="${o.id}">Cancel</button>` : ""}
              ${st === "ready" ? `<button class="primary" data-status="served" data-id="${o.id}">Served</button>` : ""}
            </span></div>
        </div>`).join("") || `<p class="muted">—</p>`;
    });
  }

  function renderStation(station) {
    const mine = data.orders.filter((o) => o.stations[station] && !["served", "cancelled", "paid"].includes(o.status));
    const col = (status) => mine.filter((o) => o.stations[station] === status).sort((a, b) => a.created_at - b.created_at);
    const ticket = (o, next, label) => `
      <div class="ticket" data-key="${o.id}-${o.status}">${ticketHead(o)}
        ${itemsHtml(o.items.filter((i) => i.station === station))}
        ${o.notes ? `<div><small>📝 ${esc(o.notes)}</small></div>` : ""}
        ${next ? `<div class="row" style="margin-top:6px;justify-content:flex-end">
          <button class="primary" data-station="${station}" data-next="${next}" data-id="${o.id}">${label}</button></div>` : ""}
      </div>`;
    $("st-queued").innerHTML = col("queued").map((o) => ticket(o, "preparing", "Start")).join("") || `<p class="muted">Nothing waiting 🎉</p>`;
    $("st-preparing").innerHTML = col("preparing").map((o) => ticket(o, "ready", "Ready ✓")).join("") || `<p class="muted">—</p>`;
    $("st-ready").innerHTML = col("ready").map((o) => ticket(o, null)).join("") || `<p class="muted">—</p>`;
    $("stock").innerHTML = data.menu.filter((m) => m.station === station).map((m) =>
      `<span class="chip ${m.available ? "on" : ""}" data-stock="${m.id}" data-avail="${m.available ? 0 : 1}">${m.available ? "✓" : "✕"} ${esc(m.name)}</span>`).join("");
  }

  function renderRequests() {
    if (!$("requests")) return;
    $("requests").innerHTML = data.requests.length ? data.requests.map((r) =>
      `<div class="ticket"><b>Table ${r.table_id}</b> — ${r.kind === "bill" ? "🧾 wants the bill" : r.kind === "help" ? "❗ needs help" : "🙋 calling waiter"}
       ${r.message ? `<br><small>${esc(r.message)}</small>` : ""}<br><small class="muted">${ago(r.created_at)}</small>
       <div style="margin-top:6px"><button data-resolve="${r.id}">Done</button></div></div>`).join("")
      : `<span class="muted">No pending requests.</span>`;
  }

  function renderFloor() {
    const ready = data.orders.filter((o) => o.status === "ready");
    const progress = data.orders.filter((o) => o.status === "new" || o.status === "preparing");
    $("fl-ready").innerHTML = ready.map((o) => `
      <div class="ticket" data-key="${o.id}-${o.status}">${ticketHead(o)}${itemsHtml(o.items)}
        <div class="row" style="margin-top:6px;justify-content:flex-end"><button class="primary" data-status="served" data-id="${o.id}">Mark served</button></div>
      </div>`).join("") || `<p class="muted">Nothing to pick up.</p>`;
    $("fl-progress").innerHTML = progress.map((o) => `
      <div class="ticket" data-key="${o.id}-${o.status}">${ticketHead(o)}${itemsHtml(o.items)}<div style="margin-top:6px">${stationBadges(o)}</div></div>`).join("") || `<p class="muted">—</p>`;
  }

  function renderTables() {
    const live = new Set(data.live_tables);
    $("tables").innerHTML = data.tables.map((t) => {
      const food = data.orders.filter((o) => o.table_id === t.id).reduce((n, o) => n + o.total, 0);
      const ai = (data.ai_by_table || {})[t.id] || { minutes: 0, amount: 0 };
      const total = food + ai.amount;
      return `<div class="tbl ${t.status}">
        <b>${esc(t.label)}</b><br>
        <small>${live.has(t.id) ? '<span class="live-dot"></span>AI chat live' : '<span class="muted">—</span>'}</small><br>
        <small class="muted">${t.status.replace("_", " ")}</small><br>
        ${ai.minutes ? `<small class="muted">🎙 ${ai.minutes} min · ${ai.amount ? money(ai.amount) : "free"}</small><br>` : ""}
        ${total || ai.minutes ? `<b>${money(total)}</b><br><button data-settle="${t.id}" style="margin-top:6px">Settle bill</button>` : ""}
      </div>`;
    }).join("");
  }

  function renderMenu() {
    $("cats").innerHTML = [...new Set(data.menu.map((m) => m.category))].map((c) => `<option value="${esc(c)}">`).join("");
    $("menuRows").innerHTML = data.menu.map((m) => `
      <tr>
        <td>${m.veg ? "🟢" : "🔴"} ${esc(m.name)}${m.spicy ? " 🌶" : ""}<br><small class="muted">${esc(m.description)}</small></td>
        <td>${esc(m.category)}</td>
        <td><select data-stationsel="${m.id}" style="max-width:110px">
          <option value="kitchen" ${m.station === "kitchen" ? "selected" : ""}>Kitchen</option>
          <option value="bar" ${m.station === "bar" ? "selected" : ""}>Bar</option></select></td>
        <td><input type="number" value="${m.price}" data-price="${m.id}" style="max-width:90px" /></td>
        <td><input type="checkbox" ${m.available ? "checked" : ""} data-availbox="${m.id}" style="width:auto" /></td>
        <td><button class="danger ghost" data-del="${m.id}" title="Delete">✕</button></td>
      </tr>`).join("");
  }

  function renderStaff() {
    $("staffRows").innerHTML = data.staff.map((s) => `
      <tr><td>${esc(s.name)}</td><td>${esc(s.username)}</td><td>${esc(s.role)}</td>
        <td>${s.active ? "Active" : '<span class="muted">Disabled</span>'}</td>
        <td>${s.id === me.id ? "<small class='muted'>you</small>" : `<button class="ghost" data-staff="${s.id}" data-active="${s.active ? 0 : 1}">${s.active ? "Disable" : "Enable"}</button>`}</td></tr>`).join("");
  }

  function renderCustomers() {
    const mask = (p) => p.slice(0, 2) + "••••" + p.slice(-4);
    $("custRows").innerHTML = data.customers.length ? data.customers.map((c) => `
      <tr><td>${esc(c.name)}</td><td>${mask(c.phone)}</td><td>${c.visits}</td><td>${since(c.last_seen)}</td><td>${money(c.spent)}</td></tr>`).join("")
      : `<tr><td colspan="5" class="muted">No registered customers yet.</td></tr>`;
  }

  let aiTimer = 0;
  async function refreshAI() {
    const u = await api("/api/staff/ai-usage");
    const t = u.today || {};
    countTo($("aMinutes"), t.minutes || 0);
    countTo($("aRevenue"), u.settled_today.revenue || 0, money);
    countTo($("aCost"), t.llm_cost_usd || 0, (v) => "$" + v.toFixed(3));
    $("aTurns").textContent = `${t.turns || 0} · ${((t.tokens || 0) / 1000).toFixed(1)}k`;
    $("redisState").textContent = u.redis ? "redis live" : "redis offline";
    $("redisState").className = "badge " + (u.redis ? "ready" : "new");
    $("aiLive").innerHTML = u.live.length ? u.live.map((l) => `
      <tr><td><b>${l.table_id}</b></td><td>${l.people.map(esc).join(", ")}</td><td>${l.minutes}</td>
        <td>${l.billable_minutes ? money(l.amount) : `<span class="muted">${l.free_left} free left</span>`}</td>
        <td>${((l.tokens_in + l.tokens_out) / 1000).toFixed(1)}k</td><td>$${l.llm_cost_usd.toFixed(4)}</td>
        <td><small class="muted">${esc((l.last_model || "").replace("groq/", ""))}</small></td></tr>`).join("")
      : `<tr><td colspan="7" class="muted">Nobody is chatting right now.</td></tr>`;
    $("aiModels").innerHTML = u.models.map((m) => `<span class="model-chip"><b>${esc(m.name)}</b>${esc(m.model)}</span>`).join("");
    $("aiPricing").textContent = `Customers get ${u.pricing.free_minutes} free chat minutes per visit, then ${money(u.pricing.price_per_minute)}/min. Only minutes with actual conversation count.`;
    $("aiFeed").innerHTML = u.events.length ? u.events.map((e) => `
      <div class="line-item"><span><span class="ev-role ${e.role}">${e.role === "user" ? "guest" : "ai"}</span>
        Table ${e.table} · ${esc(e.customer)}${e.text ? ` — <i>${esc(e.text)}</i>` : ""}</span>
        <span class="muted">${e.role === "assistant" ? `${e.tokens} tok${e.latency ? " · " + e.latency + "s" : ""}` : ""} ${ago(parseFloat(e.ts))}</span></div>`).join("")
      : `<p class="muted">No AI activity yet today.</p>`;
  }

  // ================================================================ Analytics board
  const C = window.Charts;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  let anPeriod = "7d";
  const PERIOD_LABEL = { today: "vs same day last week", "7d": "vs previous 7 days", "30d": "vs previous 30 days", "90d": "vs previous 90 days" };

  function delta(m, { upIsGood = true, suffix = "" } = {}) {
    if (!m || m.change_pct == null) return `<span class="delta flat">— <small>no comparison</small></span>`;
    const up = m.change_pct > 0, flat = Math.abs(m.change_pct) < 0.5;
    const cls = flat ? "flat" : (up === upIsGood ? "good" : "bad");
    return `<span class="delta ${cls}">${flat ? "→" : up ? "▲" : "▼"} ${Math.abs(m.change_pct)}%${suffix} <small>${PERIOD_LABEL[anPeriod]}</small></span>`;
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("#periodTabs button"); if (!b) return;
    anPeriod = b.dataset.p;
    document.querySelectorAll("#periodTabs button").forEach((x) => x.classList.toggle("on", x === b));
    loadAnalytics().catch((err) => toast(err.message));
  });

  async function loadAnalytics() {
    const d = await api(`/api/staff/analytics?period=${anPeriod}`);
    const k = d.kpis;
    $("periodNote").textContent = new Date(d.period.start * 1000).toLocaleDateString([], { day: "numeric", month: "short" }) +
      " – " + new Date(d.period.end * 1000).toLocaleDateString([], { day: "numeric", month: "short" });
    countTo($("heroRevenue"), k.revenue.value, money);
    $("heroDelta").innerHTML = delta(k.revenue);
    C.spark($("heroSpark"), d.trend.map((t) => t.food + t.ai), css("--series-1"), { width: $("heroSpark").clientWidth || 360, height: 90 });

    const tile = (lbl, val, dlt) => `<div class="card tile"><div class="lbl">${lbl}</div><div class="val">${val}</div>${dlt}</div>`;
    $("tiles").innerHTML = [
      tile("Orders", k.orders.value.toLocaleString(), delta(k.orders)),
      tile("Average order", money(k.avg_order_value.value), delta(k.avg_order_value)),
      tile("Customers (registered)", k.customers.value, `<span class="delta flat"><small>${k.returning_share}% returning · ${k.new_customers.value} new</small></span>`),
      tile("AI chat revenue", money(k.ai_revenue.value), delta(k.ai_revenue)),
      tile("Food revenue", money(k.food_revenue.value), delta(k.food_revenue)),
      tile("Avg prep time", k.prep_minutes.value != null ? k.prep_minutes.value + " min" : "—", delta(k.prep_minutes, { upIsGood: false })),
      tile("Cancellation rate", k.cancel_rate.value + "%", delta(k.cancel_rate, { upIsGood: false })),
      tile("AI chat minutes", k.ai_minutes.value.toLocaleString(), delta(k.ai_minutes)),
    ].join("");

    // revenue trend
    const hourly = d.period.bucket === "hour";
    $("trendSub").textContent = `Food orders and AI chat, per ${hourly ? "hour" : "day"}`;
    C.line($("chTrend"), {
      labels: d.trend.map((t) => t.bucket),
      series: [{ name: "Food orders", values: d.trend.map((t) => t.food), color: css("--series-1") },
               { name: "AI chat", values: d.trend.map((t) => t.ai), color: css("--series-2") }],
      format: (v) => currency + C.compact(v),
      xFormat: (l) => hourly ? l.slice(11) : new Date(l + "T00:00").toLocaleDateString([], { day: "numeric", month: "short" }),
    });

    // findings
    const ICON = { serious: "!", warning: "!", good: "✓", info: "i" }, LVL = { serious: "Critical", warning: "Watch", good: "Good", info: "Tip" };
    $("findings").innerHTML = d.signals.length ? d.signals.map((f) => `
      <div class="finding ${f.level}"><div class="ico" aria-hidden="true">${ICON[f.level]}</div>
        <div><b><span class="lvl">${LVL[f.level]}</span>${esc(f.title)}</b><span>${esc(f.detail)}</span></div></div>`).join("")
      : `<p class="muted">Nothing unusual — steady as she goes.</p>`;

    // busy hours
    const hours = d.busy.hours_open.length ? d.busy.hours_open : [...Array(15).keys()].map((h) => h + 8);
    C.heatmap($("chHeat"), { grid: d.busy.grid, rows: d.busy.days, cols: hours, unit: " orders/week" });
    const peakDay = d.busy.by_day.indexOf(Math.max(...d.busy.by_day));
    C.columns($("chWeekday"), { labels: d.busy.days, values: d.busy.by_day, color: css("--series-1"), highlight: peakDay, format: (v) => v.toFixed(0) });

    // items
    const chg = (i) => i.change_pct == null ? "new" : `${i.change_pct > 0 ? "▲" : i.change_pct < 0 ? "▼" : "→"} ${Math.abs(i.change_pct)}%`;
    C.bars($("chTop"), { rows: d.items.top.map((i) => ({ label: i.name, value: i.revenue, i, tip: `${i.qty} sold · ${i.share_pct}% of sales` })),
      color: css("--series-1"), format: (v) => money(v), sub: (r) => `${r.i.qty} sold · ${chg(r.i)}` });
    const push = [...d.items.falling, ...d.items.slow.filter((x) => !d.items.falling.some((f) => f.id === x.id))].slice(0, 5);
    C.bars($("chSlow"), { rows: push.map((i) => ({ label: i.name, value: i.qty, i, tip: `${money(i.revenue)} revenue` })),
      color: css("--series-3"), format: (v) => `${v} sold`, sub: (r) => chg(r.i) });
    C.bars($("chCats"), { rows: d.items.categories.map((c) => ({ label: c.category, value: c.revenue, tip: `${c.qty} items` })),
      color: css("--series-2"), format: (v) => money(v) });

    // customers
    $("atRisk").innerHTML = d.customers.at_risk.length ? d.customers.at_risk.map((c) =>
      `<div class="line-item"><span><b>${esc(c.name)}</b><br><small class="muted">${c.visits} visits · ${money(c.spent)} lifetime</small></span><span class="badge new">${c.days_away} days away</span></div>`).join("")
      : `<p class="muted">No regulars are slipping away. 🎉</p>`;
    $("topCust").innerHTML = d.customers.top.length ? d.customers.top.slice(0, 6).map((c, i) =>
      `<div class="line-item"><span>${i + 1}. <b>${esc(c.name)}</b><br><small class="muted">${c.orders} orders · ${c.visits} visits</small></span><b>${money(c.spent)}</b></div>`).join("")
      : `<p class="muted">No registered customers ordered in this period.</p>`;
    C.bars($("chPersonas"), { rows: d.customers.personas.slice(0, 6).map(([k, n]) => ({ label: k.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()), value: n })),
      color: css("--series-3"), format: (v) => `${v} customers` });

    // operations
    const op = d.operations;
    C.bars($("chOps"), { rows: [
      { label: "Kitchen · order → ready", value: op.prep_minutes.kitchen || 0 },
      { label: "Bar · order → ready", value: op.prep_minutes.bar || 0 },
      { label: "Waiter · ready → served", value: op.serve_minutes || 0 },
    ], color: css("--series-2"), format: (v) => v ? `${v} min` : "—" });
    $("opsNote").innerHTML = `${op.orders_over_20_min} orders took over 20 minutes.` +
      (op.requests.length ? " Table requests: " + op.requests.map((r) => `${r.n} × ${r.kind}${r.wait_minutes ? ` (${r.wait_minutes} min wait)` : ""}`).join(", ") + "." : "");

    const ai = d.ai;
    $("aiStats").innerHTML = `
      <div class="tiles" style="grid-template-columns:repeat(2,1fr)">
        <div class="tile" style="padding:0"><div class="lbl">Chat minutes</div><div class="val">${Number(ai.minutes).toLocaleString()}</div><span class="delta flat"><small>${ai.paying_share_pct}% were paid minutes</small></span></div>
        <div class="tile" style="padding:0"><div class="lbl">AI revenue vs LLM cost</div><div class="val">${money(ai.revenue)}</div><span class="delta flat"><small>cost $${Number(ai.cost).toFixed(2)}</small></span></div>
        <div class="tile" style="padding:0"><div class="lbl">Chats that led to an order</div><div class="val">${ai.order_conversion_pct != null ? ai.order_conversion_pct + "%" : "—"}</div><span class="delta flat"><small>${ai.conversations} logged-in chats</small></span></div>
        <div class="tile" style="padding:0"><div class="lbl">Visits using the AI</div><div class="val">${ai.visits}</div><span class="delta flat"><small>${Number(ai.turns).toLocaleString()} replies</small></span></div>
      </div>`;
    if (G && !REDUCED) G.from("[data-view='analytics'] .card", { y: 24, opacity: 0, duration: .7, ease: "expo.out", stagger: .03, clearProps: "transform,opacity" });
    loadBriefing().catch(() => {});
  }

  // inline markdown (bold) for model-written text, escaped first
  const inl = (t) => esc(t || "").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // ---- briefing
  const KIND_LABEL = { price_change: "Price change", availability: "Menu availability", new_item: "New item", promotion: "Promotion" };
  function describe(a) {
    const p = a.payload;
    if (a.kind === "price_change") return `${esc(p.name)}: ${money(p.old_price)} → <b>${money(p.new_price)}</b>`;
    if (a.kind === "availability") return `${esc(p.name)} → <b>${p.available ? "back on the menu" : "off the menu"}</b>`;
    if (a.kind === "new_item") return `<b>${esc(p.name)}</b> · ${esc(p.category)} · ${money(p.price)} (${p.station})`;
    if (a.kind === "promotion") return `<b>${esc(p.title)}</b> — ${esc(p.details)}${p.items.length ? ` <small class="muted">(${p.items.map(esc).join(", ")})</small>` : ""} · ${p.days} days`;
    return "";
  }
  function renderBriefing(b) {
    if (!b || !b.content) return;
    $("briefingWhen").textContent = `${b.period} · generated ${ago(b.created_at)}`;
    $("btnBriefing").textContent = "Refresh";
    const recs = b.content.recommendations || [];
    $("briefing").innerHTML = `<p class="headline">${esc(b.content.headline || "")}</p><div class="rec-list">${recs.map((r) => `
      <div class="rec">
        <div class="meta"><span class="badge ${r.impact === "high" ? "ready" : r.impact === "medium" ? "preparing" : ""}">${esc(r.impact || "")} impact</span><span class="badge served">${esc(r.effort || "")} effort</span><span class="badge">${esc(r.area || "")}</span></div>
        <b>${inl(r.title)}</b><p>${inl(r.why)}</p>
        ${r.action ? `<div class="act" data-action="${r.action.id}"><div><span class="kind">${KIND_LABEL[r.action.kind]}</span><div>${describe(r.action)}</div></div>
          <div class="row">${r.action.status && r.action.status !== "pending" ? `<span class="badge served">${r.action.status}</span>` :
            `<button class="primary" data-apply="${r.action.id}">Approve</button><button class="ghost" data-dismiss="${r.action.id}">Dismiss</button>`}</div></div>` : ""}
      </div>`).join("")}</div>`;
  }
  async function loadBriefing() {
    const b = await api("/api/staff/agent/briefing");
    if (b && b.content) {
      // reflect the current status of any attached actions
      const all = await api("/api/staff/agent/actions?status=");
      const byId = Object.fromEntries(all.map((a) => [a.id, a]));
      (b.content.recommendations || []).forEach((r) => { if (r.action && byId[r.action.id]) r.action = byId[r.action.id]; });
      renderBriefing(b);
    }
  }
  $("btnBriefing").onclick = async () => {
    const btn = $("btnBriefing"); btn.disabled = true; btn.textContent = "Analysing…";
    $("briefing").innerHTML = `<div class="rec-list">${'<div class="shimmer"></div>'.repeat(4)}</div>`;
    try { renderBriefing(await api("/api/staff/agent/briefing", { method: "POST", body: JSON.stringify({ period: anPeriod === "today" ? "7d" : anPeriod }) })); }
    catch (err) { $("briefing").innerHTML = `<p class="muted">${esc(err.message)}</p>`; btn.textContent = "Try again"; }
    finally { btn.disabled = false; }
  };

  // ---- approve / dismiss (briefing cards and the AI manager panel)
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-apply],[data-dismiss]"); if (!b) return;
    const id = b.dataset.apply || b.dataset.dismiss, decision = b.dataset.apply ? "apply" : "dismiss";
    b.disabled = true;
    try {
      const r = await api(`/api/staff/agent/actions/${id}/${decision}`, { method: "POST" });
      toast(r.message || "Done");
      document.querySelectorAll(`[data-action="${id}"]`).forEach((row) => {
        row.querySelectorAll("button").forEach((x) => x.remove());
        row.insertAdjacentHTML("beforeend", `<span class="badge ${decision === "apply" ? "ready" : "served"}">${decision === "apply" ? "applied" : "dismissed"}</span>`);
      });
      loadAgentSide().catch(() => {});
    } catch (err) { toast(err.message); b.disabled = false; }
  });

  // ================================================================ AI store manager chat
  function md(text) {
    const lines = esc(text).split("\n");
    let html = "", inList = false, table = [];
    const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, "$1<i>$2</i>").replace(/`(.+?)`/g, "<code>$1</code>");
    const flushTable = () => {
      if (!table.length) return;
      const rowsT = table.filter((r) => !/^\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim())));
      html += `<table>${rowsT.map((r, i) => `<tr>${r.map((c) => i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
      table = [];
    };
    for (const raw of lines) {
      const l = raw.trim();
      if (l.startsWith("|")) { if (inList) { html += "</ul>"; inList = false; } table.push(l); continue; }
      flushTable();
      if (/^[-*•]\s+/.test(l)) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(l.replace(/^[-*•]\s+/, ""))}</li>`; continue; }
      if (inList) { html += "</ul>"; inList = false; }
      if (/^#{1,4}\s/.test(l)) html += `<h3>${inline(l.replace(/^#+\s/, ""))}</h3>`;
      else if (/^-{3,}$/.test(l)) html += "";
      else if (l) html += `<p>${inline(l)}</p>`;
    }
    flushTable(); if (inList) html += "</ul>";
    return html;
  }
  function logMsg(cls, html) {
    const m = document.createElement("div"); m.className = "msg " + cls; m.innerHTML = html;
    $("agentLog").appendChild(m); $("agentLog").scrollTop = $("agentLog").scrollHeight;
    if (G && !REDUCED) G.from(m, { y: 14, opacity: 0, duration: .5, ease: "expo.out" });
    return m;
  }
  const TOOL_LABEL = { store_overview: "KPIs", sales_trend: "sales trend", item_performance: "item sales", busy_hours: "busy hours",
    customer_insights: "customers", operations: "operations", ai_companion_usage: "AI usage", menu: "menu",
    propose_price_change: "price proposal", propose_availability: "menu proposal", propose_new_item: "new item proposal", propose_promotion: "promotion proposal" };
  async function askAgent(text) {
    if (!text) return;
    $("agentSuggest").classList.add("hidden");
    logMsg("me", esc(text));
    const wait = logMsg("ai thinking", "Looking at your numbers…");
    $("agentSend").disabled = true;
    try {
      const r = await api("/api/staff/agent/chat", { method: "POST", body: JSON.stringify({ message: text }) });
      wait.remove();
      const used = [...new Set(r.tools_used.map((t) => TOOL_LABEL[t] || t))];
      logMsg("ai", md(r.reply) +
        r.proposals.map((a) => `<div class="proposal" data-action="${a.id}"><span class="kind">${KIND_LABEL[a.kind]}</span><div>${describe(a)}</div>
          <p>${inl(a.reason)}</p><div class="row" style="justify-content:flex-start"><button class="primary" data-apply="${a.id}">Approve</button><button class="ghost" data-dismiss="${a.id}">Dismiss</button></div></div>`).join("") +
        (used.length ? `<div class="tools">Checked: ${used.join(" · ")}</div>` : ""));
      if (r.proposals.length) loadAgentSide().catch(() => {});
    } catch (err) { wait.classList.remove("thinking"); wait.textContent = err.message; }
    finally { $("agentSend").disabled = false; }
  }
  $("agentSend").onclick = () => { const t = $("agentInput").value.trim(); $("agentInput").value = ""; askAgent(t); };
  $("agentInput").onkeydown = (e) => { if (e.key === "Enter") $("agentSend").click(); };
  $("agentSuggest").onclick = (e) => { const c = e.target.closest(".chip"); if (c) askAgent(c.textContent); };
  $("agentReset").onclick = async () => {
    await api("/api/staff/agent/reset", { method: "POST" });
    $("agentLog").innerHTML = `<div class="msg ai"><p>Fresh start — what would you like to look at?</p></div>`;
    $("agentSuggest").classList.remove("hidden");
  };

  async function loadAgentSide() {
    const [pending, all, promos] = await Promise.all([
      api("/api/staff/agent/actions?status=pending"), api("/api/staff/agent/actions?status="), api("/api/staff/promotions")]);
    $("pendingCount").textContent = pending.length;
    $("pending").innerHTML = pending.length ? pending.map((a) => `
      <div class="proposal" data-action="${a.id}"><span class="kind">${KIND_LABEL[a.kind]}</span><div>${describe(a)}</div>
        <p>${inl(a.reason)}</p><div class="row" style="justify-content:flex-start"><button class="primary" data-apply="${a.id}">Approve</button><button class="ghost" data-dismiss="${a.id}">Dismiss</button></div></div>`).join("")
      : `<p class="muted" style="margin-top:10px">No pending proposals.</p>`;
    $("promos").innerHTML = promos.length ? promos.map((p) => `
      <div class="line-item"><span><b>${esc(p.title)}</b><br><small class="muted">${esc(p.details)}${p.ends_at ? ` · until ${new Date(p.ends_at * 1000).toLocaleDateString()}` : ""}</small></span>
      <button class="ghost danger" data-endpromo="${p.id}">End</button></div>`).join("") : `<p class="muted" style="margin-top:10px">No live promotions.</p>`;
    const decided = all.filter((a) => a.status !== "pending").slice(0, 15);
    $("decided").innerHTML = decided.length ? decided.map((a) => `
      <div class="line-item"><span><span class="kind">${KIND_LABEL[a.kind]}</span><br>${describe(a)}</span>
      <span class="badge ${a.status === "applied" ? "ready" : "served"}">${a.status}${a.decided_by ? " · " + esc(a.decided_by) : ""}</span></div>`).join("")
      : `<p class="muted">Nothing decided yet.</p>`;
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-endpromo]"); if (!b) return;
    await api(`/api/staff/promotions/${b.dataset.endpromo}/end`, { method: "POST" });
    toast("Promotion ended"); loadAgentSide().catch(() => {});
  });

  function renderQr() {
    if ($("qrs").children.length) return;
    $("qrs").innerHTML = data.tables.map((t) => `
      <div class="card qr-card"><img src="/api/tables/${t.id}/qr.svg" alt="QR ${esc(t.label)}" />
      <h2>${esc(t.label)}</h2><small class="muted">Scan to chat with our AI & order</small></div>`).join("");
  }

  // ---------------- actions (event delegation)
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button, [data-stock]"); if (!b) return;
    try {
      if (b.dataset.next) {
        await api(`/api/staff/orders/${b.dataset.id}/station/${b.dataset.station}`, { method: "POST", body: JSON.stringify({ status: b.dataset.next }) });
      } else if (b.dataset.status) {
        if (b.dataset.status === "cancelled" && !confirm("Cancel this order?")) return;
        await api(`/api/staff/orders/${b.dataset.id}/status`, { method: "POST", body: JSON.stringify({ status: b.dataset.status }) });
      } else if (b.dataset.resolve) {
        await api(`/api/staff/requests/${b.dataset.resolve}/resolve`, { method: "POST" });
      } else if (b.dataset.settle) {
        if (!confirm("Mark all orders on this table as paid and free the table?")) return;
        await api(`/api/staff/tables/${b.dataset.settle}/settle`, { method: "POST" });
      } else if (b.dataset.del) {
        if (!confirm("Delete this menu item?")) return;
        await api(`/api/staff/menu/${b.dataset.del}`, { method: "DELETE" });
      } else if (b.dataset.stock) {
        await api(`/api/staff/menu/${b.dataset.stock}`, { method: "PATCH", body: JSON.stringify({ available: parseInt(b.dataset.avail, 10) }) });
      } else if (b.dataset.staff) {
        await api(`/api/staff/users/${b.dataset.staff}/active`, { method: "POST", body: JSON.stringify({ active: b.dataset.active === "1" }) });
      } else return;
      await refresh();
    } catch (err) { if (err.message !== "auth") toast(err.message); }
  });
  document.addEventListener("change", async (e) => {
    const el = e.target;
    let patch = null, id = null;
    if (el.dataset.availbox) { id = el.dataset.availbox; patch = { available: el.checked ? 1 : 0 }; }
    if (el.dataset.price) { id = el.dataset.price; patch = { price: parseFloat(el.value) }; }
    if (el.dataset.stationsel) { id = el.dataset.stationsel; patch = { station: el.value }; }
    if (!patch) return;
    try { await api(`/api/staff/menu/${id}`, { method: "PATCH", body: JSON.stringify(patch) }); }
    catch (err) { toast(err.message); }
  });
  $("btnAdd").onclick = async () => {
    const body = {
      name: $("nName").value.trim(), category: $("nCat").value.trim(), price: parseFloat($("nPrice").value),
      description: $("nDesc").value.trim(), veg: $("nVeg").checked ? 1 : 0, spicy: $("nSpicy").checked ? 1 : 0,
      station: $("nStation").value,
    };
    if (!body.name || !body.category || isNaN(body.price)) { toast("Name, category and price are required"); return; }
    try {
      await api("/api/staff/menu", { method: "POST", body: JSON.stringify(body) });
      ["nName", "nPrice", "nDesc"].forEach((id) => ($(id).value = ""));
      toast("Item added"); await refresh();
    } catch (err) { toast(err.message); }
  };
  $("btnAddStaff").onclick = async () => {
    const body = { name: $("sName").value.trim(), username: $("sUser").value.trim(), role: $("sRole").value, pin: $("sPin").value.trim() };
    try {
      await api("/api/staff/users", { method: "POST", body: JSON.stringify(body) });
      ["sName", "sUser", "sPin"].forEach((id) => ($(id).value = ""));
      toast(`${body.name || body.username} can now log in`); await refresh();
    } catch (err) { toast(err.message); }
  };

  // ---------------- realtime: alert only the people who need to act
  function shouldAlert(m) {
    const role = me.role;
    if (role === "manager") return ["order_new", "request_new", "order_ready"].includes(m.type);
    if (m.type === "order_new") return role === "kitchen" || role === "bar" ? Boolean(m.order.stations[role]) : false;
    if (m.type === "order_ready" || m.type === "request_new") return role === "waiter";
    return false;
  }
  function alertText(m) {
    if (m.type === "order_new") return `New order #${m.order.id} · Table ${m.order.table_id}`;
    if (m.type === "order_ready") return `Order #${m.order.id} ready for Table ${m.order.table_id} — please serve`;
    if (m.type === "request_new") return `Table ${m.request.table_id}: ${m.request.kind}`;
    return "";
  }
  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws/staff`);
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (shouldAlert(m)) { chime(); toast(alertText(m)); }
      if (m.type === "ai_usage") {
        if (view === "ai" && !aiTimer) aiTimer = setTimeout(() => { aiTimer = 0; refreshAI().catch(() => {}); }, 1500);
        if (view !== "tables") return;
      }
      refresh().catch(() => {});
    };
    ws.onclose = () => { if (me) setTimeout(connect, 3000); };
    clearInterval(connect._ping);
    connect._ping = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25000);
  }

  async function boot() {
    try {
      const opts = await window.CafeErrors.getJSON("/api/options");
      currency = opts.currency; $("cafeName").textContent = opts.cafe_name;
      data = await api("/api/staff/overview");
      me = data.me;
      $("who").textContent = `${me.name} · ${me.role}`;
      $("login").classList.add("hidden"); $("app").classList.remove("hidden"); $("btnLogout").classList.remove("hidden");
      buildTabs();
      connect();
      clearInterval(refreshTimer);
      refreshTimer = setInterval(() => { refresh().catch(() => {}); if (view === "ai") refreshAI().catch(() => {}); }, 30000);
      const tick = () => ($("clock").textContent = new Date().toLocaleString([], { weekday: "long", hour: "2-digit", minute: "2-digit" }));
      tick(); setInterval(tick, 30000);
      if (G && !REDUCED) G.from(".staff-hero, #tabs button", { y: 20, opacity: 0, duration: .8, ease: "expo.out", stagger: .04 });
    } catch (_) { showLogin(); }
  }
  // visual effects: ribbon light behind the login, spotlight borders on cards
  if (window.FX) {
    // the login shows the same 3D kulhad as the customer app (calm "mini" mode); nothing if 3D isn't available
    const mountLogin3D = () => {
      const S3 = window.Scene3D, tier = S3 ? S3.qualityTier() : "none";
      if (tier !== "none" && !mountLogin3D.done) { mountLogin3D.done = true;
        new S3.KulhadScene($("login3d"), { mode: "mini", quality: tier, layout: (w) => ({ x: 0, y: -0.1, scale: w < 500 ? .7 : .9 }) }); }
    };
    if (window.Scene3D) mountLogin3D(); else window.addEventListener("scene3d-ready", mountLogin3D, { once: true });
    FX.spotlight();
    new MutationObserver(() => document.querySelectorAll(".card:not(.spot), .ticket:not(.spot), .tbl:not(.spot), .col:not(.spot)")
      .forEach((el) => el.classList.add("spot"))).observe(document.body, { childList: true, subtree: true });
  }
  boot();
})();
