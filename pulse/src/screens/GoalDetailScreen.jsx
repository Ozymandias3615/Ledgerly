import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import api from "../lib/api";
import { fmtAmount, fmtDate } from "../lib/format";
import Brand from "../components/Brand";
import BackButton from "../components/BackButton";

function goalRatio(current, target) {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, current / target));
}

export default function GoalDetailScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();

  const [goal, setGoal] = useState(location.state?.goal || null);
  const [contributions, setContributions] = useState(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!goal) {
      // Deep link / hard refresh has no route state to work with - fall back
      // to the list (no single-goal GET endpoint exists).
      api
        .get("/personal/goals")
        .then(({ data }) => {
          const g = data.find((x) => x.id === id);
          if (!g) setError("Goal not found.");
          else setGoal(g);
        })
        .catch(() => setError("Couldn't load this goal."));
    }
    api
      .get(`/personal/goals/${id}/contributions`)
      .then(({ data }) => setContributions(data))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleDelete = async () => {
    if (!window.confirm(`Delete ${goal?.name}? This removes its contribution history too and can't be undone.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/personal/goals/${id}`);
      navigate("/goals", { replace: true });
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't delete this goal.");
      setDeleting(false);
    }
  };

  return (
    <div className="screen screen-narrow">
      <div className="top-row">
        <div className="top-row-left">
          <BackButton to="/goals" />
          <Brand compact />
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {!goal && !error && (
        <p className="subtitle thinking">
          <span className="thinking-dots"><span /><span /><span /></span>
          Loading
        </p>
      )}

      {goal && (
        <>
          <div className="eyebrow">Goal</div>
          <h2 className="heading">{goal.name}</h2>
          <p className="subtitle">
            {fmtAmount(goal.current_amount, goal.currency)} of {fmtAmount(goal.target_amount, goal.currency)}
            {goal.target_date ? ` · target ${fmtDate(goal.target_date)}` : ""}
          </p>

          <div className="stock-bar-track" style={{ marginBottom: "1.5rem", flex: "none" }}>
            <div
              className="stock-bar-fill"
              style={{ width: `${goalRatio(goal.current_amount, goal.target_amount) * 100}%`, background: "hsl(var(--success))" }}
            />
          </div>

          <div className="eyebrow">History</div>
          {contributions === null && (
            <p className="subtitle thinking">
              <span className="thinking-dots"><span /><span /><span /></span>
              Loading
            </p>
          )}
          {contributions && contributions.length === 0 && <p className="subtitle">No contributions logged yet.</p>}
          {contributions && contributions.length > 0 && (
            <div className="list">
              {contributions.map((c) => (
                <div className="list-card" key={c.id}>
                  <div className="list-info">
                    <div className="list-title">{c.note || "Contribution"}</div>
                    <div className="list-meta">{fmtDate(c.date)}</div>
                  </div>
                  <div className="list-amount stat-positive">+{fmtAmount(c.amount, goal.currency)}</div>
                </div>
              ))}
            </div>
          )}

          <button type="button" className="btn-outline" onClick={handleDelete} disabled={deleting} style={{ marginTop: "1.5rem" }}>
            Delete goal
          </button>
        </>
      )}
    </div>
  );
}
