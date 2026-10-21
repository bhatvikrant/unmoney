import { useNavigate } from "react-router";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, type ReactNode } from "react";
import { useGoBack } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { SyncStrip } from "./SyncStatus";

export function PageHeader({ title, back, left, right, className, sub }: {
  title?: ReactNode; back?: boolean | string; left?: ReactNode; right?: ReactNode; className?: string; sub?: ReactNode;
}) {
  const nav = useNavigate();
  const goBack = useGoBack();
  // the tab and the screen reader say which screen this is
  useEffect(() => {
    if (typeof title !== "string" || !title) return;
    document.title = `${title} · UnMoney`;
    return () => { document.title = "UnMoney"; };
  }, [title]);
  return (
    <header className={cn("sticky top-0 z-30 bg-background border-b", className)}>
      <div className="mx-auto max-w-3xl flex h-12 items-center px-2 gap-1">
        <div className="flex items-center min-w-0 w-24">
          {back ? (
            <Button variant="ghost" size="icon" aria-label="Back" onClick={() => (typeof back === "string" ? nav(back) : goBack())}>
              <ChevronLeft className="size-5" />
            </Button>
          ) : null}
          {left}
        </div>
        {title ? <h1 className="flex-1 text-center font-semibold truncate">{title}</h1> : <div className="flex-1" />}
        <div className="flex items-center justify-end w-24 gap-0.5">{right}</div>
      </div>
      <SyncStrip />
      {sub}
    </header>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto max-w-3xl", className)}>{children}</div>;
}
