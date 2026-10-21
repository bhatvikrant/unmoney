import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useCallback, useMemo } from "react";
import { ChartPie, ReceiptText, Settings, WalletCards } from "lucide-react";
import { cn } from "@/lib/utils";
import { MONTH_SHORT, parts, todayISO } from "../../../shared/dates";
import { useAdoptAccountKinds, useApp, useAutoRefreshRates, useCatchUpRepeats } from "@/lib/app";
import { Avatar } from "./Avatar";
import { SyncDot, SyncLine } from "./SyncStatus";
import { useIosInstallHint } from "@/lib/pwa";
import { MoneyManagerPrompt, usePendingImportToasts } from "@/components/MoneyManagerPrompt";
import { useGmailCheckOnFocus } from "@/pages/transactions/GmailNudge";
import { useView } from "@/lib/store";

const tabs = [
  { to: "/", icon: ReceiptText, label: "Trans." },
  { to: "/stats", icon: ChartPie, label: "Stats" },
  { to: "/payment-methods", icon: WalletCards, label: "Payment methods" },
  { to: "/settings", icon: Settings, label: "More" },
];

function isActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/" || pathname.startsWith("/t/") || ["/search", "/bookmarks", "/notes"].some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (to === "/stats") return pathname.startsWith("/stats") || pathname.startsWith("/budget");
  return pathname.startsWith(to);
}

/** How many Gmail drafts wait, on the More tab. */
function ReviewCount({ n }: { n: number }) {
  return <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-medium text-primary-foreground tabular" aria-label={`${n} from Gmail to review`}>{n > 99 ? "99+" : n}</span>;
}

export default function AppShell() {
  useCatchUpRepeats();
  useAdoptAccountKinds();
  useAutoRefreshRates();
  const nav = useNavigate();
  useIosInstallHint(useCallback(() => nav("/settings"), [nav]));
  usePendingImportToasts();
  useGmailCheckOnFocus();
  // drafts from Gmail waiting to be reviewed: a count on More, where the way to them is
  const drafts = useView().drafts;
  const toReview = useMemo(() => drafts.filter((d) => d.status === "open").length, [drafts]);
  const { pathname } = useLocation();
  const { user } = useApp();
  const { d, m } = parts(todayISO());
  const today = `${d} ${MONTH_SHORT[m - 1]}`;
  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r bg-sidebar px-3 py-5 gap-1 sticky top-0 h-dvh self-start">
        <div className="px-3 pb-4 text-lg font-semibold tracking-tight">UnMoney</div>
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              isActive(pathname, t.to) ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "text-muted-foreground hover:bg-sidebar-accent/60",
            )}
          >
            <t.icon className="size-4" />
            {t.to === "/" ? "Transactions" : t.label}
            {t.to === "/settings" && toReview ? <span className="ml-auto text-xs tabular text-muted-foreground" aria-label={`${toReview} from Gmail to review`}>{toReview}</span> : null}
          </NavLink>
        ))}
        <SyncLine className="mt-auto" />
        <NavLink to="/settings" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent/60">
          <Avatar seed={user?.email || user?.name || ""} src={user?.image} size={32} />
          <span className="min-w-0 truncate text-muted-foreground">{user?.name || user?.email || "Account"}</span>
        </NavLink>
      </aside>
      <main className="flex-1 min-w-0 pb-[calc(var(--tabbar-h)+1.5rem)] md:pb-0">
        <Outlet />
        <MoneyManagerPrompt />
      </main>
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur safe-bottom">
        <div className="grid h-14 grid-cols-4">
          {tabs.map((t) => {
            const active = isActive(pathname, t.to);
            return (
              <NavLink key={t.to} to={t.to} className={cn("flex flex-col items-center justify-center gap-0.5 text-[11px]", active ? "text-primary" : "text-muted-foreground")}>
                <span className="relative"><t.icon className="size-5" strokeWidth={active ? 2.4 : 1.8} />{t.to === "/settings" ? (toReview ? <ReviewCount n={toReview} /> : <SyncDot />) : null}</span>
                <span>{t.to === "/" ? today : t.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
