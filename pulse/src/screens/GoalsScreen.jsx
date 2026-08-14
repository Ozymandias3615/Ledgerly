import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { fmtAmount, fmtDate } from "../lib/format";
import Brand from "../components/Brand";
import AppShell from "../components/AppShell";

function goalRatio(current, target) {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, current / target));
}

export default function GoalsScreen() {
  const navigate = useNavigate();
  const [goals, setGoals] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/personal/goals")
      .then(({ data }) => setGoals(data))
      .catch((err) => setError(err.response?.data?.detail || "Couldn't load your goals."));
  }, []);

  return (
    <AppShell>
      <div className="screen screen-narrow">
        <div className="top-row">
          <Brand compact />
        </div>
        <div className="eyebrow">Personal</div>
        <h2 className="heading">Goals</h2>
        <p className="subtitle">Your savings goals and progress.</p>

        {error && <p className="error-text">{error}</p>}
        {goals === null && !error && (
          <p className="subtitle thinking">
            <span className="thinking-dots"><span /><span /><span /></span>
            Loading
          </p>
        )}
        {goals && goals.length === 0 && <p className="subtitle">No savings goals yet.</p>}

        {goals && goals.length > 0 && (
          <div className="list">
            {goals.map((g) => (
              <button
                type="button"
                key={g.id}
                className="list-card"
                style={{ flexWrap: "wrap" }}
                onClick={() => navigate(`/goals/${g.id}`, { state: { goal: g } })}
              >
                <div className="list-info">
                  <div className="list-title">{g.name}</div>
                  <div className="list-meta">
                    {fmtAmount(g.current_amount, g.currency)} of {fmtAmount(g.target_amount, g.currency)}
                    {g.target_date ? ` · by ${fmtDate(g.target_date)}` : ""}
                  </div>
                </div>
                <div className="stock-bar-track">
                  <div
                    className="stock-bar-fill"
                    style={{ width: `${goalRatio(g.current_amount, g.target_amount) * 100}%`, background: "hsl(var(--success))" }}
                  />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
