"use client";
import { useRef } from "react";
import { FadeIn, RevealText } from "@/components/ui/Reveal";
import { BRAND } from "@/lib/content";
import { gsap, useGSAP, reducedMotion } from "@/lib/gsap";

/** A Qutb Shahi arcade: five pointed arches under a parapet, a slender minaret with galleries and a bulb dome at each end. */
function Arcade() {
  const arch = (x: number, w: number, spring: number, peak: number) =>
    `M${x} 300 V${spring} C${x} ${spring - (spring - peak) * .7} ${x + w * .3} ${peak + 18} ${x + w / 2} ${peak} C${x + w * .7} ${peak + 18} ${x + w} ${spring - (spring - peak) * .7} ${x + w} ${spring} V300`;
  const minaret = (cx: number) => [
    `M${cx - 9} 300 V92`, `M${cx + 9} 300 V92`,
    ...[250, 190, 132].map((y) => `M${cx - 16} ${y} H${cx + 16} M${cx - 13} ${y + 7} H${cx + 13}`),
    `M${cx - 11} 92 C${cx - 16} 72 ${cx - 5} 60 ${cx} 46 C${cx + 5} 60 ${cx + 16} 72 ${cx + 11} 92 Z`, `M${cx} 46 V30`,
  ];
  const paths = [
    "M40 300 H760", "M70 104 H730", "M70 116 H730",
    ...Array.from({ length: 22 }, (_, i) => `M${86 + i * 28.6} 104 v-10 a6 6 0 0 1 12 0 v10`),     // parapet merlons
    ...Array.from({ length: 5 }, (_, i) => arch(110 + i * 118, 92, 196, 138)),
    ...Array.from({ length: 5 }, (_, i) => arch(128 + i * 118, 56, 212, 172)),                     // inner arch lines
    ...minaret(58), ...minaret(742),
  ];
  return (
    <svg viewBox="0 0 800 310" className="w-full" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      {paths.map((d, i) => <path key={i} d={d} data-draw pathLength={1} />)}
    </svg>
  );
}

export default function RootedHere() {
  const root = useRef<HTMLElement>(null);
  useGSAP(() => {
    const lines = root.current!.querySelectorAll<SVGPathElement>("[data-draw]");
    if (reducedMotion()) return;
    gsap.set(lines, { strokeDasharray: 1, strokeDashoffset: 1 });
    gsap.to(lines, { strokeDashoffset: 0, ease: "none", stagger: 0.01,
      scrollTrigger: { trigger: root.current, start: "top 70%", end: "center 45%", scrub: 1 } });
  }, { scope: root });
  const facts = [["17.4308° N", "78.4071° E"], ["Jubilee Hills", BRAND.city], ["Deccan", "hospitality since 1591"]];
  return (
    <section ref={root} className="relative overflow-hidden bg-ink py-32 md:py-44" aria-labelledby="rooted-h">
      <div className="mx-auto max-w-[1680px] px-6 md:px-10">
        <div className="grid gap-10 md:grid-cols-12">
          <p className="eyebrow md:col-span-3">Hyderabad</p>
          <div className="md:col-span-9">
            <RevealText as="h2" by="line" className="display text-[clamp(3.4rem,9vw,9.6rem)] text-cream">{"Rooted here."}</RevealText>
            <FadeIn className="mt-10 grid max-w-3xl gap-8 md:grid-cols-2">
              <p className="lede">The Qutb Shahi builders gave Hyderabad its arches; the Nizams gave it its manners. We borrowed a little of both — the proportions of our windows, and the habit of never letting a guest leave hungry.</p>
              <p className="lede">Our beans come from the Deccan plateau and the Western Ghats. Our granite, from Telangana quarries. Our team, from every corner of the city.</p>
            </FadeIn>
          </div>
        </div>
        <div className="mt-24 text-bronze/80 md:mt-32"><Arcade /></div>
        <dl className="mt-16 grid gap-8 border-t border-line pt-10 sm:grid-cols-3">
          {facts.map(([a, b]) => <div key={a}><dt className="font-display text-3xl text-cream">{a}</dt><dd className="label mt-2 text-muted">{b}</dd></div>)}
        </dl>
      </div>
    </section>
  );
}
