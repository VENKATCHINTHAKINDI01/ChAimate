"use client";
import { useSyncExternalStore } from "react";
import { deviceTier, type Tier } from "./device";

const noop = () => () => {};
/** A media query as React state (false during the static pre-render). */
export function useMediaQuery(q: string) {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(q); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(q).matches, () => false);
}
let tierCache: Tier | null = null;
/** 3D quality for this device; null during the static pre-render so server and client HTML match. */
export function useDeviceTier(): Tier | null {
  return useSyncExternalStore(noop, () => (tierCache ??= deviceTier()), () => null);
}
/** location.hash without the '#', kept in sync. */
export function useHash() {
  return useSyncExternalStore(
    (cb) => { addEventListener("hashchange", cb); return () => removeEventListener("hashchange", cb); },
    () => location.hash.slice(1), () => "");
}
