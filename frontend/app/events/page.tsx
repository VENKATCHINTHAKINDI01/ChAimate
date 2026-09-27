import type { Metadata } from "next";
import PageHeader from "@/components/ui/PageHeader";
import Photo from "@/components/ui/Photo";
import EventEnquiry from "@/components/sections/EventEnquiry";
import { ClipReveal } from "@/components/ui/Reveal";
import { EVENTS } from "@/lib/content";
export const metadata: Metadata = { title: "Private Events", description: "Private dinners, corporate meetings, celebrations and brand events at Deccan House, Jubilee Hills." };
export default function EventsPage() {
  return (
    <>
      <PageHeader eyebrow="Private events" title={"The house\nis yours."} lede="From an intimate dinner for ten to a full buy-out for your launch." />
      <ClipReveal className="mx-6 aspect-[21/9] md:mx-10" parallax={10}><Photo name="interior-evening" alt="Deccan House set for an evening event" fill sizes="100vw" /></ClipReveal>
      <section className="mx-auto grid max-w-[1680px] gap-20 px-6 py-32 md:px-10 lg:grid-cols-12">
        <ul className="lg:col-span-5">{EVENTS.map((e) => <li key={e.title} className="border-t border-line py-6 last:border-b"><h2 className="font-display text-3xl text-cream">{e.title}</h2><p className="mt-1 text-sm text-muted">{e.text}</p></li>)}</ul>
        <div className="lg:col-span-6 lg:col-start-7"><EventEnquiry /></div>
      </section>
    </>
  );
}
