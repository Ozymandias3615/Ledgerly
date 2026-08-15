import { useState } from "react";
import { Copy, CheckCircle } from "@phosphor-icons/react";
import Modal from "./Modal";

export default function ResetPasswordResultModal({ email, password, onClose }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal title="Temporary password set" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        Share this with <strong>{email}</strong> so they can sign back in. It's shown only this once — it isn't
        stored anywhere and can't be retrieved again. Their existing sessions have been signed out.
      </p>
      <div className="field-row">
        <input className="input" readOnly value={password} style={{ fontFamily: "monospace", fontWeight: 600 }} />
        <button className="btn btn-outline" onClick={copy}>
          {copied ? <CheckCircle size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.75rem", marginBottom: 0 }}>
        Recommend they change it once they're back in.
      </p>
      <div className="field-row" style={{ justifyContent: "flex-end", marginTop: "1.25rem" }}>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
