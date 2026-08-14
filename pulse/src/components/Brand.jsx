export default function Brand({ compact = false }) {
  return (
    <div className="brand">
      <div className="brand-mark">
        <svg width="18" height="18" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
          <polyline points="24,140 76,140 96,84 144,196 172,116 192,140 232,140" />
        </svg>
      </div>
      {!compact && <span className="brand-name">LedgerlyPulse</span>}
    </div>
  );
}
