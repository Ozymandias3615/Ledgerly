import { useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";

// Force-clears the PWA's service worker + cached assets and reloads, so a
// deployed update shows up immediately instead of requiring the user to
// remove and re-add the app to get past stale cached JS/CSS.
export default function RefreshButton() {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } finally {
      window.location.reload();
    }
  };

  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Refresh app"
      title="Refresh app - use this if a recent update isn't showing up"
      onClick={handleRefresh}
      disabled={refreshing}
    >
      <ArrowsClockwise size={18} className={refreshing ? "spin" : undefined} />
    </button>
  );
}
