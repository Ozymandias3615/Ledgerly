import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../lib/api";
import { getUser } from "../lib/auth";
import { compressImageFile } from "../lib/imageCompress";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { EXPENSE_CATEGORIES } from "../lib/categories";
import { fmtAmount, fmtDate } from "../lib/format";
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
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [extraCategory, setExtraCategory] = useState(null);
  const [billId, setBillId] = useState("");
  const [bills, setBills] = useState([]);
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
  // that call fails (bad AI response, quota, etc.) instead of the receipt
  // image silently going missing.
  const [localReceiptImage, setLocalReceiptImage] = useState(null);
  const [localReceiptContentType, setLocalReceiptContentType] = useState(null);
  // Guards against firing /receipts/extract twice for the same photo - React
  // StrictMode's dev-only mount/cleanup/mount cycle would otherwise send two
  // requests, wasting quota against the shared Groq key.
  const extractRequestedFor = useRef(null);

  useEffect(() => {
    api.get("/personal/bills").then(({ data }) => setBills(data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!photo) {
      navigate("/capture", { replace: true });
      return;
    }
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
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [photo]);

  useEffect(() => {
    if (!photo || extractRequestedFor.current === photo) return;
    extractRequestedFor.current = photo;
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
        if (ex.category) {
          const match = EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === ex.category.toLowerCase());
          if (match) {
            setCategory(match);
            setExtraCategory(null);
          } else {
            // Preserve the AI's suggestion rather than silently discarding
            // it - added as a one-off extra option alongside the curated list.
            setExtraCategory(ex.category);
            setCategory(ex.category);
          }
        }
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

  const canSubmit = amount.trim() !== "" && date.trim() !== "" && !submitting && online;

  const handleRetakeFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setVendor("");
    setAmount("");
    setCurrency(user?.currency || "USD");
    setDate(todayIso());
    setCategory(EXPENSE_CATEGORIES[0]);
    setExtraCategory(null);
    setBillId("");
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

  const handleBillChange = (e) => {
    const id = e.target.value;
    setBillId(id);
    const bill = bills.find((b) => b.id === id);
    if (bill) setCategory(bill.category);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    const payload = {
      type: "expense",
      amount: Number(amount),
      category,
      description: vendor.trim(),
      date,
      currency,
      bill_id: billId || null,
      receipt_image: receiptImage || localReceiptImage,
      receipt_content_type: receiptContentType || localReceiptContentType,
    };
    try {
      await api.post("/personal/transactions", payload);
      navigate("/transactions", { replace: true, state: { justSubmitted: true } });
    } catch (err) {
      setError(err.response?.data?.detail || "Couldn't save this expense. Try again.");
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
            You're offline — saving needs a connection. Wait until you're back online to save.
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
            <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Trader Joe's" />
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
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {extraCategory && <option value={extraCategory}>{extraCategory} (suggested)</option>}
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          {bills.length > 0 && (
            <label>
              Pay a bill (optional)
              <select value={billId} onChange={handleBillChange}>
                <option value="">None</option>
                {bills.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} · {fmtAmount(b.amount, b.currency)} · due {fmtDate(b.due_date)}</option>
                ))}
              </select>
            </label>
          )}
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="btn-primary" disabled={!canSubmit}>
            {submitting ? "Saving…" : "Save expense"}
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
