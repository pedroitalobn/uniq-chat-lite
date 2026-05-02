"use client";

import { motion, AnimatePresence } from "framer-motion";

interface Props {
  tabKey: string;
  children: React.ReactNode;
  className?: string;
}

export function AnimatedTabContent({ tabKey, children, className }: Props) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={tabKey}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -3 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className={className}
        style={{ width: "100%" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
