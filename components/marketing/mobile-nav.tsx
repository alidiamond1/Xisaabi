"use client";
import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Wordmark } from "@/components/brand";
import { NAV } from "@/lib/marketing";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-lg" className="lg:hidden" aria-label="Menu"><Menu className="size-6" /></Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-72 gap-0 p-0">
        <SheetHeader className="border-b p-4"><SheetTitle><Wordmark className="text-xl" /></SheetTitle></SheetHeader>
        <nav className="flex flex-col p-2">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center rounded-lg px-3 text-base font-medium hover:bg-muted">{n.label}</Link>
          ))}
        </nav>
        <div className="mt-auto space-y-2 border-t p-4">
          <Button asChild size="lg" className="w-full"><Link href="/signup">Start free</Link></Button>
          <Button asChild size="lg" variant="outline" className="w-full"><Link href="/login">Log in</Link></Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
