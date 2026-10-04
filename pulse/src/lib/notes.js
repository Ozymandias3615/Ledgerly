// Notes are account-level (the same /notes the desktop app's Notes panel
// uses), so desktop and phone share one list. Desktop tags each note with
// the page path it was written on; phone notes are tagged with the app's
// name instead, which shows up as a "Pulse" label in desktop's All notes.
export const NOTE_PAGE = "Pulse";

export const AUTOSAVE_MS = 600;

// "/personal/budgets" -> "Personal · Budgets", "Pulse" -> "Pulse".
export function noteSourceLabel(page) {
  if (!page) return "";
  const parts = page.split("/").filter(Boolean).filter((p) => !/\d/.test(p) || p.length < 8);
  if (parts.length === 0) return "Home";
  return parts.map((p) => p.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())).join(" · ");
}

export function noteRelativeTime(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Like a notepad: the first line is the title, the rest is the preview.
export function splitNote(body) {
  const trimmed = (body || "").trim();
  const nl = trimmed.indexOf("\n");
  if (nl === -1) return { title: trimmed, preview: "" };
  return { title: trimmed.slice(0, nl).trim(), preview: trimmed.slice(nl + 1).trim().replace(/\s+/g, " ") };
}
