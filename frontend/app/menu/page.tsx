import type { Metadata } from "next";
import PageHeader from "@/components/ui/PageHeader";
import InteractiveMenu from "@/components/sections/InteractiveMenu";
import SignatureCoffee from "@/components/sections/SignatureCoffee";

export const metadata: Metadata = { title: "Menu", description: "Specialty coffee, signature drinks, breakfast, small plates and desserts at Deccan House, Jubilee Hills." };
export default function MenuPage() {
  return (
    <>
      <PageHeader eyebrow="The menu" title={"Eat, drink,\nstay a while."} lede="Seasonal, Indian-rooted and made in-house — from the first espresso at 7 AM to the last dessert at midnight." />
      <div className="mx-auto max-w-[1680px] px-6 pb-32 md:px-10"><InteractiveMenu /></div>
      <SignatureCoffee />
    </>
  );
}
