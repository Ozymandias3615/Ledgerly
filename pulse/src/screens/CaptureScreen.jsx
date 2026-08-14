import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getUser } from "../lib/auth";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import Brand from "../components/Brand";
import BackButton from "../components/BackButton";

export default function CaptureScreen() {
  const navigate = useNavigate();
  const user = getUser();
  const online = useOnlineStatus();
  const cameraInputRef = useRef(null);
  const libraryInputRef = useRef(null);
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
          <BackButton to="/transactions" />
          <Brand compact />
        </div>
      </div>
      <div className="eyebrow">New expense</div>
      <h2 className="heading">Scan a receipt</h2>
      <p className="subtitle">Signed in as {user?.email}</p>

      {!online && (
        <div className="banner banner-warning">
          You're offline — scanning a receipt needs a connection. Come back online, or add the expense manually instead.
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      <div className="form button-row">
        <button type="button" className="btn-primary" onClick={() => cameraInputRef.current?.click()} disabled={!online}>
          Take a photo of a receipt
        </button>
        <button type="button" className="btn-outline" onClick={() => libraryInputRef.current?.click()} disabled={!online}>
          Upload a photo
        </button>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>
    </div>
  );
}
