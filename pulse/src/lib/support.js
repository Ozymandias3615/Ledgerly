import { useEffect, useState } from "react";
import api from "./api";

// Same limits the backend enforces (MAX_SUPPORT_ATTACHMENT_BYTES /
// ALLOWED_SUPPORT_ATTACHMENT_TYPES) - checked here first so a bad file fails
// instantly instead of after an upload.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = [
  "image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf",
  "video/mp4", "video/webm", "video/quicktime",
];

// Same live-chat timings as the desktop SupportPage.jsx and the admin panel -
// the server shows "typing" for 6s after a ping.
export const MESSAGE_POLL_MS = 3000;
export const TYPING_PING_MS = 2500;
export const NEAR_BOTTOM_PX = 80;

export function supportTimeLabel(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// True when Support has replied in any conversation the user hasn't opened
// since - drives the dot on Home's chat button.
export function useSupportUnread() {
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .get("/support/threads")
      .then(({ data }) => {
        if (!cancelled) setUnread(data.some((t) => t.unread_by_user));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return unread;
}
