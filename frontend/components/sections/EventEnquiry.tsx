"use client";
import { useState } from "react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { EVENTS } from "@/lib/content";

export default function EventEnquiry() {
  const [f, setF] = useState({ kind: EVENTS[0].title, date: "", guests: "12", name: "", phone: "", email: "", details: "" });
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setState("sending"); setError("");
    try { await api("/api/events/enquiry", { method: "POST", body: JSON.stringify({ ...f, guests: +f.guests }) }); setState("done"); }
    catch (err) { setError((err as Error).message); setState("idle"); }
  };
  const input = "w-full border-b border-cream/30 bg-transparent py-3 text-lg text-ivory placeholder:text-muted/70 focus:border-cream focus:outline-none";
  if (state === "done") return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="py-16">
      <p className="display text-6xl text-cream">Thank you.</p><p className="lede mt-6 max-w-md">Our events team will call you within one working day to plan the details.</p>
    </motion.div>);
  return (
    <form onSubmit={send} className="grid gap-8 sm:grid-cols-2">
      <fieldset className="sm:col-span-2"><legend className="label mb-4 text-muted">Occasion</legend>
        <div className="flex flex-wrap gap-2">{EVENTS.map((ev) => (
          <button type="button" key={ev.title} onClick={() => setF({ ...f, kind: ev.title })} aria-pressed={f.kind === ev.title}
            className={`rounded-full border px-5 py-2.5 text-sm transition-colors duration-500 ${f.kind === ev.title ? "border-cream bg-cream text-ink" : "border-line text-beige hover:border-cream/60"}`}>{ev.title}</button>))}</div>
      </fieldset>
      <div><label htmlFor="e-date" className="label text-muted">Preferred date</label><input id="e-date" type="date" required className={`${input} [color-scheme:dark]`} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
      <div><label htmlFor="e-guests" className="label text-muted">Guests</label><input id="e-guests" type="number" min={2} max={120} required className={input} value={f.guests} onChange={(e) => setF({ ...f, guests: e.target.value })} /></div>
      <div><label htmlFor="e-name" className="label text-muted">Name</label><input id="e-name" required className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></div>
      <div><label htmlFor="e-phone" className="label text-muted">Phone</label><input id="e-phone" required inputMode="tel" className={input} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></div>
      <div className="sm:col-span-2"><label htmlFor="e-email" className="label text-muted">Email</label><input id="e-email" type="email" required className={input} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></div>
      <div className="sm:col-span-2"><label htmlFor="e-details" className="label text-muted">Tell us about it</label><textarea id="e-details" rows={3} className={`${input} resize-none`} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="Menu ideas, timings, anything special…" /></div>
      <div className="flex items-center gap-6 sm:col-span-2">
        <button type="submit" disabled={state === "sending"} className="group inline-flex items-center gap-4 bg-cream px-8 py-4 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-ink hover:bg-bronze-2 disabled:opacity-40">
          {state === "sending" ? "Sending…" : "Plan your event"} <span className="transition-transform duration-500 group-hover:translate-x-1.5">→</span></button>
        {error && <p role="alert" className="text-sm text-[#e59a8c]">{error}</p>}
      </div>
    </form>
  );
}
