import { useEffect, useState } from "react";
import api from "../lib/api";

function formatShort(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function BarChart({ label, data, days, color }) {
  const max = Math.max(1, ...data);
  const total = data.reduce((a, b) => a + b, 0);
  return (
    <div className="card card-pad">
      <div className="row-between" style={{ marginBottom: "0.75rem" }}>
        <div style={{ fontWeight: 700 }}>{label}</div>
        <div className="muted">{total} in last 30 days</div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "80px" }}>
        {data.map((v, i) => (
          <div
            key={i}
            title={`${days[i]}: ${v}`}
            style={{
              flex: 1,
              background: `hsl(var(${color}))`,
              opacity: v === 0 ? 0.15 : 0.85,
              height: `${Math.max(4, (v / max) * 80)}px`,
              borderRadius: "2px",
            }}
          />
        ))}
      </div>
      <div className="row-between" style={{ marginTop: "0.5rem" }}>
        <span className="muted" style={{ fontSize: "0.7rem" }}>{formatShort(days[0])}</span>
        <span className="muted" style={{ fontSize: "0.7rem" }}>{formatShort(days[days.length - 1])}</span>
      </div>
    </div>
  );
}

export default function GrowthScreen() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/admin/analytics").then(({ data }) => setData(data));
  }, []);

  return (
    <div>
      <div className="page-header">
        <div className="eyebrow">Internal</div>
        <h1 className="page-title">Growth</h1>
        <p className="page-subtitle">Signups and platform activity over the last 30 days</p>
      </div>

      {!data ? (
        <p className="muted">Loading...</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <BarChart label="New signups" data={data.signups} days={data.days} color="--primary" />
          <BarChart label="Transactions created" data={data.transactions} days={data.days} color="--success" />
          <BarChart label="Invoices created" data={data.invoices} days={data.days} color="--amber" />
        </div>
      )}
    </div>
  );
}
