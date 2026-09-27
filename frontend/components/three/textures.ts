import * as THREE from "three";

// ---------------------------------------------------------------- tiny value-noise (deterministic)
function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, o = 5) { let v = 0, a = .5, f = 1; for (let i = 0; i < o; i++) { v += a * noise(x * f, y * f); f *= 2; a *= .5; } return v; }

/** Nero Marquina marble: near-black stone with fine white veins (colour + roughness maps). */
export function marbleTextures(size = 1024) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d")!, img = g.createImageData(size, size);
  const r = document.createElement("canvas"); r.width = r.height = size;
  const rg = r.getContext("2d")!, rimg = rg.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = x / size * 4, ny = y / size * 4;
    // domain-warped diagonal veins: a few long bright ones, fine hairlines, a cloudy near-black ground
    const wx = nx + fbm(nx * .9 + 3.1, ny * .9, 5) * 1.6, wy = ny + fbm(nx * .9, ny * .9 + 7.3, 5) * 1.6;
    const vein = Math.abs(Math.sin((wx * .9 + wy * 1.3) * Math.PI * .8));
    const fine = Math.pow(Math.max(0, 1 - vein * 16), 2.2) * (0.55 + fbm(nx * 2, ny * 2) * .6);
    const hv = Math.abs(Math.sin((wx * 2.3 - wy * .7 + fbm(nx * 4, ny * 4, 3) * 2) * Math.PI));
    const hair = Math.pow(Math.max(0, 1 - hv * 30), 2) * .28;
    const base = 12 + fbm(nx * 5, ny * 5, 4) * 18;
    const v = Math.min(235, base + fine * 150 + hair * 110);
    const i = (y * size + x) * 4;
    img.data[i] = v * 1.02; img.data[i + 1] = v; img.data[i + 2] = v * .96; img.data[i + 3] = 255;
    const rough = 70 + fine * 60;              // veins slightly less glossy
    rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = rough; rimg.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); rg.putImageData(rimg, 0, 0);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const roughnessMap = new THREE.CanvasTexture(r);
  for (const t of [map, roughnessMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return { map, roughnessMap };
}

/** Top view of a flat white: crema ring, milk rosetta, a little marbling. */
export function latteArtTexture(size = 512) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d")!, m = size / 2;
  const crema = g.createRadialGradient(m, m, size * .1, m, m, m);
  crema.addColorStop(0, "#a8683a"); crema.addColorStop(.72, "#8a4f27"); crema.addColorStop(1, "#4a2712");
  g.fillStyle = crema; g.fillRect(0, 0, size, size);
  // a tulip, poured in three pushes and pulled through — soft edges, like real microfoam
  g.filter = "blur(2px)"; g.fillStyle = "#f4e8d6";
  const blob = (cy: number, w: number, h: number) => { g.beginPath(); g.moveTo(m - w, cy);
    g.bezierCurveTo(m - w, cy - h * 1.2, m + w, cy - h * 1.2, m + w, cy); g.bezierCurveTo(m + w * .6, cy + h * .5, m - w * .6, cy + h * .5, m - w, cy); g.fill(); };
  blob(m + size * .2, size * .27, size * .13);
  g.fillStyle = "#9a5b30"; blob(m + size * .17, size * .2, size * .08); g.fillStyle = "#f4e8d6";
  blob(m + size * .06, size * .21, size * .12);
  g.fillStyle = "#9a5b30"; blob(m + size * .035, size * .15, size * .07); g.fillStyle = "#f4e8d6";
  // heart on top
  const hy = m - size * .12, hw = size * .16;
  g.beginPath(); g.moveTo(m, hy + hw * 1.05);
  g.bezierCurveTo(m - hw * 1.5, hy + hw * .1, m - hw * .9, hy - hw * .95, m, hy - hw * .25);
  g.bezierCurveTo(m + hw * .9, hy - hw * .95, m + hw * 1.5, hy + hw * .1, m, hy + hw * 1.05); g.fill();
  g.filter = "none"; g.strokeStyle = "rgba(244,232,214,.85)"; g.lineWidth = size * .008;
  g.beginPath(); g.moveTo(m, hy - hw * .2); g.lineTo(m, m + size * .3); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Soft round sprite for bokeh lights and steam. */
export function softDot(inner = "rgba(255,255,255,1)", size = 128) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d")!, r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  r.addColorStop(0, inner); r.addColorStop(.55, inner.replace(/[\d.]+\)$/, ".35)")); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, size, size); return new THREE.CanvasTexture(c);
}
