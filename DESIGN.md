# Yellow — Design Language (v2 · "watchOS, but yellow")

The reference is Apple: watchOS for the bubble canvas, iOS for every list, sheet,
form, and button. Popping comes from **contrast and restraint** — a true-black
canvas, glass materials, hairline strokes, and exactly one saturated accent —
never from decoration. If a screen has three glows, it has two too many.

`#FFD60A` is iOS systemYellow (dark). We are literally building in Apple's yellow.

## Tokens

### Canvas & surfaces
| Role | Value |
|---|---|
| Canvas (app background) | `#050403` (near-true-black, barely warm) |
| Card / inset-group surface | `rgba(255,255,255,0.045)` · hover `0.07` |
| Glass (sheets, bars, overlays) | `rgba(20,17,10,0.72)` + `backdrop-filter: blur(20px) saturate(1.4)` |
| Hairline stroke | `rgba(255,255,255,0.08)` · emphasized `0.14` |
| On-yellow ink | `#1A1200` |

### Text (on canvas)
| Role | Value |
|---|---|
| Primary | `#FFF8E7` |
| Secondary | `rgba(255,248,231,0.62)` |
| Tertiary | `rgba(255,248,231,0.40)` |
| Quaternary / disabled | `rgba(255,248,231,0.26)` |

### Yellow system
| Role | Value |
|---|---|
| Accent | `#FFD60A` |
| Top-light (gradient top) | `#FFE45C` |
| Deep (gradient bottom) | `#FFC300` |
| Muted gold (mono labels) | `#B8860B` at 70–90% |
| Tinted fill (iOS "tinted button") | `rgba(255,214,10,0.13)` |
| Tinted border | `rgba(255,214,10,0.22)` |

## Type (Geist Sans; Geist Mono only for instrumentation)
| Role | Spec |
|---|---|
| Large title | 30px / 700 / tracking −0.03em |
| Title | 21px / 600 / −0.02em |
| Headline | 16.5px / 600 |
| Body | 15px / 400 / line-height 1.5 |
| Subhead | 13.5px / 400 · secondary color |
| Footnote | 12.5px · tertiary |
| Eyebrow (mono) | 10.5px / 500 / UPPERCASE / +0.14em · muted gold or 40% cream |

Mono is for eyebrows, counters, timestamps, badges — instrumentation only.
If a full sentence is in mono, it's wrong.

## Shape
Radii scale: **10** (small chips) · **14** (inputs) · **18** (cards) ·
**22** (sheets, large cards) · **999** (buttons, pills, avatars, grabbers).

## Buttons (iOS grammar)
- **Filled (primary, max one per screen):** full pill, height 50px,
  `linear-gradient(180deg,#FFE45C,#FFC300)`, ink `#1A1200` 600/15px,
  shadow `0 8px 24px -10px rgba(255,199,0,0.55)`. Press: scale 0.97, 120ms.
- **Tinted (secondary):** pill, tinted fill + tinted border, text `#FFD60A`.
- **Plain (tertiary):** text-only, secondary color, yellow on hover.
Destructive stays quiet: plain, 60% cream, never red-alarm styling.

## Glass is the defining material (v2.1 — user-directed)

Apple-grade glassmorphism, not tinted rectangles. Three recipes; use nothing else:

| Recipe | Use for | Spec |
|---|---|---|
| **Chrome glass** | sidebar, tab/nav bars, sticky headers & composers, toasts, sheets | `rgba(20,17,10,0.70)` + `backdrop-filter: blur(20px) saturate(1.4)` + hairline edge |
| **Yellow glass** | bubbles, tinted pills, banners, active states | `rgba(255,214,10,0.12–0.16)` over `rgba(255,255,255,0.05)` + `backdrop-filter: blur(18px) saturate(1.6)` + hairline `rgba(255,255,255,0.14)` + `inset 0 1px 0 rgba(255,255,255,0.22)` top light |
| **Clear glass** | overlays' scrims, secondary floating cards | `rgba(255,255,255,0.06)` + `backdrop-filter: blur(16px) saturate(1.3)` + hairline |

Rules:
- Glass needs something behind it to refract — it shines over the grid, photos,
  and the bubble field. Flat lists (inset rows) stay near-opaque surfaces for
  legibility; glass is for **floating and chrome layers, and the bubbles**.
- The **one filled-yellow element per screen survives** (primary CTA, your own
  chat bubbles). Everything else that used to be solid yellow becomes yellow glass.
- Always pair `backdrop-filter` with `-webkit-backdrop-filter`, and provide an
  `@supports not (backdrop-filter: blur(1px))` fallback that raises fill opacity
  (e.g. yellow glass → `rgba(60,48,10,0.85)`), so no browser sees see-through soup.
- Perf: glass layers on screen at once ≤ ~14; never stack glass on glass more
  than two deep; if the bubble field drops frames, discs fall back to the
  no-backdrop fallback fill automatically — motion beats material.

### Ownership rule for media controls (learned in build)
Filled yellow marks **what is yours**: your chat bubbles, your voice-note play
knob, the screen's primary CTA. Anything received renders its controls in quiet
glass with cream glyphs — never in the sender's own palette, which would put a
foreign accent color on a one-accent screen.

## Materials & elevation
- Cards: surface color + hairline + `inset 0 1px 0 rgba(255,255,255,0.05)`
  (top gloss) + `0 10px 30px -12px rgba(0,0,0,0.6)`.
- Sheets/bars: glass recipe above; hairline on the leading edge.
- **Yellow glow budget: one per screen** — the primary CTA, a live dot, or the
  selected bubble. Everything else earns depth from black, not bloom.
- Kill decorative grain/noise anywhere it reads as texture.

## Lists (iOS inset-grouped)
Chats, hubs, settings, pickers: inset cards (radius 18) on the canvas,
rows separated by hairlines that start after the leading icon/avatar,
row height ≥ 52px, chevrons `rgba(255,248,231,0.25)`.

## Sheets & overlays
Grabber: 36×5px pill, `rgba(255,248,231,0.22)`, centered, 10px from top.
Slide-up with `cubic-bezier(0.32, 0.72, 0, 1)` at 380–440ms (Apple's sheet
curve). Backdrop: `rgba(0,0,0,0.5)` + blur(8px).

## Motion
- Standard curve `cubic-bezier(0.32,0.72,0,1)`; enters 240–420ms; press 120ms.
- Stagger list entrances 40–60ms per row, first 6 rows only.
- The bubble field is the one place slow ambient motion belongs.
- `prefers-reduced-motion`: everything lands instantly; keep opacity fades ≤1ms.

## Avatars (v2.2 — user-directed)
Priority: **photo → initials monogram**. Emoji are no longer rendered as
avatars anywhere; the profile's `emoji` field stays in the data (frozen
contract) but the UI ignores it. Monogram = `initialsFor(name)` from
`lib/initials.ts` (Apple Contacts grammar: "Ahmad" → A, "Ahmad Noori" → AN) —
always import the helper, never derive initials locally. Render: the letters
in cream `#FFF8E7`, weight 600, tracking +0.02em, sized ~40% of diameter for
one letter / ~32% for two, centered on the surface's existing disc material
(yellow glass on the map, gradient or glass in lists). Photos keep full-bleed
treatment with the hairline rim.

## Iconography
Chrome icons (tabs, back, close, plus, mic, send) are **inline SVG**: stroke
1.8, round caps/joins, monochrome cream at 55%; active/selected = `#FFD60A`.
**No emoji as chrome.** Emoji remain only as user avatars and content.

## Hard rules
1. No purple, no blue-grey Tailwind defaults, no pure-white surfaces.
2. Blur is a material, not a decoration — glass only on floating layers.
3. One filled CTA and one glow per screen, maximum.
4. Hairlines over borders; whitespace over dividers where possible.
5. Focus-visible: 2px `#FFD60A` outline, offset 2 — everywhere, always.
6. Touch targets ≥ 44px even when the glyph is small.
