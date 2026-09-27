"use client";
import { useRef, type ReactNode } from "react";

/** Wraps a button/link so it leans toward the pointer and springs back — subtle, desktop only. */
export default function Magnetic({ children, strength = 0.28, className = "" }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const move = (e: React.PointerEvent) => {
    const el = ref.current; if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * strength}px, ${(e.clientY - r.top - r.height / 2) * strength}px)`;
  };
  const leave = () => { if (ref.current) ref.current.style.transform = ""; };
  return (
    <span ref={ref} onPointerMove={move} onPointerLeave={leave}
      className={`inline-block transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] will-change-transform ${className}`}>
      {children}
    </span>
  );
}
