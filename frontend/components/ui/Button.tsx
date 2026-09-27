import Link from "next/link";
import type { ReactNode } from "react";
import Magnetic from "./Magnetic";

type Props = { href?: string; onClick?: () => void; children: ReactNode; variant?: "solid" | "outline" | "text"; cursor?: string; type?: "button" | "submit"; disabled?: boolean; className?: string };

/** Premium CTA: square-cornered, letter-spaced, arrow slides on hover, magnetic on desktop. */
export default function Button({ href, onClick, children, variant = "solid", cursor, type = "button", disabled, className = "" }: Props) {
  const base = "group relative inline-flex items-center gap-4 overflow-hidden px-7 py-4 text-[0.72rem] font-semibold uppercase tracking-[0.24em] transition-colors duration-500 disabled:opacity-40";
  const styles = {
    solid: "bg-cream text-ink hover:bg-bronze-2",
    outline: "border border-cream/35 text-ivory hover:border-cream hover:bg-cream hover:text-ink",
    text: "px-0 text-ivory",
  }[variant];
  const inner = (
    <>
      <span className="relative">{children}</span>
      <span aria-hidden="true" className="relative inline-block transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] group-hover:translate-x-1.5">→</span>
    </>
  );
  const cls = `${base} ${styles} ${className}`;
  return (
    <Magnetic>
      {href ? <Link href={href} className={cls} data-cursor={cursor}>{inner}</Link>
            : <button type={type} onClick={onClick} disabled={disabled} className={cls} data-cursor={cursor}>{inner}</button>}
    </Magnetic>
  );
}
