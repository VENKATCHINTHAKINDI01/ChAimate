// Turns assets/photos/*.jpg into responsive AVIF + WebP files in public/img (480/960/1600/2400 px wide)
// and writes lib/photos.json with each photo's aspect ratio and a tiny blurred placeholder.
// Runs before every build; unchanged photos are skipped.
import sharp from "sharp";
import { readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const SRC = "assets/photos", OUT = "public/img", WIDTHS = [480, 960, 1600, 2400];
await mkdir(OUT, { recursive: true });
const manifest = {};
for (const file of (await readdir(SRC)).filter((f) => f.endsWith(".jpg")).sort()) {
  const name = file.replace(/\.jpg$/, ""), src = path.join(SRC, file);
  const img = sharp(src).rotate();
  const { width, height } = await img.metadata();
  const srcTime = (await stat(src)).mtimeMs;
  for (const w of WIDTHS.filter((w) => w <= width || w === WIDTHS[0])) {
    for (const [ext, opts] of [["avif", { quality: 52, effort: 4 }], ["webp", { quality: 74 }]]) {
      const out = path.join(OUT, `${name}-${w}.${ext}`);
      try { if ((await stat(out)).mtimeMs > srcTime) continue; } catch {}
      await sharp(src).rotate().resize({ width: w, withoutEnlargement: true })[ext](opts).toFile(out);
    }
  }
  const blur = await sharp(src).rotate().resize(16).webp({ quality: 40 }).toBuffer();
  manifest[name] = { ratio: +(width / height).toFixed(4), widths: WIDTHS.filter((w) => w <= width || w === WIDTHS[0]),
                     blur: `data:image/webp;base64,${blur.toString("base64")}` };
}
await writeFile("lib/photos.json", JSON.stringify(manifest, null, 1));
console.log(`optimized ${Object.keys(manifest).length} photos`);
