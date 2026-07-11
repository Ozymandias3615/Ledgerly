import { toast } from "sonner";

export function formatApiError(err) {
  const d = err?.response?.data?.detail;
  if (d == null) return err?.message || "Something went wrong.";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (d && typeof d.msg === "string") return d.msg;
  return String(d);
}

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
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${m}-${d}-${y}`;
}

// Reads a JSON value previously saved with savePersisted, falling back to
// `fallback` if it's missing, unparsable, or storage is unavailable (e.g.
// private browsing) so callers never have to guard this themselves.
export function loadPersisted(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export function savePersisted(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // ignore (e.g. storage disabled or full)
  }
}

// Saves a blob to disk. In the packaged Electron app this hands the bytes to
// the main process (via the preload bridge), which opens a native Save
// dialog (defaulting to the Downloads folder with the suggested name) so the
// user can rename the file and/or choose where it goes; returns the chosen
// path, or null if they cancelled. In a plain browser (e.g. running
// `npm start` for dev) there's no filesystem access, so it falls back to the
// standard anchor-click download and returns the blob: URL instead.
async function saveBlobToDisk(blob, filename) {
  if (window.electronAPI?.saveFile) {
    const buf = await blob.arrayBuffer();
    return window.electronAPI.saveFile(filename, buf);
  }
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return url;
}

function openSavedFile(saved) {
  if (window.electronAPI?.openFile) window.electronAPI.openFile(saved);
  else window.open(saved, "_blank");
}

function baseName(savedPath) {
  const parts = String(savedPath).split(/[\\/]/);
  return parts[parts.length - 1];
}

// Wraps any file export/download in a toast: shown as "Downloading..." for
// the whole fetch+save, then updated in place to "Downloaded" with an Open
// action once the file has actually landed on disk. If the user cancels the
// save dialog, the loading toast is just dismissed rather than treated as a
// failure.
export async function exportAndDownload(fetchBlob, filename) {
  const toastId = toast.loading(`Downloading ${filename}...`);
  try {
    const blob = await fetchBlob();
    const saved = await saveBlobToDisk(blob, filename);
    if (saved == null) {
      toast.dismiss(toastId);
      return;
    }
    const savedName = saved.startsWith("blob:") ? filename : baseName(saved);
    toast.success(`Downloaded ${savedName}`, {
      id: toastId,
      action: { label: "Open", onClick: () => openSavedFile(saved) },
    });
  } catch (e) {
    toast.error(`Failed to download ${filename}`, { id: toastId });
  }
}
