// MapLibre 6 runs its tile decoding in a module Web Worker that the bundler doesn't emit for a static export,
// so ship the worker (and the shared chunk it imports) as plain files and point MapLibre at them.
import { copyFile, mkdir } from "node:fs/promises";
await mkdir("public/vendor/maplibre", { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) await copyFile(`node_modules/maplibre-gl/dist/${f}`, `public/vendor/maplibre/${f}`);
console.log("copied maplibre worker");
