import { useEffect } from "react";
import { X } from "@phosphor-icons/react";

export default function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        {title && <div className="modal-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}
