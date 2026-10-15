import { NavLink, Outlet, useLocation } from "react-router";
import { BookOpen, ChartPie, Landmark, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { todayISO } from "../../../shared/dates";
import { useApp, useCatchUpRepeats } from "@/lib/app";
import { Avatar } from "./Avatar";
import { SyncDot, SyncLine } from "./SyncStatus";

const tabs = [
  { to: "/", icon: BookOpen, label: "Trans." },
  { to: "/stats", icon: ChartPie, label: "Stats" },
  { to: "/accounts", icon: Landmark, label: "Accounts" },
  { to: "/settings", icon: Settings, label: "More" },
];

function isActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/" || pathname.startsWith("/t/") || ["/search", "/bookmarks", "/notes"].includes(pathname);
  if (to === "/stats") return pathname.startsWith("/stats") || pathname.startsWith("/budget");
  return pathname.startsWith(to);
}

export default function AppShell() {
  useCatchUpRepeats();
  const { pathname } = useLocation();
  const { user } = useApp();
  const today = todayISO().slice(5).replace("-", "/");
  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r bg-sidebar px-3 py-5 gap-1 sticky top-0 h-dvh self-start">
        <div className="px-3 pb-4 text-lg font-semibold tracking-tight">unmoney</div>
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
          </NavLink>
        ))}
        <SyncLine className="mt-auto" />
        <NavLink to="/settings" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent/60">
          <Avatar seed={user?.email || user?.name || ""} src={user?.image} size={32} />
          <span className="min-w-0 truncate text-muted-foreground">{user?.name || user?.email || "Account"}</span>
        </NavLink>
      </aside>
      <main className="flex-1 min-w-0 pb-20 md:pb-0">
        <Outlet />
      </main>
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur safe-bottom">
        <div className="grid grid-cols-4">
          {tabs.map((t) => {
            const active = isActive(pathname, t.to);
            return (
              <NavLink key={t.to} to={t.to} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-primary" : "text-muted-foreground")}>
                <span className="relative"><t.icon className="size-5" strokeWidth={active ? 2.4 : 1.8} />{t.to === "/settings" ? <SyncDot /> : null}</span>
                <span>{t.to === "/" ? today : t.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
