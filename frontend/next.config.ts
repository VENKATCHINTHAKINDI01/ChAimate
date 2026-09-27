import type { NextConfig } from "next";

// Static export: `next build` writes plain HTML/CSS/JS to out/, which the FastAPI server hosts.
// Photos are pre-optimised by scripts/optimize-images.mjs (AVIF + WebP, 4 sizes) and served through <Photo>.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
