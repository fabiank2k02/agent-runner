import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";

const navHeight = 54;

export function LiquidNav({ routes, activeRoute, onRouteChange }) {
  const navRef = useRef(null);
  const [navWidth, setNavWidth] = useState(0);
  const activeIndex = Math.max(0, routes.findIndex((route) => route.id === activeRoute));
  const tabWidth = (navWidth || 850) / routes.length;
  const lens = useMemo(() => lensMetrics(activeIndex, routes.length, tabWidth), [activeIndex, routes.length, tabWidth]);

  useLayoutEffect(() => {
    if (!navRef.current) return undefined;
    const update = () => setNavWidth(navRef.current?.getBoundingClientRect().width || 0);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(navRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      ref={navRef}
      className="liquid-nav"
      aria-label="Primary navigation"
      data-active-index={activeIndex}
      data-active-shape={lens.shape}
      data-renderer="svg-filter"
      style={{ "--tab-count": routes.length }}
    >
      <LiquidNavLens lens={lens} />
      {routes.map((route, index) => (
        <LiquidNavTab
          key={route.id}
          route={route}
          index={index}
          active={route.id === activeRoute}
          onClick={() => onRouteChange(route.id)}
        />
      ))}
    </nav>
  );
}

export function LiquidNavTab({ route, active, onClick }) {
  return (
    <button
      className={`liquid-nav-tab ${active ? "is-active" : ""}`}
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <span>{route.label}</span>
    </button>
  );
}

export function LiquidNavLens({ lens }) {
  const id = useId().replace(/:/g, "");
  const path = lensPath(lens.shape, lens.width, navHeight);
  const rim = rimPath(lens.shape, lens.width, navHeight);
  const lower = lowerLightPath(lens.shape, lens.width, navHeight);

  return (
    <span
      className="liquid-nav-lens"
      aria-hidden="true"
      data-lens-shape={lens.shape}
      style={{ width: lens.width, "--lens-x": `${lens.x}px` }}
    >
      <svg viewBox={`0 0 ${lens.width} ${navHeight}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`nav-lens-fill-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#173061" stopOpacity="0.68" />
            <stop offset="28%" stopColor="#2a55e6" stopOpacity="0.74" />
            <stop offset="62%" stopColor="#2032b8" stopOpacity="0.76" />
            <stop offset="100%" stopColor="#7658e8" stopOpacity="0.58" />
          </linearGradient>
          <linearGradient id={`nav-lens-rim-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
            <stop offset="30%" stopColor="#9fd3ff" stopOpacity="0.52" />
            <stop offset="70%" stopColor="#6fe9ff" stopOpacity="0.36" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.24" />
          </linearGradient>
          <linearGradient id={`nav-lens-lower-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3f8cff" stopOpacity="0" />
            <stop offset="35%" stopColor="#49eaff" stopOpacity="0.96" />
            <stop offset="70%" stopColor="#477bff" stopOpacity="0.88" />
            <stop offset="100%" stopColor="#9b6bff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`nav-lens-hotspot-${id}`} cx="31%" cy="7%" r="74%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
            <stop offset="28%" stopColor="#89d7ff" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#14245e" stopOpacity="0" />
          </radialGradient>
          <filter id={`nav-liquid-filter-${id}`} x="-18%" y="-42%" width="136%" height="184%">
            <feTurbulence type="fractalNoise" baseFrequency="0.018 0.08" numOctaves="2" seed="17" result="noise">
              <animate attributeName="baseFrequency" dur="5.2s" values="0.018 0.08;0.026 0.052;0.018 0.08" repeatCount="indefinite" />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="4.2" xChannelSelector="R" yChannelSelector="G" result="displaced" />
            <feGaussianBlur in="displaced" stdDeviation="0.18" result="softened" />
            <feMerge>
              <feMergeNode in="softened" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={`nav-lens-glow-${id}`} x="-32%" y="-80%" width="164%" height="260%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id={`nav-lens-clip-${id}`}>
            <path d={path} />
          </clipPath>
        </defs>
        <g filter={`url(#nav-liquid-filter-${id})`}>
          <path className="nav-lens-glass" d={path} fill={`url(#nav-lens-fill-${id})`} />
          <path className="nav-lens-hotspot" d={path} fill={`url(#nav-lens-hotspot-${id})`} />
          <g clipPath={`url(#nav-lens-clip-${id})`}>
            <path className="nav-lens-caustic caustic-a" d={`M-18 12 C24 2 49 13 73 8 S128 5 ${lens.width + 24} 15`} />
            <path className="nav-lens-caustic caustic-b" d={`M-10 43 C29 36 52 42 84 37 S136 42 ${lens.width + 22} 33`} />
          </g>
        </g>
        <path className="nav-lens-rim" d={rim} stroke={`url(#nav-lens-rim-${id})`} />
        <path className="nav-lens-lower" d={lower} stroke={`url(#nav-lens-lower-${id})`} filter={`url(#nav-lens-glow-${id})`} />
      </svg>
    </span>
  );
}

function lensMetrics(activeIndex, count, tabWidth) {
  if (activeIndex <= 0) {
    return { x: -1, width: tabWidth + 50, shape: "left" };
  }
  if (activeIndex >= count - 1) {
    return { x: activeIndex * tabWidth - 50, width: tabWidth + 51, shape: "right" };
  }
  return { x: activeIndex * tabWidth - 29, width: tabWidth + 58, shape: "middle" };
}

function lensPath(shape, width, height) {
  const h = height - 2;
  const y = 1;
  const bottom = height - 1;
  const r = height / 2 - 1;
  if (shape === "left") {
    return [
      `M${r + 1} ${y}`,
      `C12 ${y} 1 12 1 ${height / 2}`,
      `C1 ${height - 12} 12 ${bottom} ${r + 1} ${bottom}`,
      `L${width - 18} ${bottom}`,
      `C${width - 27} ${bottom - 8} ${width - 35} ${height * 0.32} ${width - 48} ${y}`,
      "Z"
    ].join(" ");
  }
  if (shape === "right") {
    return [
      `M47 ${y}`,
      `C36 ${height * 0.33} 26 ${bottom - 8} 14 ${bottom}`,
      `L${width - r - 1} ${bottom}`,
      `C${width - 12} ${bottom} ${width - 1} ${height - 12} ${width - 1} ${height / 2}`,
      `C${width - 1} 12 ${width - 12} ${y} ${width - r - 1} ${y}`,
      "Z"
    ].join(" ");
  }
  return [
    `M44 ${y}`,
    `C31 ${height * 0.34} 24 ${bottom - 8} 10 ${bottom}`,
    `L${width - 17} ${bottom}`,
    `C${width - 27} ${bottom - 9} ${width - 35} ${height * 0.32} ${width - 49} ${y}`,
    "Z"
  ].join(" ");
}

function rimPath(shape, width, height) {
  return lensPath(shape, width, height);
}

function lowerLightPath(shape, width, height) {
  const bottom = height - 2;
  if (shape === "left") {
    return `M18 ${bottom - 1} C48 ${bottom + 2} 74 ${bottom + 2} 102 ${bottom - 1} S${width - 38} ${bottom - 1} ${width - 22} ${bottom - 3}`;
  }
  if (shape === "right") {
    return `M18 ${bottom - 3} C52 ${bottom} 82 ${bottom + 2} 118 ${bottom - 1} S${width - 68} ${bottom - 2} ${width - 24} ${bottom - 1}`;
  }
  return `M16 ${bottom - 2} C49 ${bottom + 1} 77 ${bottom + 2} 112 ${bottom - 1} S${width - 51} ${bottom - 1} ${width - 16} ${bottom - 3}`;
}
