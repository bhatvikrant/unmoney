import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  /** Label of the confirming button. */
  action?: string;
  /** Destructive by default: every caller so far is a delete or something just as final. */
  destructive?: boolean;
  /** A third, milder choice between Cancel and the action ("Archive instead"); picking it resolves "alternative". */
  alternative?: string;
};

type Confirm = {
  (o: ConfirmOptions & { alternative: string }): Promise<boolean | "alternative">;
  (o: ConfirmOptions): Promise<boolean>;
};

const Ctx = createContext<Confirm | null>(null);

/** Destructive actions ask first. `if (!(await confirm({ title: "Delete X?" }))) return;` */
export function useConfirm(): Confirm {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return c;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean | "alternative") => void) | null>(null);

  const settle = (ok: boolean | "alternative") => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  };

  const confirm = useCallback((o: ConfirmOptions) => {
    resolver.current?.(false);
    setOpts(o);
    return new Promise<boolean | "alternative">((resolve) => { resolver.current = resolve; });
  }, []) as Confirm;

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <AlertDialog open={!!opts} onOpenChange={(o) => !o && settle(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
            {opts?.description ? <AlertDialogDescription>{opts.description}</AlertDialogDescription> : null}
          </AlertDialogHeader>
          <AlertDialogFooter className={opts?.alternative ? "flex-col sm:flex-row" : undefined}>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {opts?.alternative ? <Button variant="outline" onClick={() => settle("alternative")}>{opts.alternative}</Button> : null}
            <AlertDialogAction variant={opts?.destructive === false ? "default" : "destructive"} onClick={() => settle(true)}>{opts?.action ?? "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  );
}
