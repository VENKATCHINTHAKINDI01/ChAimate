"use client";
/** How much 3D a device gets: full on capable desktops, lighter on phones/low-memory devices, none for reduced motion. */
export type Tier = "high" | "low" | "none";
export function deviceTier(): Tier {
  if (typeof window === "undefined") return "none";
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return "none";
  try { const c = document.createElement("canvas"); if (!(c.getContext("webgl2") || c.getContext("webgl"))) return "none"; } catch { return "none"; }
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return "none";
  const small = matchMedia("(max-width: 900px), (pointer: coarse)").matches;
  return small || (nav.deviceMemory ?? 8) <= 4 ? "low" : "high";
}
