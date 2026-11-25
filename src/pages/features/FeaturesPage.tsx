/**
 * /features — what each AI feature does, what it sends to Claude and what it never does. Public,
 * outside the sign-in gate like /privacy, and where every "How it works" link in the app lands
 * (AiHow in components/shell/misc.tsx): a section's id is its key in shared/aiCost.ts AI_FEATURES, so
 * a new feature without a section here does not compile. The claims match the privacy policy
 * (pages/legal/PrivacyPage.tsx) and the limits are the code's own constants: change it when they change.
 *
 * Each feature is one bento grid, laid out by the Stageshow skill's rules (github.com/benjitaylor/skills,
 * references/bento.md): one picture of the product, cropped by its tile, and the other tiles of other
 * kinds (steps, what is sent, a statement, one figure). The pictures are drawn with the app's own tokens.
 * Each tile plays once as it scrolls into view and then holds (references/motion.md), and plays again
 * for a mouse that comes to rest on it; with reduced motion it is the finished picture throughout.
 */
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useTransform, type Variants } from "framer-motion";
import { Calculator, Check, ChevronLeft, CircleCheck, EyeOff, FileLock, Mail, MailX, Smartphone, Sparkles, ToggleLeft, Users, WandSparkles, type LucideIcon } from "lucide-react";
import { RollingNumber } from "@/components/motion/RollingNumber";
import { Logo } from "@/components/shell/Logo";
import { Button } from "@/components/ui/button";
import { useGoBack } from "@/lib/nav";
import { applyTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { AI_FEATURES, type AiFeature } from "../../../shared/aiCost";
import { SPLIT_MONTHLY_CAP } from "../../../shared/billSplit";
import { AI_MAX_TEXT, AI_MONTHLY_CAP as GMAIL_MONTHLY_CAP } from "../../../shared/gmail/ai";
import { QUICK_MONTHLY_CAP } from "../../../shared/quickAi";
import { RECAP_MONTHLY_CAP } from "../../../shared/recapAi";
import { RECEIPT_MONTHLY_CAP } from "../../../shared/receiptAi";
import { SEARCH_MONTHLY_CAP } from "../../../shared/searchAi";
import { LAYOUT_ROWS, STATEMENT_MAX_LINES, STATEMENT_MAX_TEXT } from "../../../shared/statementAi";
import { AI_MIN_CATEGORIES, AI_MIN_ENTRIES, AI_MIN_HISTORY_DAYS, AI_RUN_EVERY_MS } from "../../../shared/tidyAi";

const num = (n: number) => n.toLocaleString("en-US");

type Feature = {
  /** The picture tile's copy: a bold lead and its continuation. */
  lead: string; rest: string;
  Picture: () => ReactNode;
  steps: [string, string, string];
  /** Everything that leaves for Anthropic, a chip each. */
  sent: string[];
  /** What it never does. */
  kept: { icon: LucideIcon; lead: string; rest: string };
  stat: { lead: string; value: string; label: string };
  /** Where it lives in the app, and any allowance the stat tile does not already give. */
  where: string; limit?: string;
};

/** In the order the page shows them. */
const FEATURES: Record<AiFeature, Feature> = {
  quick: {
    lead: "Type it like a text.", rest: "One sentence fills in the amount, category, payment method and date.",
    Picture: QuickPicture,
    steps: ["Type or dictate a sentence", "Tap Fill in", "Check the form, then save"],
    sent: ["The sentence", "Today's date", "Category names", "Payment method names", "Currency codes", "Your most-used notes"],
    kept: { icon: EyeOff, lead: "No entries, amounts or balances.", rest: "The answer only fills in the form. Nothing is saved until you save it." },
    stat: { lead: "Up to", value: num(QUICK_MONTHLY_CAP), label: "sentences a month" },
    where: "New entry, above the form",
  },
  receipt: {
    lead: "Snap the receipt.", rest: "A photo fills in the note, category and date for you to check.",
    Picture: ReceiptPicture,
    steps: ["Turn on Read photos with AI", "Attach a photo to an entry", "Check what it filled in"],
    sent: ["The photo, made smaller", "Category names", "Notes and descriptions you use most"],
    kept: { icon: ToggleLeft, lead: "Off until you turn it on.", rest: "Without it a photo is read on your device, and only for the amount." },
    stat: { lead: "Up to", value: num(RECEIPT_MONTHLY_CAP), label: "photos a month" },
    where: "More › Preferences › Read photos with AI",
  },
  split: {
    lead: "Split by who had what.", rest: "Claude reads the items off the bill. UnMoney works out each share.",
    Picture: SplitPicture,
    steps: ["Split an expense that has a photo", "Tap Read items from the photo", "Pick who had each item"],
    sent: ["The entry's first photo, made smaller", "Your currency's code"],
    kept: { icon: Users, lead: "Names stay with you.", rest: "The people you split with are never sent, and every sum is UnMoney's." },
    stat: { lead: "Up to", value: num(SPLIT_MONTHLY_CAP), label: "bills a month" },
    where: "Split, on an expense with a photo. Needs Read photos with AI turned on",
  },
  gmail: {
    lead: "Payment mail becomes drafts.", rest: "Mail from your bank and shops turns into entries you tick and save.",
    Picture: GmailPicture,
    steps: ["Rules read most payment mail", "Claude reads what no rule can", "You tick the drafts worth saving"],
    sent: ["Sender", "Subject", "Date received", `Up to ${num(AI_MAX_TEXT)} characters of text`, "Category names", "Payment method names", "Last four digits of cards"],
    kept: { icon: MailX, lead: "The mail is never stored.", rest: "Access is read-only, and nothing counts until you save a draft." },
    stat: { lead: "At most", value: num(AI_MAX_TEXT), label: "characters of a mail reach Claude" },
    where: "More › Gmail",
    limit: `${num(GMAIL_MONTHLY_CAP)} AI reads a month; mail the rules can read keeps coming past that.`,
  },
  statement: {
    lead: "Statements, named and filed.", rest: "Each new row gets a note and a category before you import it.",
    Picture: StatementPicture,
    steps: ["Choose a bank statement", "Tap Suggest", "Review, then confirm the import"],
    sent: ["Each new row's bank text", "Money in, out or a refund", "Category names", "Your most-used notes"],
    kept: { icon: FileLock, lead: "No amounts, dates or balances.", rest: "The file itself stays on your device." },
    stat: { lead: "At most", value: num(STATEMENT_MAX_TEXT), label: "characters of each row's bank text" },
    where: "More › Import, with a bank statement",
    limit: `Up to ${num(STATEMENT_MAX_LINES)} different descriptions a file. If the columns can't be told apart, Match the columns with AI sends the header row and the ${LAYOUT_ROWS} rows under it, amounts and dates included.`,
  },
  search: {
    lead: "Ask instead of filtering.", rest: "A question turns into the filters Search already has.",
    Picture: SearchPicture,
    steps: ["Type a question in Search", "Tap Ask AI", "The filters fill in, and your device searches"],
    sent: ["The question", "Today's date", "Your currency", "The days your month and week start", "Category names", "Payment method names", "Tag names"],
    kept: { icon: Smartphone, lead: "The search runs on your device.", rest: "Only filters come back. Typing without tapping Ask AI sends nothing." },
    stat: { lead: "Entries, amounts and notes sent", value: "0", label: "for any question" },
    where: "Search",
    limit: `${num(SEARCH_MONTHLY_CAP)} questions a month.`,
  },
  recap: {
    lead: "What stood out.", rest: "What marked a month or a year, as cards in its recap, and budgets to try.",
    Picture: RecapPicture,
    steps: ["Open a month's or year's recap", "Tap Get insights", "See the cards, try a budget"],
    sent: ["Totals spent and received", "The five months before, or two years", "Your ten largest categories", "Budgets, and whether they held", "Your five most-logged notes", "What stood out, with the notes and amounts of the few largest entries behind it"],
    kept: { icon: Calculator, lead: "The figures are UnMoney's own.", rest: "UnMoney finds what stands out and draws the charts; Claude picks and words it. No date, account or photo is sent." },
    stat: { lead: "Only your top", value: "10", label: "expense categories go out, by name and total" },
    where: "A month's or year's recap",
    limit: `${num(RECAP_MONTHLY_CAP)} runs a month. An answer is kept with the recap, so opening it again sends nothing. After your first Get insights on a device, a recap that has just finished gets its insights when you open it there; Preferences turns that off.`,
  },
  tidy: {
    lead: "Categories, tidied.", rest: "Look-alikes, vague names and categories that belong together.",
    Picture: TidyPicture,
    steps: ["Open Categories, then Tidy up", "Agree to send a summary", "Tick the changes you want"],
    sent: ["Category names", "How many entries each has", "Each one's total", "Their most common notes, if you allow it"],
    kept: { icon: CircleCheck, lead: "Nothing changes until you approve it.", rest: "No dates, payment methods, photos or single entries are sent." },
    stat: { lead: "Once every", value: `${AI_RUN_EVERY_MS / 86_400_000} days`, label: "and only when you ask" },
    where: "More › Categories › Tidy up",
    limit: `Unlocks at ${AI_MIN_CATEGORIES} categories, ${AI_MIN_ENTRIES} entries and ${AI_MIN_HISTORY_DAYS} days of history.`,
  },
};
const KEYS = Object.keys(FEATURES) as AiFeature[];

/**
 * Where each tile sits once there is room for three columns: the picture two wide and two tall with the
 * figure and the statement beside it, then what is sent and the steps. Every other grid is mirrored.
 */
const WIDE_AREAS = [
  { picture: "@min-[900px]:col-start-1", side: "@min-[900px]:col-start-3", steps: "@min-[900px]:col-start-2", sent: "@min-[900px]:col-start-1" },
  { picture: "@min-[900px]:col-start-2", side: "@min-[900px]:col-start-1", steps: "@min-[900px]:col-start-1", sent: "@min-[900px]:col-start-3" },
];

/** One frame for every tile: the radius, ground and padding the copy sits at. */
const TILE = "relative overflow-hidden rounded-[22px] bg-muted";
const COPY = "text-[17px] leading-6 tracking-[-0.012em] text-muted-foreground text-pretty [&_b]:font-semibold [&_b]:text-foreground";

export default function FeaturesPage() {
  const goBack = useGoBack();
  const { hash, key } = useLocation();
  // Signed out, nothing has applied a theme yet: follow the system, as the sign-in screen does.
  useEffect(() => {
    if (!document.documentElement.dataset.colorset) applyTheme("system", "neutral", "A");
  }, []);
  // A "How it works" link names its feature in the hash. After the app's own scroll-to-top for a new page.
  // `key` changes with every navigation, so a link to the section already in the address scrolls back to it.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash, key]);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-[1040px] items-center gap-2 px-4">
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => goBack("/")}>
            <ChevronLeft className="size-4" aria-hidden="true" />
            Back
          </Button>
          <Logo size={24} className="ml-auto" />
        </div>
      </header>

      <main className="mx-auto max-w-[1040px] px-4 pt-10 pb-20">
        <h1 className="max-w-xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">What the AI in UnMoney does, and what it sees</h1>
        <p className="mt-4 max-w-xl text-[17px] leading-7 text-muted-foreground text-pretty">
          UnMoney uses Anthropic's Claude in {KEYS.length} places. Each one is optional, sends only what is listed here, and
          cannot save or change an entry on its own: you check everything first.
        </p>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">AI is being turned on account by account, so you may not see these in the app yet.</p>

        <nav aria-label="AI features" className="mt-6 flex flex-wrap gap-2">
          {KEYS.map((k) => (
            <Link key={k} to={`#${k}`} className="rounded-full bg-muted px-3.5 py-1.5 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              {AI_FEATURES[k]}
            </Link>
          ))}
        </nav>

        {KEYS.map((k, i) => <FeatureGrid key={k} id={k} feature={FEATURES[k]} areas={WIDE_AREAS[i % 2]} />)}

        <p className="mt-16 text-sm text-muted-foreground">
          Anthropic does not train its models on what UnMoney sends. The full detail is in the{" "}
          <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">privacy policy</Link>.
        </p>
      </main>
    </div>
  );
}

// ---- Motion: a tile plays once, when most of it has scrolled into view, and then holds. Hovering it plays it again. ----

/** Whether the tile around this has started playing. */
const Playing = createContext(true);
/** For something arriving from nowhere: slow to settle, never a pop. */
const arrive = (delay: number, duration = 0.7) => ({ delay, duration, ease: [0.25, 0.8, 0.25, 1] as const });
/** Back to the start for a replay: what the story added leaves together, quickly, before it is told again. */
const RESET = { duration: 0.18 };
/** That, and a breath, before the replay starts. */
const RESET_MS = 260;
/** Longer than any tile's story: a hover does not restart one still being told. */
const STORY_MS = 3200;
// `custom` on each of these is how many seconds after its tile starts playing it moves.
/** Arrives whole from just above: a value, a chip, a row of results. */
const DROP: Variants = { before: { opacity: 0, y: -6, transition: RESET }, after: (t: number) => ({ opacity: 1, y: 0, transition: arrive(t) }) };
/** A row that opens its own space, carrying the rows under it down. */
const OPEN: Variants = { before: { opacity: 0, height: 0, transition: RESET }, after: (t: number) => ({ opacity: 1, height: "auto", transition: arrive(t) }) };
/** Paper sliding up into the picture: solid things move in, they do not fade through. */
const RISE: Variants = { before: { y: "75%", transition: RESET }, after: (t: number) => ({ y: 0, transition: arrive(t, 0.9) }) };
/** A button pressed: the small give that comes before its result. */
const PRESS: Variants = { before: { scale: 1 }, after: (t: number) => ({ scale: [1, 0.94, 1], transition: { delay: t, duration: 0.3 } }) };
/** A mark set where it already had its place: a tick, a figure, a step's number. */
const SET: Variants = { before: { opacity: 0, transition: RESET }, after: (t: number) => ({ opacity: 1, transition: { delay: t, duration: 0.3 } }) };
const DIM: Variants = { before: { opacity: 0.3, transition: RESET }, after: (t: number) => ({ opacity: 1, transition: { delay: t, duration: 0.3 } }) };
/** The calm tile's mark under the pointer. */
const NUDGE: Variants = { hover: { scale: 1.18, rotate: -6, transition: { type: "spring", stiffness: 420, damping: 14 } } };
/** A line drawn from its start. */
const DRAW: Variants = { before: { scaleX: 0, transition: RESET }, after: (t: number) => ({ scaleX: 1, transition: { delay: t, duration: 0.5, ease: [0.45, 0, 0.1, 1] as const } }) };

/** A tile of the grid: the one frame for all five, and the trigger for whatever moves inside it. */
function BentoTile({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const still = useReducedMotion();
  const seen = useInView(ref, { once: true, amount: 0.6 });
  // a replay: back to the start, then told again
  const [rewound, setRewound] = useState(false);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { if (seen) startedAt.current = performance.now(); }, [seen]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const play = !!still || (seen && !rewound);
  // A mouse only: a finger that lands on a tile is scrolling the page, not pointing at it.
  const replay = (e: PointerEvent) => {
    if (still || !seen || rewound || e.pointerType !== "mouse" || performance.now() - startedAt.current < STORY_MS) return;
    setRewound(true);
    timer.current = setTimeout(() => { startedAt.current = performance.now(); setRewound(false); }, RESET_MS);
  };
  return (
    <Playing.Provider value={play}>
      {/* with reduced motion there is no "before": every part starts where it ends */}
      <motion.div ref={ref} initial={still ? false : "before"} animate={play ? "after" : "before"} onPointerEnter={replay} className={cn(TILE, className)}>{children}</motion.div>
    </Playing.Provider>
  );
}

/** Text typed into a box once its tile plays. */
function Typed({ text, at }: { text: string; at: number }) {
  const play = useContext(Playing);
  const still = useReducedMotion();
  const n = useMotionValue(still ? text.length : 0);
  const shown = useTransform(n, (v) => text.slice(0, Math.round(v)));
  useEffect(() => {
    if (still) return;
    // typed in; or, for a replay, cleared
    const c = play ? animate(n, text.length, { delay: at, duration: text.length * 0.035, ease: "linear" }) : animate(n, 0, RESET);
    return () => c.stop();
  }, [play, still, n, text, at]);
  return <motion.span>{shown}</motion.span>;
}

/** The tile's one figure: rolls up from zero, digit by digit, and stays. */
function Figure({ value }: { value: string }) {
  const play = useContext(Playing);
  return <RollingNumber value={play ? value : value.replace(/[\d,]+/, "0")} />;
}

function FeatureGrid({ id, feature: f, areas }: { id: AiFeature; feature: Feature; areas: (typeof WIDE_AREAS)[number] }) {
  return (
    // scroll-mt: clear of the sticky header when a link lands here
    <section id={id} aria-labelledby={`${id}-title`} className="@container mt-16 scroll-mt-20">
      <h2 id={`${id}-title`} className="mb-4 text-2xl font-semibold tracking-tight">{AI_FEATURES[id]}</h2>
      <div className="grid grid-cols-1 gap-3.5 @min-[600px]:grid-cols-2 @min-[900px]:grid-cols-3 @min-[900px]:grid-rows-[minmax(183px,auto)_minmax(183px,auto)_auto]">
        <BentoTile className={cn("flex h-[400px] flex-col @min-[600px]:col-span-2 @min-[600px]:h-[380px] @min-[900px]:row-span-2 @min-[900px]:row-start-1 @min-[900px]:h-auto", areas.picture)}>
          <p className={cn(COPY, "max-w-[460px] px-6 pt-6 @min-[600px]:px-7")}><b>{f.lead}</b> {f.rest}</p>
          {/* the picture: its left edge on the copy's gutter, run off the tile's foot. Out of the flow, so the tile's height is the grid's, not the picture's; the padding leaves room for its shadow. */}
          <div aria-hidden="true" className="pointer-events-none relative mt-4 min-h-0 flex-1 select-none">
            <div className="absolute inset-0 overflow-hidden px-6 pt-2 @min-[600px]:px-7"><f.Picture /></div>
          </div>
        </BentoTile>

        <BentoTile className={cn("@container p-6 @min-[600px]:p-7 @min-[900px]:col-span-2 @min-[900px]:row-start-3", areas.steps)}>
          <p className={COPY}><b>How it works.</b></p>
          <ol className="mt-5 grid gap-4 @min-[460px]:grid-cols-3 @min-[460px]:gap-6">
            {f.steps.map((s, n) => (
              <li key={s} className="flex items-center gap-3 @min-[460px]:block">
                <span className="flex items-center gap-3">
                  {/* the numbers light up in turn; the words are there to read from the start */}
                  <motion.span variants={DIM} custom={0.2 + n * 0.35} className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground text-[13px] font-semibold text-background tabular">{n + 1}</motion.span>
                  {/* the line to the next step, where they sit in a row */}
                  {n < 2 ? <motion.span variants={DRAW} custom={0.3 + n * 0.35} className="hidden h-px flex-1 origin-left bg-foreground/15 @min-[460px]:block" /> : null}
                </span>
                <span className="block text-[15px] leading-snug font-medium text-pretty @min-[460px]:mt-3 @min-[460px]:pr-3">{s}</span>
              </li>
            ))}
          </ol>
        </BentoTile>

        <BentoTile className={cn("p-6 @min-[600px]:p-7 @min-[900px]:row-start-3", areas.sent)}>
          <p className={COPY}><b>What goes to Claude.</b></p>
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {f.sent.map((s, i) => <motion.li key={s} variants={DROP} custom={0.15 + i * 0.06} className="rounded-full bg-background px-3 py-1 text-[13px] leading-5 font-medium">{s}</motion.li>)}
          </ul>
        </BentoTile>

        {/* the calm one: nothing moves as it scrolls in. Under the pointer its mark alone answers: it tips up, and settles back when the pointer leaves. */}
        <motion.div whileHover="hover" className={cn(TILE, "p-6 @min-[600px]:p-7 @min-[900px]:row-start-2", areas.side)}>
          <motion.span variants={NUDGE} className="block size-5 origin-bottom-left motion-reduce:transform-none!"><f.kept.icon className="size-5" strokeWidth={1.8} aria-hidden="true" /></motion.span>
          <p className={cn(COPY, "mt-2.5")}><b>{f.kept.lead}</b> {f.kept.rest}</p>
        </motion.div>

        <BentoTile className={cn("p-6 @min-[600px]:p-7 @min-[900px]:row-start-1", areas.side)}>
          <p className={COPY}>{f.stat.lead}</p>
          <p className="mt-1 text-[56px] leading-none font-semibold tracking-tight whitespace-nowrap"><Figure value={f.stat.value} /></p>
          <p className={cn(COPY, "mt-2")}>{f.stat.label}</p>
        </BentoTile>
      </div>
      <p className="mt-3 text-[13px] leading-5 text-muted-foreground">In the app: {f.where}.{f.limit ? ` ${f.limit}` : ""}</p>
    </section>
  );
}

// ---- The pictures: one piece of the real screen each, at its real size, cut off by the tile's foot. ----
// Each opens on the screen as it is before the feature runs, and `at` is when a part of the result arrives.

/** The surface a picture sits on: a card of the app, its foot past the tile's. */
function Shot({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("h-full overflow-hidden rounded-t-2xl bg-card text-[13px] leading-5 text-foreground shadow-pop", className)}>{children}</div>;
}

/** A line of filler: what the story is not about. */
function Bar({ w, className }: { w: number | string; className?: string }) {
  return <span className={cn("block h-1.5 rounded-full bg-foreground/10", className)} style={{ width: w }} />;
}

/** A row of the entry form; its value arrives `at`. With no label it is filler. */
function Field({ label, at, children }: { label?: string; at?: number; children?: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center gap-3 border-t border-border px-3.5 py-2.5 @max-[420px]:gap-2.5">
      <span className="w-[4.5rem] shrink-0 text-muted-foreground @max-[420px]:w-[3.75rem]">{label ?? <Bar w={40} />}</span>
      <motion.span variants={at === undefined ? undefined : DROP} custom={at} className="min-w-0 flex-1 truncate font-medium">{children ?? <Bar w="45%" />}</motion.span>
    </div>
  );
}

const Box = ({ children }: { children: ReactNode }) => <span className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-border bg-background px-2.5"><span className="truncate">{children}</span></span>;
/** A button, pressed `at`. */
const Btn = ({ children, className, at }: { children: ReactNode; className?: string; at?: number }) => (
  <motion.span variants={at === undefined ? undefined : PRESS} custom={at} className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 font-medium", className)}>{children}</motion.span>
);
/** A checkbox, ticked `at`. */
const Tick = ({ at }: { at?: number }) => (
  <span className="relative mt-0.5 size-4 shrink-0 rounded-[4px] border border-foreground/25">
    {at === undefined ? null : <motion.span variants={SET} custom={at} className="absolute -inset-px grid place-items-center rounded-[4px] bg-primary text-primary-foreground"><Check className="size-3" strokeWidth={3} /></motion.span>}
  </span>
);

/** A category's tile in the ledger, in its own colour, as on the sign-in screen. */
function Tile({ hue, children }: { hue: number; children: ReactNode }) {
  return (
    <span
      className="grid size-7 shrink-0 place-items-center rounded-lg bg-(--tile-bg) text-xs font-semibold text-(--tile-fg) dark:bg-(--tile-bg-dark) dark:text-(--tile-fg-dark)"
      style={{ "--tile-bg": `oklch(0.92 0.06 ${hue})`, "--tile-fg": `oklch(0.4 0.12 ${hue})`, "--tile-bg-dark": `oklch(0.3 0.06 ${hue})`, "--tile-fg-dark": `oklch(0.85 0.1 ${hue})` } as CSSProperties}
    >
      {children}
    </span>
  );
}

const YESTERDAY = new Date(Date.now() - 86_400_000).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** The sentence is typed, Fill in is pressed, and the form fills in from the top. */
function QuickPicture() {
  return (
    <Shot>
      <div className="flex gap-2 p-3.5">
        {/* on a phone the box is too narrow for the whole sentence: one word shorter, never cut */}
        <Box>
          <span className="@max-[420px]:hidden"><Typed text="450 swiggy dinner hdfc yesterday" at={0.3} /></span>
          <span className="@min-[421px]:hidden"><Typed text="450 swiggy hdfc yesterday" at={0.3} /></span>
        </Box>
        <Btn at={1.5}>Fill in</Btn>
      </div>
      <Field label="Date" at={1.75}>{YESTERDAY}</Field>
      <Field label="Method" at={1.81}>HDFC Card</Field>
      <Field label="Category" at={1.87}>Food</Field>
      <Field label="Amount" at={1.93}><span className="tabular text-expense">₹450.00</span></Field>
      <Field />
      <Field />
    </Shot>
  );
}

/** The receipt slides in beside the form, and the form fills in from it. */
function ReceiptPicture() {
  return (
    <div className="grid h-full grid-cols-[104px_minmax(0,1fr)] items-stretch gap-2.5 @min-[600px]:grid-cols-[150px_minmax(0,1fr)] @min-[600px]:gap-5">
      {/* the receipt stays paper, white in the dark theme too */}
      <motion.div variants={RISE} custom={0.2} className="mt-6 rounded-t-md bg-white px-2.5 pt-3.5 font-mono text-[11px] leading-4 text-neutral-800 shadow-card @min-[600px]:px-3">
        <div className="text-center font-semibold tracking-wide">BLUE TOKAI</div>
        <Bar w="60%" className="mx-auto mt-2 bg-neutral-200" />
        <div className="mt-3.5 flex justify-between"><span>Latte</span><span>220</span></div>
        <div className="mt-1 flex justify-between"><span>Cookie</span><span>120</span></div>
        <div className="mt-2.5 flex justify-between border-t border-dashed border-neutral-300 pt-2.5 font-semibold"><span>TOTAL</span><span>340</span></div>
        <Bar w="80%" className="mt-4 bg-neutral-200" />
        <Bar w="55%" className="mt-2 bg-neutral-200" />
        <Bar w="70%" className="mt-2 bg-neutral-200" />
      </motion.div>
      <Shot className="[&>div:first-child]:border-t-0">
        <Field label="Note" at={1.1}>Blue Tokai</Field>
        <Field label="Category" at={1.16}>Coffee</Field>
        <Field label="Date" at={1.22}>{YESTERDAY}</Field>
        <Field label="Amount" at={1.28}><span className="tabular text-expense">₹340.00</span></Field>
        <Field />
        <Field />
        <Field />
      </Shot>
    </div>
  );
}

/** Three people, each their own colour everywhere; `had` is who is on a line. */
const PEOPLE = [{ name: "Asha", hue: 255 }, { name: "Ravi", hue: 150 }, { name: "Kabir", hue: 30 }];
/** The bill is read; the people go onto its lines one line at a time, and then the shares arrive. */
function SplitPicture() {
  const items: [string, string, number[]][] = [["Margherita", "520.00", [0, 1]], ["Arrabbiata", "460.00", [1]], ["Iced tea × 2", "240.00", [0, 2]], ["Garlic bread", "180.00", [0, 1, 2]]];
  return (
    <Shot>
      {items.map(([name, amount, had], row) => (
        <div key={name} className="flex items-center gap-2.5 border-t border-border px-3.5 py-2 first:border-t-0">
          <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
          <span className="flex gap-1">
            {PEOPLE.map((p, i) => (
              // the dashed place is there from the start and only the person arrives in it
              <span key={p.name} className="relative size-7 rounded-lg border border-dashed border-foreground/15">
                {had.includes(i) ? <motion.span variants={DROP} custom={0.3 + row * 0.16 + i * 0.05} className="absolute -inset-px flex"><Tile hue={p.hue}>{p.name[0]}</Tile></motion.span> : null}
              </span>
            ))}
          </span>
          <span className="w-14 text-right tabular">{amount}</span>
        </div>
      ))}
      <div className="border-t border-border px-3.5 py-2 text-xs text-muted-foreground">GST 70.00, spread over the items in proportion</div>
      {/* with the tax: 546 + 483 + 252 + 189, each shared equally by the people on it */}
      <div className="grid grid-cols-3 border-t border-border px-3.5 py-3">
        {[["Asha", "₹462.00"], ["Ravi", "₹819.00"], ["Kabir", "₹189.00"]].map(([name, share], i) => (
          <motion.span key={name} variants={DROP} custom={1.25 + i * 0.07}><span className="block text-xs text-muted-foreground">{name}</span><span className="block font-semibold tabular">{share}</span></motion.span>
        ))}
      </div>
    </Shot>
  );
}

/** The mail is there; its draft opens under it, pushing the others down, and is ticked. */
function GmailPicture() {
  return (
    <Shot>
      <div className="flex items-start gap-3 bg-foreground/[0.04] px-3.5 py-3">
        <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
        <span className="min-w-0">
          <span className="block font-medium">ICICI Bank</span>
          <span className="block text-muted-foreground">INR 1,249.00 spent on your card ending 4821 at AMAZON</span>
        </span>
      </div>
      <motion.div variants={OPEN} custom={0.5} className="overflow-hidden">
        <div className="flex items-start gap-3 border-t border-border px-3.5 py-3">
          <Tick at={1.4} />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Amazon</span>
            <span className="block text-xs text-muted-foreground">Shopping · ICICI Card ·· 4821</span>
          </span>
          <span className="font-medium tabular text-expense">₹1,249.00</span>
        </div>
      </motion.div>
      {[["42%", 52], ["30%", 44], ["36%", 48], ["46%", 40], ["34%", 50]].map(([w, a]) => (
        <div key={w} className="flex items-start gap-3 border-t border-border px-3.5 py-3.5">
          <Tick />
          <span className="flex-1 space-y-2 pt-1"><Bar w={w} /><Bar w="26%" /></span>
          <Bar w={a} className="mt-1" />
        </div>
      ))}
    </Shot>
  );
}

/** The bank's own text is there; a note and a category arrive under each row in turn. */
function StatementPicture() {
  const rows = [["UPI/429817/ZOMATO/okaxis", "Zomato", "Eating out"], ["POS 4821 DECATHLON SPORTS IN", "Decathlon", "Sports"], ["ACH D- NETFLIX COM", "Netflix", "Subscriptions"]];
  return (
    <Shot>
      {rows.map(([bank, note, category], i) => (
        <div key={bank} className="border-t border-border px-3.5 py-2.5 first:border-t-0">
          <span className="block truncate font-mono text-[11px] text-muted-foreground">{bank}</span>
          <motion.span variants={DROP} custom={0.4 + i * 0.3} className="mt-1 flex items-center gap-2">
            <span className="font-medium">{note}</span>
            <span className="rounded-full bg-muted px-2 text-xs leading-5">{category}</span>
          </motion.span>
        </div>
      ))}
      {[["52%", "24%"], ["40%", "30%"], ["46%", "20%"]].map(([a, b]) => <div key={a} className="space-y-2.5 border-t border-border px-3.5 py-3.5"><Bar w={a} /><Bar w={b} /></div>)}
    </Shot>
  );
}

/** The question is typed, Ask AI is pressed, the filters arrive and then what they find. */
function SearchPicture() {
  const rows: [string, number, string, string, string][] = [["T", 30, "Toit", "Eating out · HDFC Card", "₹1,180.00"], ["N", 150, "Nature's Basket", "Groceries · UPI", "₹960.00"]];
  return (
    <Shot>
      <div className="flex gap-2 p-3.5 pb-2.5">
        <Box><Typed text="food over 500 last month" at={0.3} /></Box>
        {/* the app's own Ask AI button */}
        <Btn at={1.25}><Sparkles className="size-4" />Ask AI</Btn>
      </div>
      {/* the filters and what they find open their own room: until then the list sits right under the box */}
      <motion.div variants={OPEN} custom={1.45} className="overflow-hidden">
        <div className="flex flex-wrap gap-1.5 px-3.5 pb-3">
          {["Food", "Over ₹500", "Last month"].map((c, i) => <motion.span key={c} variants={DROP} custom={1.55 + i * 0.06} className="rounded-full border border-primary bg-primary/10 px-2.5 text-xs leading-6">{c}</motion.span>)}
        </div>
      </motion.div>
      {rows.map(([letter, hue, name, note, amount], i) => (
        <motion.div key={name} variants={OPEN} custom={1.9 + i * 0.1} className="overflow-hidden">
          <div className="flex items-center gap-2.5 border-t border-border px-3.5 py-2">
            <Tile hue={hue}>{letter}</Tile>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{name}</span><span className="block truncate text-[11px] leading-4 text-muted-foreground">{note}</span></span>
            <span className="font-medium tabular text-expense">{amount}</span>
          </div>
        </motion.div>
      ))}
      {[["34%", 48], ["26%", 40], ["38%", 52]].map(([w, a]) => (
        <div key={w} className="flex items-center gap-2.5 border-t border-border px-3.5 py-3">
          <span className="size-7 shrink-0 rounded-lg bg-foreground/10" />
          <span className="flex-1 space-y-2"><Bar w={w} /><Bar w="22%" /></span>
          <Bar w={a} />
        </div>
      ))}
    </Shot>
  );
}

/** Claude's sentence arrives with the places for its figures marked; UnMoney's figures are set into them; then the budget. */
function RecapPicture() {
  const fig = "rounded bg-foreground/[0.07] px-0.5 font-medium tabular";
  return (
    <Shot className="space-y-3 p-3.5">
      <motion.div variants={DROP} custom={0.3} className="rounded-lg border border-border px-3 py-2.5 leading-[1.55]">
        Eating out came to <span className={fig}><motion.span variants={SET} custom={1.1}>₹8,240</motion.span></span>, up from{" "}
        <span className={fig}><motion.span variants={SET} custom={1.3}>₹5,100</motion.span></span> the month before.
      </motion.div>
      <div className="space-y-2.5 rounded-lg border border-border px-3 py-3.5"><Bar w="88%" /><Bar w="54%" /></div>
      <div className="pt-0.5 text-xs font-medium text-muted-foreground">Suggested budgets</div>
      <div className="rounded-lg border border-border">
        <motion.div variants={DROP} custom={1.7} className="flex items-center gap-3 px-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Eating out · ₹7,000</span>
            <span className="block text-xs text-muted-foreground">Now ₹9,000</span>
          </span>
          <Btn className="h-8 text-xs">Set</Btn>
        </motion.div>
        {[["46%", "28%"], ["38%", "24%"]].map(([a, b]) => (
          <div key={a} className="flex items-center gap-3 border-t border-border px-3 py-4">
            <span className="flex-1 space-y-2"><Bar w={a} /><Bar w={b} /></span>
            <Bar w={40} />
          </div>
        ))}
      </div>
    </Shot>
  );
}

/** The suggestions are there; which one to keep is picked, and the two are ticked. */
function TidyPicture() {
  const chip = "rounded-full border border-border px-2.5 text-xs leading-6 text-muted-foreground";
  return (
    <Shot>
      <div className="flex gap-3 px-3.5 py-3">
        <Tick at={1.1} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="font-medium">Cab → Taxi</div>
          <div className="text-xs text-muted-foreground">Both hold rides, under the same notes.</div>
          {/* the app's own mark for a suggestion that came from Claude */}
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><WandSparkles className="size-3" />Suggested by AI</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Keep</span>
            <span className={chip}>Cab</span>
            {/* the chosen one: its selected look is set over the plain chip, which keeps its size */}
            <span className={cn(chip, "relative")}>Taxi<motion.span variants={SET} custom={0.6} className="absolute -inset-px grid place-items-center rounded-full border border-primary bg-primary/10 text-foreground">Taxi</motion.span></span>
            <span className={chip}>New name</span>
          </div>
        </div>
      </div>
      <div className="flex gap-3 border-t border-border px-3.5 py-3">
        <Tick at={1.35} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="font-medium">Petrol → under Transport</div>
          <div className="text-xs text-muted-foreground">Most of its notes are already under Transport.</div>
        </div>
      </div>
      {[["38%", "52%"], ["30%", "44%"], ["42%", "36%"]].map(([a, b]) => (
        <div key={a} className="flex gap-3 border-t border-border px-3.5 py-3.5">
          <Tick />
          <div className="flex-1 space-y-2 pt-1"><Bar w={a} /><Bar w={b} /></div>
        </div>
      ))}
    </Shot>
  );
}
