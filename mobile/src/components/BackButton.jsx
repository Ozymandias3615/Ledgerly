import { useNavigate } from "react-router-dom";

export default function BackButton({ to }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Back"
      onClick={() => navigate(to)}
    >
      <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
        <polyline points="160,48 80,128 160,208" />
      </svg>
    </button>
  );
}
