/**
 * The closer card's poster as data, and the same poster drawn on a canvas for sharing or saving
 * as an image. The card on screen and the image share the rows, so they always say the same
 * thing. Drawn by hand rather than captured from the page: a capture of HTML loses web fonts on
 * iOS, and the canvas gives a crisp 1080 px image in the current theme.
 */
import { pctChange, type RecapSummary } from "../../../shared/recap";

export type PosterRow = { key: string; label: string; value: string; tone?: "income" | "expense" | "budgetLeft" };

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The poster's rows: what was spent, against when, where it went, and the month's (or year's) highlights. */
export function posterRows(s: RecapSummary, year: boolean, fmt: (minor: number) => string): PosterRow[] {
  const rows: PosterRow[] = [{ key: "spent", label: "Spent", value: fmt(s.spent), tone: "expense" }];
  if (s.change !== undefined && s.prevLabel) {
    const c = pctChange(s.change);
    rows.push({ key: "vs", label: `vs ${s.prevLabel}`, value: c.pct === 0 ? "the same" : `${c.less ? "↓" : "↑"} ${c.pct}% ${c.less ? "less" : "more"}`, tone: c.pct === 0 ? undefined : c.less ? "income" : "expense" });
  }
  rows.push({ key: "top", label: "Top category", value: s.top ? `${s.top.name} · ${pct(s.top.pct)}` : "—" });
  rows.push({ key: "big", label: "Biggest spend", value: s.biggest ? `${s.biggest.note} · ${fmt(s.biggest.amount)}` : "—" });
  const repeat = s.repeat ? `“${s.repeat.text}” ×${s.repeat.count}` : "—";
  if (year) rows.push({ key: "repeat", label: "Most logged", value: repeat });
  rows.push(s.keptPct === undefined ? { key: "kept", label: "Kept", value: "no income logged" } : s.keptPct < 0 ? { key: "kept", label: "Spent", value: `${100 - s.keptPct}% of income` } : { key: "kept", label: "Kept", value: `${s.keptPct}% of income` });
  rows.push({ key: "nospend", label: "No-spend days", value: String(s.noSpend) });
  // every budget held reads green; otherwise just the count
  if (s.budgets) {
    const all = s.budgets.held === s.budgets.total;
    rows.push(year
      ? { key: "budgets", label: "Within budget", value: `${s.budgets.held} of ${s.budgets.total} months`, tone: all ? "budgetLeft" : undefined }
      : { key: "budgets", label: "Budgets", value: all ? `all ${s.budgets.total} held` : `${s.budgets.held} of ${s.budgets.total} held`, tone: all ? "budgetLeft" : undefined });
  }
  rows.push(year ? { key: "personality", label: "Personality", value: s.personality ?? "—" } : { key: "repeat", label: "On repeat", value: repeat });
  return rows;
}

export type Poster = {
  /** "September" (with `sub` "2026"), or "2026" for a year. */
  title: string;
  sub?: string;
  /** "1–30 Sep · 63 entries" */
  meta: string;
  /** The colour signature: each top category's share and its CSS colour; the rest fills the remainder. */
  strip: { pct: number; color: string }[];
  rest: string;
  rows: PosterRow[];
};

const W = 1080;
const PAD = 80;
const FONT = '"Geist Variable", system-ui, sans-serif';
const ROW_H = 100;
/** The UnMoney mark (public/icon.svg), drawn on a 512 grid; the "M" alone spans 128–384 × 160–352. */
export const MARK = "M128 352V160h48l80 112 80-112h48v192h-48V240l-80 112-80-112v112z";

/** A CSS colour (a var(), oklch, color-mix…) as the browser resolves it in the current theme. */
function resolve(css: string): string {
  const probe = document.createElement("i");
  probe.style.color = css;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}

/** `text` cut with an ellipsis to fit `max` px in the context's current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid).trimEnd()}…`).width <= max) lo = mid; else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

/** The poster as a PNG, 1080 px wide, in the colours of the current theme. */
export async function posterImage(p: Poster): Promise<Blob> {
  await Promise.all([600, 500, 400].map((w) => document.fonts.load(`${w} 40px ${FONT}`))).catch(() => undefined);
  const color = {
    bg: resolve("var(--card)"), fg: resolve("var(--foreground)"), muted: resolve("var(--muted-foreground)"),
    border: resolve("var(--border)"), income: resolve("var(--income)"), expense: resolve("var(--expense)"), budgetLeft: resolve("var(--chart-3)"),
    paper: resolve("var(--background)"), rest: resolve(p.rest),
  };
  const titleH = p.sub ? 236 : 160;
  // title, period, strip, rows, then the signature (a gap and the mark) and the bottom padding
  const H = PAD + titleH + 64 + 76 + p.rows.length * ROW_H + 40 + 52 + PAD;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  // the watermark: the "M" alone, large and faint, off the bottom-right corner
  const wm = 620 / 256;
  ctx.save();
  ctx.globalAlpha = 0.045;
  ctx.fillStyle = color.fg;
  ctx.translate(W - 620 + 70, H - 192 * wm + 40);
  ctx.scale(wm, wm);
  ctx.translate(-128, -160);
  ctx.fill(new Path2D(MARK));
  ctx.restore();

  // the title, and the period under it
  let y = PAD;
  ctx.fillStyle = color.fg;
  if (p.sub) {
    ctx.font = `600 100px ${FONT}`;
    ctx.fillText(p.title, PAD - 4, y + 88);
    ctx.fillStyle = color.muted;
    ctx.font = `500 100px ${FONT}`;
    ctx.fillText(p.sub, PAD - 4, y + 196);
  } else {
    ctx.font = `600 140px ${FONT}`;
    ctx.fillText(p.title, PAD - 6, y + 124);
  }
  y += titleH;
  ctx.fillStyle = color.muted;
  ctx.font = `400 36px ${FONT}`;
  ctx.fillText(p.meta, PAD, y + 36);
  y += 64;

  // the colour strip
  const inner = W - 2 * PAD;
  const gap = 6;
  const parts = [...p.strip.map((s) => ({ w: s.pct, c: resolve(s.color) })), { w: Math.max(0, 1 - p.strip.reduce((a, s) => a + s.pct, 0)), c: color.rest }].filter((s) => s.w > 0);
  const usable = inner - gap * (parts.length - 1);
  let x = PAD;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(PAD, y, inner, 24, 8);
  ctx.clip();
  parts.forEach((s, i) => {
    const w = i === parts.length - 1 ? PAD + inner - x : usable * s.w;
    ctx.fillStyle = s.c;
    ctx.fillRect(x, y, w, 24);
    x += w + gap;
  });
  ctx.restore();
  y += 24 + 52;

  // the rows: label left, value right, a hairline between
  p.rows.forEach((r, i) => {
    const base = y + ROW_H / 2 + 14;
    ctx.font = `400 38px ${FONT}`;
    ctx.fillStyle = color.muted;
    ctx.textAlign = "left";
    ctx.fillText(r.label, PAD, base);
    const labelW = ctx.measureText(r.label).width;
    ctx.font = `500 38px ${FONT}`;
    ctx.fillStyle = r.tone === "income" ? color.income : r.tone === "expense" ? color.expense : r.tone === "budgetLeft" ? color.budgetLeft : color.fg;
    ctx.textAlign = "right";
    ctx.fillText(fit(ctx, r.value, inner - labelW - 40), W - PAD, base);
    if (i < p.rows.length - 1) {
      ctx.fillStyle = color.border;
      ctx.fillRect(PAD, y + ROW_H - 1, inner, 2);
    }
    y += ROW_H;
  });
  ctx.textAlign = "left";

  // the signature, quiet: no rule, at 60%; the mark and name on the left, the address on the right
  y += 40;
  const mark = 52;
  ctx.globalAlpha = 0.6;
  ctx.save();
  ctx.translate(PAD, y);
  ctx.scale(mark / 512, mark / 512);
  ctx.fillStyle = color.fg;
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 512, 112);
  ctx.fill();
  ctx.fillStyle = color.paper;
  ctx.fill(new Path2D(MARK));
  ctx.restore();
  ctx.fillStyle = color.fg;
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText("UnMoney", PAD + mark + 16, y + 38);
  ctx.fillStyle = color.muted;
  ctx.font = `400 30px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("unmoney.vercel.app", W - PAD, y + 37);
  ctx.globalAlpha = 1;

  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("toBlob failed"))), "image/png"));
}
