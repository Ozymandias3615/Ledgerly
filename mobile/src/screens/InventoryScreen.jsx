import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, Minus, Warning } from "@phosphor-icons/react";
import api from "../lib/api";
import { isLowStock, stockRatio, stockBarColor } from "../lib/format";
import Brand from "../components/Brand";
import AppShell from "../components/AppShell";

export default function InventoryScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const justSubmitted = Boolean(location.state?.justSubmitted);
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  // Debounces the actual PUT per item so a burst of stepper taps collapses
  // into a single request for the final settled quantity - mirrors
  // frontend/src/pages/InventoryPage.jsx's adjustQty exactly.
  const pendingQty = useRef({});
  const pendingSaves = useRef({});

  const load = () => {
    api
      .get("/inventory")
      .then(({ data }) => setItems(data))
      .catch((err) => setError(err.response?.data?.detail || "Couldn't load inventory."));
  };

  useEffect(() => {
    load();
  }, []);

  const adjustQty = (item, delta) => {
    const base = pendingQty.current[item.id] ?? item.quantity;
    const quantity = Math.max(0, Number(base) + delta);
    pendingQty.current[item.id] = quantity;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, quantity } : i)));

    clearTimeout(pendingSaves.current[item.id]);
    pendingSaves.current[item.id] = setTimeout(() => {
      delete pendingQty.current[item.id];
      api
        .put(`/inventory/${item.id}`, {
          name: item.name,
          category: item.category,
          quantity,
          unit: item.unit,
          reorder_point: item.reorder_point,
          unit_cost: item.unit_cost,
        })
        .catch(() => {
          setError("Couldn't update stock. Refreshing…");
          load();
        });
    }, 400);
  };

  const lowStockItems = (items || []).filter(isLowStock);

  return (
    <AppShell>
      <div className="screen screen-narrow">
        <div className="top-row">
          <Brand compact />
          <button type="button" className="icon-btn" aria-label="Add item" title="Add item" onClick={() => navigate("/inventory/new")}>
            <Plus size={18} />
          </button>
        </div>
        <div className="eyebrow">Stock</div>
        <h2 className="heading">Inventory</h2>
        <p className="subtitle">Track what you have on hand and know when to restock.</p>

        {justSubmitted && <div className="banner banner-success">Saved.</div>}
        {error && <p className="error-text">{error}</p>}

        {lowStockItems.length > 0 && (
          <div className="banner banner-warning">
            <Warning size={16} weight="fill" style={{ verticalAlign: "-2px", marginRight: "0.375rem" }} />
            {lowStockItems.length} item{lowStockItems.length > 1 ? "s" : ""} running low: {lowStockItems.map((i) => i.name).join(", ")}
          </div>
        )}

        {items === null && !error && (
          <p className="subtitle thinking">
            <span className="thinking-dots"><span /><span /><span /></span>
            Loading
          </p>
        )}
        {items && items.length === 0 && <p className="subtitle">No inventory items yet. Tap + to add one.</p>}

        {items && items.length > 0 && (
          <div className="list">
            {items.map((item) => (
              <div className="list-card" key={item.id}>
                <button
                  type="button"
                  className="list-info-btn"
                  onClick={() => navigate(`/inventory/${item.id}/edit`, { state: { item } })}
                >
                  <div className="list-title">{item.name}</div>
                  <div className="list-meta">{[item.category, item.unit].filter(Boolean).join(" · ")}</div>
                </button>
                <div className="stepper">
                  <button type="button" className="stepper-btn" aria-label={`Decrease ${item.name}`} onClick={() => adjustQty(item, -1)}>
                    <Minus size={14} />
                  </button>
                  <span className="stepper-value">{item.quantity}</span>
                  <button type="button" className="stepper-btn" aria-label={`Increase ${item.name}`} onClick={() => adjustQty(item, 1)}>
                    <Plus size={14} />
                  </button>
                </div>
                <div className="stock-bar-track">
                  <div
                    className="stock-bar-fill"
                    style={{ width: `${stockRatio(item) * 100}%`, background: stockBarColor(item) }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
