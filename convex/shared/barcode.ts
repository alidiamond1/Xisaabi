// Pure barcode helpers, shared by Convex functions AND the UI. No imports.

const DIGITS = /^\d+$/;

/** Mod-10 check digit for the digits BEFORE the check digit (GTIN/EAN/UPC weights 3,1 from the right). */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = body.charCodeAt(body.length - 1 - i) - 48;
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

function checkOk(code: string): boolean {
  return gtinCheckDigit(code.slice(0, -1)) === code.charCodeAt(code.length - 1) - 48;
}

/** UPC-E (8 digits, number system 0/1) -> 12-digit UPC-A, or null. */
export function upcEToUpcA(e: string): string | null {
  if (!/^[01]\d{7}$/.test(e)) return null;
  const ns = e[0], m = e.slice(1, 7), chk = e[7], d = m[5];
  let body: string;
  if (d === "0" || d === "1" || d === "2") body = m.slice(0, 2) + d + "0000" + m.slice(2, 5);
  else if (d === "3") body = m.slice(0, 3) + "00000" + m.slice(3, 5);
  else if (d === "4") body = m.slice(0, 4) + "00000" + m[4];
  else body = m.slice(0, 5) + "0000" + d;
  return ns + body + chk;
}

/** EAN-8, EAN-13, UPC-A (12), UPC-E (8), GTIN-14 with a correct check digit. */
export function isValidGtin(code: string): boolean {
  if (!DIGITS.test(code)) return false;
  if (code.length === 8) {
    if (checkOk(code)) return true;
    const a = upcEToUpcA(code);
    return !!a && checkOk(a);
  }
  return (code.length === 12 || code.length === 13 || code.length === 14) && checkOk(code);
}

/** Canonical EAN-13 (UPC-A / UPC-E -> leading 0 EAN-13, GTIN-14 with 0 indicator -> EAN-13); EAN-8 stays 8 digits. Null if not a valid GTIN. */
export function normalizeGtin(raw: string): string | null {
  const code = raw.trim();
  if (!isValidGtin(code)) return null;
  if (code.length === 13 || (code.length === 8 && checkOk(code))) return code;
  if (code.length === 12) return "0" + code;
  if (code.length === 14) return code[0] === "0" ? code.slice(1) : code;
  const a = upcEToUpcA(code); // UPC-E
  return a ? "0" + a : null;
}

/** Retailer-internal EAN-13 (GS1 prefixes 20-29). */
export function isInternal(code: string): boolean {
  return code.length === 13 && /^2\d{12}$/.test(code);
}

/** "20" + 10-digit zero-padded sequence + check digit. seq in 0..9_999_999_999. */
export function makeInternalEan13(seq: number): string {
  if (!Number.isInteger(seq) || seq < 0 || seq > 9_999_999_999) throw new Error("seq out of range");
  const body = "20" + String(seq).padStart(10, "0");
  return body + gtinCheckDigit(body);
}

/** 15 digits with a valid Luhn check digit. */
export function isValidImei(s: string): boolean {
  if (!/^\d{15}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = s.charCodeAt(14 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export type Gs1 = { gtin?: string; batch?: string; expiry?: string; serial?: string };

const FIXED: Record<string, number> = {
  "00": 18, "01": 14, "02": 14, "11": 6, "12": 6, "13": 6, "15": 6, "16": 6, "17": 6, "20": 2,
};
const GS = "\u001d";

function yymmdd(s: string): string | undefined {
  if (!/^\d{6}$/.test(s)) return undefined;
  const yy = Number(s.slice(0, 2)), mm = Number(s.slice(2, 4));
  let dd = Number(s.slice(4, 6));
  if (mm < 1 || mm > 12) return undefined;
  const year = 2000 + yy;
  if (dd === 0) dd = new Date(Date.UTC(year, mm, 0)).getUTCDate(); // day 00 = last day of month
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  if (dd > last) return undefined;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/**
 * Parse a GS1 element string (AI 01 GTIN, 10 batch, 17 expiry, 21 serial). Accepts a
 * symbology prefix (]d2, ]C1, ...), GS separators, or the human "(01)...(10)..." form.
 * Returns {} when the input is not GS1 (e.g. a plain EAN).
 */
export function parseGs1(raw: string): Gs1 {
  let s = raw.replace(/^\][A-Za-z][0-9A-Za-z]/, "").trim();
  if (s.startsWith("(")) {
    // human-readable form: convert to element string with GS after every variable field
    s = s.replace(/\((\d{2,4})\)([^(]*)/g, (_m, ai: string, val: string) => ai + val + (FIXED[ai] ? "" : GS));
  }
  const out: Gs1 = {};
  let i = 0;
  let any = false;
  while (i < s.length) {
    if (s[i] === GS) { i++; continue; }
    const ai = s.slice(i, i + 2);
    const fixed = FIXED[ai];
    let val: string;
    if (fixed) {
      val = s.slice(i + 2, i + 2 + fixed);
      if (val.length !== fixed || !DIGITS.test(val)) return any ? out : {};
      i += 2 + fixed;
    } else if (ai === "10" || ai === "21") {
      let end = s.indexOf(GS, i + 2);
      if (end < 0) end = s.length;
      val = s.slice(i + 2, Math.min(end, i + 2 + 20));
      if (!val) return any ? out : {};
      i += 2 + val.length;
    } else return any ? out : {};
    any = true;
    if (ai === "01") {
      const g = normalizeGtin(val);
      if (!g) return {};
      out.gtin = g;
    } else if (ai === "10") out.batch = val;
    else if (ai === "21") out.serial = val;
    else if (ai === "17") {
      const e = yymmdd(val);
      if (e) out.expiry = e;
    }
  }
  return any ? out : {};
}
