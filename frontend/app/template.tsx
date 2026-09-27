"use client";
import { motion } from "motion/react";
import type { ReactNode } from "react";

/** Page transition: a bronze-edged curtain lifts off every new page while its content rises into place. */
export default function Template({ children }: { children: ReactNode }) {
  return (
    <>
      <motion.div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[80] origin-top bg-ink-2"
        initial={{ scaleY: 1 }} animate={{ scaleY: 0 }} transition={{ duration: 1, ease: [0.76, 0, 0.24, 1], delay: 0.05 }}>
        <div className="absolute inset-x-0 bottom-0 h-px bg-bronze/60" />
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 40, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}>
        {children}
      </motion.div>
    </>
  );
}
