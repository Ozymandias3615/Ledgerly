import { useLocation, useNavigate } from "react-router-dom";
import { Notepad } from "@phosphor-icons/react";

// Header icon on each tab screen - remembers where you came from so Notes'
// back button returns there.
export default function NotesButton() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <button type="button" className="icon-btn" aria-label="Notes" title="Notes" onClick={() => navigate("/notes", { state: { from: pathname } })}>
      <Notepad size={18} />
    </button>
  );
}
