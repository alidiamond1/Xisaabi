"use client";
import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReference } from "convex/server";

type UrlFn = FunctionReference<"mutation", "public", Record<string, never>, string>;

/** Uploads to Convex storage via a generateUploadUrl mutation; reports the storageId. */
export function LogoUpload({
  generateUrl,
  preview,
  onUploaded,
}: {
  generateUrl: UrlFn;
  preview: string | null;
  onUploaded: (id: Id<"_storage">, localUrl: string) => void;
}) {
  const gen = useMutation(generateUrl);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2_000_000) return toast.error("Choose an image under 2 MB.");
    setBusy(true);
    try {
      const url = await gen({});
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error("upload");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      onUploaded(storageId, URL.createObjectURL(file));
    } catch {
      toast.error("Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview ? <img src={preview} alt="Logo" className="size-full object-cover" /> : <ImagePlus className="size-6 text-muted-foreground" />}
      </div>
      <div>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy && <Loader2 className="animate-spin" />}
          {preview ? "Change logo" : "Upload logo"}
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">PNG or JPG, up to 2 MB. Printed on receipts.</p>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
    </div>
  );
}
