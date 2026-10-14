"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { ChevronDown, ChevronRight, Home, LayoutGrid, LifeBuoy, LogOut, Settings, Store } from "lucide-react";
import { Suspense } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BUSINESS_APPS, PLATFORM_APPS, type AppDef } from "@/lib/apps";
import { useSession } from "@/lib/session";
import { canOpenApp } from "@/convex/shared/modules";
import type { Feature } from "@/convex/shared/presets";
import { BrandMark } from "@/components/brand";
import { AnnouncementBanner } from "@/components/announcement-banner";
import { clearOnLogout } from "@/lib/outbox";

export { BrandMark };

// Sub-menu tabs per app. Pages read `?view=`.
export const APP_TABS: Record<string, { label: string; view: string; feature?: Feature }[]> = {
  inventory: [
    { label: "Products", view: "all" }, { label: "Categories", view: "categories" }, { label: "Stock moves", view: "moves" },
    { label: "Stocktake", view: "stocktake" }, { label: "Low stock", view: "low" }, { label: "Valuation", view: "valuation" },
    { label: "Serials", view: "serials", feature: "serials" },
  ],
  purchases: [{ label: "Receive stock", view: "receive" }, { label: "Purchases", view: "history" }, { label: "Suppliers", view: "suppliers" }],
  customers: [{ label: "All customers", view: "all" }, { label: "With debt", view: "debt" }],
  expiry: [{ label: "Expired", view: "expired" }, { label: "1 month", view: "1m" }, { label: "3 months", view: "3m" }],
  support: [{ label: "All", view: "all" }, { label: "Open", view: "open" }, { label: "Closed", view: "closed" }],
};
export const DEFAULT_VIEW: Record<string, string> = { inventory: "all", purchases: "receive", customers: "all", expiry: "expired", support: "all" };

export function useView(app: string) {
  const v = useSearchParams().get("view");
  const path = usePathname();
  if (app === "purchases" && path.includes("/suppliers/")) return "suppliers"; // supplier detail belongs under Suppliers
  return v ?? DEFAULT_VIEW[app];
}

function UserMenu({ name, sub, business, canSettings }: { name: string; sub: string; business?: string; canSettings: boolean }) {
  const { signOut } = useAuthActions();
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-1.5" aria-label="Account menu">
          <Avatar className="size-8"><AvatarFallback className="bg-brand-100 text-xs font-semibold text-brand-800">{name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
          <span className="hidden max-w-32 truncate text-sm font-medium md:inline">{name}</span>
          <ChevronDown className="hidden size-3.5 text-muted-foreground md:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="font-semibold">{name}</div>
          <div className="text-xs capitalize text-muted-foreground">{sub.toLowerCase()}{business && ` · ${business}`}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {canSettings && <DropdownMenuItem asChild><Link href="/apps/settings"><Settings /> Settings</Link></DropdownMenuItem>}
        {canSettings && <DropdownMenuItem asChild><Link href="/apps/support"><LifeBuoy /> Help & support</Link></DropdownMenuItem>}
        {canSettings && <DropdownMenuSeparator />}
        <DropdownMenuItem variant="destructive" onClick={() => signOut().then(clearOnLogout).then(() => router.replace("/login"))}><LogOut /> Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TabLinks({ appKey, base, className, itemClass }: { appKey: string; base: string; className?: string; itemClass?: string }) {
  const me = useSession();
  const feats = me?.kind === "business" ? me.business.features : [];
  const tabs = APP_TABS[appKey]?.filter((t) => !t.feature || feats.includes(t.feature));
  const view = useView(appKey);
  if (!tabs) return null;
  return (
    <nav aria-label="Sections" className={className}>
      {tabs.map((t) => (
        <Link key={t.view} href={`${base}?view=${t.view}`} aria-current={view === t.view ? "page" : undefined}
          className={cn("inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-medium transition-colors",
            view === t.view ? "bg-brand-50 text-brand-800" : "text-muted-foreground hover:bg-muted hover:text-foreground", itemClass)}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** App switcher: every module the user may open, as a tile grid. */
function ModuleMenu({ apps, current, home }: { apps: AppDef[]; current?: AppDef; home: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-2" aria-label="Switch app">
          <LayoutGrid className="size-[18px] text-muted-foreground" />
          {current && (
            <>
              <span className={cn("grid size-6 place-items-center rounded-md", current.tile)}><current.icon className="size-3.5" /></span>
              <span className="text-sm font-semibold">{current.name}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(22rem,calc(100vw-1.5rem))] p-2">
        <div className="grid grid-cols-3 gap-1">
          {apps.map((a) => (
            <DropdownMenuItem key={a.key} asChild className="h-auto flex-col gap-1.5 rounded-lg px-1 py-2.5 text-center">
              <Link href={a.href} aria-current={current?.key === a.key ? "page" : undefined}>
                <span className={cn("grid size-10 place-items-center rounded-xl", a.tile, current?.key === a.key && "ring-2 ring-brand-600 ring-offset-1")}><a.icon className="size-5" /></span>
                <span className="text-xs font-medium leading-tight">{a.name}</span>
              </Link>
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href={home}><Home /> All apps</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Breadcrumbs({ home, current, pathname }: { home: string; current: AppDef; pathname: string }) {
  const rest = pathname.slice(current.href.length).split("/").filter(Boolean);
  if (rest.length === 0) return null; // top-level app page: the title says where you are
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-sm text-muted-foreground">
      <Link href={home} className="hover:text-foreground">Apps</Link><ChevronRight className="size-3.5" />
      <Link href={current.href} className="hover:text-foreground">{current.name}</Link><ChevronRight className="size-3.5" />
      <span className="font-medium text-foreground">Details</span>
    </nav>
  );
}

/** Top bar + content frame for /apps/* and /platform/*. */
export function AppShell({ side, children }: { side: "business" | "platform"; children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useSession();
  const home = side === "business" ? "/apps" : "/platform";
  const all: AppDef[] = side === "business" ? BUSINESS_APPS : PLATFORM_APPS;
  const current = all.find((a) => pathname === a.href || pathname.startsWith(a.href + "/"));

  let brandName = "Xisaabi Platform";
  let logo: string | null = null;
  let userName = "";
  let userSub = "";
  let apps = all;
  let isOwner = false;
  if (me?.kind === "business") {
    brandName = me.business.name; logo = me.logoUrl; userName = me.member.fullName; userSub = me.member.role; isOwner = me.member.role === "OWNER";
    const m = me;
    apps = BUSINESS_APPS.filter((a) => canOpenApp(m.member.role as never, m.plan.modules, a.key) && (!m.lockReason || ["billing", "support", "settings"].includes(a.key)));
  } else if (me?.kind === "platform") {
    userName = me.member.fullName; userSub = me.member.role.replace("_", " ");
    apps = PLATFORM_APPS.filter((a) => !a.superOnly || me.member.role === "SUPER_ADMIN");
  }
  const Brand = (
    <span className="flex min-w-0 items-center gap-2.5">
      {logo ? <Avatar className="size-8 rounded-lg"><AvatarImage src={logo} alt="" /><AvatarFallback><Store className="size-4" /></AvatarFallback></Avatar> : <BrandMark />}
      <span className="max-w-40 truncate font-display text-[15px] font-semibold tracking-tight sm:max-w-64">{brandName}</span>
    </span>
  );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-1.5 px-3 sm:px-6">
          {!current ? (
            <Link href={home} className="min-w-0 flex-1" aria-label="Home">{Brand}</Link>
          ) : (
            <>
              <ModuleMenu apps={apps} current={current} home={home} />
              <Suspense><TabLinks appKey={current.key} base={current.href} className="ml-2 hidden items-center gap-1 md:flex" /></Suspense>
              <div className="flex-1" />
              <Link href={home} className="hidden min-w-0 lg:block">{Brand}</Link>
            </>
          )}
          <UserMenu name={userName || "..."} sub={userSub} business={side === "business" ? brandName : undefined} canSettings={isOwner} />
        </div>
        {current && APP_TABS[current.key] && (
          <Suspense>
            <TabLinks appKey={current.key} base={current.href} className="flex gap-1 overflow-x-auto border-t px-3 py-1.5 md:hidden" />
          </Suspense>
        )}
        {side === "platform" && current && (
          <nav aria-label="Platform" className="flex gap-1 overflow-x-auto border-t px-3 py-1.5 sm:px-6">
            {apps.map((a) => (
              <Link key={a.key} href={a.href} aria-current={current.key === a.key ? "page" : undefined}
                className={cn("inline-flex h-10 shrink-0 items-center rounded-lg px-3 text-sm font-medium transition-colors md:h-9",
                  current.key === a.key ? "bg-brand-50 text-brand-800" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                {a.name}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main className="page-in mx-auto max-w-7xl px-3 py-5 sm:px-6">
        {me?.kind === "business" && ["OWNER", "MANAGER"].includes(me.member.role) && <AnnouncementBanner />}
        {current && <Breadcrumbs home={home} current={current} pathname={pathname} />}
        <Suspense>{children}</Suspense>
      </main>
    </div>
  );
}
