import { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { clearToken, getUser } from "../lib/auth";
import Brand from "../components/Brand";
import ThemeToggle from "../components/ThemeToggle";

export default function CaptureScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getUser();
  const inputRef = useRef(null);
  const [error, setError] = useState("");
  const justSubmitted = Boolean(location.state?.justSubmitted);

  const handleLogout = () => {
    clearToken();
    navigate("/login");
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setError("");
    navigate("/review", { state: { photo: file } });
  };

  return (
    <div className="screen screen-center">
      <div className="top-row">
        <Brand />
        <div className="top-row-left">
          <button
            type="button"
            className="icon-btn"
            aria-label="View past receipts"
            title="Past receipts"
            onClick={() => navigate("/receipts")}
          >
            <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M200,32H72A16,16,0,0,0,56,48V216a8,8,0,0,0,12.19,6.81L96,206.05l27.81,16.76a8,8,0,0,0,8.38,0L160,206.05l27.81,16.76A8,8,0,0,0,200,216V48A16,16,0,0,0,200,32ZM184,202.05,164.19,190.19a8,8,0,0,0-8.38,0L128,206.95l-27.81-16.76a8,8,0,0,0-8.38,0L72,202.05V48H184Z" />
            </svg>
          </button>
          <ThemeToggle />
        </div>
      </div>
      <div className="eyebrow">New expense</div>
      <h2 className="heading">Capture a receipt</h2>
      <p className="subtitle">Signed in as {user?.email}</p>

      {justSubmitted && <div className="banner banner-success">Expense saved.</div>}
      {error && <p className="error-text">{error}</p>}

      <div className="form">
        <button type="button" className="btn-primary" onClick={() => inputRef.current?.click()}>
          Take a photo of a receipt
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
        <button type="button" className="btn-outline" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </div>
  );
}
