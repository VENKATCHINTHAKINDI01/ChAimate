"use client";
import { useState } from "react";
import Photo from "@/components/ui/Photo";
import Lightbox from "@/components/ui/Lightbox";
import { FadeIn } from "@/components/ui/Reveal";
import { GALLERY } from "@/lib/content";

/** Masonry via CSS columns: mixed sizes, hover zoom, opens the lightbox. */
export default function GalleryGrid({ limit }: { limit?: number }) {
  const items = limit ? GALLERY.slice(0, limit) : GALLERY;
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <div className="columns-1 gap-5 sm:columns-2 lg:columns-3 [&>*]:mb-5">
        {items.map((g, i) => (
          <FadeIn key={g.photo} delay={(i % 3) * 0.08} y={60}>
            <button onClick={() => setOpen(i)} data-cursor="VIEW" className="group relative block w-full overflow-hidden text-left" aria-label={`Open photo: ${g.alt}`}>
              <Photo name={g.photo} alt={g.alt} sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw"
                imgClassName="transition-transform duration-[1.6s] ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-[1.06]" />
              <span className="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-transparent opacity-0 transition-opacity duration-700 group-hover:opacity-100" />
              <span className="label absolute bottom-4 left-4 translate-y-2 text-cream opacity-0 transition-all duration-700 group-hover:translate-y-0 group-hover:opacity-100">{g.tag}</span>
            </button>
          </FadeIn>
        ))}
      </div>
      <Lightbox items={items} index={open} onClose={() => setOpen(null)} onIndex={setOpen} />
    </>
  );
}
