import React from 'react';
import { AbsoluteFill, Sequence, Img, staticFile, useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import './fonts';
import { DISPLAY, BODY } from './fonts';
import { C, FPS } from './theme';
import { SCENES } from './timings';
import { Bg, Words, Eyebrow, Chip, Device, GlowButton } from './ui';

// one solid highlight color per statement; varies by scene for rhythm
const HL = { hook: C.teal, sweep: '#a78bfa', outcome: C.pink, cta: C.teal };

const marksOf = (k: string): Record<string, number> => {
  const sc = SCENES.find((s) => s.k === k);
  return (sc ? { ...sc.marks } : {}) as Record<string, number>;
};

// portrait (1080x1920) rendering: scenes stack vertically and type scales down
const VertCtx = React.createContext(false);
const useVert = () => React.useContext(VertCtx);

const Center: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '0 8%', ...style }}>{children}</AbsoluteFill>
);

const H1 = 118, H2 = 84;

// ── Scene: Hook ───────────────────────────────────────────────────────────────
const Hook: React.FC = () => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const V = useVert();
  const M = marksOf('hook');
  const subS = spring({ frame: frame - M.sub, fps, config: { damping: 200 } });
  const keepS = spring({ frame: frame - M.keeps, fps, config: { damping: 15, stiffness: 130 } });
  return (
    <Center>
      <div>
        <Eyebrow text="In-Sync CRM" delay={0} />
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: V ? 88 : H1, lineHeight: 1.04, letterSpacing: -2, marginTop: 24 }}>
          <Words text="Your CRM should" delay={6} />
          <br />
          <Words text="work for you." delay={22} accentColor={HL.hook} />
        </div>
        <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: V ? 34 : 42, color: C.dim, marginTop: 40, opacity: subS, transform: `translateY(${interpolate(subS, [0, 1], [24, 0])}px)` }}>
          Not the other way around.
        </div>
        <div style={{ marginTop: V ? 46 : 40, opacity: keepS, transform: `scale(${interpolate(keepS, [0, 1], [0.8, 1])})` }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: V ? 52 : 64, color: '#fff' }}>
            The modern, <span style={{ color: HL.hook, textShadow: '0 0 44px rgba(45,212,191,.4)' }}>AI-native CRM.</span>
          </span>
        </div>
      </div>
    </Center>
  );
};

// ── Scene: Sweep (device cycling module stills, cuts locked to the voice) ────
const SWEEP_KEYS = ['dashboard', 'pipeline', 'contact', 'coaching', 'aicaller', 'insights'];
const SWEEP_LABELS = ['AI command center', 'Every channel, one pipeline', 'Enriched contacts', 'AI call coaching', 'AI caller', 'Real-time insights'];

const sweepIdx = (frame: number, M: Record<string, number>) => {
  let idx = 0;
  for (let i = 0; i < SWEEP_KEYS.length; i++) if (frame >= (M[`f${i}`] ?? 1e9)) idx = i;
  return idx;
};

const SweepDevice: React.FC<{ idx: number }> = ({ idx }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const V = useVert();
  const s = spring({ frame: frame - 20, fps, config: { damping: 200, stiffness: 80 } });
  const float = Math.sin(frame / 26) * 12;
  const push = 1 + Math.min(frame * 0.00028, 0.045);
  return (
    <div style={{
      width: V ? 980 : 1220, opacity: s, borderRadius: 18, overflow: 'hidden', margin: '0 auto',
      transform: `perspective(2000px) rotateX(6deg) translateY(${interpolate(s, [0, 1], [40, 0]) + float}px) scale(${interpolate(s, [0, 1], [0.92, 1]) * push})`,
      boxShadow: '0 70px 160px rgba(0,0,0,.62), 0 0 120px rgba(139,92,246,.34), 0 0 0 1px rgba(255,255,255,.10)', background: '#0b0b18',
    }}>
      <div style={{ height: 46, background: '#15162b', display: 'flex', alignItems: 'center', gap: 9, padding: '0 18px' }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />)}
        <div style={{ marginLeft: 16, height: 22, flex: 1, maxWidth: 360, background: 'rgba(255,255,255,.09)', borderRadius: 11 }} />
      </div>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1600/1000', background: '#0b0b18' }}>
        {SWEEP_KEYS.map((k, i) => (
          <Img key={k} src={staticFile(`ui/${k}.png`)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', opacity: i === idx ? 1 : 0, transition: 'opacity .3s' }} />
        ))}
      </div>
    </div>
  );
};

const Sweep: React.FC = () => {
  const frame = useCurrentFrame();
  const V = useVert();
  const M = marksOf('sweep');
  const idx = sweepIdx(frame, M);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 6%' }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: V ? 64 : H2, textAlign: 'center', letterSpacing: -1 }}>
        <Words text="One platform." delay={4} /><Words text=" Lead to closure." delay={16} accentColor={HL.sweep} />
      </div>
      <div style={{ marginTop: V ? 56 : 34 }}><SweepDevice idx={idx} /></div>
      <div style={{ marginTop: V ? 52 : 30 }}><Chip key={idx} delay={0}>{SWEEP_LABELS[idx]}</Chip></div>
    </AbsoluteFill>
  );
};

// ── Scene: Power beat ─────────────────────────────────────────────────────────
// zoom: crop-scale a text-dense screenshot so the meaningful top region reads
// at video size instead of shrinking into a grey wall of text.
const Power: React.FC<{ k: string; n: string; title: string; chip: React.ReactNode; src: string; side: 'L' | 'R'; accentColor: string; zoom?: number }>
  = ({ k, n, title, chip, src, side, accentColor, zoom }) => {
    const V = useVert();
    const M = marksOf(k);
    if (V) {
      return (
        <AbsoluteFill style={{ flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '0 5%' }}>
          <Eyebrow text={n} color={accentColor} delay={0} />
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 72, letterSpacing: -1, marginTop: 18 }}><Words text={title} delay={8} /></div>
          <div style={{ marginTop: 54 }}><Device src={src} side={side} width={940} delay={6} zoom={zoom} /></div>
          <div style={{ marginTop: 64 }}><Chip delay={M.chip ?? 22}>{chip}</Chip></div>
        </AbsoluteFill>
      );
    }
    const text = (
      <div style={{ flex: 1, padding: side === 'R' ? '0 4% 0 6%' : '0 6% 0 4%' }}>
        <Eyebrow text={n} color={accentColor} delay={0} />
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: H2, letterSpacing: -1, marginTop: 20 }}><Words text={title} delay={8} /></div>
        <div style={{ marginTop: 36 }}><Chip delay={M.chip ?? 22}>{chip}</Chip></div>
      </div>
    );
    const dev = <div style={{ flex: 1.15, display: 'flex', justifyContent: 'center' }}><Device src={src} side={side} width={980} delay={6} zoom={zoom} /></div>;
    return (
      <AbsoluteFill style={{ flexDirection: 'row', alignItems: 'center', padding: '0 6%' }}>
        {side === 'R' ? <>{dev}{text}</> : <>{text}{dev}</>}
      </AbsoluteFill>
    );
  };

// ── Scene: Outcome ────────────────────────────────────────────────────────────
const Outcome: React.FC = () => {
  const V = useVert();
  const M = marksOf('outcome');
  const lead = (f: number) => Math.max(0, f - 8);
  return (
    <Center>
      <div>
        <Eyebrow text="The result" color={C.pink} delay={0} />
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: V ? 72 : 98, lineHeight: 1.16, letterSpacing: -1, marginTop: 26 }}>
          <div><Words text="Less busywork." delay={lead(M.l0)} /></div>
          <div><Words text="More closing." delay={lead(M.l1)} accentColor={HL.outcome} /></div>
          <div><Words text="A CRM they'll actually use." delay={lead(M.l2)} /></div>
        </div>
      </div>
    </Center>
  );
};

// ── Scene: CTA ────────────────────────────────────────────────────────────────
const Cta: React.FC = () => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const V = useVert();
  const M = marksOf('cta');
  const logoS = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const subS = spring({ frame: frame - M.url, fps, config: { damping: 200 } });
  return (
    <Center>
      <div>
        <div style={{ display: 'inline-block', background: '#fff', borderRadius: 22, padding: '20px 38px', boxShadow: '0 24px 70px rgba(0,0,0,.4)', opacity: logoS, transform: `scale(${interpolate(logoS, [0, 1], [0.7, 1])})` }}>
          <Img src={staticFile('logo.png')} style={{ height: V ? 78 : 92, display: 'block' }} />
        </div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: V ? 60 : H2, letterSpacing: -1, marginTop: 44 }}>
          <Words text="The AI-native CRM" delay={10} /><br /><Words text="your team will adopt." delay={30} accentColor={HL.cta} />
        </div>
        <div style={{ marginTop: 48 }}><GlowButton delay={M.btn}>Book your free demo &rarr;</GlowButton></div>
        <div style={{ fontFamily: BODY, fontSize: V ? 26 : 30, color: C.dim, marginTop: 30, opacity: subS }}>crm.in-sync.co.in &middot; part of the In-Sync suite</div>
      </div>
    </Center>
  );
};

// ── assembly with crossfades + slow per-scene push ────────────────────────────
const OVERLAP = 9;
const Fade: React.FC<{ dur: number; first?: boolean; last?: boolean; children: React.ReactNode }> = ({ dur, first, last, children }) => {
  const frame = useCurrentFrame();
  const op = interpolate(frame, [0, OVERLAP, dur, dur + OVERLAP], [first ? 1 : 0, 1, 1, last ? 1 : 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const push = 1 + Math.min(frame / (dur + OVERLAP), 1) * 0.014;
  return <AbsoluteFill style={{ opacity: op, transform: `scale(${push})` }}>{children}</AbsoluteFill>;
};

export const Promo: React.FC<{ vertical?: boolean }> = ({ vertical }) => {
  const comp: Record<string, React.ReactNode> = {
    hook: <Hook />, sweep: <Sweep />, outcome: <Outcome />, cta: <Cta />,
    p1: <Power k="p1" n="One" title="Every channel, one pipeline." chip={<>Events &middot; web &middot; ads &middot; email &middot; WhatsApp</>} src="pipeline" side="R" accentColor={C.teal} />,
    p2: <Power k="p2" n="Two" title="Data enriches itself." chip={<>One-click enrichment + AI lead score</>} src="contact" side="L" accentColor={C.violet} zoom={1.5} />,
    p3: <Power k="p3" n="Three" title="AI coaches every call." chip={<>Scored calls &middot; exactly what to fix</>} src="coaching" side="R" accentColor={C.pink} zoom={1.7} />,
    adds: <Power k="adds" n="And it's all AI" title="Know what to close next." chip={<>Pipeline health &middot; bottlenecks &middot; live</>} src="insights" side="L" accentColor={'#a78bfa'} zoom={1.5} />,
  };
  let acc = 0;
  const seqs = SCENES.map((sc, i) => {
    const dur = Math.round(sc.s * FPS);
    const from = acc;
    acc += dur;
    const last = i === SCENES.length - 1;
    return (
      <Sequence key={sc.k} from={from} durationInFrames={last ? undefined : dur + OVERLAP}>
        <Fade dur={dur} first={i === 0} last={last}>{comp[sc.k]}</Fade>
      </Sequence>
    );
  });
  return (
    <VertCtx.Provider value={!!vertical}>
      <AbsoluteFill style={{ background: C.bg1 }}>
        <Bg />
        {seqs}
      </AbsoluteFill>
    </VertCtx.Provider>
  );
};
