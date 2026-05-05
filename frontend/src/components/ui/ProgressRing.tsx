"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";

interface ProgressRingProps {
  value: number; // 0-100
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  sublabel?: string;
  className?: string;
}

export function ProgressRing({
  value,
  size = 80,
  strokeWidth = 6,
  color = "#00d46a",
  trackColor = "rgba(255,255,255,0.06)",
  label,
  sublabel,
  className,
}: ProgressRingProps) {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref as any, { once: true, margin: "-20px" });
  const [animated, setAnimated] = useState(0);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (animated / 100) * circumference;

  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    const duration = 900;
    function tick(now: number) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimated(eased * value);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [inView, value]);

  return (
    <div className={`flex flex-col items-center gap-1.5 ${className ?? ""}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg ref={ref} width={size} height={size} className="-rotate-90">
          {/* Track */}
          <circle cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
          {/* Progress */}
          <circle cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 0.05s linear" }}
          />
        </svg>
        {label && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-sm font-bold" style={{ color: "hsl(240 15% 92%)" }}>
              {label}
            </span>
          </div>
        )}
      </div>
      {sublabel && (
        <span className="text-xs text-center" style={{ color: "hsl(240 8% 50%)" }}>
          {sublabel}
        </span>
      )}
    </div>
  );
}
