import { useOp } from "@/lib/store";
import { useState } from "react";
import { useApp } from "@/lib/app";
import { PageHeader, Page } from "@/components/shell/PageHeader";
import { Row, Section } from "@/components/shell/misc";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PinPad } from "@/pages/auth/Lock";
import { hashPin, newSalt, markUnlocked } from "@/lib/passcode";

/** Turning the lock off or changing it first asks for the current passcode. */
type Stage = null | { verify: "off" | "change" } | "enter" | "confirm";

export default function PasscodeSettings() {
  const { settings: s } = useApp();
  const setPasscode = useOp("settings.setPasscode");
  const update = useOp("settings.update");
  const [stage, setStage] = useState<Stage>(null);
  const [first, setFirst] = useState("");
  const [err, setErr] = useState(false);
  const [message, setMessage] = useState<string>();
  const fail = (text: string) => { setMessage(text); setErr(true); setTimeout(() => setErr(false), 400); };
  return (
    <>
      <PageHeader back="/settings" title="Passcode" />
      <Page className="pb-8">
        {stage ? (
          <div className="py-10">
            <PinPad title={typeof stage === "object" ? "Enter your current passcode" : stage === "enter" ? "Choose a 4-digit passcode" : "Enter it again"} error={err} message={message} onComplete={async (pin) => {
              setMessage(undefined);
              if (typeof stage === "object") {
                if ((await hashPin(pin, s.passcodeSalt ?? "")) !== s.passcodeHash) { fail("Wrong passcode. Try again."); return; }
                if (stage.verify === "change") { setStage("enter"); return; }
                await setPasscode({});
                setStage(null);
                return;
              }
              if (stage === "enter") { setFirst(pin); setStage("confirm"); return; }
              if (pin !== first) { fail("Those didn't match. Choose it again."); setStage("enter"); return; }
              const salt = newSalt();
              await setPasscode({ hash: await hashPin(pin, salt), salt });
              markUnlocked();
              setStage(null);
            }} />
            <div className="text-center mt-6"><Button variant="ghost" onClick={() => { setMessage(undefined); setStage(null); }}>Cancel</Button></div>
          </div>
        ) : (
          <>
            <Section>
              <Row label="Passcode lock" hint="Asks for a 4-digit code when the app opens" right={s.passcodeHash ? <Button variant="outline" size="sm" aria-label="Turn the passcode lock off" onClick={() => setStage({ verify: "off" })}>Turn off</Button> : <Button size="sm" aria-label="Turn the passcode lock on" onClick={() => setStage("enter")}>Turn on</Button>} />
              {s.passcodeHash ? <Row label="Change passcode" onClick={() => setStage({ verify: "change" })} /> : null}
              <Row label="Require again after" right={(id) => <Select value={s.lockAfter} onValueChange={(v) => update({ patch: { lockAfter: v as "always" | "5m" | "1h" } })}><SelectTrigger aria-labelledby={id} className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="always">Every open</SelectItem><SelectItem value="5m">5 minutes</SelectItem><SelectItem value="1h">1 hour</SelectItem></SelectContent></Select>} />
            </Section>
            <p className="px-4 py-3 text-xs text-muted-foreground">The passcode is a screen lock on top of your sign-in. It applies on every device you are signed in on. If you forget it, tap "Forgot it?" on the lock screen and sign in with Google again to remove it.</p>
          </>
        )}
      </Page>
    </>
  );
}
