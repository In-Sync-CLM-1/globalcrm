import { useRef, useState, type ReactNode, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

// Mouse-tracked tilt card — the "3D" stat tiles on the Fervent dashboard.
// Pure CSS perspective transform, no dependency: rotation follows cursor
// position within the card, springs back to flat on mouse-leave, and a
// light sheen tracks the same position for a subtle glass highlight.
// Reserved for cards with no canvas content inside (chart cards keep a
// flatter elevated style — tilting a live ECharts canvas reads as broken,
// not "3D").
export function Card3D({ children, className, accent }: { children: ReactNode; className?: string; accent?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  const [glow, setGlow] = useState({ x: 50, y: 50, active: false });

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotateY = (px - 0.5) * 14;
    const rotateX = (0.5 - py) * 14;
    setStyle({
      transform: `perspective(700px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(6px)`,
    });
    setGlow({ x: px * 100, y: py * 100, active: true });
  };

  const handleLeave = () => {
    setStyle({ transform: "perspective(700px) rotateX(0deg) rotateY(0deg) translateZ(0px)" });
    setGlow((g) => ({ ...g, active: false }));
  };

  return (
    <div style={{ perspective: "700px" }}>
      <div
        ref={ref}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        style={style}
        className={cn(
          "relative overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_20px_-8px_rgba(0,0,0,0.18)] transition-transform duration-150 ease-out will-change-transform",
          className
        )}
      >
        {accent && (
          <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
        )}
        {glow.active && (
          <div
            className="pointer-events-none absolute inset-0 opacity-60 transition-opacity"
            style={{
              background: `radial-gradient(220px circle at ${glow.x}% ${glow.y}%, rgba(255,255,255,0.16), transparent 60%)`,
            }}
          />
        )}
        {children}
      </div>
    </div>
  );
}
