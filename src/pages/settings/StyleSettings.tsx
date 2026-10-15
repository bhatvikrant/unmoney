import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useApp } from "@/lib/app";
import { ACCENTS } from "@/lib/theme";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export default function StyleSettings() {
  const { settings: s } = useApp();
  const update = useMutation(api.settings.update);
  return (
    <>
      <PageHeader back="/settings" title="Style" />
      <Page>
        <Section>
          <Row label="Mode" right={<Select value={s.theme} onValueChange={(v) => update({ patch: { theme: v as "system" | "light" | "dark" } })}><SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem></SelectContent></Select>} />
          <Row label="Accent colour" right={
            <div className="flex gap-2">{Object.entries(ACCENTS).map(([k, a]) => <button key={k} type="button" aria-label={a.label} title={a.label} onClick={() => update({ patch: { accent: k } })} className={cn("size-7 rounded-full border-2", s.accent === k ? "border-foreground" : "border-transparent")} style={{ background: a.primary }} />)}</div>
          } />
          <Row label="Income / expense colours" hint={s.colorSet === "A" ? "Income blue, expenses red" : "Income red, expenses blue"} right={<Select value={s.colorSet} onValueChange={(v) => update({ patch: { colorSet: v as "A" | "B" } })}><SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="A">Set A</SelectItem><SelectItem value="B">Set B</SelectItem></SelectContent></Select>} />
        </Section>
      </Page>
    </>
  );
}
