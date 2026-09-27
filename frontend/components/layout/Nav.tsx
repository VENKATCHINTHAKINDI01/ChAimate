"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Logo from "@/components/ui/Logo";
import { BRAND, NAV } from "@/lib/content";

export default function Nav() {
  const path = usePathname();
  const [hidden, setHidden] = useState(false);
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let last = scrollY;
    const on = () => { const y = scrollY; setSolid(y > 40); setHidden(y > last && y > 240); last = y; };
    addEventListener("scroll", on, { passive: true }); return () => removeEventListener("scroll", on);
  }, []);
  useEffect(() => { document.documentElement.style.overflow = open ? "hidden" : ""; }, [open]);
  const active = (href: string) => !href.includes("#") && path.startsWith(href.replace(/\/$/, "")) && href !== "/";

  return (
    <>
      <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-700 ease-[cubic-bezier(.16,1,.3,1)]
        ${hidden && !open ? "-translate-y-full" : "translate-y-0"} ${solid && !open ? "border-b border-line bg-ink/70 backdrop-blur-xl" : "bg-transparent"}`}>
        <nav className="mx-auto flex h-20 max-w-[1680px] items-center justify-between px-6 md:px-10" aria-label="Main">
          <Link href="/" onClick={() => setOpen(false)} aria-label={`${BRAND.name} — home`} className="relative z-10"><Logo /></Link>
          <ul className="hidden items-center gap-9 lg:flex">
            {NAV.map((n) => (
              <li key={n.href}><Link href={n.href} className="link-line label text-ivory/80 transition-colors hover:text-ivory" aria-current={active(n.href) ? "page" : undefined}>{n.label}</Link></li>
            ))}
          </ul>
          <div className="flex items-center gap-4">
            <Link href="/reservations/" data-cursor="BOOK" className="hidden border border-cream/40 px-5 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.24em] transition-colors duration-500 hover:bg-cream hover:text-ink sm:inline-block">Book a table</Link>
            <button onClick={() => setOpen((o) => !o)} className="relative z-10 flex h-11 w-11 flex-col items-center justify-center gap-[7px] lg:hidden" aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"}>
              <span className={`h-px w-7 bg-ivory transition-transform duration-500 ${open ? "translate-y-[4px] rotate-45" : ""}`} />
              <span className={`h-px w-7 bg-ivory transition-transform duration-500 ${open ? "-translate-y-[4px] -rotate-45" : ""}`} />
            </button>
          </div>
        </nav>
      </header>

      {/* full-screen menu (tablet & phone) */}
      <AnimatePresence>
        {open && (
          <motion.div key="menu" className="fixed inset-0 z-40 flex flex-col justify-between bg-ink-2 px-6 pb-10 pt-28 lg:hidden"
            initial={{ clipPath: "inset(0 0 100% 0)" }} animate={{ clipPath: "inset(0 0 0% 0)" }} exit={{ clipPath: "inset(0 0 100% 0)" }}
            transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }}>
            <ul className="space-y-2">
              {[{ href: "/", label: "Home" }, ...NAV].map((n, i) => (
                <li key={n.href} className="overflow-hidden">
                  <motion.div initial={{ y: "110%" }} animate={{ y: 0 }} transition={{ delay: 0.25 + i * 0.06, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}>
                    <Link href={n.href} onClick={() => setOpen(false)} className="display block text-[13vw] leading-[1.05] text-ivory sm:text-7xl">{n.label}</Link>
                  </motion.div>
                </li>
              ))}
            </ul>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} className="flex items-end justify-between gap-6 border-t border-line pt-6">
              <div className="text-sm text-muted">{BRAND.area}<br />{BRAND.city}</div>
              <Link href="/reservations/" onClick={() => setOpen(false)} className="bg-cream px-6 py-4 text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-ink">Reserve</Link>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
