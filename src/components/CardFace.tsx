/**
 * A payment card drawn like the real thing: the card's colour as its background, bank name, chip,
 * masked number with the last 4 digits, and the card's name. In the editor the same card is the
 * form: the bank, the digits and the name are typed straight onto it.
 */
import { useRef, type CSSProperties, type ReactNode } from "react";
import { Check, Nfc, Pipette } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD_COLORS } from "../../shared/defaults";

/** Ink that reads on `hex`: near-white on deep colours, near-black on light ones. */
function inkOn(hex: string): { ink: string; soft: string } {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.4 ? { ink: "#1c1917", soft: "rgb(28 25 23 / 0.35)" } : { ink: "#ffffff", soft: "rgb(255 255 255 / 0.4)" };
}

/** The card's background: its colour, deepening toward the bottom right, with a soft light from the top. */
function surface(color: string): CSSProperties {
  const { ink, soft } = inkOn(color);
  return {
    color: ink,
    ["--ink-soft" as string]: soft,
    backgroundColor: color,
    backgroundImage: [
      "radial-gradient(120% 90% at 100% 0%, rgb(255 255 255 / 0.22), transparent 55%)",
      `linear-gradient(135deg, ${color} 0%, color-mix(in oklab, ${color} 72%, black) 100%)`,
    ].join(", "),
  };
}

/**
 * What the last-4 field holds after an edit: digits only, at most 4. A whole card number pasted
 * in keeps its last 4; an extra digit typed onto a full field is ignored.
 */
function lastDigits(raw: string, prev: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length <= 4) return d;
  return d.length - prev.length > 1 ? d.slice(-4) : d.slice(0, 4);
}

type Editable = {
  onChange: (field: "name" | "bankName" | "last4", value: string) => void;
  autoFocus?: boolean;
};

export function CardFace({ kind, name, bankName, last4, color, edit, footer, className }: {
  kind: string; name: string; bankName?: string; last4?: string; color: string;
  /** Makes the bank, digits and name editable in place. */
  edit?: Editable;
  /** Shown bottom right, e.g. the balance. */
  footer?: ReactNode;
  className?: string;
}) {
  const field = "min-w-0 bg-transparent [color:inherit] outline-none border-b border-dashed border-[var(--ink-soft)] focus:border-solid focus:border-current placeholder:text-current placeholder:opacity-55 transition-colors";
  return (
    <div style={surface(color)} className={cn("relative isolate flex aspect-[1.586/1] w-full max-w-[340px] flex-col overflow-hidden rounded-2xl p-5 shadow-lg ring-1 ring-black/10 select-none", edit && "select-auto", className)}>
      {/* two faint rings, the way many cards are printed */}
      <div aria-hidden className="absolute -right-16 -bottom-20 -z-10 size-56 rounded-full border-[28px] border-white/[0.06]" />
      <div aria-hidden className="absolute -right-4 -bottom-28 -z-10 size-56 rounded-full border-[18px] border-white/[0.05]" />

      <div className="flex items-start justify-between gap-3">
        {edit ? (
          <input aria-label="Bank name" placeholder="Bank name" value={bankName ?? ""} maxLength={40} onChange={(e) => edit.onChange("bankName", e.target.value)} className={cn(field, "flex-1 text-base font-semibold")} />
        ) : (
          <span className="truncate text-base font-semibold">{bankName || " "}</span>
        )}
        <span className="shrink-0 pt-1 text-[10px] font-medium uppercase tracking-[0.2em] opacity-75">{kind === "debitCard" ? "Debit" : "Credit"}</span>
      </div>

      <div className="mt-auto flex items-center gap-2.5">
        <div aria-hidden className="h-7 w-9 rounded-md bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-500 shadow-inner ring-1 ring-black/15 relative overflow-hidden">
          <div className="absolute inset-x-0 top-1/2 h-px bg-black/20" /><div className="absolute inset-y-0 left-1/2 w-px bg-black/20" />
        </div>
        <Nfc aria-hidden className="size-5 opacity-70" />
      </div>

      <div className="mt-3 flex items-center gap-[0.6em] font-mono text-lg tracking-[0.14em] tabular-nums">
        <span aria-hidden className="opacity-70">••••</span><span aria-hidden className="opacity-70">••••</span><span aria-hidden className="opacity-70">••••</span>
        {edit ? (
          <input aria-label="Last 4 digits of the card" placeholder="1234" inputMode="numeric" autoComplete="off" value={last4 ?? ""}
            onChange={(e) => edit.onChange("last4", lastDigits(e.target.value, last4 ?? ""))} className={cn(field, "w-[calc(4ch+0.8em)] shrink-0 tracking-[0.14em]")} />
        ) : (
          <span>{last4 || <span className="opacity-70">••••</span>}</span>
        )}
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        {edit ? (
          <input aria-label="Name" placeholder="Card name" value={name} autoFocus={edit.autoFocus} onChange={(e) => edit.onChange("name", e.target.value)} className={cn(field, "flex-1 text-xs font-medium uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal")} />
        ) : (
          <span className="truncate text-xs font-medium uppercase tracking-wider">{name}</span>
        )}
        {footer ? <span className="shrink-0 text-right">{footer}</span> : null}
      </div>
    </div>
  );
}

/** A small card for list rows, in the card's colour. */
export function CardThumb({ color, className }: { color: string; className?: string }) {
  return (
    <span aria-hidden style={surface(color)} className={cn("relative inline-block h-[26px] w-10 shrink-0 overflow-hidden rounded-[5px] ring-1 ring-black/10", className)}>
      <span className="absolute left-1.5 top-[9px] h-[7px] w-[9px] rounded-[2px] bg-gradient-to-br from-amber-200 to-amber-500" />
    </span>
  );
}

/** The colours a card can take, plus any colour from the system picker. */
export function CardColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const custom = useRef<HTMLInputElement>(null);
  const isPreset = CARD_COLORS.some((c) => c.value === value.toLowerCase());
  const swatch = "relative size-8 shrink-0 rounded-full ring-1 ring-black/15 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return (
    <div role="radiogroup" aria-label="Card colour" className="flex flex-wrap items-center justify-center gap-2.5">
      {CARD_COLORS.map((c) => {
        const on = c.value === value.toLowerCase();
        return (
          <button key={c.value} type="button" role="radio" aria-checked={on} aria-label={c.name} title={c.name} onClick={() => onChange(c.value)}
            className={cn(swatch, on && "ring-2 ring-foreground ring-offset-2 ring-offset-background")} style={{ backgroundColor: c.value }}>
            {on ? <Check className="absolute inset-0 m-auto size-4" style={{ color: inkOn(c.value).ink }} /> : null}
          </button>
        );
      })}
      <button type="button" role="radio" aria-checked={!isPreset} aria-label="Pick any colour" title="Pick any colour" onClick={() => custom.current?.click()}
        className={cn(swatch, "flex items-center justify-center bg-[conic-gradient(from_180deg,#ef4444,#eab308,#22c55e,#06b6d4,#6366f1,#d946ef,#ef4444)]", !isPreset && "ring-2 ring-foreground ring-offset-2 ring-offset-background")}>
        <span className="flex size-5 items-center justify-center rounded-full" style={!isPreset ? { backgroundColor: value } : { backgroundColor: "white" }}>
          <Pipette className="size-3" style={{ color: !isPreset ? inkOn(value).ink : "#1c1917" }} />
        </span>
      </button>
      <input ref={custom} type="color" tabIndex={-1} aria-hidden className="sr-only" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
