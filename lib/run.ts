import { toast } from "sonner";
import { errorMessage } from "@/convex/shared/errors";

/** Await a mutation/action with toast feedback. Returns undefined on failure. */
export async function run<T>(p: Promise<T>, ok?: string): Promise<T | undefined> {
  try {
    const r = await p;
    if (ok) toast.success(ok);
    return r;
  } catch (e) {
    toast.error(errorMessage(e));
    return undefined;
  }
}

/** Like run, but resolves true/false (for void mutations). */
export async function act(p: Promise<unknown>, ok?: string): Promise<boolean> {
  try {
    await p;
    if (ok) toast.success(ok);
    return true;
  } catch (e) {
    toast.error(errorMessage(e));
    return false;
  }
}
