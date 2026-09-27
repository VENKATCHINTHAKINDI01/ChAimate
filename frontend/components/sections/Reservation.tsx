"use client";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Minus, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { BRAND } from "@/lib/content";
import { ArchMark } from "@/components/ui/Logo";

const SEATING = [
  { id: "main", title: "Main Room", text: "Under the arches, by the windows" },
  { id: "bar", title: "Coffee Bar", text: "Front row to the espresso machine" },
  { id: "courtyard", title: "Courtyard", text: "Neem trees and brass lanterns" },
  { id: "lounge", title: "Work Lounge", text: "Quiet sofas, good Wi-Fi" },
  { id: "private", title: "Private Dining", text: "For six to ten guests", min: 6 },
];
const OCCASIONS = ["Just because", "Birthday", "Anniversary", "Date night", "Business", "Celebration"];

type Slot = { time: string; label: string; available: boolean };
type Confirmation = { reference: string; date: string; time: string; guests: number; seating: string; name: string };

const fmtDate = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function localSlots(date: string): Slot[] {
  // opening hours: 7:00 – 23:00 weekdays, until 00:00 weekends; last seating an hour before close
  const d = new Date(date + "T00:00"), weekend = d.getDay() === 0 || d.getDay() === 6, last = weekend ? 22.5 : 21.5, now = new Date();
  const out: Slot[] = [];
  for (let h = 7.5; h <= last; h += 0.5) {
    const hh = Math.floor(h), mm = h % 1 ? 30 : 0, t = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    const at = new Date(`${date}T${t}`);
    out.push({ time: t, label: at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }), available: at.getTime() - now.getTime() > 45 * 60000 });
  }
  return out;
}

export default function Reservation({ compact = false }: { compact?: boolean }) {
  const days = useMemo(() => Array.from({ length: 21 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; }), []);
  const [step, setStep] = useState(0);
  const [date, setDate] = useState(iso(days[0]));
  const [remote, setRemote] = useState<{ key: string; slots: Slot[] } | null>(null);
  const [picked, setTime] = useState("");
  const [guests, setGuests] = useState(2);
  const [chosenSeat, setSeating] = useState("main");
  const [occasion, setOccasion] = useState(OCCASIONS[0]);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Confirmation | null>(null);

  // availability from the house (falls back to opening hours if the server can't be reached)
  const key = `${date}|${guests}`;
  useEffect(() => {
    let live = true;
    api<{ slots: Slot[] }>(`/api/reservations/availability?date=${date}&guests=${guests}`)
      .then((r) => { if (live) setRemote({ key: `${date}|${guests}`, slots: r.slots }); }).catch(() => {});
    return () => { live = false; };
  }, [date, guests]);
  const fallback = useMemo(() => localSlots(date), [date]);
  const slots = remote?.key === key ? remote.slots : fallback;
  const time = picked && slots.some((s) => s.time === picked && s.available) ? picked : "";
  const seating = chosenSeat === "private" && guests < 6 ? "main" : chosenSeat;

  const groups = [["Morning", (h: number) => h < 12], ["Afternoon", (h: number) => h >= 12 && h < 17], ["Evening", (h: number) => h >= 17]] as const;
  const canNext = step === 0 ? !!time : step === 1 ? !!seating : form.name.trim().length > 1 && /^[+\d\s-]{8,}$/.test(form.phone) && /\S+@\S+\.\S+/.test(form.email);
  const seatTitle = SEATING.find((s) => s.id === seating)?.title ?? "";
  const whenLabel = `${fmtDate(new Date(date + "T00:00"))}${time ? ` · ${slots.find((s) => s.time === time)?.label}` : ""}`;

  const submit = async () => {
    setSending(true); setError("");
    try {
      const r = await api<Confirmation>("/api/reservations", { method: "POST",
        body: JSON.stringify({ date, time, guests, seating, occasion, ...form }) });
      setDone(r);
    } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  };

  const ics = done ? `data:text/calendar;charset=utf-8,${encodeURIComponent([
    "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", `SUMMARY:Table at ${BRAND.name}`,
    `DTSTART:${done.date.replace(/-/g, "")}T${done.time.replace(":", "")}00`, `LOCATION:${BRAND.address}`,
    `DESCRIPTION:Reservation ${done.reference} for ${done.guests}`, "END:VEVENT", "END:VCALENDAR"].join("\n"))}` : "";

  const input = "w-full border-b border-cream/30 bg-transparent py-3 text-lg text-ivory placeholder:text-muted/70 focus:border-cream focus:outline-none";
  return (
    <div className={`relative grid gap-12 ${compact ? "" : "lg:grid-cols-12"}`}>
      <AnimatePresence mode="wait">
        {done ? (
          <motion.div key="done" className="col-span-full flex min-h-[60vh] flex-col items-center justify-center text-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
            <motion.svg viewBox="0 0 24 30" className="h-24 w-20 text-bronze-2" fill="none" stroke="currentColor" strokeWidth="0.8">
              {["M3 29V13C3 7.5 8.5 3.2 12 1c3.5 2.2 9 6.5 9 12v16", "M7.5 29V15.5c0-3.4 2.7-6 4.5-7.4 1.8 1.4 4.5 4 4.5 7.4V29", "M1 29h22"].map((d, i) => (
                <motion.path key={i} d={d} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, delay: 0.2 + i * 0.3, ease: [0.65, 0, 0.35, 1] }} />))}
            </motion.svg>
            <motion.h3 initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
              className="display mt-10 text-[clamp(2.8rem,7vw,6.4rem)] text-cream">Your table<br /><span className="display-italic text-bronze-2">is waiting.</span></motion.h3>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.7 }} className="mt-10 space-y-2 text-beige">
              <p>{done.name.split(" ")[0]}, we&apos;ll see you on <b className="font-medium text-cream">{fmtDate(new Date(done.date + "T00:00"))}</b> at <b className="font-medium text-cream">{new Date(`${done.date}T${done.time}`).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</b> — {done.guests} {done.guests === 1 ? "guest" : "guests"}, {SEATING.find((s) => s.id === done.seating)?.title}.</p>
              <p className="label text-muted">Reference {done.reference}</p>
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }} className="mt-10 flex flex-wrap justify-center gap-4">
              <a href={ics} download="deccan-house.ics" className="border border-line px-6 py-3 text-[0.68rem] uppercase tracking-[0.2em] text-beige hover:border-cream hover:text-cream">Add to calendar</a>
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${BRAND.coords.lat},${BRAND.coords.lng}`} target="_blank" rel="noreferrer" className="border border-line px-6 py-3 text-[0.68rem] uppercase tracking-[0.2em] text-beige hover:border-cream hover:text-cream">Directions</a>
            </motion.div>
          </motion.div>
        ) : (
          <motion.div key="form" className={compact ? "" : "lg:col-span-8"} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.5 }}>
            {/* progress */}
            <ol className="mb-12 flex gap-6" aria-label="Booking steps">
              {["When", "Where", "You"].map((s, i) => (
                <li key={s} className="flex-1">
                  <button disabled={i > step} onClick={() => setStep(i)} className="w-full text-left disabled:cursor-default">
                    <span className={`block h-px ${i <= step ? "bg-cream" : "bg-cream/15"} transition-colors duration-700`} />
                    <span className={`label mt-3 block ${i === step ? "text-cream" : "text-muted"}`}>0{i + 1} · {s}</span>
                  </button>
                </li>
              ))}
            </ol>

            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}>
                {step === 0 && (
                  <div className="space-y-12">
                    <fieldset>
                      <legend className="label mb-5 text-muted">Date</legend>
                      <div className="-mx-1 flex gap-2 overflow-x-auto pb-3 [scrollbar-width:thin]" data-lenis-prevent>
                        {days.map((d, i) => {
                          const v = iso(d), on = v === date;
                          return (
                            <button key={v} onClick={() => setDate(v)} aria-pressed={on}
                              className={`mx-1 flex w-[74px] shrink-0 flex-col items-center border py-4 transition-colors duration-500 ${on ? "border-cream bg-cream text-ink" : "border-line text-beige hover:border-cream/50"}`}>
                              <span className="text-[0.6rem] uppercase tracking-[0.2em]">{i === 0 ? "Today" : d.toLocaleDateString("en-IN", { weekday: "short" })}</span>
                              <span className="mt-1 font-display text-3xl leading-none">{d.getDate()}</span>
                              <span className="mt-1 text-[0.6rem] uppercase tracking-[0.2em] opacity-70">{d.toLocaleDateString("en-IN", { month: "short" })}</span>
                            </button>);
                        })}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend className="label mb-5 text-muted">Guests</legend>
                      <div className="flex items-center gap-6">
                        <button onClick={() => setGuests((g) => Math.max(1, g - 1))} aria-label="Fewer guests" className="grid h-12 w-12 place-items-center border border-line hover:border-cream"><Minus size={16} /></button>
                        <span className="w-16 text-center font-display text-5xl text-cream" aria-live="polite">{guests}</span>
                        <button onClick={() => setGuests((g) => Math.min(12, g + 1))} aria-label="More guests" className="grid h-12 w-12 place-items-center border border-line hover:border-cream"><Plus size={16} /></button>
                        <span className="text-sm text-muted">{guests >= 10 ? "For larger groups, see private events." : ""}</span>
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend className="label mb-5 text-muted">Time</legend>
                      <div className="space-y-6">
                        {groups.map(([name, test]) => {
                          const list = slots.filter((s) => test(+s.time.slice(0, 2)));
                          if (!list.length) return null;
                          return (
                            <div key={name}>
                              <p className="mb-3 font-display text-xl italic text-beige">{name}</p>
                              <div className="flex flex-wrap gap-2">
                                {list.map((s) => (
                                  <button key={s.time} disabled={!s.available} onClick={() => setTime(s.time)} aria-pressed={time === s.time}
                                    className={`min-w-[88px] border px-3 py-2.5 text-sm transition-colors duration-500 disabled:cursor-not-allowed disabled:border-transparent disabled:text-muted/40 disabled:line-through
                                      ${time === s.time ? "border-cream bg-cream text-ink" : "border-line text-beige hover:border-cream/60"}`}>{s.label}</button>
                                ))}
                              </div>
                            </div>);
                        })}
                      </div>
                    </fieldset>
                  </div>
                )}
                {step === 1 && (
                  <div className="space-y-12">
                    <fieldset>
                      <legend className="label mb-5 text-muted">Seating preference</legend>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {SEATING.map((s) => {
                          const disabled = !!s.min && guests < s.min;
                          return (
                            <button key={s.id} onClick={() => setSeating(s.id)} disabled={disabled} aria-pressed={seating === s.id}
                              className={`group border p-5 text-left transition-colors duration-500 disabled:opacity-35 ${seating === s.id ? "border-cream bg-cream/[0.06]" : "border-line hover:border-cream/50"}`}>
                              <span className="flex items-center justify-between"><span className="font-display text-2xl text-cream">{s.title}</span>
                                <span className={`h-2.5 w-2.5 rounded-full border ${seating === s.id ? "border-bronze-2 bg-bronze-2" : "border-muted"}`} /></span>
                              <span className="mt-2 block text-sm text-muted">{s.text}</span>
                            </button>);
                        })}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend className="label mb-5 text-muted">Special occasion</legend>
                      <div className="flex flex-wrap gap-2">
                        {OCCASIONS.map((o) => (
                          <button key={o} onClick={() => setOccasion(o)} aria-pressed={occasion === o}
                            className={`rounded-full border px-5 py-2.5 text-sm transition-colors duration-500 ${occasion === o ? "border-cream bg-cream text-ink" : "border-line text-beige hover:border-cream/60"}`}>{o}</button>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                )}
                {step === 2 && (
                  <div className="grid gap-8 sm:grid-cols-2">
                    <div className="sm:col-span-2"><label htmlFor="r-name" className="label text-muted">Name</label>
                      <input id="r-name" className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" placeholder="Your full name" /></div>
                    <div><label htmlFor="r-phone" className="label text-muted">Phone</label>
                      <input id="r-phone" className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" /></div>
                    <div><label htmlFor="r-email" className="label text-muted">Email</label>
                      <input id="r-email" className={input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" placeholder="you@example.com" /></div>
                    <div className="sm:col-span-2"><label htmlFor="r-notes" className="label text-muted">Anything we should know? (optional)</label>
                      <textarea id="r-notes" rows={2} className={`${input} resize-none`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Allergies, a high chair, a surprise…" /></div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="mt-14 flex items-center justify-between gap-6 border-t border-line pt-8">
              <button onClick={() => setStep((s) => Math.max(0, s - 1))} className={`link-line label text-beige ${step === 0 ? "invisible" : ""}`}>← Back</button>
              {error && <p role="alert" className="text-sm text-[#e59a8c]">{error}</p>}
              {step < 2
                ? <button disabled={!canNext} onClick={() => setStep((s) => s + 1)} className="group inline-flex items-center gap-4 bg-cream px-8 py-4 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-ink transition-colors hover:bg-bronze-2 disabled:opacity-30">Continue <span className="transition-transform duration-500 group-hover:translate-x-1.5">→</span></button>
                : <button disabled={!canNext || sending} onClick={submit} data-cursor="BOOK" className="group inline-flex items-center gap-4 bg-cream px-8 py-4 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-ink transition-colors hover:bg-bronze-2 disabled:opacity-30">{sending ? "Reserving…" : "Reserve your table"} <span className="transition-transform duration-500 group-hover:translate-x-1.5">→</span></button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* live summary, like a hotel booking panel */}
      {!done && !compact && (
        <aside className="lg:col-span-4" aria-label="Your reservation">
          <div className="sticky top-28 border border-line bg-ink-3/40 p-8">
            <div className="flex items-center gap-3 text-bronze-2"><ArchMark className="h-6 w-5" /><span className="label">Your table</span></div>
            <dl className="mt-8 space-y-5">
              {[["When", whenLabel], ["Guests", `${guests} ${guests === 1 ? "guest" : "guests"}`], ["Seating", seatTitle], ["Occasion", occasion]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-line pb-4"><dt className="label text-muted">{k}</dt><dd className="text-right text-beige">{v}</dd></div>
              ))}
            </dl>
            <p className="mt-8 text-xs leading-relaxed text-muted">Tables are held for 15 minutes. For groups over twelve or a full buy-out, write to {BRAND.email}.</p>
          </div>
        </aside>
      )}
    </div>
  );
}
