/** Deccan House mark: a single Qutb Shahi pointed arch — the shape repeated across the Charminar and the Old City. */
export function ArchMark({ className = "h-7 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 30" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M3 29V13C3 7.5 8.5 3.2 12 1c3.5 2.2 9 6.5 9 12v16" />
      <path d="M7.5 29V15.5c0-3.4 2.7-6 4.5-7.4 1.8 1.4 4.5 4 4.5 7.4V29" />
      <path d="M1 29h22" />
    </svg>
  );
}

export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <ArchMark className="h-7 w-[22px] text-bronze-2" />
      <span className="font-display text-[1.35rem] font-medium uppercase leading-none tracking-[0.18em]">Deccan House</span>
    </span>
  );
}
