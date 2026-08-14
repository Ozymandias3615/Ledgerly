import React, { useEffect, useState } from "react";

// Mounts at 0 width and grows to its target on the next frame, so the bar
// always animates in on load - recharts' bar/pie charts do this for free
// (isAnimationActive defaults true), these plain CSS bars need it done by
// hand since a transition can't animate a property that's already at its
// final value on first paint.
export default function AnimatedBar({ pct, colorClass = "bg-emerald-600", className = "h-1.5" }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  return (
    <div className={`${className} rounded-full bg-slate-100 overflow-hidden`}>
      <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${colorClass}`} style={{ width: `${width}%` }} />
    </div>
  );
}
