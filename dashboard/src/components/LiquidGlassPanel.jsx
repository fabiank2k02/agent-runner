import { motion } from "framer-motion";

export function LiquidGlassPanel({ as: Element = "section", className = "", children, delay = 0, ...props }) {
  const MotionElement = motion[Element] || motion.section;
  return (
    <MotionElement
      className={`liquid-glass-panel ${className}`}
      initial={{ opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.36, delay, ease: [0.2, 0.8, 0.2, 1] }}
      {...props}
    >
      <div className="glass-content">{children}</div>
    </MotionElement>
  );
}
