import manifest from "./photos.json";

export type PhotoName = keyof typeof manifest;
export const photoInfo = (name: string) => (manifest as Record<string, { ratio: number; widths: number[]; blur: string }>)[name];
export const photoCredits = "Photography: Wikimedia Commons contributors (CC BY / CC BY-SA / CC0). Full list in /credits.json.";
