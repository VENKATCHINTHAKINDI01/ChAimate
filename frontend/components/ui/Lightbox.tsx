"use client";
import { useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Photo from "./Photo";

type Item = { photo: string; alt: string; tag?: string };

/** Full-screen image viewer: arrows, keyboard (← → Esc), swipe, and a cross-fade between images. */
export default function Lightbox({ items, index, onClose, onIndex }: { items: Item[]; index: number | null; onClose: () => void; onIndex: (i: number) => void }) {
  const open = index !== null;
  const go = useCallback((d: number) => { if (index !== null) onIndex((index + d + items.length) % items.length); }, [index, items.length, onIndex]);
  const start = useRef<number | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
    addEventListener("keydown", key); document.documentElement.style.overflow = "hidden"; closeBtn.current?.focus();
    return () => { removeEventListener("keydown", key); document.documentElement.style.overflow = ""; };
  }, [open, go, onClose]);
  const item = index !== null ? items[index] : null;
  return (
    <AnimatePresence>
      {open && item && (
        <motion.div role="dialog" aria-modal="true" aria-label="Photo viewer" className="fixed inset-0 z-[95] flex items-center justify-center bg-ink/95 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }}
          onPointerDown={(e) => { start.current = e.clientX; }}
          onPointerUp={(e) => { if (start.current !== null && Math.abs(e.clientX - start.current) > 50) go(e.clientX < start.current ? 1 : -1); start.current = null; }}>
          <AnimatePresence mode="wait">
            <motion.figure key={index} className="relative h-[78vh] w-[88vw] max-w-6xl"
              initial={{ opacity: 0, scale: 0.96, clipPath: "inset(6% 6% 6% 6%)" }} animate={{ opacity: 1, scale: 1, clipPath: "inset(0% 0% 0% 0%)" }}
              exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
              <Photo name={item.photo} alt={item.alt} fill sizes="90vw" imgClassName="!object-contain" className="!bg-none" />
              <figcaption className="absolute -bottom-10 left-0 right-0 flex justify-between text-sm text-beige"><span>{item.alt}</span><span className="label text-muted">{index! + 1} / {items.length}</span></figcaption>
            </motion.figure>
          </AnimatePresence>
          <button ref={closeBtn} onClick={onClose} aria-label="Close" className="absolute right-5 top-5 grid h-12 w-12 place-items-center border border-line text-ivory hover:bg-cream hover:text-ink"><X size={18} /></button>
          <button onClick={() => go(-1)} aria-label="Previous photo" className="absolute left-4 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center border border-line text-ivory hover:bg-cream hover:text-ink md:grid"><ChevronLeft size={18} /></button>
          <button onClick={() => go(1)} aria-label="Next photo" className="absolute right-4 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center border border-line text-ivory hover:bg-cream hover:text-ink md:grid"><ChevronRight size={18} /></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
