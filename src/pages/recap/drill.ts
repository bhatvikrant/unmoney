/**
 * Drilling into a recap card: a tap on a category block, a day's bar, a note… opens a drawer with
 * the entries behind it, over the card, without leaving the story. The open drill is in the URL
 * (?drill=…, replaced like ?card=), so Back from an entry opened in the drawer reopens the drawer.
 */
import { createContext, useContext } from "react";
import type { RecapCard, RecapDrill } from "../../../shared/recap";

/** What the cards call to open a drill; the recap page provides it. */
export const DrillContext = createContext<(d: RecapDrill) => void>(() => {});
export const useDrill = () => useContext(DrillContext);
/** Whether to point at a card's tappable parts with a pulsing dot: until the user first opens a drawer. */
export const HintContext = createContext(false);
export const useHints = () => useContext(HintContext);

/** "c:<id>", "d:2026-09-14", "n:coffee", "top:10"… for the URL. */
export function encodeDrill(d: RecapDrill): string {
  switch (d.kind) {
    case "category": return `c:${d.id}`;
    case "rest": return "rest";
    case "day": return `d:${d.date}`;
    case "month": return `m:${d.month}`;
    case "note": return `n:${d.text}`;
    case "account": return `a:${d.id}`;
    case "hour": return `h:${d.hour}`;
    case "scheduled": return "s";
    case "income": return "i";
    case "largest": return `top:${d.count}`;
  }
}

/** The drill a URL value names, or null for nothing or nonsense. "rest" is the categories after the card's top ones. */
export function decodeDrill(s: string | null, card: RecapCard | undefined): RecapDrill | null {
  if (!s) return null;
  if (s === "rest") return card?.kind === "categories" ? { kind: "rest", exclude: card.top.map((t) => t.id) } : null;
  if (s === "s") return { kind: "scheduled" };
  if (s === "i") return { kind: "income" };
  const at = s.indexOf(":");
  if (at < 1) return null;
  const tag = s.slice(0, at), v = s.slice(at + 1);
  if (!v) return null;
  switch (tag) {
    case "c": return { kind: "category", id: v };
    case "d": return /^\d{4}-\d{2}-\d{2}$/.test(v) ? { kind: "day", date: v } : null;
    case "m": return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? { kind: "month", month: v } : null;
    case "n": return { kind: "note", text: v };
    case "a": return { kind: "account", id: v };
    case "h": { const h = Number(v); return Number.isInteger(h) && h >= 0 && h < 24 ? { kind: "hour", hour: h } : null; }
    case "top": { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= 50 ? { kind: "largest", count: n } : null; }
  }
  return null;
}
