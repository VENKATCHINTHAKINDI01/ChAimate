import type { Metadata } from "next";
import PageHeader from "@/components/ui/PageHeader";
import GalleryGrid from "@/components/sections/GalleryGrid";
export const metadata: Metadata = { title: "Gallery", description: "Inside Deccan House — interiors, coffee, food and the city that inspired us." };
export default function GalleryPage() {
  return (
    <>
      <PageHeader eyebrow="Gallery" title={"Light, stone,\ncoffee."} lede="Interiors, the coffee bar, the kitchen at dawn and the Hyderabad that inspired every room." />
      <div className="mx-auto max-w-[1680px] px-6 pb-40 md:px-10"><GalleryGrid /></div>
    </>
  );
}
