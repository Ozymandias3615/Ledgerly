export default function Brand({ compact = false }) {
  return (
    <div className="brand">
      <div className="brand-mark">
        <svg width="18" height="18" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
          <path d="M68,40 L188,40 L188,170 L178,186 L168,170 L158,186 L148,170 L138,186 L128,170 L118,186 L108,170 L98,186 L88,170 L78,186 L68,170 Z" />
          <line x1="88" y1="72" x2="168" y2="72" />
          <line x1="88" y1="98" x2="168" y2="98" />
          <line x1="88" y1="124" x2="140" y2="124" />
        </svg>
      </div>
      {!compact && <span className="brand-name">Ledgerly</span>}
    </div>
  );
}
