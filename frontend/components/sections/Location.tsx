"use client";
import { useEffect, useRef, useState } from "react";
import { MapPin, MessageCircle, Navigation, Phone } from "lucide-react";
import Button from "@/components/ui/Button";
import { FadeIn, RevealText } from "@/components/ui/Reveal";
import { BRAND } from "@/lib/content";

/** Dark CARTO basemap via MapLibre (no API key), loaded only when the section is near the viewport. */
function DarkMap() {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let map: { remove: () => void } | null = null, cancelled = false;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return; io.disconnect();
      try {
        const maplibre = await import("maplibre-gl");
        maplibre.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (cancelled || !el.current) return;
        const m = new maplibre.Map({
          container: el.current, center: [BRAND.coords.lng, BRAND.coords.lat], zoom: 14.6, attributionControl: { compact: true },
          cooperativeGestures: true,
          style: "https://tiles.openfreemap.org/styles/positron",
        });
        // repaint OpenFreeMap's light "positron" style in the house palette: espresso land, bronze roads, muted labels
        m.on("style.load", () => {
          const paint: Record<string, [string, string][]> = {
            fill: [["fill-color", "#1b1916"]], line: [["line-color", "#3a332b"]], symbol: [["text-color", "#9c9285"], ["text-halo-color", "#11100e"]],
          };
          for (const layer of m.getStyle().layers ?? []) {
            const id = layer.id;
            if (layer.type === "background") m.setPaintProperty(id, "background-color", "#11100e");
            else if (id === "water") m.setPaintProperty(id, "fill-color", "#0c0d0e");
            else if (id === "park" || id.startsWith("landcover")) m.setPaintProperty(id, "fill-color", "#1a1c16");
            else if (id === "building") { m.setPaintProperty(id, "fill-color", "#1f1c19"); m.setPaintProperty(id, "fill-outline-color", "#2a2622"); }
            else if (id.includes("motorway") || id.includes("major")) { if (layer.type === "line") { m.setPaintProperty(id, "line-color", id.includes("casing") ? "#1b1916" : "#5a4636"); m.setPaintProperty(id, "line-opacity", 0.85); } }
            else if (id.includes("shield")) m.setLayoutProperty(id, "visibility", "none");
            else for (const [k, v] of paint[layer.type] ?? []) { try { m.setPaintProperty(id, k as "fill-color", v); } catch {} }
          }
        });
        const pin = document.createElement("div");
        pin.innerHTML = `<div style="position:relative;display:grid;place-items:center"><span style="position:absolute;width:56px;height:56px;border-radius:50%;background:rgba(183,138,90,.25);animation:dhpulse 2.4s infinite"></span><svg width="28" height="34" viewBox="0 0 24 30" fill="#11100e" stroke="#d3a878" stroke-width="1.4"><path d="M3 29V13C3 7.5 8.5 3.2 12 1c3.5 2.2 9 6.5 9 12v16z"/></svg></div>`;
        new maplibre.Marker({ element: pin, anchor: "bottom" }).setLngLat([BRAND.coords.lng, BRAND.coords.lat]).addTo(m);
        // keep the canvas matched to its box (the section's height settles after fonts and images load)
        const ro = new ResizeObserver(() => m.resize()); ro.observe(el.current);
        m.once("load", () => m.resize());
        map = { remove: () => { ro.disconnect(); m.remove(); } };
      } catch { setFailed(true); }
    }, { rootMargin: "300px" });
    if (el.current) io.observe(el.current);
    return () => { cancelled = true; io.disconnect(); map?.remove(); };
  }, []);
  return (
    <div className="relative h-full min-h-[420px] w-full bg-ink-3 lg:min-h-[640px]">
      <div ref={el} style={{ position: "absolute", inset: 0 }} aria-label={`Map showing ${BRAND.name} in ${BRAND.area}`} role="img" />
      {failed && <div className="absolute inset-0 grid place-items-center text-sm text-muted">{BRAND.address}</div>}
      <style>{`@keyframes dhpulse{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.6);opacity:0}}`}</style>
    </div>
  );
}

export default function Location() {
  const dirs = `https://www.google.com/maps/dir/?api=1&destination=${BRAND.coords.lat},${BRAND.coords.lng}`;
  const links = [
    { href: dirs, label: "Get directions", Icon: Navigation },
    { href: `tel:${BRAND.phone.replace(/\s/g, "")}`, label: "Call", Icon: Phone },
    { href: `https://wa.me/${BRAND.whatsapp}`, label: "WhatsApp", Icon: MessageCircle },
  ];
  return (
    <section className="bg-ink-2" aria-labelledby="loc-h">
      <div className="mx-auto grid max-w-[1680px] lg:grid-cols-2">
        <div className="px-6 py-28 md:px-10 lg:py-40">
          <p className="eyebrow mb-8">Visit</p>
          <RevealText as="h2" by="line" className="display text-[clamp(2.8rem,6vw,6rem)] text-cream">{"Deccan House,\nJubilee Hills."}</RevealText>
          <FadeIn className="mt-12 grid gap-10 sm:grid-cols-2">
            <div>
              <h3 className="label text-muted">Address</h3>
              <p className="mt-3 flex gap-2 text-beige"><MapPin size={16} className="mt-1 shrink-0 text-bronze-2" />{BRAND.address}</p>
            </div>
            <div>
              <h3 className="label text-muted">Opening hours</h3>
              <dl className="mt-3 space-y-1 text-beige">{BRAND.hours.map((h) => <div key={h.days} className="flex justify-between gap-6"><dt>{h.days}</dt><dd>{h.time}</dd></div>)}</dl>
            </div>
          </FadeIn>
          <FadeIn className="mt-12 flex flex-wrap gap-3">
            {links.map(({ href, label, Icon }) => (
              <a key={label} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer"
                className="inline-flex items-center gap-2 border border-line px-5 py-3 text-[0.68rem] uppercase tracking-[0.2em] text-beige transition-colors duration-500 hover:border-cream hover:text-cream">
                <Icon size={14} strokeWidth={1.5} />{label}
              </a>
            ))}
          </FadeIn>
          <FadeIn className="mt-10"><Button href="/reservations/" cursor="BOOK">Reserve a table</Button></FadeIn>
        </div>
        <DarkMap />
      </div>
    </section>
  );
}
