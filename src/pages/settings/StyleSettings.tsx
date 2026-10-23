import { useOp } from "@/lib/store";
import { useApp } from "@/lib/app";
import { ACCENTS } from "@/lib/theme";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export default function StyleSettings() {
  const { settings: s } = useApp();
  const update = useOp("settings.update");
  return (
    <>
      <PageHeader back="/settings" title="Style" />
      <Page>
        <Section>
          <Row label="Mode" right={(id) => <Select value={s.theme} onValueChange={(v) => update({ patch: { theme: v as "system" | "light" | "dark" } })}><SelectTrigger aria-labelledby={id} className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem></SelectContent></Select>} />
          <Row label="Accent colour" right={(id) => (
            <div role="radiogroup" aria-labelledby={id} className="flex gap-2">
              {Object.entries(ACCENTS).map(([k, a]) => (
                <button key={k} type="button" role="radio" aria-checked={s.accent === k} aria-label={a.label} title={a.label} onClick={() => update({ patch: { accent: k } })} className={cn("size-7 rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", s.accent === k ? "border-foreground" : "border-transparent")} style={{ background: a.primary }} />
              ))}
            </div>
          )} />
          <Row label="Income / expense colours" hint={s.colorSet === "A" ? "Income blue, expenses red" : "Income red, expenses blue"} right={(id) => <Select value={s.colorSet} onValueChange={(v) => update({ patch: { colorSet: v as "A" | "B" } })}><SelectTrigger aria-labelledby={id} className="h-8 w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="A">Set A</SelectItem><SelectItem value="B">Set B</SelectItem></SelectContent></Select>} />
        </Section>
      </Page>
    </>
  );
}
