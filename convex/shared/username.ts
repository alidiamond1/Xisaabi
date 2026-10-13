const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Lowercases + trims. Returns null if not 3–32 chars of a-z 0-9 . _ - */
export function normalizeUsername(raw: string): string | null {
  const u = raw.trim().toLowerCase();
  return USERNAME_RE.test(u) ? u : null;
}
