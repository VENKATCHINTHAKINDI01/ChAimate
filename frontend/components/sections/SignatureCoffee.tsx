import Link from "next/link";
import Photo from "@/components/ui/Photo";
import { FadeIn, RevealText } from "@/components/ui/Reveal";
import { SIGNATURES } from "@/lib/content";

export default function SignatureCoffee() {
  return (
    <section className="bg-ink-2 py-32 md:py-44" aria-labelledby="coffee-h">
      <div className="mx-auto max-w-[1680px] px-6 md:px-10">
        <div className="flex flex-col justify-between gap-10 md:flex-row md:items-end">
          <div>
            <p className="eyebrow mb-8">Signature coffee</p>
            <RevealText as="h2" by="line" className="display text-[clamp(2.8rem,7vw,7.6rem)] text-cream">{"Coffee,\nwithout compromise."}</RevealText>
          </div>
          <FadeIn className="max-w-sm"><p className="lede">Single-estate Indian beans from Araku, Coorg and the Nilgiris — roasted in small batches every Monday, a few kilometres from your cup.</p></FadeIn>
        </div>
        <ul className="mt-20 grid gap-x-8 gap-y-16 sm:grid-cols-2 lg:grid-cols-4">
          {SIGNATURES.map((s, i) => (
            <li key={s.name}>
              <FadeIn delay={i * 0.08}>
                <Link href="/menu/#signature" data-cursor="VIEW" className="group block">
                  <div className="relative aspect-[3/4] overflow-hidden">
                    <Photo name={s.photo} alt={s.name} fill sizes="(min-width:1024px) 25vw, (min-width:640px) 50vw, 100vw"
                      imgClassName="transition-transform duration-[1.6s] ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-[1.07]" />
                    <div className="absolute inset-0 bg-ink/10 transition-colors duration-700 group-hover:bg-ink/0" />
                    <span className="absolute left-4 top-4 bg-ink/70 px-3 py-1.5 text-[0.62rem] uppercase tracking-[0.2em] text-beige backdrop-blur">{s.origin}</span>
                  </div>
                  <div className="mt-6 flex items-baseline justify-between gap-4 border-b border-line pb-4">
                    <h3 className="font-display text-[1.7rem] leading-tight text-cream transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)] group-hover:translate-x-2">{s.name}</h3>
                    <span className="shrink-0 text-sm text-bronze-2">₹{s.price}</span>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-muted">{s.description}</p>
                  <p className="mt-4 flex flex-wrap gap-2">{s.notes.map((n) => <span key={n} className="border border-line px-2.5 py-1 text-[0.62rem] uppercase tracking-[0.18em] text-beige">{n}</span>)}</p>
                </Link>
              </FadeIn>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
