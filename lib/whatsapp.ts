// wa.me helpers. No API: the link opens WhatsApp with the text ready to send.

/** Digits only, with Somalia's +252 added when the number looks local (061..., 61..., 0252...). */
export function waDigits(phone: string | undefined) {
  let d = (phone ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("252")) return d;
  d = d.replace(/^0+/, "");
  return d.length <= 9 ? "252" + d : d;
}

/** Link to WhatsApp. Without a phone the user picks the contact. */
export function waLink(phone: string | undefined, text: string) {
  return `https://wa.me/${waDigits(phone)}?text=${encodeURIComponent(text)}`;
}

export function openWhatsApp(phone: string | undefined, text: string) {
  window.open(waLink(phone, text), "_blank", "noopener,noreferrer");
}

/** Polite Somali + English payment reminder. */
export function reminderText(o: { customer: string; shop: string; amount: string }) {
  return [
    `Salaan ${o.customer}, waxaan ka soo wacnay ${o.shop}.`,
    `Xasuusin xisaabeed: waxaad leedahay ${o.amount}. Fadlan nagu soo dir markaad awooddo. Mahadsanid!`,
    ``,
    `Hello ${o.customer}, a friendly reminder from ${o.shop}: your balance is ${o.amount}. Please pay when you can. Thank you!`,
  ].join("\n");
}
