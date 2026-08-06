export default function Brand({ compact = false }) {
  return (
    <div className="brand">
      <div className="brand-mark">
        <svg width="18" height="18" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
          <polyline points="81,60 131,128 81,196" />
          <polyline points="125,60 175,128 125,196" />
        </svg>
      </div>
      {!compact && <span className="brand-name">LedgerlyGo</span>}
    </div>
  );
}
