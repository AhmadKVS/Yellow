'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MatchResult, Profile } from '@/lib/types';
import Bubble from './Bubble';

/* `RankedMatch` from `@/lib/match` is structurally identical to this, so
   `RankedMatch[]` passes straight in. Declared locally so this component
   has no build-order dependency on the matching layer. */
export type FieldMatch = MatchResult & { normalized: number };

export interface BubbleFieldProps {
  /** The signed-in person. Renders as the big bubble at dead centre. */
  me: Profile | null | undefined;
  /** Ranked matches, score descending. `normalized` drives size + distance. */
  matches: FieldMatch[];
  /** id of the person whose card is open, so their bubble can light up. */
  selectedId?: string | null;
  onSelect?: (match: FieldMatch) => void;
  onSelectMe?: () => void;
  className?: string;
}

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */
const ME_SIZE = 132;
const D_MIN = 56;
const D_SPAN = 44; // 56 → 100
const R_MIN = 110; // tightest orbit — hugging the centre bubble
const PAD = 15; // clear space between two discs — the names live in this gap
const GOLDEN = Math.PI * (137.5 / 180);
const SCALE_MIN = 0.6;
const SCALE_MAX = 1.6;

const SANS =
  'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;
const clamp01 = (n: number) =>
  Number.isFinite(n) ? clamp(n, 0, 1) : 0;

/* Threads run cream at low overlap and warm to systemYellow at high, so the
   map's strongest links read before you've parsed a single label. Computed
   at render, never per frame. */
function threadColor(norm: number): string {
  const t = clamp01(norm);
  return `rgb(255 ${Math.round(248 - t * 34)} ${Math.round(231 - t * 221)})`;
}

/* Client Components still render on the server for the initial HTML, and
   useLayoutEffect logs a warning there. Same hook order either way. */
const useIsoLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/* Deterministic per-person jitter — same cluster every reload, and no
   Math.random() to desync between renders. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function seeded(h: number, salt: number): number {
  const x = Math.sin(h * 0.00013 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

interface FieldNode {
  id: string;
  d: number;
  r: number;
  norm: number;
  targetR: number;
  x: number;
  y: number;
  drift: number; // rad/sec, signed
  fx: number;
  fy: number;
  px: number;
  py: number;
  amp: number;
}

/* Pairwise separation + a soft pull back toward each node's ideal orbit.
   Called ~30x at layout time (hard pull) and 1x per frame (feather pull). */
function relax(
  nodes: FieldNode[],
  cx: number,
  cy: number,
  meR: number,
  iterations: number,
  pull: number
) {
  const n = nodes.length;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const min = a.r + b.r + PAD;
        if (dist < min) {
          const push = (min - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      let dx = node.x - cx;
      let dy = node.y - cy;
      let dist = Math.hypot(dx, dy) || 0.0001;
      const floor = meR + node.r + PAD;
      if (dist < floor) {
        node.x = cx + (dx / dist) * floor;
        node.y = cy + (dy / dist) * floor;
        dx = node.x - cx;
        dy = node.y - cy;
        dist = floor;
      }
      const want = Math.max(node.targetR, floor);
      const next = dist + (want - dist) * pull;
      node.x = cx + (dx / dist) * next;
      node.y = cy + (dy / dist) * next;
    }
  }
}

function FieldStyles() {
  return (
    <style href="yellow-field" precedence="high">{`
@keyframes y-breathe{
  0%,100%{ transform:scale(1); opacity:.58 }
  50%    { transform:scale(1.06); opacity:.95 }
}
.y-halo{ animation: y-breathe 6.4s cubic-bezier(.45,0,.55,1) infinite; }
.y-recenter{
  display:inline-flex; align-items:center; gap:7px;
  height:44px; padding:0 16px 0 14px; border-radius:9999px; cursor:pointer;
  font-size:14px; font-weight:600; letter-spacing:-.01em; color:#FFD60A;
  background:rgba(255,214,10,.13);
  border:1px solid rgba(255,255,255,.14);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.22);
  backdrop-filter:blur(18px) saturate(1.6);
  -webkit-backdrop-filter:blur(18px) saturate(1.6);
  transition: opacity 380ms cubic-bezier(.32,.72,0,1),
              transform 380ms cubic-bezier(.32,.72,0,1),
              background 200ms linear, border-color 200ms linear;
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){
  .y-recenter{ background:rgba(60,48,10,.85); border-color:rgba(255,214,10,.34); }
}
.y-noglass .y-recenter{
  backdrop-filter:none; -webkit-backdrop-filter:none;
  background:rgba(60,48,10,.85); border-color:rgba(255,214,10,.34);
}
.y-recenter:hover{ background:rgba(255,214,10,.2); border-color:rgba(255,255,255,.24); }
.y-recenter:active{ background:rgba(255,214,10,.26); }
.y-recenter:focus-visible{ outline:2px solid #FFD60A; outline-offset:2px; }
/* The grid is the space itself: it lives inside the camera, so panning and
   zooming carry it along with no per-frame work at all. Oversized well past
   the container and masked to nothing long before its own edge, so no seam
   is reachable at any pan offset or zoom level. Graph-paper hierarchy —
   cream minors every 56px, a yellow major every fourth — so it reads as
   instrumentation rather than wallpaper, and gives the glass discs
   something real to refract as they drift across it. */
.y-grid{
  position:absolute; inset:-40%; pointer-events:none;
  background-position:50% 50%;
  background-repeat:repeat;
  background-size:224px 224px, 224px 224px, 56px 56px, 56px 56px;
  /* majors are 2px on purpose: a 1px line is annihilated by the discs'
     frost, and the whole point of the pairing is seeing the grid bend
     through the glass. Alpha stays low because the discs brighten whatever
     is behind them — the lines land far hotter under a bubble than beside
     one, and pushed any higher they start competing with the cluster. */
  background-image:
    linear-gradient(to right, rgba(255,214,10,.22) 0 2px, transparent 2px),
    linear-gradient(to bottom, rgba(255,214,10,.22) 0 2px, transparent 2px),
    linear-gradient(to right, rgba(255,248,231,.125) 0 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,248,231,.125) 0 1px, transparent 1px);
  -webkit-mask-image:radial-gradient(ellipse 34% 34% at 50% 50%,
    #000 0%, #000 56%, rgba(0,0,0,0) 100%);
  mask-image:radial-gradient(ellipse 34% 34% at 50% 50%,
    #000 0%, #000 56%, rgba(0,0,0,0) 100%);
}
@media (prefers-reduced-motion: reduce){
  .y-halo{ animation:none; opacity:.8 }
  .y-recenter{ transition-duration:1ms }
}
`}</style>
  );
}

/* The cluster's own light, kept to a whisper — the spheres get their pop
   from sitting on true black, not from bloom. Lives inside the camera so
   it travels with them instead of leaving a lit patch of empty canvas. */
const CORE_GLOW =
  'radial-gradient(62% 48% at 50% 50%, rgba(255,201,10,.13) 0%, rgba(255,150,0,.05) 52%, rgba(255,150,0,0) 78%)';

const VIGNETTE =
  'radial-gradient(140% 108% at 50% 48%, rgba(5,4,3,0) 62%, rgba(5,4,3,.34) 84%, rgba(3,2,1,.8) 100%)';

export default function BubbleField({
  me,
  matches,
  selectedId = null,
  onSelect,
  onSelectMe,
  className,
}: BubbleFieldProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<HTMLDivElement | null>(null);
  const meElRef = useRef<HTMLDivElement | null>(null);
  const recenterRef = useRef<HTMLButtonElement | null>(null);

  const bubbleEls = useRef(new Map<string, HTMLDivElement>());
  const threadEls = useRef(new Map<string, SVGLineElement>());
  const nodesRef = useRef<FieldNode[]>([]);
  const bloomedRef = useRef(false);

  const camRef = useRef({
    x: 0,
    y: 0,
    s: 1,
    tx: 0,
    ty: 0,
    ts: 1,
    home: 1,
    dragging: false,
  });

  const reducedRef = useRef(false);
  const movedRef = useRef(false);
  /* Glass costs a backdrop read per disc per frame. If this machine can't
     pay for it, the discs drop to the opaque fallback fill — motion beats
     material. Flipped at most once, by a classList write, never a render. */
  const degradedRef = useRef(false);

  const [size, setSize] = useState({ w: 0, h: 0 });

  /* Keep the latest props reachable from stable callbacks so the memo'd
     bubbles never receive a new onClick identity. */
  const matchById = useMemo(() => {
    const map = new Map<string, FieldMatch>();
    for (const m of matches ?? []) if (m?.person?.id) map.set(m.person.id, m);
    return map;
  }, [matches]);

  const matchesRef = useRef(matches);
  const matchByIdRef = useRef(matchById);
  const onSelectRef = useRef(onSelect);
  const onSelectMeRef = useRef(onSelectMe);
  const meRef = useRef(me);
  matchesRef.current = matches;
  matchByIdRef.current = matchById;
  onSelectRef.current = onSelect;
  onSelectMeRef.current = onSelectMe;
  meRef.current = me;

  const handleBubbleClick = useCallback((profile: Profile) => {
    const m = matchByIdRef.current.get(profile.id);
    if (m) onSelectRef.current?.(m);
  }, []);

  const handleMeClick = useCallback(() => {
    onSelectMeRef.current?.();
  }, []);

  /* Only rebuild the cluster when the people or the box actually change. */
  const layoutKey = useMemo(() => {
    const ids = (matches ?? [])
      .map((m) => `${m?.person?.id ?? '?'}:${(m?.normalized ?? 0).toFixed(3)}`)
      .join('|');
    return `${me?.id ?? 'none'}#${ids}`;
  }, [me?.id, matches]);

  /* ---------------- measure ---------------- */
  useIsoLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((prev) =>
        Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
          ? prev
          : { w: r.width, h: r.height }
      );
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------------- reduced motion ---------------- */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedRef.current = mq.matches;
    const onChange = () => {
      reducedRef.current = mq.matches;
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /* ---------------- layout + animation ---------------- */
  useIsoLayoutEffect(() => {
    const { w, h } = size;
    const meNow = meRef.current;
    if (!w || !h || !meNow) return;

    const list = (matchesRef.current ?? []).filter((m) => m?.person?.id);
    const cx = w / 2;
    const cy = h / 2;
    const meR = ME_SIZE / 2;

    /* The physics runs in circular space, but a phone column is much taller
       than it is wide. `ky` stretches the cluster vertically at paint time
       only — stretching can never create an overlap, so the solver stays
       correct while the cluster fills the space it was actually given. */
    const ky = clamp(Math.pow(h / Math.max(w, 1), 0.72), 1, 1.5);
    const budget = Math.min(w / 2, h / (2 * ky));

    /* --- deterministic seed layout --- */
    const nodes: FieldNode[] = list.map((m, i) => {
      const norm = Number.isFinite(m.normalized)
        ? clamp01(m.normalized)
        : list.length > 1
          ? 1 - i / (list.length - 1)
          : 1;
      const d = D_MIN + norm * D_SPAN;
      const r = d / 2;
      const rMax = Math.max(R_MIN + 14, budget - r - 8);
      const targetR = rMax - norm * (rMax - R_MIN);
      const angle = -Math.PI / 2 + i * GOLDEN;
      const hash = hashString(m.person.id);
      return {
        id: m.person.id,
        d,
        r,
        norm,
        targetR,
        x: cx + Math.cos(angle) * targetR,
        y: cy + Math.sin(angle) * targetR,
        drift: (seeded(hash, 1) - 0.5) * 0.055,
        fx: 0.24 + seeded(hash, 2) * 0.3,
        fy: 0.2 + seeded(hash, 3) * 0.28,
        px: seeded(hash, 4) * Math.PI * 2,
        py: seeded(hash, 5) * Math.PI * 2,
        amp: 3.4 + seeded(hash, 6) * 2.4,
      };
    });

    relax(nodes, cx, cy, meR, 30, 0.28);
    nodesRef.current = nodes;

    /* --- fit the cluster to the box: scales up when there's room to spare,
           down when there isn't, so it never lands lost in a void --- */
    let extentX = meR + 8;
    let extentY = meR + 8;
    for (const n of nodes) {
      extentX = Math.max(extentX, Math.abs(n.x - cx) + n.r + 6);
      extentY = Math.max(extentY, Math.abs(n.y - cy) * ky + n.r + 6);
    }
    const home = clamp(
      Math.min((w / 2 - 8) / extentX, (h / 2 - 8) / extentY),
      SCALE_MIN,
      1.22
    );
    const cam = camRef.current;
    cam.home = home;
    cam.ts = home;
    // first mount settles outward from slightly-too-small: a gravitational
    // bloom rather than a pop. Subsequent relayouts just snap.
    cam.s = bloomedRef.current ? home : home * 0.87;
    cam.x = cam.tx = 0;
    cam.y = cam.ty = 0;

    if (meElRef.current) {
      meElRef.current.style.transform = `translate3d(${cx - meR}px, ${
        cy - meR
      }px, 0)`;
    }

    /* --- the loop --- */
    let raf = 0;
    let last = 0;
    let winFrames = 0;
    let winTime = 0;
    let windows = 0;
    let bad = 0;

    const paint = (t: number) => {
      const nodesNow = nodesRef.current;
      for (let i = 0; i < nodesNow.length; i++) {
        const n = nodesNow[i];
        const wob = reducedRef.current ? 0 : 1;
        const wx = wob * Math.sin(t * n.fx + n.px) * n.amp;
        const wy = wob * Math.cos(t * n.fy + n.py) * n.amp * 0.85;
        const sx = n.x + wx;
        const sy = cy + (n.y + wy - cy) * ky;
        const el = bubbleEls.current.get(n.id);
        if (el) {
          el.style.transform = `translate3d(${(sx - n.r).toFixed(2)}px, ${(
            sy - n.r
          ).toFixed(2)}px, 0)`;
        }
        const line = threadEls.current.get(n.id);
        if (line) {
          const dx = sx - cx;
          const dy = sy - cy;
          const dist = Math.hypot(dx, dy) || 1;
          const ux = dx / dist;
          const uy = dy / dist;
          const start = meR + 7;
          const end = dist - n.r - 7;
          if (end - start > 6) {
            line.setAttribute('x1', (cx + ux * start).toFixed(1));
            line.setAttribute('y1', (cy + uy * start).toFixed(1));
            line.setAttribute('x2', (cx + ux * end).toFixed(1));
            line.setAttribute('y2', (cy + uy * end).toFixed(1));
            line.style.visibility = 'visible';
          } else {
            line.style.visibility = 'hidden';
          }
        }
      }
    };

    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const t = now / 1000;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;

      /* frame budget watch — numbers only, no allocation, and it stops
         looking after the first few seconds */
      if (!degradedRef.current && windows < 6) {
        winFrames++;
        winTime += dt;
        if (winTime >= 1) {
          windows++;
          // the first window is mount jank, never evidence
          bad = windows > 1 && winFrames / winTime < 36 ? bad + 1 : 0;
          if (bad >= 2) {
            degradedRef.current = true;
            containerRef.current?.classList.add('y-noglass');
          }
          winFrames = 0;
          winTime = 0;
        }
      }

      if (!reducedRef.current && nodesRef.current.length) {
        const ns = nodesRef.current;
        for (let i = 0; i < ns.length; i++) {
          const n = ns[i];
          const a = n.drift * dt;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const dx = n.x - cx;
          const dy = n.y - cy;
          n.x = cx + dx * ca - dy * sa;
          n.y = cy + dx * sa + dy * ca;
        }
        relax(ns, cx, cy, meR, 1, 0.02);
      }

      /* camera easing */
      const c = camRef.current;
      const f = Math.min(1, dt * 13);
      c.x += (c.tx - c.x) * f;
      c.y += (c.ty - c.y) * f;
      c.s += (c.ts - c.s) * f;
      if (cameraRef.current) {
        cameraRef.current.style.transform = `translate3d(${c.x.toFixed(
          2
        )}px, ${c.y.toFixed(2)}px, 0) scale(${c.s.toFixed(4)})`;
      }
      const off =
        Math.abs(c.tx) > 14 ||
        Math.abs(c.ty) > 14 ||
        Math.abs(c.ts - c.home) > 0.05;
      const rb = recenterRef.current;
      if (rb) {
        rb.style.visibility = off ? 'visible' : 'hidden';
        rb.style.opacity = off ? '1' : '0';
        rb.style.transform = off ? 'translateY(0)' : 'translateY(6px)';
      }

      paint(t);
    };

    paint(0);
    if (cameraRef.current) {
      cameraRef.current.style.transform = `translate3d(0px, 0px, 0) scale(${cam.s.toFixed(
        4
      )})`;
      cameraRef.current.style.opacity = '1';
    }
    bloomedRef.current = true;
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [layoutKey, size.w, size.h]);

  /* ---------------- pan / zoom ---------------- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const pointers = new Map<number, { x: number; y: number }>();
    const drag = {
      sx: 0,
      sy: 0,
      ox: 0,
      oy: 0,
      pinchDist: 0,
      pinchScale: 1,
    };

    /* Pan headroom grows with zoom — zoomed in you need more reach to get
       to the edge of the cluster, zoomed out you shouldn't be able to shove
       it off screen. */
    const limits = () => {
      const r = el.getBoundingClientRect();
      const z = Math.max(camRef.current.ts, 0.6);
      return {
        px: Math.max(60, r.width * 0.3 * z),
        py: Math.max(60, r.height * 0.3 * z),
        rect: r,
      };
    };

    const rubber = (v: number, lim: number) => {
      if (v > lim) return lim + (v - lim) * 0.34;
      if (v < -lim) return -lim + (v + lim) * 0.34;
      return v;
    };

    const zoomAt = (next: number, px: number, py: number) => {
      const c = camRef.current;
      const k = next / c.ts;
      c.tx = px - (px - c.tx) * k;
      c.ty = py - (py - c.ty) * k;
      c.ts = next;
    };

    const onPointerDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        movedRef.current = false;
        camRef.current.dragging = true;
        drag.sx = e.clientX;
        drag.sy = e.clientY;
        drag.ox = camRef.current.tx;
        drag.oy = camRef.current.ty;
        /* Capturing here would retarget the matching pointerup/click to `el`
           itself, even for a plain tap — so a bubble's own button never
           sees the click. Only capture for drags that don't start on a
           control; those still pan fine via normal bubbling. */
        const interactive =
          e.target instanceof Element && e.target.closest('button');
        if (!interactive) {
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            /* capture is best-effort */
          }
        }
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        drag.pinchDist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        drag.pinchScale = camRef.current.ts;
        movedRef.current = true;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = camRef.current;

      if (pointers.size >= 2) {
        const [a, b] = Array.from(pointers.values());
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const { rect } = limits();
        const mx = (a.x + b.x) / 2 - rect.left - rect.width / 2;
        const my = (a.y + b.y) / 2 - rect.top - rect.height / 2;
        const next = clamp(
          drag.pinchScale * (dist / drag.pinchDist),
          SCALE_MIN,
          SCALE_MAX
        );
        zoomAt(next, mx, my);
        return;
      }

      if (!c.dragging) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (!movedRef.current && Math.abs(dx) + Math.abs(dy) > 7) {
        movedRef.current = true;
      }
      const { px, py } = limits();
      c.tx = rubber(drag.ox + dx, px);
      c.ty = rubber(drag.oy + dy, py);
      // 1:1 with the finger while dragging; the loop only springs on release
      c.x = c.tx;
      c.y = c.ty;
    };

    const endPointer = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      if (pointers.size === 0) {
        const c = camRef.current;
        c.dragging = false;
        const { px, py } = limits();
        c.tx = clamp(c.tx, -px, px);
        c.ty = clamp(c.ty, -py, py);
      } else if (pointers.size === 1) {
        const only = Array.from(pointers.values())[0];
        drag.sx = only.x;
        drag.sy = only.y;
        drag.ox = camRef.current.tx;
        drag.oy = camRef.current.ty;
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = camRef.current;
      const { rect, px: lx, py: ly } = limits();
      const next = clamp(
        c.ts * Math.exp(-e.deltaY * 0.0016),
        SCALE_MIN,
        SCALE_MAX
      );
      zoomAt(
        next,
        e.clientX - rect.left - rect.width / 2,
        e.clientY - rect.top - rect.height / 2
      );
      c.tx = clamp(c.tx, -lx, lx);
      c.ty = clamp(c.ty, -ly, ly);
    };

    const onDouble = () => {
      const c = camRef.current;
      c.tx = 0;
      c.ty = 0;
      c.ts = c.home;
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDouble);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endPointer);
      el.removeEventListener('pointercancel', endPointer);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDouble);
    };
  }, []);

  /* Swallow the click that ends a drag so panning never opens a card. */
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (movedRef.current) {
      e.stopPropagation();
      e.preventDefault();
      movedRef.current = false;
    }
  }, []);

  const recenter = useCallback(() => {
    const c = camRef.current;
    c.tx = 0;
    c.ty = 0;
    c.ts = c.home;
  }, []);

  const visible = (matches ?? []).filter((m) => m?.person?.id);

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full select-none overflow-hidden ${
        className ?? ''
      }`}
      style={{ background: '#050403', touchAction: 'none', cursor: 'grab' }}
    >
      <FieldStyles />

      {/* camera */}
      <div
        ref={cameraRef}
        onClickCapture={onClickCapture}
        className="absolute inset-0"
        style={{
          transformOrigin: '50% 50%',
          willChange: 'transform',
          opacity: 0,
          transition: 'opacity 620ms cubic-bezier(.32,.72,0,1)',
        }}
      >
        <div aria-hidden className="y-grid" />

        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: CORE_GLOW }}
        />

        {/* gravity threads: the pull between you and each person, drawn as
            fine instrument lines. Every thread stays legible; the strongest
            overlap warms from cream to yellow and thickens a hair, so the
            structure of the map reads at a glance from across a room. */}
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ overflow: 'visible' }}
        >
          {visible.map((m) => {
            const norm = clamp01(m.normalized);
            const on = selectedId === m.person.id;
            return (
              <line
                key={m.person.id}
                ref={(node) => {
                  if (node) threadEls.current.set(m.person.id, node);
                  return () => {
                    threadEls.current.delete(m.person.id);
                  };
                }}
                stroke={on ? '#FFD60A' : threadColor(norm)}
                strokeWidth={on ? 1.8 : 1.05 + norm * 0.7}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                opacity={on ? 0.92 : 0.22 + norm * 0.34}
                /* `visibility` is owned by the rAF loop, never by React */
                style={{
                  transition:
                    'opacity 500ms cubic-bezier(.22,1,.36,1), stroke 500ms linear',
                }}
              />
            );
          })}
        </svg>

        {/* you */}
        {me ? (
          <div
            ref={meElRef}
            className="absolute left-0 top-0"
            style={{
              width: ME_SIZE,
              height: ME_SIZE,
              willChange: 'transform',
              zIndex: 3,
            }}
          >
            {/* the screen's one glow: you, breathing */}
            <div
              aria-hidden
              className="y-halo pointer-events-none absolute rounded-full"
              style={{
                inset: -30,
                background:
                  'radial-gradient(circle, rgba(255,214,10,.20) 0%, rgba(255,178,0,.07) 46%, rgba(255,178,0,0) 72%)',
              }}
            />
            {/* "you are here" — a hairline marker, not more light */}
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-full"
              style={{
                inset: -9,
                border: '1px solid rgba(255,214,10,.16)',
              }}
            />
            <Bubble
              profile={me}
              size={ME_SIZE}
              prominence={1}
              variant="me"
              onClick={onSelectMe ? handleMeClick : undefined}
              interactive={Boolean(onSelectMe)}
            />
          </div>
        ) : null}

        {/* everyone else */}
        {visible.map((m) => {
          const norm = clamp01(m.normalized);
          const d = D_MIN + norm * D_SPAN;
          const shared =
            (m.sharedSkills?.length ?? 0) + (m.sharedInterests?.length ?? 0);
          return (
            <div
              key={m.person.id}
              ref={(node) => {
                if (node) bubbleEls.current.set(m.person.id, node);
                return () => {
                  bubbleEls.current.delete(m.person.id);
                };
              }}
              className="absolute left-0 top-0"
              style={{
                width: d,
                height: d,
                willChange: 'transform',
                zIndex: selectedId === m.person.id ? 4 : 2,
              }}
            >
              <Bubble
                profile={m.person}
                size={d}
                prominence={norm}
                selected={selectedId === m.person.id}
                onClick={handleBubbleClick}
                ariaLabel={`${m.person.name}. You share ${shared} skills and interests. Open profile.`}
              />
            </div>
          );
        })}
      </div>

      {/* depth from black, above everything, never intercepts pointers */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: VIGNETTE }}
      />

      {/* only appears once you've wandered off */}
      <button
        ref={recenterRef}
        type="button"
        onClick={recenter}
        className="y-recenter absolute bottom-4 right-4"
        style={{ visibility: 'hidden', opacity: 0, fontFamily: SANS }}
      >
        <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden>
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <circle cx="8.5" cy="8.5" r="4.1" />
            <path d="M8.5 1v2.1M8.5 13.9V16M16 8.5h-2.1M3.1 8.5H1" />
          </g>
        </svg>
        Recenter
      </button>

      {me && visible.length === 0 ? (
        <p
          className="pointer-events-none absolute inset-x-0 bottom-14 text-center"
          style={{
            fontFamily: SANS,
            fontSize: 13.5,
            letterSpacing: '-0.006em',
            color: 'rgba(255,248,231,.40)',
          }}
        >
          No one orbiting yet. Add a few interests and they&rsquo;ll show up
          here.
        </p>
      ) : null}
    </div>
  );
}
