"use client";
import { useState } from "react";
import { useHash } from "@/lib/hooks";
import { AnimatePresence, motion } from "motion/react";
import Photo from "@/components/ui/Photo";
import { DIET_LABELS, MENU } from "@/lib/content";

export default function InteractiveMenu() {
  const hash = useHash();
  const [picked, setCat] = useState<string | null>(null);
  const cat = picked ?? (MENU.some((m) => m.id === hash) ? hash : MENU[0].id);
  const c = MENU.find((m) => m.id === cat)!;
  return (
    <div>
      <div role="tablist" aria-label="Menu categories" className="-mx-6 flex gap-8 overflow-x-auto border-b border-line px-6 md:mx-0 md:px-0" data-lenis-prevent>
        {MENU.map((m) => (
          <button key={m.id} role="tab" aria-selected={cat === m.id} aria-controls={`panel-${m.id}`} id={`tab-${m.id}`}
            onClick={() => { setCat(m.id); history.replaceState(null, "", `#${m.id}`); }}
            className={`relative shrink-0 pb-5 text-[0.72rem] font-semibold uppercase tracking-[0.24em] transition-colors duration-500 ${cat === m.id ? "text-cream" : "text-muted hover:text-beige"}`}>
            {m.title}
            {cat === m.id && <motion.span layoutId="menu-underline" className="absolute inset-x-0 -bottom-px h-px bg-bronze-2" transition={{ type: "spring", stiffness: 300, damping: 34 }} />}
          </button>
        ))}
      </div>

      <div className="mt-16 grid gap-14 lg:grid-cols-12">
        <div className="hidden lg:col-span-5 lg:block">
          <div className="sticky top-28 aspect-[4/5] overflow-hidden">
            <AnimatePresence mode="popLayout">
              <motion.div key={c.photo} className="absolute inset-0" initial={{ opacity: 0, scale: 1.08 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}>
                <Photo name={c.photo} alt={c.title} fill sizes="40vw" />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <AnimatePresence mode="wait">
          <motion.section key={c.id} id={`panel-${c.id}`} role="tabpanel" aria-labelledby={`tab-${c.id}`} className="lg:col-span-6 lg:col-start-7"
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
            <h2 className="display text-6xl text-cream md:text-7xl">{c.title}</h2>
            <p className="mt-4 font-display text-xl italic text-beige">{c.intro}</p>
            <ul className="mt-12">
              {c.items.map((it, i) => (
                <motion.li key={it.name} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.06, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  data-cursor="EXPLORE" className="group border-t border-line py-7 last:border-b">
                  <div className="flex items-baseline gap-4">
                    <h3 className="display text-[1.65rem] text-cream transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)] group-hover:translate-x-2 md:text-3xl">{it.name}</h3>
                    <span className="mb-1.5 flex-1 border-b border-dotted border-cream/20" aria-hidden="true" />
                    <span className="font-display text-2xl text-bronze-2">₹{it.price}</span>
                  </div>
                  <p className="mt-2 text-beige">{it.description}</p>
                  <p className="mt-1 text-sm text-muted">{it.ingredients}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {it.diet.map((d) => <abbr key={d} title={DIET_LABELS[d]} className="border border-line px-2 py-0.5 text-[0.6rem] font-semibold tracking-[0.15em] text-beige no-underline">{d}</abbr>)}
                    {it.note && <span className="text-[0.62rem] uppercase tracking-[0.2em] text-bronze-2">{it.note}</span>}
                  </div>
                </motion.li>
              ))}
            </ul>
            <p className="mt-8 text-xs text-muted">V vegetarian · VG vegan · GF gluten-free · N contains nuts · E contains egg. Prices include taxes. Please tell us about any allergies.</p>
          </motion.section>
        </AnimatePresence>
      </div>
    </div>
  );
}
