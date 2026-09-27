"use client";
import Link from "next/link";
import { useState } from "react";
import { BRAND } from "@/lib/content";
import { api } from "@/lib/api";
import { ArchMark } from "@/components/ui/Logo";

const COLS = [
  { title: "Visit", links: [["Menu", "/menu/"], ["Our Story", "/story/"], ["Gallery", "/gallery/"], ["Reservations", "/reservations/"], ["Events", "/events/"], ["Talk to ChAimate", "/table?t=1"]] },
  { title: "Connect", links: [["Contact", `mailto:${BRAND.email}`], ["Instagram", `https://instagram.com/${BRAND.instagram}`], ["Google Maps", `https://www.google.com/maps/search/?api=1&query=${BRAND.coords.lat},${BRAND.coords.lng}`], ["WhatsApp", `https://wa.me/${BRAND.whatsapp}`]] },
  { title: "House", links: [["Privacy", "/privacy/"], ["Terms", "/terms/"], ["Photo credits", "/credits.json"]] },
];

export default function Footer() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const join = async (e: React.FormEvent) => {
    e.preventDefault(); setState("sending");
    try { await api("/api/newsletter", { method: "POST", body: JSON.stringify({ email }) }); setState("done"); setMsg("Welcome to the table. See you soon."); }
    catch (err) { setState("error"); setMsg((err as Error).message); }
  };
  return (
    <footer className="relative overflow-hidden border-t border-line bg-ink pt-28">
      <div className="mx-auto max-w-[1680px] px-6 md:px-10">
        <p className="display text-[clamp(3rem,10.5vw,11rem)] text-cream">Come for the coffee.<br /><span className="display-italic text-bronze-2">Stay for the moment.</span></p>
        <div className="mt-24 grid gap-14 border-t border-line pt-14 md:grid-cols-12">
          <div className="md:col-span-5">
            <h2 className="eyebrow">Join the table</h2>
            <p className="mt-4 max-w-sm text-beige">New menus, first-look tastings and the occasional recipe. Once a month, never more.</p>
            <form onSubmit={join} className="mt-8 flex max-w-md border-b border-cream/40 focus-within:border-cream">
              <label htmlFor="nl" className="sr-only">Email address</label>
              <input id="nl" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email"
                className="w-full bg-transparent py-4 text-ivory placeholder:text-muted focus:outline-none" disabled={state === "done"} />
              <button type="submit" disabled={state === "sending" || state === "done"} className="label shrink-0 py-4 pl-4 text-bronze-2 disabled:opacity-50">Subscribe →</button>
            </form>
            <p role="status" className={`mt-3 text-sm ${state === "error" ? "text-[#e59a8c]" : "text-muted"}`}>{msg}</p>
          </div>
          {COLS.map((c) => (
            <div key={c.title} className="md:col-span-2">
              <h2 className="eyebrow">{c.title}</h2>
              <ul className="mt-5 space-y-3">{c.links.map(([l, h]) => <li key={l}><Link href={h} className="link-line text-beige hover:text-ivory">{l}</Link></li>)}</ul>
            </div>
          ))}
          <div className="md:col-span-1" />
        </div>
        <div className="mt-20 flex flex-col gap-4 border-t border-line py-8 text-xs text-muted md:flex-row md:items-center md:justify-between">
          <span className="flex items-center gap-3"><ArchMark className="h-5 w-4 text-bronze" /> © {new Date().getFullYear()} Deccan House · {BRAND.area}, {BRAND.city}</span>
          <span>Photography: Wikimedia Commons contributors, used under CC licences.</span>
        </div>
      </div>
    </footer>
  );
}
