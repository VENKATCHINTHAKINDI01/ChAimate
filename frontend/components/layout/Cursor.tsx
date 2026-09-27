"use client";
import { useEffect, useRef, useState } from "react";

/** Minimal custom cursor: a small dot that grows into a labelled ring over elements with data-cursor="VIEW" etc.
 *  Fine pointers only; touch devices and reduced-motion users keep the native cursor. */
export default function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.documentElement.classList.add("has-cursor");
    let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y, raf = 0;
    const move = (e: PointerEvent) => {
      x = e.clientX; y = e.clientY;
      const t = (e.target as HTMLElement).closest?.("[data-cursor], a, button, input, select, textarea") as HTMLElement | null;
      setLabel(t ? (t.dataset.cursor ?? (t.matches("input, select, textarea") ? "text" : "link")) : "");
    };
    const loop = () => {
      cx += (x - cx) * 0.2; cy += (y - cy) * 0.2;
      if (dot.current) dot.current.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      raf = requestAnimationFrame(loop);
    };
    addEventListener("pointermove", move, { passive: true }); loop();
    return () => { removeEventListener("pointermove", move); cancelAnimationFrame(raf); document.documentElement.classList.remove("has-cursor"); };
  }, []);
  const big = label && label !== "link" && label !== "text";
  return (
    <div ref={dot} aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-[100] hidden [@media(hover:hover)_and_(pointer:fine)]:block">
      <div className={`flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[0.6rem] font-semibold uppercase tracking-[0.2em] transition-all duration-500 ease-[cubic-bezier(.16,1,.3,1)]
        ${big ? "h-20 w-20 bg-cream text-ink" : label === "link" ? "h-10 w-10 border border-cream/70" : label === "text" ? "h-6 w-[2px] rounded-none bg-cream" : "h-2 w-2 bg-cream"}`}>
        {big ? label : ""}
      </div>
    </div>
  );
}
