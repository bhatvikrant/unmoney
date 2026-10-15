import { useState } from "react";
import { EllipsisVertical, Share, SquarePlus } from "lucide-react";
import { Row } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { promptInstall, useInstallState } from "@/lib/pwa";

const steps = {
  ios: [
    { icon: Share, text: <>Tap <b>Share</b> in the browser's toolbar.</> },
    { icon: SquarePlus, text: <>Scroll down and choose <b>Add to Home Screen</b>, then tap <b>Add</b>.</> },
  ],
  manual: [
    { icon: EllipsisVertical, text: <>Open your browser's menu.</> },
    { icon: SquarePlus, text: <>Choose <b>Install app</b> or <b>Add to Home screen</b>.</> },
  ],
};

/** "Install app" in Settings; hidden once unmoney is running as an installed app. */
export function InstallRow() {
  const state = useInstallState();
  const [open, setOpen] = useState(false);
  if (state === "installed") return null;
  const how = state === "ios" ? "ios" : "manual";
  return (
    <>
      <Row
        label="Install app"
        hint="Opens full screen from your home screen and works offline"
        right={state === "prompt"
          ? <Button size="sm" onClick={() => void promptInstall()}>Install</Button>
          : <Button size="sm" variant="outline" onClick={() => setOpen(true)}>How?</Button>}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install unmoney</DialogTitle>
            <DialogDescription>It then opens from your home screen like any other app, and works without a connection.</DialogDescription>
          </DialogHeader>
          <ol className="space-y-3">
            {steps[how].map((s, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted"><s.icon className="size-4" /></span>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
          {how === "ios" ? <p className="text-xs text-muted-foreground">On iPhone and iPad this works in Safari, and in Chrome or Edge on iOS 16.4 and later.</p> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
