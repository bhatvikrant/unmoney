export const ACCENTS: Record<string, { label: string; primary: string; fg: string }> = {
  neutral: { label: "Ink", primary: "oklch(0.205 0 0)", fg: "oklch(0.985 0 0)" },
  red: { label: "Coral", primary: "oklch(0.64 0.2 25)", fg: "oklch(0.99 0 0)" },
  orange: { label: "Amber", primary: "oklch(0.72 0.17 60)", fg: "oklch(0.15 0 0)" },
  green: { label: "Mint", primary: "oklch(0.62 0.15 160)", fg: "oklch(0.99 0 0)" },
  blue: { label: "Sky", primary: "oklch(0.6 0.19 255)", fg: "oklch(0.99 0 0)" },
  purple: { label: "Iris", primary: "oklch(0.58 0.2 290)", fg: "oklch(0.99 0 0)" },
};

export function applyTheme(theme: "system" | "light" | "dark", accent: string, colorSet: "A" | "B") {
  const root = document.documentElement;
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
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
  const meta = document.querySelector('meta[name="theme-color"]:not([media])') ?? (() => {
    const m = document.createElement("meta");
    m.name = "theme-color";
    document.head.appendChild(m);
    return m;
  })();
  (meta as HTMLMetaElement).content = dark ? "#0a0a0a" : "#ffffff";
}
