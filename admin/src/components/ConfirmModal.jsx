import Modal from "./Modal";

export default function ConfirmModal({ title, description, confirmLabel = "Confirm", destructive = true, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>{description}</p>
      <div className="field-row" style={{ justifyContent: "flex-end", marginTop: "1.25rem" }}>
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className={`btn ${destructive ? "btn-destructive" : "btn-primary"}`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
