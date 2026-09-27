/* Tiny SVG chart kit for the analytics board.
   Specs: 2px lines, bars <= 24px with 4px rounded data-ends, 2px surface gaps, >= 8px markers with a surface ring,
   hairline recessive grid, text in text tokens (never series colour), hover tooltip on every chart, legend for >= 2
   series, and a "Table" toggle so no value is colour- or hover-only. Colours come from CSS custom properties. */
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---- tooltip (one shared, follows the pointer, stays inside the viewport)
  let tip;
  function tooltip(html, x, y) {
    if (!tip) { tip = document.createElement("div"); tip.className = "viz-tip"; document.body.appendChild(tip); }
    if (html == null) { tip.style.opacity = 0; return; }
    tip.innerHTML = html; tip.style.opacity = 1;
    const r = tip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - r.width - 8, x + 14), top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
    tip.style.transform = `translate(${Math.max(8, left)}px, ${top}px)`;
  }

  // ---- nice ticks
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  const compact = (n) => Math.abs(n) >= 1e5 ? (n / 1e5).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, "") + "L"
    : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(Math.round(n));

  // ---- frame: header (legend + table toggle), plot, table
  function frame(host, { legend = [], table }) {
    host.innerHTML = "";
    host.classList.add("viz");
    const head = document.createElement("div"); head.className = "viz-head";
    head.innerHTML = `<div class="viz-legend">${legend.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>
      <button class="viz-toggle" type="button" aria-pressed="false">Table</button>`;
    const plot = document.createElement("div"); plot.className = "viz-plot";
    const tbl = document.createElement("div"); tbl.className = "viz-table hidden";
    tbl.innerHTML = `<table><thead><tr>${table.cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    head.querySelector(".viz-toggle").onclick = (e) => {
      const on = tbl.classList.toggle("hidden") === false;
      plot.classList.toggle("hidden", on); e.target.setAttribute("aria-pressed", on); e.target.textContent = on ? "Chart" : "Table";
    };
    host.append(head, plot, tbl);
    return plot;
  }

  // ---------------------------------------------------------------- line chart (time series)
  function line(host, { labels, series, format = compact, height = 240, xFormat = (l) => l }) {
    const plot = frame(host, {
      legend: series.length > 1 ? series : [],
      table: { cols: ["", ...series.map((s) => s.name)], rows: labels.map((l, i) => [xFormat(l), ...series.map((s) => format(s.values[i]))]) },
    });
    const W = Math.max(280, plot.clientWidth || host.clientWidth || 600), H = height;
    const m = { t: 12, r: 16, b: 26, l: 44 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
    const x = (i) => m.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
    const y = (v) => m.t + ih - (v / max) * ih;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img" }, plot);
    for (let k = 0; k <= 4; k++) {
      const v = (max / 4) * k;
      el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "viz-grid" }, svg);
      el("text", { x: m.l - 8, y: y(v) + 4, class: "viz-axis", "text-anchor": "end" }, svg).textContent = format(v);
    }
    const every = Math.ceil(labels.length / Math.max(2, Math.floor(iw / 70)));
    labels.forEach((l, i) => {
      if (i % every === 0 || i === labels.length - 1) el("text", { x: x(i), y: H - 6, class: "viz-axis", "text-anchor": i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle" }, svg).textContent = xFormat(l);
    });
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
      if (si === 0) el("polygon", { points: `${x(0)},${y(0)} ${pts} ${x(labels.length - 1)},${y(0)}`, fill: s.color, opacity: 0.1 }, svg);
      el("polyline", { points: pts, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      const li = s.values.length - 1;
      el("circle", { cx: x(li), cy: y(s.values[li]), r: 4, fill: s.color, class: "viz-ring" }, svg);
    });
    // end label for the lead series only (selective labelling)
    const lead = series[0], li = lead.values.length - 1;
    el("text", { x: x(li) - 8, y: y(lead.values[li]) - 10, class: "viz-label", "text-anchor": "end" }, svg).textContent = format(lead.values[li]);
    // crosshair + tooltip
    const cross = el("line", { y1: m.t, y2: m.t + ih, class: "viz-cross", opacity: 0 }, svg);
    const dots = series.map((s) => el("circle", { r: 5, fill: s.color, class: "viz-ring", opacity: 0 }, svg));
    const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }, svg);
    hit.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(labels.length - 1, Math.round(((px - m.l) / iw) * (labels.length - 1))));
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("opacity", 1);
      dots.forEach((d, si) => { d.setAttribute("cx", x(i)); d.setAttribute("cy", y(series[si].values[i])); d.setAttribute("opacity", 1); });
      tooltip(`<b>${esc(xFormat(labels[i]))}</b>` + series.map((s) => `<div><i style="background:${s.color}"></i>${esc(s.name)}<span>${format(s.values[i])}</span></div>`).join(""), e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", () => { cross.setAttribute("opacity", 0); dots.forEach((d) => d.setAttribute("opacity", 0)); tooltip(null); });
  }

  // ---------------------------------------------------------------- horizontal bar list (ranked)
  function bars(host, { rows, format = compact, color, sub = () => "" }) {
    const plot = frame(host, { table: { cols: ["", "Value", ""], rows: rows.map((r) => [r.label, format(r.value), sub(r).replace(/<[^>]+>/g, "")]) } });
    const max = Math.max(1, ...rows.map((r) => r.value));
    plot.innerHTML = rows.map((r, i) => `
      <div class="viz-bar" data-i="${i}">
        <div class="viz-bar-top"><span class="viz-bar-name">${esc(r.label)}</span><span class="viz-bar-sub">${sub(r)}</span></div>
        <div class="viz-bar-track"><div class="viz-bar-fill" style="width:${(r.value / max) * 100}%;background:${color}"></div><b>${format(r.value)}</b></div>
      </div>`).join("") || `<p class="muted">No data yet.</p>`;
    plot.querySelectorAll(".viz-bar").forEach((b) => {
      const r = rows[b.dataset.i];
      b.addEventListener("pointermove", (e) => tooltip(`<b>${esc(r.label)}</b><div>${format(r.value)}${r.tip ? `<span>${esc(r.tip)}</span>` : ""}</div>`, e.clientX, e.clientY));
      b.addEventListener("pointerleave", () => tooltip(null));
    });
  }

  // ---------------------------------------------------------------- columns (categorical, one series)
  function columns(host, { labels, values, format = compact, color, height = 200, highlight = -1 }) {
    const plot = frame(host, { table: { cols: ["", "Value"], rows: labels.map((l, i) => [l, format(values[i])]) } });
    const W = Math.max(260, plot.clientWidth || 400), H = height, m = { t: 22, r: 8, b: 24, l: 8 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, band = iw / labels.length, bw = Math.min(24, band * 0.6);
    const max = niceMax(Math.max(1, ...values));
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H }, plot);
    el("line", { x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih, class: "viz-grid" }, svg);
    const peak = values.indexOf(Math.max(...values));
    values.forEach((v, i) => {
      const h = (v / max) * ih, x0 = m.l + band * i + (band - bw) / 2, y0 = m.t + ih - h, rr = Math.min(4, h);
      const d = `M${x0},${m.t + ih} V${y0 + rr} Q${x0},${y0} ${x0 + rr},${y0} H${x0 + bw - rr} Q${x0 + bw},${y0} ${x0 + bw},${y0 + rr} V${m.t + ih} Z`;
      const bar = el("path", { d, fill: color, opacity: highlight >= 0 && i !== highlight ? 0.45 : 1 }, svg);
      el("text", { x: x0 + bw / 2, y: H - 6, class: "viz-axis", "text-anchor": "middle" }, svg).textContent = labels[i];
      if (i === peak) el("text", { x: x0 + bw / 2, y: y0 - 6, class: "viz-label", "text-anchor": "middle" }, svg).textContent = format(v);
      const hit = el("rect", { x: m.l + band * i, y: m.t, width: band, height: ih, fill: "transparent" }, svg);
      hit.addEventListener("pointermove", (e) => { bar.style.filter = "brightness(1.1)"; tooltip(`<b>${esc(labels[i])}</b><div>${format(v)}</div>`, e.clientX, e.clientY); });
      hit.addEventListener("pointerleave", () => { bar.style.filter = ""; tooltip(null); });
    });
  }

  // ---------------------------------------------------------------- heatmap (weekday x hour, sequential ramp)
  function heatmap(host, { grid, rows, cols, format = (v) => v, unit = "" }) {
    const plot = frame(host, { table: { cols: ["", ...cols.map((c) => c + ":00")], rows: grid.map((r, i) => [rows[i], ...cols.map((c) => r[c])]) } });
    const max = Math.max(1, ...grid.flatMap((r) => cols.map((c) => r[c])));
    const W = Math.max(300, plot.clientWidth || 600), lw = 36, cw = (W - lw) / cols.length, ch = 26, H = rows.length * ch + 22;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H }, plot);
    const steps = 6;
    rows.forEach((rl, ri) => {
      el("text", { x: 0, y: ri * ch + ch / 2 + 4, class: "viz-axis" }, svg).textContent = rl;
      cols.forEach((c, ci) => {
        const v = grid[ri][c], s = v ? Math.min(steps, 1 + Math.floor((v / max) * steps)) : 0;
        const cell = el("rect", { x: lw + ci * cw + 1, y: ri * ch + 1, width: cw - 2, height: ch - 2, rx: 4, fill: `var(--seq-${s})` }, svg);
        cell.addEventListener("pointermove", (e) => { cell.setAttribute("stroke", "var(--ink)"); tooltip(`<b>${esc(rl)} ${c}:00–${c + 1}:00</b><div>${format(v)}${unit}</div>`, e.clientX, e.clientY); });
        cell.addEventListener("pointerleave", () => { cell.removeAttribute("stroke"); tooltip(null); });
      });
    });
    const every = cols.length > 12 ? 2 : 1;
    cols.forEach((c, ci) => { if (ci % every === 0) el("text", { x: lw + ci * cw + cw / 2, y: H - 4, class: "viz-axis", "text-anchor": "middle" }, svg).textContent = c; });
    const key = document.createElement("div"); key.className = "viz-ramp";
    key.innerHTML = `<span>Quiet</span>${Array.from({ length: steps }, (_, i) => `<i style="background:var(--seq-${i + 1})"></i>`).join("")}<span>Busy</span>`;
    plot.appendChild(key);
  }

  // ---------------------------------------------------------------- sparkline for stat tiles
  function spark(host, values, color, { width = 120, height = 30 } = {}) {
    const W = width, H = height, max = Math.max(1, ...values), min = Math.min(...values);
    const x = (i) => (i / Math.max(1, values.length - 1)) * (W - 4) + 2, y = (v) => H - 3 - ((v - min) / Math.max(1, max - min)) * (H - 6);
    host.innerHTML = "";
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true" }, host);
    const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    if (H > 40) el("polygon", { points: `${x(0)},${H} ${pts} ${x(values.length - 1)},${H}`, fill: color, opacity: 0.08 }, svg);
    el("polyline", { points: pts, fill: "none", stroke: H > 40 ? color : "var(--viz-muted)", "stroke-width": H > 40 ? 2 : 1.5, "stroke-linejoin": "round" }, svg);
    const li = values.length - 1;
    el("circle", { cx: x(li), cy: y(values[li]), r: 3, fill: color }, svg);
  }

  window.Charts = { line, bars, columns, heatmap, spark, compact, tooltip };
})();
