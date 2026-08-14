export const CURRENCIES = [
  { code: "USD", label: "USD — US Dollar", symbol: "$" },
  { code: "EUR", label: "EUR — Euro", symbol: "€" },
  { code: "GBP", label: "GBP — Pound Sterling", symbol: "£" },
  { code: "CAD", label: "CAD — Canadian Dollar", symbol: "C$" },
  { code: "JMD", label: "JMD — Jamaican Dollar", symbol: "J$" },
  { code: "GHS", label: "GHS — Ghana Cedi", symbol: "GH₵" },
  { code: "INR", label: "INR — Indian Rupee", symbol: "₹" },
  { code: "AUD", label: "AUD — Australian Dollar", symbol: "A$" },
  { code: "JPY", label: "JPY — Japanese Yen", symbol: "¥" },
];

export function currencySymbol(code) {
  const c = CURRENCIES.find((x) => x.code === code);
  return c ? c.symbol : (code ? code + " " : "$");
}

export function fmt(amount, code = "USD") {
  const n = Number(amount || 0);
  return `${currencySymbol(code)}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function fmtAmount(amount, currency) {
  const code = currency || "USD";
  try {
    // Intl's own currency-symbol resolution falls back to the bare ISO code
    // for currencies without curated symbol data in this locale (GHS -> "GHS"
    // instead of "GH₵") - format with currencyDisplay: "code" to get correct
    // per-currency grouping/decimals (e.g. JPY has none), strip the code
    // token, and prepend our own curated symbol instead for consistency with
    // fmt() above.
    const parts = new Intl.NumberFormat(undefined, { style: "currency", currency: code, currencyDisplay: "code" }).formatToParts(Number(amount || 0));
    const numberPart = parts.filter((p) => p.type !== "currency").map((p) => p.value).join("").trim();
    return `${currencySymbol(code)}${numberPart}`;
  } catch {
    return `${code} ${amount}`.trim();
  }
}

// Mirrors mobile/src/lib/format.js's stockRatio/stockBarColor thresholds
// (0.75 boundary, same colors) but inverted - here HIGH spend relative to
// the limit is bad, where high stock relative to reorder point is good.
export function budgetRatio(spent, limit) {
  if (limit <= 0) return 0;
  return Math.max(0, Math.min(1, spent / limit));
}

export function budgetBarColor(spent, limit) {
  if (limit <= 0) return "hsl(var(--muted-foreground) / 0.3)";
  const ratio = spent / limit;
  if (ratio >= 1) return "hsl(var(--destructive))";
  if (ratio >= 0.75) return "#f59e0b";
  return "hsl(var(--success))";
}
