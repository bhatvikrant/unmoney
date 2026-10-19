import { useState } from "react";
import { Delete } from "lucide-react";
import { BottomSheet } from "@/components/shell/BottomSheet";
import { Button } from "@/components/ui/button";
import { evaluateExpression } from "../../../shared/money";
import { cn } from "@/lib/utils";
import { localNumber, LOCALE_DECIMAL } from "@/lib/format";

/** Calculator keypad. Returns a major-unit string. */
export function AmountKeypad({ open, onOpenChange, initial, onDone, currencyLabel }: {
  open: boolean; onOpenChange: (o: boolean) => void; initial: string; onDone: (value: string) => void; currencyLabel?: string;
}) {
  const [expr, setExpr] = useState(initial);
  const press = (k: string) => {
    if (k === "⌫") return setExpr((e) => e.slice(0, -1));
    if (k === "C") return setExpr("");
    if (k === "=") {
      const v = evaluateExpression(expr, LOCALE_DECIMAL);
      return setExpr(v === null ? expr : localNumber(Math.round(v * 1e8) / 1e8));
    }
    setExpr((e) => e + k);
  };
  const done = () => {
    const v = evaluateExpression(expr, LOCALE_DECIMAL);
    // an unfinished expression ("5+") stays in the field to fix, rather than wiping the amount
    onDone(v === null ? expr : localNumber(Math.round(v * 1e8) / 1e8));
    onOpenChange(false);
  };
  const keys = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "-", LOCALE_DECIMAL, "0", "⌫", "+"];
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={currencyLabel ? `Amount (${currencyLabel})` : "Amount"}>
      <div className="px-2">
        <div className="h-12 flex items-center justify-end text-2xl tabular font-medium rounded-md bg-muted px-3 mb-2 overflow-x-auto no-scrollbar">{expr || "0"}</div>
        <div className="grid grid-cols-4 gap-1.5">
          {keys.map((k) => (
            <button key={k} type="button" onClick={() => press(k)} className={cn("h-12 rounded-md text-lg bg-card border hover:bg-accent active:scale-95 transition", /[÷×+-]/.test(k) && "bg-muted text-muted-foreground")}>
              {k === "⌫" ? <Delete className="size-5 mx-auto" /> : k}
            </button>
          ))}
          <Button variant="outline" className="h-12 col-span-1" onClick={() => press("C")}>C</Button>
          <Button variant="outline" className="h-12 col-span-1" onClick={() => press("=")}>=</Button>
          <Button className="h-12 col-span-2" onClick={done}>Done</Button>
        </div>
      </div>
    </BottomSheet>
  );
}
