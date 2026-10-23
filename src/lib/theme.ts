export const ACCENTS: Record<string, { label: string; primary: string; fg: string }> = {
  neutral: { label: "Ink", primary: "oklch(0.205 0 0)", fg: "oklch(0.985 0 0)" },
  red: { label: "Coral", primary: "oklch(0.64 0.2 25)", fg: "oklch(0.99 0 0)" },
  orange: { label: "Amber", primary: "oklch(0.72 0.17 60)", fg: "oklch(0.15 0 0)" },
  green: { label: "Mint", primary: "oklch(0.62 0.15 160)", fg: "oklch(0.99 0 0)" },
  blue: { label: "Sky", primary: "oklch(0.6 0.19 255)", fg: "oklch(0.99 0 0)" },
  purple: { label: "Iris", primary: "oklch(0.58 0.2 290)", fg: "oklch(0.99 0 0)" },
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

export function applyTheme(theme: "system" | "light" | "dark", accent: string, colorSet: "A" | "B") {
  const root = document.documentElement;
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  // for index.html's first paint, before the app has its settings
  try { localStorage.setItem("unmoney:theme", theme); } catch { /* storage unavailable: the first paint follows the system */ }
  root.dataset.colorset = colorSet;
  const a = ACCENTS[accent] ?? ACCENTS.neutral;
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
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = dark ? "#0a0a0a" : "#ffffff";
}
