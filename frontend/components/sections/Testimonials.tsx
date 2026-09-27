"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { TESTIMONIALS } from "@/lib/content";

export default function Testimonials() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => { if (paused) return; const t = setInterval(() => setI((x) => (x + 1) % TESTIMONIALS.length), 6500); return () => clearInterval(t); }, [paused]);
  const q = TESTIMONIALS[i];
  return (
    <section className="bg-ink-2 py-32 md:py-44" aria-label="What guests say" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
      <div className="mx-auto max-w-5xl px-6 text-center md:px-10">
        <p className="eyebrow">In their words</p>
        <div className="relative mt-12 min-h-[16rem] md:min-h-[14rem]" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.figure key={i} initial={{ opacity: 0, y: 30, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -20, filter: "blur(6px)" }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}>
              <blockquote className="font-display text-[clamp(2rem,4.4vw,3.8rem)] italic leading-[1.1] text-cream">“{q.quote}”</blockquote>
              <figcaption className="label mt-10 text-muted">— {q.who}, {q.where}</figcaption>
            </motion.figure>
          </AnimatePresence>
        </div>
        <div className="mt-10 flex justify-center gap-3">
          {TESTIMONIALS.map((_, k) => (
            <button key={k} onClick={() => setI(k)} aria-label={`Show review ${k + 1}`} aria-current={k === i}
              className="relative h-px w-12 overflow-hidden bg-cream/20"><span className={`absolute inset-y-0 left-0 bg-cream transition-all duration-700 ${k === i ? "w-full" : "w-0"}`} /></button>
          ))}
        </div>
      </div>
    </section>
  );
}
