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
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
  } catch {
    return `${currency || ""} ${amount}`.trim();
  }
}

export function isLowStock(item) {
  return Number(item.reorder_point) > 0 && Number(item.quantity) <= Number(item.reorder_point);
}

// Scales the bar to "full" at 2x the reorder point, mirroring
// frontend/src/pages/InventoryPage.jsx's stockRatio exactly, since there's
// no separate max-stock field - once stock reaches double the restock
// threshold, the bar reads as full.
export function stockRatio(item) {
  const reorderPoint = Number(item.reorder_point);
  if (reorderPoint <= 0) return 1;
  return Math.max(0, Math.min(1, Number(item.quantity) / (reorderPoint * 2)));
}

export function stockBarColor(item) {
  if (Number(item.reorder_point) <= 0) return "hsl(var(--muted-foreground) / 0.3)";
  if (isLowStock(item)) return "hsl(var(--destructive))";
  return stockRatio(item) < 0.75 ? "#f59e0b" : "hsl(var(--success))";
}
