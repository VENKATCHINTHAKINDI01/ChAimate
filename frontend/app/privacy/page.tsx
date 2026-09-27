import type { Metadata } from "next";
import PageHeader from "@/components/ui/PageHeader";
export const metadata: Metadata = { title: "Privacy" };
export default function Page() {
  return (
    <>
      <PageHeader eyebrow="Deccan House" title="Privacy" />
      <div className="mx-auto max-w-2xl space-y-6 px-6 pb-40 text-beige md:px-10">
        <p>We collect only what we need to look after you: your name, phone number and email when you reserve a table or enquire about an event, and your email if you join our newsletter.</p><p>We use these details to confirm and manage your booking and, if you asked, to send our monthly letter. We never sell or share them. Write to hello@deccanhouse.cafe to see, correct or delete your data at any time.</p><p>At the table, our AI companion ChAimate remembers conversations only if you create an account, and you can erase everything it knows from within the app.</p>
      </div>
    </>
  );
}
