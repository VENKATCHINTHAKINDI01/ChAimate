import type { Metadata } from "next";
import PageHeader from "@/components/ui/PageHeader";
export const metadata: Metadata = { title: "Terms" };
export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Deccan House" title="Terms" />
      <div className="mx-auto max-w-2xl space-y-6 px-6 pb-40 text-beige md:px-10">
        <p>Tables are held for 15 minutes past the reserved time. Please let us know if you are running late or need to cancel.</p><p>Private events are confirmed once our events team has agreed the details with you in writing. Menus and prices may change with the seasons.</p><p>Photography on this website is used under Creative Commons licences; see the credits for authors and licences.</p>
      </div>
    </>
  );
}
