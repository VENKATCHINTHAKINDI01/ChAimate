import type { Metadata } from "next";
import PageHeader from "@/components/ui/PageHeader";
import Reservation from "@/components/sections/Reservation";
import Events from "@/components/sections/Events";
export const metadata: Metadata = { title: "Reservations", description: "Reserve a table at Deccan House, Jubilee Hills, Hyderabad." };
export default function ReservationsPage() {
  return (
    <>
      <PageHeader eyebrow="Reservations" title={"Your table\nawaits."} lede="Choose a day, a time and where you'd like to sit. We'll take care of the rest." />
      <div className="mx-auto max-w-[1680px] px-6 pb-40 md:px-10"><Reservation /></div>
      <Events />
    </>
  );
}
