import Photo from "@/components/ui/Photo";
import Button from "@/components/ui/Button";
import { RevealText } from "@/components/ui/Reveal";
import { BRAND } from "@/lib/content";

const POSTS = ["latte-hands", "croissant", "jaali-screen", "iced-latte", "beans-jar", "pastry-rose", "espresso", "lake-view"];

export default function Social() {
  return (
    <section className="bg-ink py-32 md:py-40" aria-labelledby="social-h">
      <div className="mx-auto max-w-[1680px] px-6 md:px-10">
        <div className="mb-14 flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <RevealText as="h2" by="line" className="display text-[clamp(2.6rem,6vw,6rem)] text-cream">{"See you\nat the café."}</RevealText>
          <Button href={`https://instagram.com/${BRAND.instagram}`} variant="outline">Follow @{BRAND.instagram}</Button>
        </div>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {POSTS.map((p) => (
            <li key={p}>
              <a href={`https://instagram.com/${BRAND.instagram}`} target="_blank" rel="noreferrer" data-cursor="VIEW" className="group relative block aspect-square overflow-hidden" aria-label="View on Instagram">
                <Photo name={p} alt="" fill sizes="(min-width:768px) 25vw, 50vw" imgClassName="transition-transform duration-[1.4s] ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-110" />
                <span className="absolute inset-0 grid place-items-center bg-ink/55 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
                  <span className="flex flex-col items-center gap-2 text-cream"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor"/></svg><span className="label">View</span></span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
