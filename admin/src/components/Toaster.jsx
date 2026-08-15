import { useEffect, useState } from "react";
import { subscribeToasts } from "../lib/toast";

export default function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    return subscribeToasts((toastItem) => {
      setItems((prev) => [...prev, toastItem]);
      setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== toastItem.id));
      }, 3200);
    });
  }, []);

  if (items.length === 0) return null;

  return (
    <div style={{ position: "fixed", bottom: "1.25rem", right: "1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem", zIndex: 100 }}>
      {items.map((t) => (
        <div
          key={t.id}
          className="card card-pad"
          style={{
            fontSize: "0.85rem",
            fontWeight: 600,
            borderColor: t.type === "error" ? "hsl(var(--destructive))" : "hsl(var(--border))",
            color: t.type === "error" ? "hsl(var(--destructive))" : "hsl(var(--foreground))",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
