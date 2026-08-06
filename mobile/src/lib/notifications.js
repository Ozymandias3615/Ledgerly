import { useEffect, useState } from "react";
import api from "./api";

export function useUnreadCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/notifications")
      .then(({ data }) => {
        if (!cancelled) setCount(data.unread_count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return count;
}
