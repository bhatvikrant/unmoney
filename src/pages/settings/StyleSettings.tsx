import { useId } from "react";
import { useOp } from "@/lib/store";
import { useApp } from "@/lib/app";
import { ACCENTS, CORNERS, PATTERNS, TINTS } from "@/lib/theme";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";
// the selected one gets a ring outside it, which shows on any colour
const chosen = "ring-2 ring-foreground ring-offset-2 ring-offset-card";

export default function StyleSettings() {
  const { settings: s } = useApp();
  const update = useOp("settings.update");
  const patternId = useId();
  // a value this build does not know (saved by a newer one) shows as the stock look, which is what applyTheme draws for it
  const tint = s.tint && TINTS[s.tint] ? s.tint : "plain";
  const pattern = s.pattern && PATTERNS[s.pattern] ? s.pattern : "none";
  const corners = s.corners && CORNERS[s.corners] ? s.corners : "soft";
  return (
    <>
      <PageHeader back="/settings" title="Style" />
      <Page>
        <Section>
          <Row label="Mode" right={(id) => <Select value={s.theme} onValueChange={(v) => update({ patch: { theme: v as "system" | "light" | "dark" } })}><SelectTrigger aria-labelledby={id} className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem></SelectContent></Select>} />
          {/* with Light chosen there is no dark page for it to change */}
          {s.theme === "light" ? null : <Row label="True black" hint="A pure black page in dark mode" right={(id) => <Switch aria-labelledby={id} checked={!!s.trueBlack} onCheckedChange={(v) => update({ patch: { trueBlack: v } })} />} />}
          <Row label="Accent colour" right={(id) => (
            <div role="radiogroup" aria-labelledby={id} className="flex gap-2">
              {/* Ink is the theme's own neutral (near-white in dark mode), so its swatch follows the mode. */}
              {Object.entries(ACCENTS).map(([k, a]) => (
                <button key={k} type="button" role="radio" aria-checked={s.accent === k} aria-label={a.label} title={a.label} onClick={() => update({ patch: { accent: k } })} className={cn("size-7 rounded-full", focus, s.accent === k && chosen)} style={{ background: k === "neutral" ? "var(--foreground)" : a.primary }} />
              ))}
            </div>
          )} />
          <Row label="Income / expense colours" hint={s.colorSet === "A" ? "Income blue, expenses red" : "Income red, expenses blue"} right={(id) => <Select value={s.colorSet} onValueChange={(v) => update({ patch: { colorSet: v as "A" | "B" } })}><SelectTrigger aria-labelledby={id} className="h-8 w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="A">Set A</SelectItem><SelectItem value="B">Set B</SelectItem></SelectContent></Select>} />
        </Section>
        <Section title="Page">
          <Row label="Background" hint={TINTS[tint].label} right={(id) => (
            <div role="radiogroup" aria-labelledby={id} className="flex gap-2">
              {/* the tint itself is too faint to tell apart at this size, so each swatch shows its hue stronger */}
              {Object.entries(TINTS).map(([k, t]) => (
                <button key={k} type="button" role="radio" aria-checked={tint === k} aria-label={t.label} title={t.label} onClick={() => update({ patch: { tint: k } })} className={cn("size-7 rounded-full border", focus, tint === k && chosen)} style={{ background: t.hue === undefined ? "var(--muted)" : `oklch(0.8 0.07 ${t.hue})` }} />
              ))}
            </div>
          )} />
          <div className="border-b px-4 py-3">
            <div className="text-sm"><span id={patternId}>Pattern</span></div>
            <div className="text-xs text-muted-foreground">{PATTERNS[pattern]}{pattern === "glow" ? ", in the accent colour" : ""}</div>
            <div role="radiogroup" aria-labelledby={patternId} className="mt-2.5 grid grid-cols-6 gap-2">
              {Object.entries(PATTERNS).map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={pattern === k} aria-label={label} title={label} onClick={() => update({ patch: { pattern: k } })} data-pattern={k} className={cn("page-pattern h-12 rounded-md border bg-background", focus, pattern === k && chosen)} />
              ))}
            </div>
          </div>
          <Row label="Corners" right={(id) => <Select value={corners} onValueChange={(v) => update({ patch: { corners: v } })}><SelectTrigger aria-labelledby={id} className="h-8 w-24"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CORNERS).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}</SelectContent></Select>} />
        </Section>
      </Page>
    </>
  );
}
