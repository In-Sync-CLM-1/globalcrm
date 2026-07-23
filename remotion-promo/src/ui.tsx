import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { C } from './theme';
import { DISPLAY, BODY } from './fonts';

// ── animated background: deep gradient + crisp glows + dot grid + vignette ───
export const Bg: React.FC = () => {
  const frame = useCurrentFrame();
  const dx = (spd: number, ph: number) => Math.sin(frame / spd + ph) * 3;
  const dy = (spd: number, ph: number) => Math.cos(frame / spd + ph) * 3;
  return (
    <AbsoluteFill style={{
      overflow: 'hidden',
      background: `
        radial-gradient(1150px 820px at ${-8 + dx(110, 0)}% ${-14 + dy(110, 0)}%, rgba(45,212,191,.16), transparent 62%),
        radial-gradient(1050px 780px at ${106 + dx(130, 2)}% ${114 + dy(130, 2)}%, rgba(139,92,246,.20), transparent 60%),
        radial-gradient(950px 700px at ${54 + dx(150, 4)}% ${42 + dy(150, 4)}%, rgba(244,114,182,.08), transparent 62%),
        linear-gradient(135deg, ${C.bg1} 0%, ${C.bg2} 45%, ${C.bg3} 100%)`,
    }}>
      <AbsoluteFill style={{
        backgroundImage: 'radial-gradient(rgba(255,255,255,.09) 1.2px, transparent 1.2px)',
        backgroundSize: '44px 44px', opacity: 0.35,
      }} />
      <AbsoluteFill style={{ boxShadow: 'inset 0 0 340px rgba(0,0,0,0.65)' }} />
    </AbsoluteFill>
  );
};

// ── kinetic words (per-word spring rise) ─────────────────────────────────────
// accentColor: ONE solid color for the whole statement (readability rule).
export const Words: React.FC<{ text: string; delay?: number; stagger?: number; accentColor?: string; style?: React.CSSProperties }>
  = ({ text, delay = 0, stagger = 2, accentColor, style }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    return (
      <span style={{ fontFamily: DISPLAY, color: accentColor || '#fff', ...style }}>
        {text.split(' ').map((w, i) => {
          const s = spring({ frame: frame - delay - i * stagger, fps, config: { damping: 200, stiffness: 130, mass: 0.7 } });
          const y = interpolate(s, [0, 1], [46, 0]);
          return (
            <span key={i} style={{ display: 'inline-block', opacity: s, transform: `translateY(${y}px)` }}>
              {w}&nbsp;
            </span>
          );
        })}
      </span>
    );
  };

export const Eyebrow: React.FC<{ text: string; color?: string; delay?: number }> = ({ text, color = C.teal, delay = 0 }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return <div style={{ fontFamily: BODY, fontWeight: 700, letterSpacing: 7, textTransform: 'uppercase', fontSize: 26, color, opacity: s, transform: `translateY(${interpolate(s, [0, 1], [20, 0])}px)` }}>{text}</div>;
};

export const Chip: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 120 } });
  return (
    <div style={{
      display: 'inline-block', fontFamily: BODY, fontWeight: 700, fontSize: 30, color: '#eaf0ff',
      padding: '16px 34px', borderRadius: 999, opacity: interpolate(s, [0, 1], [0, 1]),
      transform: `scale(${interpolate(s, [0, 1], [0.7, 1])})`,
      background: 'linear-gradient(100deg, rgba(45,212,191,.20), rgba(139,92,246,.22))',
      border: '1px solid rgba(139,92,246,.5)', backdropFilter: 'blur(6px)',
    }}>{children}</div>
  );
};

// ── browser device mockup, tilted + floating + glowing ───────────────────────
export const Device: React.FC<{ src: string; delay?: number; side?: 'L' | 'R' | 'C'; width: number; zoom?: number }>
  = ({ src, delay = 0, side = 'C', width, zoom }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig();
    const s = spring({ frame: frame - delay, fps, config: { damping: 200, stiffness: 80, mass: 1 } });
    const float = Math.sin((frame - delay) / 24) * 12;
    const rot = side === 'L' ? 13 : side === 'R' ? -13 : -8;
    const enterX = side === 'L' ? -70 : side === 'R' ? 70 : 0;
    const tx = interpolate(s, [0, 1], [enterX, 0]);
    const sc = interpolate(s, [0, 1], [0.9, 1]);
    return (
      <div style={{
        width, opacity: s, borderRadius: 18, overflow: 'hidden',
        transform: `perspective(1900px) rotateY(${rot}deg) rotateX(4deg) translateX(${tx}px) translateY(${float}px) scale(${sc})`,
        boxShadow: '0 70px 150px rgba(0,0,0,.62), 0 0 110px rgba(139,92,246,.32), 0 0 0 1px rgba(255,255,255,.10)',
        background: '#0b0b18',
      }}>
        <div style={{ height: 46, background: '#15162b', display: 'flex', alignItems: 'center', gap: 9, padding: '0 18px' }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />)}
          <div style={{ marginLeft: 16, height: 22, flex: 1, maxWidth: 360, background: 'rgba(255,255,255,.09)', borderRadius: 11 }} />
        </div>
        {zoom ? (
          // crop to the top region and scale up so dense UI text stays legible
          <div style={{ width: '100%', aspectRatio: `1600/${Math.round(1000 / zoom)}`, overflow: 'hidden' }}>
            <Img src={staticFile(`ui/${src}.png`)} style={{ display: 'block', width: `${zoom * 100}%`, transformOrigin: 'top left' }} />
          </div>
        ) : (
          <Img src={staticFile(`ui/${src}.png`)} style={{ display: 'block', width: '100%' }} />
        )}
        {/* subtle screen sheen */}
        <AbsoluteFill style={{ background: 'linear-gradient(120deg, rgba(255,255,255,.06), transparent 40%)', pointerEvents: 'none' }} />
      </div>
    );
  };

export const GlowButton: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 13, stiffness: 130 } });
  const pulse = 1 + Math.sin(frame / 12) * 0.02;
  return (
    <div style={{
      display: 'inline-block', fontFamily: DISPLAY, fontWeight: 800, fontSize: 42, color: '#fff',
      padding: '28px 68px', borderRadius: 999, background: 'linear-gradient(100deg,#14b8a6,#8b5cf6)',
      opacity: interpolate(s, [0, 1], [0, 1]), transform: `scale(${interpolate(s, [0, 1], [0.7, 1]) * pulse})`,
      boxShadow: '0 24px 60px rgba(139,92,246,.55)',
    }}>{children}</div>
  );
};

