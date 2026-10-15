import { useState } from "react";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type RepeatChoice =
  | { kind: "none" }
  | { kind: "repeat"; frequency: "daily" | "weekly" | "biweekly" | "monthly" | "yearly"; endDate?: string }
  | { kind: "installment"; count: number };

export const FREQ_LABEL: Record<string, string> = { daily: "Every day", weekly: "Every week", biweekly: "Every 2 weeks", monthly: "Every month", yearly: "Every year" };

export function repeatLabel(r: RepeatChoice): string {
  if (r.kind === "none") return "Repeat";
  if (r.kind === "repeat") return FREQ_LABEL[r.frequency] + (r.endDate ? ` until ${r.endDate}` : "");
  return `${r.count} installments`;
}

export function RepeatSheet({ open, onOpenChange, value, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; value: RepeatChoice; onChange: (r: RepeatChoice) => void }) {
  const [mode, setMode] = useState<RepeatChoice["kind"]>(value.kind);
  const [freq, setFreq] = useState<"daily" | "weekly" | "biweekly" | "monthly" | "yearly">(value.kind === "repeat" ? value.frequency : "monthly");
  const [end, setEnd] = useState(value.kind === "repeat" ? value.endDate ?? "" : "");
  const [count, setCount] = useState(value.kind === "installment" ? value.count : 3);
  const apply = () => {
    if (mode === "none") onChange({ kind: "none" });
    else if (mode === "repeat") onChange({ kind: "repeat", frequency: freq, endDate: end || undefined });
    else onChange({ kind: "installment", count: Math.min(60, Math.max(2, Math.floor(count))) });
    onOpenChange(false);
  };
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Repeat / Installment">
      <div className="px-2 space-y-4">
        <div className="grid grid-cols-3 gap-1.5">
          {(["none", "repeat", "installment"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={cn("rounded-md border px-2 py-2 text-sm capitalize", mode === m && "bg-primary text-primary-foreground border-primary")}>{m === "none" ? "Once" : m}</button>
          ))}
        </div>
        {mode === "repeat" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <Select value={freq} onValueChange={(v) => setFreq(v as typeof freq)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(FREQ_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>End date (optional)</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">Entries are added on each date (or on the first day of the month, see Settings › Repeat display). Edit or stop the schedule from Settings › Repeat settings.</p>
          </div>
        ) : null}
        {mode === "installment" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Number of months</Label>
              <Input type="number" min={2} max={60} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </div>
            <p className="text-xs text-muted-foreground">The amount is split evenly across the months, one entry per month starting on this date.</p>
          </div>
        ) : null}
        <Button className="w-full" onClick={apply}>Apply</Button>
      </div>
    </BottomSheet>
  );
}
