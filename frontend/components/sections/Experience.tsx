"use client";
import { useRef } from "react";
import Photo from "@/components/ui/Photo";
import { ClipReveal, FadeIn, RevealText } from "@/components/ui/Reveal";
import { gsap, useGSAP, reducedMotion } from "@/lib/gsap";

const CHAPTERS = [
  { n: "01", title: "Not a coffee shop.\nA house.", text: "Deccan House is built around the old Hyderabadi idea of the open house — a place where the door is always open, the chai is always on, and no one is ever in a hurry to leave.", photo: "interior", alt: "The main room at Deccan House in soft daylight" },
  { n: "02", title: "Light, stone,\nand shadow.", text: "Jaali screens carved in Telangana granite filter the afternoon sun into patterns across the floor. The room changes, hour by hour, like the city outside.", photo: "jaali-light", alt: "Sunlight falling through a carved stone jaali" },
  { n: "03", title: "Made slowly,\nby hand.", text: "Our baristas weigh every shot. Our pastry is laminated over three days. Nothing here is rushed — and that is exactly the point.", photo: "barista", alt: "Our head barista at the espresso machine" },
];

export default function Experience() {
  const root = useRef<HTMLElement>(null);
  useGSAP(() => {
    if (reducedMotion() || !matchMedia("(min-width: 1024px)").matches) return;
    // as each photo passes, the matching chapter title on the left takes over
    const items = gsap.utils.toArray<HTMLElement>("[data-chapter]");
    items.forEach((el, i) => {
      gsap.to(`[data-title="${i}"]`, { opacity: 1, y: 0, duration: .8, ease: "expo.out",
        scrollTrigger: { trigger: el, start: "top 60%", end: "bottom 60%", toggleActions: "play reverse play reverse" } });
    });
  }, { scope: root });
  return (
    <section id="experience" ref={root} className="relative bg-ink py-32 md:py-44" aria-labelledby="exp-h">
      <div className="mx-auto max-w-[1680px] px-6 md:px-10">
        <div className="mb-24 grid gap-10 md:mb-36 md:grid-cols-12">
          <p className="eyebrow md:col-span-3">The experience</p>
          <RevealText as="h2" by="line" className="display text-[clamp(2.4rem,5.2vw,5.6rem)] text-cream md:col-span-9">{"Hyderabad has always\nbeen a city that\nlingers over its cup."}</RevealText>
        </div>
        <div className="grid gap-16 lg:grid-cols-12">
          {/* sticky chapter titles (desktop) */}
          <div className="hidden lg:col-span-5 lg:block">
            <div className="sticky top-[22vh] h-[60vh]">
              {CHAPTERS.map((c, i) => (
                <div key={c.n} data-title={i} className="absolute inset-0 translate-y-6 opacity-0 first:translate-y-0 first:opacity-100">
                  <span className="font-display text-7xl italic text-bronze/70">{c.n}</span>
                  <h3 className="display mt-6 whitespace-pre-line text-6xl text-cream">{c.title}</h3>
                  <p className="lede mt-8 max-w-md">{c.text}</p>
                </div>
              ))}
            </div>
          </div>
          <div id="exp-h" className="space-y-28 lg:col-span-6 lg:col-start-7 lg:space-y-[30vh]">
            {CHAPTERS.map((c) => (
              <div key={c.n} data-chapter>
                <ClipReveal className="aspect-[4/5] w-full" parallax={10}>
                  <Photo name={c.photo} alt={c.alt} fill sizes="(min-width:1024px) 45vw, 100vw" />
                </ClipReveal>
                <FadeIn className="mt-8 lg:hidden">
                  <span className="font-display text-5xl italic text-bronze/70">{c.n}</span>
                  <h3 className="display mt-4 whitespace-pre-line text-4xl text-cream">{c.title}</h3>
                  <p className="lede mt-5">{c.text}</p>
                </FadeIn>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
