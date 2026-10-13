"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { Megaphone, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Banner } from "@/components/common";

const KEY = "xisaabi.dismissedAnnouncements";
const TONE = { INFO: "info", WARNING: "warning", SUCCESS: "success" } as const;

function load(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}

/** Platform announcements for OWNER/MANAGER (the query refuses cashiers, so only mount it for those roles). */
export function AnnouncementBanner() {
  const [now] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  const rows = useQuery(api.announcements.active, { now });
  const [gone, setGone] = useState<string[]>(load);
  const shown = rows?.filter((r) => !gone.includes(r._id)) ?? [];
  if (shown.length === 0) return null;
  function dismiss(id: string) {
    const next = [...gone, id].slice(-100);
    setGone(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: dismissal lasts until reload */ }
  }
  return (
    <div className="mb-4 space-y-2">
      {shown.map((r) => (
        <div key={r._id} className="relative">
          <Banner tone={TONE[r.level]} icon={Megaphone}>
            <span className="block pr-8"><strong>{r.title}</strong><span className="block whitespace-pre-wrap break-words">{r.body}</span></span>
          </Banner>
          <button type="button" onClick={() => dismiss(r._id)} aria-label="Dismiss announcement"
            className="absolute right-1 top-1 grid size-11 place-items-center rounded-lg text-current opacity-70 hover:opacity-100"><X className="size-4" /></button>
        </div>
      ))}
    </div>
  );
}
