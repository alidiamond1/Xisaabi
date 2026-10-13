"use client";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState, Panel } from "@/components/common";
import { Button } from "@/components/ui/button";

/** A page whose query threw (e.g. a record that is missing or belongs to another shop) shows this instead of a blank crash. */
export default function AppsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Panel>
      <EmptyState icon={SearchX} title="We could not open this page" desc="It may have been removed, or it is not part of your shop."
        action={<div className="flex gap-2"><Button variant="outline" onClick={reset}>Try again</Button><Button asChild><Link href="/apps">Back to apps</Link></Button></div>} />
    </Panel>
  );
}
