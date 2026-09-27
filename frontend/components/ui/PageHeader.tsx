import { RevealText } from "./Reveal";
export default function PageHeader({ eyebrow, title, lede }: { eyebrow: string; title: string; lede?: string }) {
  return (
    <header className="mx-auto max-w-[1680px] px-6 pb-16 pt-44 md:px-10 md:pb-24 md:pt-56">
      <p className="eyebrow mb-8">{eyebrow}</p>
      <RevealText as="h1" by="line" className="display text-[clamp(3.4rem,10vw,10rem)] text-cream">{title}</RevealText>
      {lede && <p className="lede mt-10 max-w-xl">{lede}</p>}
    </header>
  );
}
