import type { Metadata } from "next";
import PageHeader from "@/components/ui/PageHeader";
import Photo from "@/components/ui/Photo";
import Button from "@/components/ui/Button";
import RootedHere from "@/components/sections/RootedHere";
import { ClipReveal, FadeIn, RevealText } from "@/components/ui/Reveal";

export const metadata: Metadata = { title: "Our Story", description: "How a grandmother's Irani chai and the architecture of the Deccan became Deccan House." };

const TIMELINE = [
  ["1591", "Charminar rises at the heart of a new city. Its four arches become Hyderabad's first meeting place."],
  ["1900s", "Irani cafés open across the Old City — marble tables, bentwood chairs, chai that never stops pouring."],
  ["2019", "Our founders begin roasting Araku beans in a Banjara Hills garage, serving friends on Sunday mornings."],
  ["2024", "Deccan House opens in Jubilee Hills — an Irani café's generosity, a specialty roaster's precision."],
];
const VALUES = [
  ["Slow", "Nothing is rushed. Not the laminating, not the pour, not you."],
  ["Local", "Indian estates, Telangana stone, Hyderabadi recipes — told in a modern voice."],
  ["Generous", "The open-house hospitality of the Deccan: one more cup is always on us."],
];

export default function StoryPage() {
  return (
    <>
      <PageHeader eyebrow="Our story" title={"Born in\nHyderabad."} />
      <section className="mx-auto grid max-w-[1680px] gap-16 px-6 pb-32 md:px-10 lg:grid-cols-12">
        <ClipReveal className="aspect-[4/5] lg:col-span-6" parallax={8}><Photo name="qutb-night" alt="The Qutb Shahi tombs at night" fill sizes="50vw" imgClassName="sepia-[30%] grayscale-[30%]" /></ClipReveal>
        <div className="space-y-8 self-end lg:col-span-5 lg:col-start-8">
          <FadeIn><p className="font-display text-3xl italic leading-snug text-cream md:text-4xl">“My grandmother made Irani chai for whoever walked in. Nobody ever left in under two hours.”</p><p className="label mt-6 text-muted">— Our founder</p></FadeIn>
          <FadeIn className="space-y-6 text-lg leading-[1.85] text-beige">
            <p>Deccan House began with a recipe, a walk through the Old City at dawn and a simple question: what would a Hyderabadi café look like if it were built today?</p>
            <p>We spent two years finding out — sourcing beans from Araku and Coorg, learning lamination from Parisian-trained bakers, and studying the proportions of Qutb Shahi arches until they found their way into our windows, our menu cards and our logo.</p>
          </FadeIn>
        </div>
      </section>

      <section className="bg-cream py-32 text-ink md:py-44">
        <div className="mx-auto max-w-[1680px] px-6 md:px-10">
          <p className="mb-8 text-[0.7rem] font-semibold uppercase tracking-[0.32em] text-bronze">Four centuries, one table</p>
          <ol className="mt-12">
            {TIMELINE.map(([y, t]) => (
              <li key={y} className="grid gap-4 border-t border-ink/15 py-10 md:grid-cols-12">
                <FadeIn className="md:col-span-4"><span className="display text-[clamp(3rem,7vw,6.5rem)]">{y}</span></FadeIn>
                <FadeIn className="self-center md:col-span-6 md:col-start-7" delay={0.1}><p className="text-lg leading-relaxed text-ink/75">{t}</p></FadeIn>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1680px] gap-6 px-6 py-32 md:grid-cols-3 md:px-10 md:py-44">
        {[["chowmahalla-door", "The arch", "Proportions from Chowmahalla's doorways"], ["jaali-screen", "The screen", "Telangana granite, carved by hand"], ["beans", "The roast", "Every Monday, 40 kg at a time"]].map(([p, t, s], i) => (
          <FadeIn key={p} delay={i * 0.1}>
            <ClipReveal className="aspect-[3/4]" parallax={10}><Photo name={p} alt={t} fill sizes="33vw" /></ClipReveal>
            <h3 className="mt-6 font-display text-3xl text-cream">{t}</h3><p className="mt-1 text-sm text-muted">{s}</p>
          </FadeIn>
        ))}
      </section>

      <section className="border-t border-line bg-ink-2 py-32 md:py-44">
        <div className="mx-auto max-w-[1680px] px-6 md:px-10">
          <RevealText as="h2" by="line" className="display text-[clamp(2.8rem,7vw,7rem)] text-cream">{"What we\nbelieve."}</RevealText>
          <div className="mt-20 grid gap-12 md:grid-cols-3">
            {VALUES.map(([t, s], i) => <FadeIn key={t} delay={i * 0.1}><span className="font-display text-6xl italic text-bronze-2">{t}</span><p className="lede mt-5">{s}</p></FadeIn>)}
          </div>
        </div>
      </section>
      <RootedHere />
      <section className="bg-ink py-32 text-center"><Button href="/reservations/" cursor="BOOK">Come and see for yourself</Button></section>
    </>
  );
}
