"use client";
import { useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Photo from "@/components/ui/Photo";
import { FadeIn, RevealText } from "@/components/ui/Reveal";
import { EVENTS } from "@/lib/content";

const PHOTOS = ["interior-evening", "espresso", "dessert-plate", "terrace", "interior", "brunch"];

/** Private events: an editorial list where hovering a row floats its photograph beside the cursor. */
export default function Events() {
  const [hover, setHover] = useState<number | null>(null);
  const float = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState(false);
  const move = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || !float.current) return;
    float.current.style.transform = `translate(${e.clientX + 24}px, ${e.clientY - 140}px)`; if (!placed) setPlaced(true);
  };
  return (
    <section className="relative bg-ink py-32 md:py-44" aria-labelledby="events-h" onPointerMove={move}>
      <div className="mx-auto grid max-w-[1680px] gap-16 px-6 md:px-10 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <p className="eyebrow mb-8">Private events</p>
          <RevealText as="h2" by="line" className="display text-[clamp(2.8rem,5.6vw,5.6rem)] text-cream">{"The house\nis yours."}</RevealText>
          <FadeIn className="mt-8"><p className="lede max-w-sm">From a candle-lit dinner for ten to a full buy-out for your launch — our events team plans every detail with you.</p></FadeIn>
          <FadeIn className="mt-10"><Button href="/events/" cursor="PLAN">Plan your event</Button></FadeIn>
        </div>
        <ul className="lg:col-span-7 lg:col-start-6">
          {EVENTS.map((e, i) => (
            <li key={e.title} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}
              className="group flex items-baseline justify-between gap-6 border-t border-line py-8 last:border-b">
              <span className="font-display text-[clamp(1.8rem,3.4vw,3.2rem)] leading-none text-cream transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)] group-hover:translate-x-4">{e.title}</span>
              <span className="max-w-[16rem] text-right text-sm text-muted transition-colors duration-500 group-hover:text-beige">{e.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div ref={float} aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-30 hidden transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] [@media(hover:hover)]:block">
        {PHOTOS.map((p, i) => (
          <div key={p} className={`absolute h-[280px] w-[220px] overflow-hidden transition-all duration-700 ease-[cubic-bezier(.16,1,.3,1)] ${hover === i && placed ? "scale-100 opacity-100" : "scale-90 opacity-0"}`}>
            <Photo name={p} alt="" fill sizes="220px" />
          </div>
        ))}
      </div>
    </section>
  );
}
