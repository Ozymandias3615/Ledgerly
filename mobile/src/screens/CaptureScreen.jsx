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
          <BackButton to="/receipts" />
          <Brand compact />
        </div>
      </div>
      <div className="eyebrow">New expense</div>
      <h2 className="heading">Capture a receipt</h2>
      <p className="subtitle">Signed in as {user?.email}</p>

      {!online && (
        <div className="banner banner-warning">
          You're offline — you can still capture a receipt and fill in the details by hand. It'll upload once you're back online.
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      <div className="form button-row">
        <button type="button" className="btn-primary" onClick={() => cameraInputRef.current?.click()}>
          Take a photo of a receipt
        </button>
        <button type="button" className="btn-outline" onClick={() => libraryInputRef.current?.click()}>
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
