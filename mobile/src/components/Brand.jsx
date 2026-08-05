export default function Brand({ compact = false }) {
  return (
    <div className="brand">
      <div className="brand-mark">
        <svg width="18" height="18" viewBox="0 0 256 256" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M216,72H56a8,8,0,0,1,0-16H192a8,8,0,0,0,0-16H56A24,24,0,0,0,32,64V192a24,24,0,0,0,24,24H216a16,16,0,0,0,16-16V88A16,16,0,0,0,216,72Zm-36,80a12,12,0,1,1,12-12A12,12,0,0,1,180,152Z" />
        </svg>
      </div>
      {!compact && <span className="brand-name">Ledgerly</span>}
    </div>
  );
}
