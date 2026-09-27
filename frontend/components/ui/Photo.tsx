import { photoInfo } from "@/lib/photos";

type Props = {
  name: string;
  alt: string;
  sizes?: string;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
  fill?: boolean;          // cover the parent (parent must be positioned)
};

/** Responsive, pre-optimised photo: AVIF → WebP → fallback, lazy by default, with a blurred placeholder. */
export default function Photo({ name, alt, sizes = "100vw", className = "", imgClassName = "", priority = false, fill = false }: Props) {
  const info = photoInfo(name);
  if (!info) return null;
  const set = (ext: string) => info.widths.map((w) => `/img/${name}-${w}.${ext} ${w}w`).join(", ");
  const fallback = `/img/${name}-${info.widths[Math.min(1, info.widths.length - 1)]}.webp`;
  const box = fill ? "absolute inset-0 h-full w-full" : "block w-full";
  return (
    <picture className={`${fill ? "absolute inset-0" : "block"} ${className}`} style={{ backgroundImage: `url(${info.blur})`, backgroundSize: "cover" }}>
      <source type="image/avif" srcSet={set("avif")} sizes={sizes} />
      <source type="image/webp" srcSet={set("webp")} sizes={sizes} />
      <img
        src={fallback} alt={alt} sizes={sizes}
        loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async"
        className={`${box} object-cover ${imgClassName}`}
        style={fill ? undefined : { aspectRatio: String(info.ratio) }}
      />
    </picture>
  );
}
