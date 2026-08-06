import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getUser } from "../lib/auth";
import Brand from "../components/Brand";
import BackButton from "../components/BackButton";

export default function CaptureScreen() {
  const navigate = useNavigate();
  const user = getUser();
  const inputRef = useRef(null);
  const [error, setError] = useState("");

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
        <div className="top-row-left">
          <BackButton to="/receipts" />
          <Brand compact />
        </div>
      </div>
      <div className="eyebrow">New expense</div>
      <h2 className="heading">Capture a receipt</h2>
      <p className="subtitle">Signed in as {user?.email}</p>

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
      </div>
    </div>
  );
}
