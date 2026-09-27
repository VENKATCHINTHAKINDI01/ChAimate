import Hero from "@/components/sections/Hero";
import Experience from "@/components/sections/Experience";
import StepInside from "@/components/sections/StepInside";
import MeetChaimate from "@/components/sections/MeetChaimate";
import SignatureCoffee from "@/components/sections/SignatureCoffee";
import SlowMornings from "@/components/sections/SlowMornings";
import StoryTeaser from "@/components/sections/StoryTeaser";
import RootedHere from "@/components/sections/RootedHere";
import GalleryGrid from "@/components/sections/GalleryGrid";
import Events from "@/components/sections/Events";
import Testimonials from "@/components/sections/Testimonials";
import Social from "@/components/sections/Social";
import Location from "@/components/sections/Location";
import Reservation from "@/components/sections/Reservation";
import Button from "@/components/ui/Button";
import { RevealText } from "@/components/ui/Reveal";

export default function Home() {
  return (
    <>
      <Hero />
      <Experience />
      <SignatureCoffee />
      <MeetChaimate />
      <SlowMornings />
      <StepInside />
      <StoryTeaser />
      <RootedHere />
      <section className="bg-ink-2 py-32 md:py-44" aria-labelledby="gallery-h">
        <div className="mx-auto max-w-[1680px] px-6 md:px-10">
          <div className="mb-16 flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div><p className="eyebrow mb-8">Gallery</p><RevealText as="h2" by="line" className="display text-[clamp(2.8rem,7vw,7rem)] text-cream">{"A house\nin pictures."}</RevealText></div>
            <Button href="/gallery/" variant="outline">View the gallery</Button>
          </div>
          <GalleryGrid limit={9} />
        </div>
      </section>
      <Events />
      <Testimonials />
      <Social />
      <Location />
      <section id="reserve" className="bg-ink py-32 md:py-44" aria-labelledby="reserve-h">
        <div className="mx-auto max-w-[1680px] px-6 md:px-10">
          <p className="eyebrow mb-8">Reservations</p>
          <RevealText as="h2" by="line" className="display mb-20 text-[clamp(2.8rem,7vw,7rem)] text-cream">{"Reserve\nyour table."}</RevealText>
          <Reservation />
        </div>
      </section>
    </>
  );
}
