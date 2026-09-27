"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FadeIn, RevealText } from "@/components/ui/Reveal";
import Photo from "@/components/ui/Photo";
import { SPACES } from "@/lib/content";
import { useDeviceTier } from "@/lib/hooks";

const Walkthrough = dynamic(() => import("@/components/three/Walkthrough"), { ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-muted">Setting the tables…</div> });

/** Section 14: an interactive cut-away model of the café. Loads its 3D only when scrolled near. */
export default function StepInside() {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const tier = useDeviceTier();
  const [active, setActive] = useState("overview");
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); io.disconnect(); } }, { rootMargin: "400px" });
    if (box.current) io.observe(box.current); return () => io.disconnect();
  }, []);
  const space = SPACES.find((s) => s.id === active);
  return (
    <section className="bg-ink-2 py-32 md:py-44" aria-labelledby="inside-h">
      <div className="mx-auto max-w-[1680px] px-6 md:px-10">
        <div className="mb-14 flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div><p className="eyebrow mb-8">Step inside</p>
            <RevealText as="h2" by="line" className="display text-[clamp(2.8rem,7vw,7rem)] text-cream">{"Five rooms,\none house."}</RevealText></div>
          <FadeIn className="max-w-sm"><p className="lede">Drag to walk around the house. Choose a space to step closer.</p></FadeIn>
        </div>

        <div ref={box} className="relative h-[72svh] min-h-[480px] overflow-hidden border border-line bg-ink" data-cursor="DRAG">
          {tier === "none" ? <Photo name="interior" alt="Inside Deccan House" fill sizes="100vw" />
            : near && tier ? <Walkthrough active={active} onSelect={setActive} quality={tier} /> : null}

          {/* space picker */}
          <nav aria-label="Spaces" className="absolute left-4 top-4 z-10 flex max-w-[calc(100%-2rem)] flex-wrap gap-2">
            {[{ id: "overview", title: "Overview" }, ...SPACES].map((s) => (
              <button key={s.id} onClick={() => setActive(s.id)} aria-pressed={active === s.id}
                className={`border px-3 py-2 text-[0.62rem] uppercase tracking-[0.2em] backdrop-blur transition-colors duration-500 ${active === s.id ? "border-cream bg-cream text-ink" : "border-line bg-ink/60 text-beige hover:border-cream/60"}`}>
                {s.title}
              </button>
            ))}
          </nav>

          <AnimatePresence mode="wait">
            {space && (
              <motion.aside key={space.id} className="absolute bottom-4 left-4 right-4 z-10 max-w-sm border border-line bg-ink/85 p-6 backdrop-blur-md md:bottom-8 md:left-auto md:right-8"
                initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
                <p className="eyebrow">Deccan House</p>
                <h3 className="mt-3 font-display text-4xl text-cream">{space.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-beige">{space.text}</p>
                <button onClick={() => setActive("overview")} className="link-line label mt-6 text-bronze-2">← Back to the house</button>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
