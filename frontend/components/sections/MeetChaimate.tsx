"use client";
import { useEffect, useState } from "react";
import { FadeIn, RevealText } from "@/components/ui/Reveal";
import Magnetic from "@/components/ui/Magnetic";

// The café's AI companion lives in the table app (/table?t=N, served by FastAPI — not a Next.js route, so plain <a>).
const LINES = [
  { who: "you", text: "Kuch suggest karo — something light, it's late." },
  { who: "ai", text: "A Sulaimani tonic, then. Bright, a little spiced, no caffeine crash. Shall I send one over?" },
  { who: "you", text: "Yes please, and a Qubani tart." },
  { who: "ai", text: "Done — both are on their way to table 4. Enjoy the courtyard tonight." },
];
const FEATURES = [
  ["Talks like a friend", "Telugu, Hindi, Urdu, Tamil or English — just speak, it listens and replies out loud."],
  ["Orders for you", "“One cardamom cloud, less sugar” goes straight to the coffee bar."],
  ["Remembers you", "Your usual, your stories, where you left off — only if you sign in, and you can erase it anytime."],
  ["Knows the city", "Tonight's release, the match score, what's on in Hyderabad this weekend."],
];

export default function MeetChaimate() {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= LINES.length) { const t = setTimeout(() => setShown(0), 5000); return () => clearTimeout(t); }
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 900 : 1900); return () => clearTimeout(t);
  }, [shown]);
  return (
    <section id="chaimate" className="relative overflow-hidden bg-ink-2 py-32 md:py-44" aria-labelledby="chaimate-h">
      <div className="mx-auto grid max-w-[1680px] gap-16 px-6 md:px-10 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-6">
          <p className="eyebrow mb-8">At every table</p>
          <RevealText as="h2" by="line" className="display text-[clamp(2.8rem,7vw,7rem)] text-cream">{"Meet ChAimate,\nyour chai-mate."}</RevealText>
          <FadeIn className="mt-8"><p className="lede max-w-lg">Scan the code on your table and talk. Our AI companion keeps you company, recommends from the menu, and places your order the moment you ask — no app, no sign-up.</p></FadeIn>
          <FadeIn className="mt-12 grid gap-8 sm:grid-cols-2">
            {FEATURES.map(([t, d]) => (
              <div key={t} className="border-t border-line pt-5"><h3 className="font-display text-2xl text-cream">{t}</h3><p className="mt-2 text-sm leading-relaxed text-muted">{d}</p></div>
            ))}
          </FadeIn>
          <FadeIn className="mt-12 flex flex-wrap items-center gap-6">
            <Magnetic>
              <a href="/table?t=1" data-cursor="TALK" className="group inline-flex items-center gap-4 bg-cream px-7 py-4 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-ink transition-colors duration-500 hover:bg-bronze-2">
                Talk to ChAimate <span className="transition-transform duration-500 group-hover:translate-x-1.5">→</span>
              </a>
            </Magnetic>
            <span className="text-xs text-muted">First 10 minutes free · then ₹2 a minute, on your bill</span>
          </FadeIn>
        </div>

        {/* a live-looking conversation card */}
        <FadeIn className="lg:col-span-5 lg:col-start-8">
          <div className="relative border border-line bg-ink p-6 md:p-8" aria-hidden="true">
            <div className="flex items-center gap-4 border-b border-line pb-5">
              <span className="relative grid h-12 w-12 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#f4efe7,#d3a878_45%,#6b4a2e)] shadow-[0_0_30px_rgba(211,168,120,.35)]">
                <span className="absolute inset-0 animate-ping rounded-full bg-bronze/20" />
              </span>
              <div><p className="font-display text-2xl leading-none text-cream">ChAimate</p><p className="label mt-1 text-[0.6rem] text-muted">Table 4 · listening</p></div>
              <div className="ml-auto flex h-6 items-end gap-[3px]">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="w-[3px] animate-[eq_1s_ease-in-out_infinite] rounded bg-bronze-2" style={{ animationDelay: `${i * 0.12}s`, height: "40%" }} />)}</div>
            </div>
            <ul className="mt-6 min-h-[300px] space-y-4">
              {LINES.slice(0, shown).map((l, i) => (
                <li key={i} className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed animate-[msgIn_.6s_cubic-bezier(.16,1,.3,1)] ${l.who === "you" ? "ml-auto bg-cream text-ink" : "border border-line text-beige"}`}>{l.text}</li>
              ))}
              {shown < LINES.length && shown > 0 && LINES[shown].who === "ai" && <li className="flex gap-1 px-2 py-3">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 0.15}s` }} />)}</li>}
            </ul>
          </div>
          <style>{`@keyframes eq{0%,100%{height:25%}50%{height:100%}}@keyframes msgIn{from{opacity:0;transform:translateY(10px)}}`}</style>
        </FadeIn>
      </div>
    </section>
  );
}
