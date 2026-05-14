"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Primitive: DockIcon ──────────────────────────────────────────────────────
// A single icon button for use inside a dock. Shows tooltip to the right.
// badge: number or string shown as a pill.
// pulse: shows a glowing dot indicator.
// active: highlights with the  Qchat green.

interface DockIconProps {
  icon: React.ElementType;
  label: string;
  badge?: string | number;
  pulse?: boolean;
  active?: boolean;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  /** Render a custom element instead of the icon */
  children?: React.ReactNode;
}

export function DockIcon({ icon: Icon, label, badge, pulse, active, onClick, danger, children }: DockIconProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div className="relative flex items-center" style={{ isolation: "isolate" }}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={label}
        style={{
          position: "relative",
          width: 40,
          height: 40,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          border: active
            ? "1px solid rgba(37, 99, 235,0.35)"
            : "1px solid var(--border-default)",
          background: active
            ? "linear-gradient(135deg, rgba(37, 99, 235,0.22), rgba(37, 99, 235,0.08))"
            : hovered
            ? "var(--border-default)"
            : "var(--input)",
          color: active ? "#2563EB" : danger ? "#f87171" : "rgba(255,255,255,0.65)",
          boxShadow: active
            ? "0 0 16px rgba(37, 99, 235,0.25), inset 0 1px 0 var(--border-default)"
            : hovered && !danger
            ? "0 4px 16px rgba(0,0,0,0.3)"
            : "none",
          transform: hovered ? "scale(1.07) translateX(2px)" : "scale(1) translateX(0)",
          transition: "all 0.2s cubic-bezier(0.34,1.56,0.64,1)",
          cursor: "pointer",
          outline: "none",
        }}
      >
        {children ?? <Icon style={{ width: 16, height: 16 }} strokeWidth={active ? 2.2 : 1.9} />}

        {/* Pulse dot */}
        {pulse && (
          <span style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#2563EB",
            boxShadow: "0 0 6px #2563EB",
            animation: "dockPulse 2s ease-in-out infinite",
          }} />
        )}

        {/* Badge */}
        {badge != null && !pulse && (
          <span style={{
            position: "absolute",
            top: -4,
            right: -4,
            minWidth: 16,
            height: 16,
            borderRadius: 99,
            background: "#2563EB",
            color: "#03170a",
            fontSize: 9,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 3px",
            boxShadow: "0 0 6px rgba(37, 99, 235,0.5)",
          }}>
            {typeof badge === "number" && badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>

      {/* Tooltip — appears to the right */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.15 }}
            style={{
              position: "absolute",
              left: "calc(100% + 10px)",
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
              whiteSpace: "nowrap",
              zIndex: 100,
            }}
          >
            <div style={{
              padding: "4px 10px",
              borderRadius: 8,
              background: "rgba(20,20,30,0.95)",
              border: "1px solid var(--border-default)",
              color: "rgba(255,255,255,0.92)",
              fontSize: 11,
              fontWeight: 500,
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              backdropFilter: "blur(12px)",
            }}>
              {label}
              {/* Arrow */}
              <span style={{
                position: "absolute",
                left: -5,
                top: "50%",
                transform: "translateY(-50%)",
                width: 0,
                height: 0,
                borderTop: "5px solid transparent",
                borderBottom: "5px solid transparent",
                borderRight: "5px solid rgba(20,20,30,0.95)",
              }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Primitive: DockDivider ───────────────────────────────────────────────────
export function DockDivider() {
  return (
    <div style={{
      width: 24,
      height: 1,
      background: "linear-gradient(90deg, transparent, var(--border-default), transparent)",
      margin: "2px 0",
    }} />
  );
}

// ─── Primitive: DockContainer ─────────────────────────────────────────────────
// Vertical pill container. Wrap DockIcon + DockDivider inside.
export function DockContainer({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "12px 8px",
        borderRadius: 24,
        background: "rgba(10,10,16,0.82)",
        backdropFilter: "blur(24px) saturate(200%)",
        WebkitBackdropFilter: "blur(24px) saturate(200%)",
        border: "1px solid var(--border-default)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.55), 0 1px 0 var(--border-subtle) inset, 4px 0 24px rgba(0,0,0,0.2)",
      }}
    >
      {children}
      <style>{`
        @keyframes dockPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}
