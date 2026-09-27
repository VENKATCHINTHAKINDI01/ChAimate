"use client";
import dynamic from "next/dynamic";
import { useRef } from "react";
import Button from "@/components/ui/Button";
import Photo from "@/components/ui/Photo";
import { BRAND } from "@/lib/content";
import { useDeviceTier, useMediaQuery } from "@/lib/hooks";
import { gsap, useGSAP, reducedMotion } from "@/lib/gsap";

const HeroCup = dynamic(() => import("@/components/three/HeroCup"), { ssr: false });

export default function Hero() {
  const root = useRef<HTMLElement>(null);
  const tier = useDeviceTier();
  const wide = useMediaQuery("(min-width: 1024px)");

  useGSAP(() => {
    if (reducedMotion()) return;
    const tl = gsap.timeline({ delay: 0.6 });
    tl.from("[data-h] > span > span", { yPercent: 115, duration: 1.6, ease: "expo.out", stagger: 0.09 })
      .from("[data-fade]", { y: 24, opacity: 0, duration: 1.2, ease: "expo.out", stagger: 0.08 }, "-=1.1")
      .from("[data-scene]", { opacity: 0, scale: 1.06, duration: 2.4, ease: "expo.out" }, 0);
    // on scroll the headline drifts up and the scene sinks and dims — a slow cinematic exit
    gsap.to("[data-copy]", { yPercent: -18, opacity: 0.2, ease: "none", scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true } });
    gsap.to("[data-scene]", { yPercent: 12, opacity: 0.35, ease: "none", scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true } });
  }, { scope: root });

  const lines = ["A different", "kind of café."];
  return (
    <section ref={root} className="relative h-[100svh] min-h-[640px] overflow-hidden bg-[#0b0a09]" aria-label="Welcome">
      <div data-scene className="absolute inset-0">
        {tier === "high" || tier === "low" ? <HeroCup quality={tier} offsetX={wide ? -1.25 : 0} compact={!wide} />
          : tier === "none" ? <Photo name="latte-pour" alt="Milk poured into an espresso" fill priority imgClassName="opacity-70" /> : null}
        {/* legibility: darken toward the copy */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(11,10,9,.88)_0%,rgba(11,10,9,.45)_45%,transparent_70%),linear-gradient(0deg,rgba(11,10,9,.9),transparent_35%)] max-lg:bg-[linear-gradient(0deg,rgba(11,10,9,.95)_18%,rgba(11,10,9,.2)_60%,transparent)]" />
      </div>

      <div data-copy className="relative z-10 mx-auto flex h-full max-w-[1680px] flex-col justify-end px-6 pb-[12vh] md:px-10 lg:justify-center lg:pb-0">
        <p data-fade className="eyebrow mb-6">{BRAND.area} · Hyderabad</p>
        <h1 data-h className="display text-[clamp(3.2rem,8vw,9rem)] text-cream" aria-label="A different kind of café.">
          {lines.map((l, i) => (
            <span key={i} className="block overflow-hidden whitespace-nowrap pb-[0.06em]" aria-hidden="true">
              <span className={`block ${i === 1 ? "display-italic normal-case text-bronze-2" : ""}`}>{l}</span>
            </span>
          ))}
        </h1>
        <p data-fade className="lede mt-8 max-w-md">Specialty coffee, contemporary cuisine, and slow moments in the heart of Hyderabad.</p>
        <div data-fade className="mt-10 flex flex-wrap items-center gap-4">
          <Button href="/menu/" cursor="EXPLORE">Explore menu</Button>
          <Button href="/reservations/" variant="outline" cursor="BOOK">Reserve a table</Button>
        </div>
      </div>

      <div data-fade className="absolute bottom-8 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-3 md:flex">
        <span className="label text-muted">Scroll to explore</span>
        <span className="relative h-12 w-px overflow-hidden bg-cream/15"><span className="absolute inset-x-0 top-0 h-1/2 animate-[scrollcue_2.2s_cubic-bezier(.65,0,.35,1)_infinite] bg-cream" /></span>
      </div>
      <div data-fade className="absolute bottom-8 right-6 z-10 hidden text-right text-xs leading-relaxed text-muted md:block md:right-10">
        Open today<br /><span className="text-beige">7:00 AM – 11:00 PM</span>
      </div>
      <style>{`@keyframes scrollcue{0%{transform:translateY(-100%)}100%{transform:translateY(200%)}}`}</style>
    </section>
  );
}
