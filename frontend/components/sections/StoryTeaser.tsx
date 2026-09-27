import Button from "@/components/ui/Button";
import Photo from "@/components/ui/Photo";
import { ClipReveal, FadeIn, RevealText } from "@/components/ui/Reveal";

export default function StoryTeaser() {
  return (
    <section className="bg-cream py-32 text-ink md:py-44" aria-labelledby="story-h">
      <div className="mx-auto grid max-w-[1680px] gap-16 px-6 md:px-10 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-6">
          <p className="mb-8 text-[0.7rem] font-semibold uppercase tracking-[0.32em] text-bronze">Our story</p>
          <RevealText as="h2" by="line" className="display text-[clamp(3rem,8vw,8rem)]">{"Born in\nHyderabad."}</RevealText>
          <FadeIn className="mt-10 max-w-lg space-y-5 text-[1.05rem] leading-[1.85] text-ink/75">
            <p>It began with a grandmother&apos;s Irani chai recipe, a walk through the Old City at dawn, and a question: what would a Hyderabadi café look like if it were built today?</p>
            <p>We found our answer in the city itself — in Qutb Shahi arches, in the generosity of Deccan hospitality, and in the unhurried conversations that have always happened over a cup here.</p>
          </FadeIn>
          <FadeIn className="mt-12"><Button href="/story/" variant="outline" className="!border-ink/40 !text-ink hover:!bg-ink hover:!text-cream">Read our story</Button></FadeIn>
        </div>
        <div className="relative lg:col-span-6">
          <ClipReveal className="aspect-[4/5] w-[78%]" parallax={8}><Photo name="qutb-night" alt="The Qutb Shahi tombs, lit at night" fill sizes="40vw" imgClassName="grayscale-[35%] sepia-[20%]" /></ClipReveal>
          <ClipReveal className="absolute -bottom-16 right-0 aspect-square w-[44%] border-[10px] border-cream" parallax={14}>
            <Photo name="chowmahalla-door" alt="A carved doorway at Chowmahalla Palace" fill sizes="25vw" />
          </ClipReveal>
          <p className="absolute -left-2 bottom-4 hidden -rotate-90 origin-bottom-left text-[0.62rem] uppercase tracking-[0.3em] text-ink/50 lg:block">Est. in the Deccan · 17.43° N</p>
        </div>
      </div>
    </section>
  );
}
