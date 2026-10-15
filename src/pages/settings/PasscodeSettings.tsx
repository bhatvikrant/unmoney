import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PinPad } from "@/pages/auth/Lock";
import { hashPin, newSalt, markUnlocked } from "@/lib/passcode";

export default function PasscodeSettings() {
  const { settings: s } = useApp();
  const setPasscode = useMutation(api.settings.setPasscode);
  const update = useMutation(api.settings.update);
  const [stage, setStage] = useState<null | "enter" | "confirm">(null);
  const [first, setFirst] = useState("");
  const [err, setErr] = useState(false);
  return (
    <>
      <PageHeader back="/settings" title="Passcode" />
      <Page className="pb-8">
        {stage ? (
          <div className="py-10">
            <PinPad title={stage === "enter" ? "Choose a 4-digit passcode" : "Enter it again"} error={err} onComplete={async (pin) => {
              if (stage === "enter") { setFirst(pin); setStage("confirm"); return; }
              if (pin !== first) { setErr(true); setTimeout(() => setErr(false), 400); setStage("enter"); return; }
              const salt = newSalt();
              await setPasscode({ hash: await hashPin(pin, salt), salt });
              markUnlocked();
              setStage(null);
              toast.success("Passcode set");
            }} />
            <div className="text-center mt-6"><Button variant="ghost" onClick={() => setStage(null)}>Cancel</Button></div>
          </div>
        ) : (
          <>
            <Section>
              <Row label="Passcode lock" hint="Asks for a 4-digit code when the app opens" right={s.passcodeHash ? <Button variant="outline" size="sm" onClick={async () => { await setPasscode({}); toast.success("Passcode removed"); }}>Turn off</Button> : <Button size="sm" onClick={() => setStage("enter")}>Turn on</Button>} />
              {s.passcodeHash ? <Row label="Change passcode" onClick={() => setStage("enter")} /> : null}
              <Row label="Require again after" right={<Select value={s.lockAfter} onValueChange={(v) => update({ patch: { lockAfter: v as "always" | "5m" | "1h" } })}><SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="always">Every open</SelectItem><SelectItem value="5m">5 minutes</SelectItem><SelectItem value="1h">1 hour</SelectItem></SelectContent></Select>} />
            </Section>
            <p className="px-4 py-3 text-xs text-muted-foreground">The passcode is a screen lock on top of your sign-in. If you forget it, sign out and back in to reset it.</p>
          </>
        )}
      </Page>
    </>
  );
}
