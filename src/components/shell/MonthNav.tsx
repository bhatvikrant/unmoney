import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MonthNav({ label, onPrev, onNext, onClick }: { label: string; onPrev: () => void; onNext: () => void; onClick?: () => void }) {
  return (
    <div className="flex items-center justify-between px-2 py-1">
      <Button variant="ghost" size="icon" aria-label="Previous" onClick={onPrev}><ChevronLeft className="size-5" /></Button>
      <button type="button" className="text-sm font-medium px-3 py-1 rounded-md hover:bg-accent" onClick={onClick}>{label}</button>
      <Button variant="ghost" size="icon" aria-label="Next" onClick={onNext}><ChevronRight className="size-5" /></Button>
    </div>
  );
}
