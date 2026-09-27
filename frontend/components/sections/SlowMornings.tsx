"use client";
import { useRef } from "react";
import Photo from "@/components/ui/Photo";
import { gsap, useGSAP, reducedMotion } from "@/lib/gsap";

const FRAMES = [
  { photo: "latte-pour", caption: "The pour", sub: "Microfoam at 62°C" },
  { photo: "pain-au-chocolat", caption: "Laminated for three days", sub: "Out of the oven at 6:40 AM" },
  { photo: "plating", caption: "The pass", sub: "Brunch until noon, every day" },
  { photo: "tamping", caption: "18 grams, exactly", sub: "Weighed, tamped, timed" },
  { photo: "cardamom", caption: "Green cardamom", sub: "Ground to order, never before" },
  { photo: "interior-evening", caption: "And then, evening", sub: "Open until midnight on weekends" },
];

/** Full-bleed title, then a pinned horizontal reel of photographs that scrolls sideways as you scroll down. */
export default function SlowMornings() {
  const root = useRef<HTMLElement>(null), track = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (reducedMotion() || !matchMedia("(min-width: 900px)").matches) return;
    const t = track.current!;
    gsap.to(t, { x: () => -(t.scrollWidth - innerWidth + 80), ease: "none",
      scrollTrigger: { trigger: root.current, pin: true, scrub: 1, start: "top top", end: () => `+=${t.scrollWidth}`, invalidateOnRefresh: true } });
    gsap.utils.toArray<HTMLElement>("[data-frame] img").forEach((img) => gsap.fromTo(img, { scale: 1.2 }, { scale: 1, ease: "none",
      scrollTrigger: { trigger: root.current, start: "top top", end: () => `+=${t.scrollWidth}`, scrub: true } }));
  }, { scope: root });
  return (
    <section ref={root} className="relative overflow-hidden bg-ink" aria-labelledby="slow-h">
      <div className="flex min-h-[100svh] flex-col justify-center py-24">
        <div ref={track} className="flex items-center gap-8 pl-6 md:gap-12 md:pl-10 max-[899px]:flex-col max-[899px]:items-stretch max-[899px]:px-6">
          <div className="w-full shrink-0 md:w-[42vw]">
            <p className="eyebrow mb-8">Food & ritual</p>
            <h2 id="slow-h" className="display text-[clamp(3rem,8vw,8.4rem)] text-cream">Made for<br /><span className="display-italic text-bronze-2">slow mornings.</span></h2>
            <p className="lede mt-8 max-w-md">A kitchen that starts at dawn, and a room that never asks you to leave. Scroll on — this is how a day unfolds at Deccan House.</p>
          </div>
          {FRAMES.map((f, i) => (
            <figure key={f.photo} data-frame className={`relative shrink-0 ${i % 2 ? "md:mt-40" : "md:-mt-24"}`}>
              <div className={`relative overflow-hidden ${i % 3 === 0 ? "h-[62vh] w-[44vh]" : "h-[48vh] w-[36vw] max-w-[620px]"} max-[899px]:h-[60vh] max-[899px]:w-full`}>
                <Photo name={f.photo} alt={f.caption} fill sizes="(min-width:900px) 40vw, 100vw" />
              </div>
              <figcaption className="mt-4 flex items-baseline justify-between gap-6">
                <span className="font-display text-2xl italic text-cream">{f.caption}</span>
                <span className="label text-muted">{f.sub}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
