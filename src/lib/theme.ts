/**
 * Each accent in two strengths, because it is used both ways round: as the fill under button text and as
 * text (the active tab, links) on the page. On white it is the darker one with white text; on the dark theme
 * the brighter one with dark text. Every pairing is at least 4.5:1 (the single shade used before was 2.6 to 4).
 */
const WHITE = "oklch(0.99 0 0)";
const INK = "oklch(0.15 0 0)";
export const ACCENTS: Record<string, { label: string; primary: string; fg: string; dark?: { primary: string; fg: string } }> = {
  neutral: { label: "Ink", primary: "oklch(0.205 0 0)", fg: "oklch(0.985 0 0)" },
  red: { label: "Coral", primary: "oklch(0.58 0.2 25)", fg: WHITE, dark: { primary: "oklch(0.66 0.2 25)", fg: INK } },
  orange: { label: "Amber", primary: "oklch(0.57 0.17 60)", fg: WHITE, dark: { primary: "oklch(0.72 0.17 60)", fg: INK } },
  green: { label: "Mint", primary: "oklch(0.53 0.15 160)", fg: WHITE, dark: { primary: "oklch(0.64 0.15 160)", fg: INK } },
  blue: { label: "Sky", primary: "oklch(0.56 0.19 255)", fg: WHITE, dark: { primary: "oklch(0.64 0.19 255)", fg: INK } },
  purple: { label: "Iris", primary: "oklch(0.58 0.2 290)", fg: WHITE, dark: { primary: "oklch(0.66 0.2 290)", fg: INK } },
};

/** Eight categorical slots in a fixed order (see --chart-N in index.css); anything past them is the neutral "rest" tone. */
export const SERIES_SLOTS = 8;

/** How many of `count` ranked items get their own colour: all of them up to eight, otherwise seven and the rest fold into one neutral slice. */
export function colouredCount(count: number) {
  return count <= SERIES_SLOTS ? count : SERIES_SLOTS - 1;
}

/** The colour of the item ranked `i` in a list of `count`; past the coloured ones, the neutral "rest" tone. */
export function colorAt(i: number, count = SERIES_SLOTS) {
  return i < colouredCount(count) ? `var(--chart-${i + 1})` : "var(--chart-rest)";
}

/** Page tints: a hue for the neutral surfaces (index.css, [data-tint]). No hue is the stock grey. */
export const TINTS: Record<string, { label: string; hue?: number }> = {
  plain: { label: "Plain" },
  sand: { label: "Sand", hue: 80 },
  sage: { label: "Sage", hue: 155 },
  mist: { label: "Mist", hue: 245 },
  rose: { label: "Rose", hue: 10 },
};
/** What is drawn behind the cards; each key is a [data-pattern] rule in index.css. */
export const PATTERNS: Record<string, string> = { none: "None", dots: "Dots", grid: "Grid", waves: "Waves", plus: "Crosses", glow: "Glow" };
/** Corner roundness; each key but "soft" (the stock radius) is a [data-corners] rule in index.css. */
export const CORNERS: Record<string, string> = { sharp: "Sharp", soft: "Soft", round: "Round" };

/** A CSS colour as #rrggbb, for the theme-color tag (browsers differ on what they parse there). */
function hexOf(color: string, fallback: string) {
  const c = document.createElement("canvas").getContext("2d");
  if (!c) return fallback;
  c.fillStyle = fallback;
  c.fillStyle = color; // a colour the canvas cannot read leaves the fallback in place
  c.fillRect(0, 0, 1, 1);
  return "#" + [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((n) => n.toString(16).padStart(2, "0")).join("");
}

export function applyTheme(theme: "system" | "light" | "dark", accent: string, colorSet: "A" | "B", look: { tint?: string; pattern?: string; corners?: string; trueBlack?: boolean } = {}) {
  const root = document.documentElement;
  const hue = TINTS[look.tint ?? ""]?.hue;
  if (hue === undefined) delete root.dataset.tint;
  else {
    root.dataset.tint = "";
    root.style.setProperty("--tint-h", String(hue));
  }
  root.dataset.pattern = look.pattern ?? "none";
  root.dataset.corners = look.corners ?? "soft";
  // only the dark theme has rules for it, so it can stay on while the page is light
  if (look.trueBlack) root.dataset.black = "";
  else delete root.dataset.black;
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  // for index.html's first paint, before the app has its settings
  try { localStorage.setItem("unmoney:theme", theme); } catch { /* storage unavailable: the first paint follows the system */ }
  root.dataset.colorset = colorSet;
  const chosen = ACCENTS[accent] ?? ACCENTS.neutral;
  const a = (dark && chosen.dark) || chosen;
  if (accent === "neutral") {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-foreground");
    root.style.removeProperty("--ring");
  } else {
    root.style.setProperty("--primary", a.primary);
    root.style.setProperty("--primary-foreground", a.fg);
    root.style.setProperty("--ring", a.primary);
  }
  // every theme-color tag, including the light/dark ones in index.html, so a chosen theme wins over the system one
  const stock = dark ? "#0a0a0a" : "#ffffff";
  // a tinted page: the browser's bar takes the page colour as painted, so no seam shows above the header
  const bar = hue === undefined && !(dark && look.trueBlack) ? stock : hexOf(getComputedStyle(root).getPropertyValue("--background"), stock);
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = bar;
}
