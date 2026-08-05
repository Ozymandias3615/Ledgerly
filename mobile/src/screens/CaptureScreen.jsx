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
        <ThemeToggle />
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
