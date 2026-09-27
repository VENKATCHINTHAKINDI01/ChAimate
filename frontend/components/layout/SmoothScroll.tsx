"use client";
import { useEffect } from "react";
import Lenis from "lenis";
import { gsap, ScrollTrigger, reducedMotion } from "@/lib/gsap";

/** Lenis smooth scrolling, driven by GSAP's ticker so ScrollTrigger animations stay in lockstep. */
export default function SmoothScroll() {
  useEffect(() => {
    if (reducedMotion()) return;
    const lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    (window as unknown as { __lenis?: Lenis }).__lenis = lenis;
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(tick); gsap.ticker.lagSmoothing(0);
    // in-page anchors (/#experience) scroll smoothly too
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[href*='#']") as HTMLAnchorElement | null;
      if (!a || a.pathname !== location.pathname) return;
      const el = document.querySelector(a.hash); if (!el) return;
      e.preventDefault(); lenis.scrollTo(el as HTMLElement, { offset: -40 });
    };
    document.addEventListener("click", onClick);
    return () => { gsap.ticker.remove(tick); lenis.destroy(); document.removeEventListener("click", onClick); };
  }, []);
  return null;
}
