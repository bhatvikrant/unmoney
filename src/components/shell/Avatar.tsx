import { useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * Generated avatar: a deterministic, colourful SVG composition derived from a seed
 * (the user's email or name). Same seed → same avatar on every device.
 * Shows the user's photo instead when one is available.
 */
export function Avatar({ seed, src, alt, size = 40, className }: {
  seed: string; src?: string; alt?: string; size?: number; className?: string;
}) {
  const art = useMemo(() => build(seed), [seed]);
  const cls = cn("shrink-0 rounded-full overflow-hidden", className);
  if (src) return <img src={src} alt={alt ?? ""} width={size} height={size} className={cn(cls, "object-cover")} />;
  return (
    <svg viewBox="0 0 80 80" width={size} height={size} role="img" aria-label={alt ?? ""} className={cls}>
      <rect width="80" height="80" fill={art.bg} />
      <circle cx={art.blob.x} cy={art.blob.y} r={art.blob.r} fill={art.c1} opacity="0.9" />
      <rect x={art.bar.x} y={art.bar.y} width={art.bar.w} height={art.bar.h} rx={art.bar.rx} fill={art.c2} transform={`rotate(${art.bar.rot} 40 40)`} />
      <circle cx={art.dot.x} cy={art.dot.y} r={art.dot.r} fill={art.c3} />
      {/* face */}
      <g transform={`translate(${art.face.x} ${art.face.y})`}>
        <circle cx="-5" cy="0" r="1.9" fill={art.ink} />
        <circle cx="5" cy="0" r="1.9" fill={art.ink} />
        <path d={art.face.smile ? "M -4 5 Q 0 9 4 5" : "M -4 6 L 4 6"} stroke={art.ink} strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

/** Curated palettes: each is [bg, shape1, shape2, shape3, ink]. */
const PALETTES = [
  ["#FFD166", "#EF476F", "#06D6A0", "#118AB2", "#073B4C"],
  ["#F4A261", "#E76F51", "#2A9D8F", "#E9C46A", "#264653"],
  ["#CDB4DB", "#FFAFCC", "#A2D2FF", "#BDE0FE", "#3A2E5C"],
  ["#A8DADC", "#E63946", "#F1FAEE", "#457B9D", "#1D3557"],
  ["#FFB5A7", "#FCD5CE", "#F9DCC4", "#9A8C98", "#4A4E69"],
  ["#B5E48C", "#52B69A", "#168AAD", "#F9C74F", "#1A3C40"],
  ["#F72585", "#7209B7", "#4CC9F0", "#4361EE", "#10002B"],
  ["#FFE66D", "#FF6B6B", "#4ECDC4", "#1A535C", "#2B2D42"],
  ["#FDE2E4", "#FAD2E1", "#C5DEDD", "#DBE7E4", "#3C3744"],
  ["#FF9F1C", "#FFBF69", "#CBF3F0", "#2EC4B6", "#1B263B"],
];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function build(seed: string) {
  let h = hash(seed.trim().toLowerCase() || "unmoney");
  const next = (n: number) => { h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909); h >>>= 0; return h % n; };
  const p = PALETTES[next(PALETTES.length)];
  // Shuffle which palette colour plays which role so two users on the same palette still differ.
  const roles = [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]][next(6)];
  return {
    bg: p[0], c1: p[roles[0]], c2: p[roles[1]], c3: p[roles[2]], ink: p[4],
    blob: { x: 20 + next(40), y: 15 + next(35), r: 18 + next(14) },
    bar: { x: 10 + next(20), y: 40 + next(20), w: 36 + next(30), h: 10 + next(10), rx: next(2) ? 8 : 2, rot: next(4) * 45 - 45 },
    dot: { x: 12 + next(56), y: 12 + next(56), r: 4 + next(6) },
    face: { x: 28 + next(24), y: 28 + next(20), smile: next(4) !== 0 },
  };
}
