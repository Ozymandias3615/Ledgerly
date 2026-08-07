import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../lib/api";
import { getUser } from "../lib/auth";
import { compressImageFile } from "../lib/imageCompress";
import { queueReceipt } from "../lib/offlineQueue";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import Brand from "../components/Brand";
import BackButton from "../components/BackButton";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReviewScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getUser();
  const initialPhoto = location.state?.photo || null;
  const retakeInputRef = useRef(null);
  const online = useOnlineStatus();

  const [photo, setPhoto] = useState(initialPhoto);
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(user?.currency || "USD");
  const [date, setDate] = useState(todayIso());
  const [category, setCategory] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [photoUrl, setPhotoUrl] = useState(null);

  const [extracting, setExtracting] = useState(true);
  const [extractError, setExtractError] = useState("");
  const [confidence, setConfidence] = useState(null);
  const [notes, setNotes] = useState("");
  const [receiptImage, setReceiptImage] = useState(null);
  const [receiptContentType, setReceiptContentType] = useState(null);
  // Compressed client-side the moment a photo is picked, independent of
  // /receipts/extract - so the photo is still attached to the expense when
  // that call is skipped (offline) or fails (bad AI response, quota, etc.)
  // instead of the receipt image silently going missing.
  const [localReceiptImage, setLocalReceiptImage] = useState(null);
  const [localReceiptContentType, setLocalReceiptContentType] = useState(null);
  // Guards against firing /receipts/extract twice for the same photo - React
  // 18 StrictMode's dev-only mount/cleanup/mount cycle would otherwise send
  // two requests, wasting quota against the shared Groq key.
  const extractRequestedFor = useRef(null);

  useEffect(() => {
    if (!photo) {
      navigate("/capture", { replace: true });
      return;
    }
    // Create and revoke the object URL together in the same effect so
    // React 18 StrictMode's dev-only mount/cleanup/mount cycle can't revoke
    // a URL that a later mount is still relying on.
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo, navigate]);

  useEffect(() => {
    if (!photo) return;
    let cancelled = false;
    compressImageFile(photo)
      .then(({ base64, contentType }) => {
        if (cancelled) return;
        setLocalReceiptImage(base64);
        setLocalReceiptContentType(contentType);
      })
      // Best-effort - if this fails, receiptImage from a successful
      // /receipts/extract call (below) is still the primary source.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [photo]);

  useEffect(() => {
    // Guarded by extractRequestedFor rather than the usual effect-cleanup
    // "cancelled" flag: React 18 StrictMode's dev-only mount/cleanup/mount
    // cycle would otherwise mark the *first* invocation's request as
    // cancelled (via its cleanup) while never re-issuing it, leaving the
    // screen stuck loading forever. Staleness is instead judged by comparing
    // against the ref at resolution time, which survives the phantom cycle.
    if (!photo || extractRequestedFor.current === photo) return;
    extractRequestedFor.current = photo;
    // No point sending a request that's guaranteed to fail - and skipping it
    // outright (rather than letting it error out) avoids a scary red banner
    // for what's actually the expected offline path.
    if (!navigator.onLine) {
      setExtracting(false);
      setExtractError("");
      return;
    }
    setExtracting(true);
    setExtractError("");
    const formData = new FormData();
    formData.append("file", photo);
    api
      .post("/receipts/extract", formData)
      .then(({ data }) => {
        if (extractRequestedFor.current !== photo) return;
        setReceiptImage(data.receipt_image);
        setReceiptContentType(data.receipt_content_type);
        const ex = data.extracted || {};
        if (ex.vendor) setVendor(ex.vendor);
        if (ex.amount != null) setAmount(String(ex.amount));
        if (ex.currency) setCurrency(ex.currency);
        if (ex.date) setDate(ex.date);
        if (ex.category) setCategory(ex.category);
        setConfidence(ex.confidence || null);
        setNotes(ex.notes || "");
      })
      .catch((err) => {
        if (extractRequestedFor.current !== photo) return;
        setExtractError(err.response?.data?.detail || "Couldn't process this photo automatically. You can still enter the details manually.");
      })
      .finally(() => {
        if (extractRequestedFor.current === photo) setExtracting(false);
      });
  }, [photo]);

  const canSubmit = amount.trim() !== "" && date.trim() !== "" && !submitting;

  const handleRetakeFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // Swapping photo re-triggers both effects above via their [photo]
    // dependency - reset the fields they populate so stale data from the
    // previous receipt doesn't linger on screen while the new one loads.
    setVendor("");
    setAmount("");
    setCurrency(user?.currency || "USD");
    setDate(todayIso());
    setCategory("");
    setTaxAmount("");
    setError("");
    setExtractError("");
    setConfidence(null);
    setNotes("");
    setReceiptImage(null);
    setReceiptContentType(null);
    setLocalReceiptImage(null);
    setLocalReceiptContentType(null);
    setPhoto(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    const payload = {
      type: "expense",
      amount: Number(amount),
      category: category.trim() || "Uncategorized",
      description: vendor.trim(),
      date,
      currency,
      tax_amount: taxAmount.trim() === "" ? 0 : Number(taxAmount),
      receipt_image: receiptImage || localReceiptImage,
      receipt_content_type: receiptContentType || localReceiptContentType,
    };
    try {
      if (!navigator.onLine) throw { isOffline: true };
      await api.post("/transactions", payload);
      navigate("/receipts", { replace: true, state: { justSubmitted: true } });
    } catch (err) {
      // Offline, or the request never made it to the server (connection
      // dropped mid-submit) - queue it locally instead of losing what was
      // just filled in. A real server-side rejection (4xx/5xx with an
      // actual response) still surfaces as an error rather than queuing.
      if (err.isOffline || !err.response) {
        await queueReceipt(payload);
        navigate("/receipts", { replace: true, state: { queuedOffline: true } });
      } else {
        setError(err.response?.data?.detail || "Couldn't save this expense. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!photo) return null;

  return (
    <div className="screen screen-narrow">
      <div className="top-row">
        <div className="top-row-left">
          <BackButton to="/capture" />
          <Brand compact />
        </div>
      </div>
      <div className="eyebrow">Review</div>
      <h2 className="heading">{extracting ? "Reading receipt…" : "Check the details"}</h2>
      <p className="subtitle">
        {extracting ? "" : "Edit anything that looks off, then save."}
      </p>
      {extracting && (
        <p className="subtitle thinking">
          <span className="thinking-dots"><span /><span /><span /></span>
          Reading receipt
        </p>
      )}

      <div className="card">
        {photoUrl && <img src={photoUrl} alt="Captured receipt" className="receipt-preview" />}

        {!online && (
          <div className="banner banner-warning">
            You're offline — this will be saved on your phone and uploaded once you're back online.
          </div>
        )}
        {online && extractError && <p className="error-text">{extractError}</p>}
        {!extracting && confidence && confidence !== "high" && (
          <div className="banner banner-warning">
            Double check these details{notes ? ` — ${notes}` : ""}.
          </div>
        )}

        <form onSubmit={handleSubmit} className="form">
          <label>
            Vendor
            <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Office Depot" />
          </label>
          <label>
            Amount
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          <label>
            Currency
            <input type="text" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
          </label>
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            Category
            <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Office Supplies" />
          </label>
          <label>
            Tax amount
            <input type="number" inputMode="decimal" step="0.01" min="0" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn-primary" disabled={!canSubmit}>
            {submitting ? "Saving…" : online ? "Save expense" : "Save offline"}
          </button>
          <button type="button" className="btn-outline" onClick={() => retakeInputRef.current?.click()}>
            Retake photo
          </button>
          <input
            ref={retakeInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleRetakeFile}
            style={{ display: "none" }}
          />
        </form>
      </div>
    </div>
  );
}
