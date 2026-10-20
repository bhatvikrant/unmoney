import { useEffect, useState, type CSSProperties } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Link } from "react-router";
import { ArrowLeftRight, CloudOff, Lock, RefreshCw } from "lucide-react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform, type Transition } from "framer-motion";
import { Logo } from "@/components/shell/Logo";
import { applyTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const points = [
  { icon: CloudOff, label: "Works offline" },
  { icon: RefreshCw, label: "Syncs everywhere" },
  { icon: Lock, label: "Passcode lock" },
];

/** One strong ease-out for every entrance, so the pieces settle together. */
const ease: Transition = { duration: 0.6, ease: [0.23, 1, 0.32, 1] };

export default function SignIn() {
  const { signIn } = useAuthActions();
  const [busy, setBusy] = useState(false);
  const still = useReducedMotion();
  const rise = (delay: number, y = 12) => ({
    initial: still ? false : { opacity: 0, y },
    animate: { opacity: 1, y: 0 },
    transition: { ...ease, delay },
  });

  // The saved theme loads with the ledger, which happens after sign-in, so follow the system here.
  useEffect(() => {
    applyTheme("system", "neutral", "A");
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => applyTheme("system", "neutral", "A");
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  async function google() {
    setBusy(true);
    try {
      await signIn("google");
    } catch {
      toast.error("Could not start Google sign-in. Try again in a moment.");
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      {/* a faint wash of the ledger's two colours, income blue and expense coral, behind the card */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh] opacity-70 dark:opacity-40"
        style={{
          background:
            "radial-gradient(42rem 22rem at 18% -10%, color-mix(in oklch, var(--income) 14%, transparent), transparent 70%), radial-gradient(38rem 20rem at 85% -5%, color-mix(in oklch, var(--expense) 12%, transparent), transparent 70%)",
        }}
      />

      <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-10">
        <motion.div {...rise(0, 8)} className="relative z-10 mb-[12rem]">
          <Logo size={34} />
        </motion.div>

        <div className="relative w-full max-w-sm">
          <LedgerPeek delay={0.35} />

          <motion.div {...rise(0.1)} className="relative rounded-2xl bg-card p-6 shadow-pop">
            <h1 className="text-lg font-semibold tracking-tight">Welcome to UnMoney</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in with Google to keep your ledger in step across your phone and desktop.
            </p>

            <motion.button
              type="button"
              disabled={busy}
              onClick={google}
              whileTap={still ? undefined : { scale: 0.98 }}
              className={cn(
                "mt-5 flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-background text-sm font-medium text-foreground shadow-card",
                "transition-[transform,background-color,box-shadow] duration-150 ease-out",
                "hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                "disabled:pointer-events-none disabled:opacity-60",
              )}
            >
              {busy ? (
                <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" aria-hidden="true" />
              ) : (
                <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
              )}
              {busy ? "Opening Google…" : "Continue with Google"}
            </motion.button>

            <ul className="mt-6 grid grid-cols-3 gap-2 border-t border-border pt-5">
              {points.map((p, i) => (
                <motion.li key={p.label} {...rise(0.3 + i * 0.07, 6)} className="flex flex-col items-center gap-1.5 text-center">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-foreground/80">
                    <p.icon className="size-4" strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <span className="text-[11px] leading-tight text-muted-foreground">{p.label}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </div>

        <motion.p {...rise(0.5, 6)} className="mt-5 max-w-xs text-center text-xs text-muted-foreground/80">
          Track income, expenses and transfers across every account. Your ledger stays on this device and syncs when you are online.
          If you like, connect Gmail and UnMoney turns the payment mails from your bank and shops into entries you check and save.
        </motion.p>
        <motion.p {...rise(0.55, 6)} className="mt-3 text-xs text-muted-foreground/80">
          <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy policy</Link>
        </motion.p>
      </div>
    </div>
  );
}

/** Sample entries that arrive one by one in the peek. Amounts in cents; "kind" picks the colour. */
type Kind = "income" | "expense" | "transfer";
const SAMPLE: { name: string; note: string; cents: number; kind: Kind; hue?: number; tile: string }[] = [
  { name: "Groceries", note: "Whole Foods · Checking", cents: 4280, kind: "expense", hue: 150, tile: "G" },
  { name: "Coffee", note: "Blue Bottle · Card", cents: 460, kind: "expense", hue: 60, tile: "C" },
  { name: "To Savings", note: "Checking → Savings", cents: 50000, kind: "transfer", tile: "⇄" },
  { name: "Lunch", note: "Sweetgreen · Card", cents: 1425, kind: "expense", hue: 30, tile: "L" },
  { name: "Refund", note: "Amazon · Card", cents: 3200, kind: "income", hue: 255, tile: "R" },
  { name: "Train", note: "Metro · Card", cents: 290, kind: "expense", hue: 300, tile: "T" },
];

const money = (cents: number, decimals = 2) =>
  "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** A number that rolls to its new value instead of jumping. */
function Ticker({ cents, decimals = 2, className }: { cents: number; decimals?: number; className?: string }) {
  const still = useReducedMotion();
  const mv = useMotionValue(cents);
  const text = useTransform(mv, (v) => money(v, decimals));
  useEffect(() => {
    if (still) { mv.set(cents); return; }
    const c = animate(mv, cents, { duration: 0.7, ease: [0.23, 1, 0.32, 1] });
    return () => c.stop();
  }, [cents, mv, still]);
  return <motion.span className={className}>{text}</motion.span>;
}

/** The top of a month in the ledger, rising from behind the sign-in card: a glimpse of the app rather than a list of features. */
function LedgerPeek({ delay }: { delay: number }) {
  const [today] = useState(() => {
    const d = new Date();
    return { month: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }), day: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }) };
  });
  const still = useReducedMotion();
  // the day's rows, newest first; each gets a fresh id so a repeated sample is still a new row
  const [rows, setRows] = useState(() => [{ id: 0, ...SAMPLE[0] }]);
  const [totals, setTotals] = useState({ income: 420000, expense: 131800, day: SAMPLE[0].cents });

  useEffect(() => {
    if (still) return;
    let next = 1;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t = SAMPLE[next % SAMPLE.length];
      const id = next++;
      // keep three rows: the visible one, the one sliding behind the card, and one more so the shift reads as a list
      setRows((r) => [{ id, ...t }, ...r].slice(0, 3));
      setTotals((o) => ({
        income: o.income + (t.kind === "income" ? t.cents : 0),
        expense: o.expense + (t.kind === "expense" ? t.cents : 0),
        day: o.day + (t.kind === "expense" ? t.cents : 0),
      }));
      timer = setTimeout(tick, 3200);
    };
    timer = setTimeout(tick, (delay + 1.8) * 1000);
    return () => clearTimeout(timer);
  }, [still, delay]);

  return (
    <motion.div
      aria-hidden="true"
      // rises out from behind the card once the card has landed
      initial={still ? false : { opacity: 0, y: 56 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1], delay }}
      // tall enough for the month header, the summary, the day and its newest row, with the next row slipping under the card
      className="pointer-events-none absolute bottom-[calc(100%-2.75rem)] left-1/2 h-[232px] w-full origin-bottom overflow-hidden rounded-t-2xl select-none"
      style={{
        x: "-50%",
        scale: 0.9,
        maskImage: "linear-gradient(to bottom, transparent 0, #000 72px)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 72px)",
      }}
    >
      <div className="rounded-t-2xl bg-card text-[13px] ring-1 ring-foreground/6 dark:ring-white/8">
        <div className="flex items-center justify-between border-b border-border px-3.5 pt-3 pb-2.5">
          <span className="text-sm font-semibold">{today.month}</span>
          <span className="text-xs text-muted-foreground/70">‹ ›</span>
        </div>
        <div className="tabular grid grid-cols-3 border-b border-border py-2.5 text-center">
          <div><div className="text-[11px] text-muted-foreground">Income</div><Ticker cents={totals.income} decimals={0} className="block font-medium text-income" /></div>
          <div><div className="text-[11px] text-muted-foreground">Expenses</div><Ticker cents={totals.expense} decimals={0} className="block font-medium text-expense" /></div>
          <div><div className="text-[11px] text-muted-foreground">Total</div><Ticker cents={totals.income - totals.expense} decimals={0} className="block font-medium" /></div>
        </div>
        <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1 text-xs">
          <span className="font-medium">{today.day}</span>
          <Ticker cents={totals.day} className="tabular text-expense" />
        </div>
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.div
              key={r.id}
              layout
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              transition={{ duration: 0.55, ease: [0.23, 1, 0.32, 1] }}
              className="overflow-hidden"
            >
              <motion.div
                // a soft highlight that settles, the way a just-saved entry does
                initial={{ backgroundColor: "color-mix(in oklch, var(--foreground) 6%, transparent)" }}
                animate={{ backgroundColor: "color-mix(in oklch, var(--foreground) 0%, transparent)" }}
                transition={{ duration: 1.6, delay: 0.3 }}
                className="flex items-center gap-2.5 px-3.5 py-1.5"
              >
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-lg text-xs font-semibold",
                    r.hue ? "bg-(--tile-bg) text-(--tile-fg) dark:bg-(--tile-bg-dark) dark:text-(--tile-fg-dark)" : "bg-muted text-muted-foreground",
                  )}
                  style={r.hue ? ({
                    "--tile-bg": `oklch(0.92 0.06 ${r.hue})`, "--tile-fg": `oklch(0.4 0.12 ${r.hue})`,
                    "--tile-bg-dark": `oklch(0.3 0.06 ${r.hue})`, "--tile-fg-dark": `oklch(0.85 0.1 ${r.hue})`,
                  } as CSSProperties) : undefined}
                >
                  {r.kind === "transfer" ? <ArrowLeftRight className="size-3.5" /> : r.tile}
                </span>
                <span className="min-w-0 flex-1"><span className="block font-medium">{r.name}</span><span className="block text-[11px] text-muted-foreground/70">{r.note}</span></span>
                <span className={cn("tabular font-medium", r.kind === "income" && "text-income", r.kind === "expense" && "text-expense", r.kind === "transfer" && "text-transfer")}>{money(r.cents)}</span>
              </motion.div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
