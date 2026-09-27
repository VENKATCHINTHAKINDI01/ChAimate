"use client";
import { useRef, type ReactNode } from "react";
import { gsap, useGSAP, reducedMotion } from "@/lib/gsap";

/** Headline that rises in word by word (or line by line) as it scrolls into view. */
export function RevealText({ as = "h2", children, className = "", delay = 0, by = "word" }:
  { as?: "h1" | "h2" | "h3" | "p"; children: string; className?: string; delay?: number; by?: "word" | "line" }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const Tag = as as "h2";
  const lines = children.split("\n");
  useGSAP(() => {
    if (reducedMotion()) return;
    gsap.from(ref.current!.querySelectorAll("[data-w]"), {
      yPercent: 110, rotate: 2, duration: 1.3, ease: "expo.out", stagger: by === "line" ? 0.06 : 0.05, delay,
      scrollTrigger: { trigger: ref.current, start: "top 88%" },
    });
  }, { scope: ref });
  // lines → words: forced line breaks hold on wide screens, long lines still wrap naturally on phones
  const kids = lines.map((line, li) => (
    <span key={li} className="block" aria-hidden="true">
      {line.split(" ").map((w, wi) => (
        <span key={wi}>
          {wi > 0 && " "}
          <span className="inline-block overflow-hidden align-bottom" style={{ paddingBottom: ".08em", marginBottom: "-.08em" }}>
            <span data-w className="inline-block">{w}</span>
          </span>
        </span>
      ))}
    </span>
  ));
  return <Tag ref={ref} className={className} aria-label={children.replace(/\n/g, " ")}>{kids}</Tag>;
}

/** Fades + lifts any block in on scroll. */
export function FadeIn({ children, className = "", delay = 0, y = 40 }: { children: ReactNode; className?: string; delay?: number; y?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (reducedMotion()) return;
    gsap.from(ref.current, { y, opacity: 0, duration: 1.4, delay, ease: "expo.out", scrollTrigger: { trigger: ref.current, start: "top 90%" } });
  }, { scope: ref });
  return <div ref={ref} className={className}>{children}</div>;
}

/** Image that unmasks upward on entry, then drifts gently with scroll (parallax). */
export function ClipReveal({ children, className = "", parallax = 12 }: { children: ReactNode; className?: string; parallax?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (reducedMotion()) return;
    const inner = ref.current!.firstElementChild as HTMLElement;
    gsap.fromTo(ref.current, { clipPath: "inset(18% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 1.6, ease: "expo.out", scrollTrigger: { trigger: ref.current, start: "top 85%" } });
    gsap.fromTo(inner, { scale: 1.18 }, { scale: 1, duration: 1.8, ease: "expo.out", scrollTrigger: { trigger: ref.current, start: "top 85%" } });
    if (parallax) gsap.fromTo(inner, { yPercent: -parallax / 2 }, { yPercent: parallax / 2, ease: "none", scrollTrigger: { trigger: ref.current, start: "top bottom", end: "bottom top", scrub: true } });
  }, { scope: ref });
  return <div ref={ref} className={`relative overflow-hidden ${className}`}><div className="absolute inset-[-8%]">{children}</div></div>;
}
