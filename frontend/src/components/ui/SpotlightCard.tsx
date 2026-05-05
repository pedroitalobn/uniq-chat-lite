"use client";

import { useRef, MouseEvent, ReactNode } from "react";

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  spotlightColor?: string;
  style?: React.CSSProperties;
}

export function SpotlightCard({
  children, className = "", spotlightColor = "rgba(0,212,106,0.10)", style,
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    if (!cardRef.current || !spotRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    spotRef.current.style.left = `${x}px`;
    spotRef.current.style.top = `${y}px`;
    spotRef.current.style.opacity = "1";
  }

  function handleMouseLeave() {
    if (spotRef.current) spotRef.current.style.opacity = "0";
  }

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`relative overflow-hidden ${className}`}
      style={style}
    >
      {/* Spotlight */}
      <div
        ref={spotRef}
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full w-48 h-48 blur-2xl transition-opacity duration-300"
        style={{ background: spotlightColor, opacity: 0 }}
      />
      {children}
    </div>
  );
}
