# CLAUDE.md — Concep Workshop deck

Project memory for Claude Code. Read this top-to-bottom before touching anything.

## What this is

A **Vue 3 + Vite** slide deck for a 15–20 min workshop talk hosted by **Concep**
on **14 May 2026**. The speaker is **Albert Marimón** from **Primlux Group**. The
talk explains a workflow Albert built that goes from a CAD file to a
photorealistic 3D render with AI, in-house, without depending on a professional
renderer for the exploration phase.

The deck is **tool #1** of the Alberts Toolbox monorepo and lives in
**`tools/deck`** (package `@toolbox/tool-deck`, manifest id `primlux.deck`). It
runs both standalone in a browser (dev) and inside the Electron shell as a tool.
Two earlier prototypes — a single-file `cad-to-render.html` and a Slidev build —
were retired on 1 Jun 2026; do not recreate them. See the repo-root `CLAUDE.md`
for the toolbox as a whole.

Audience: mixed — technical (architects, 3D artists, engineers) **and**
management. AutoCAD-first, not AI-adapted. Language: Spanish (Spain). Never
voseo. Tone: see "Voice" below.

## How to run / present

It's a Vite app. From the repo root `pnpm dev:deck`, or from `tools/deck`:

```bash
cd tools/deck
pnpm dev
```

When loaded inside the shell it runs as a built artifact (`dist/index.html`
over `file://`); `vite.config.ts` sets `base: './'` so assets resolve there.

Two surfaces, same dev server:

- **Audience window** — `http://localhost:5173/` (the App). This is what the
  projector shows. Its keyboard is **locked** on purpose: only `F` (fullscreen
  toggle) and `Esc` (exit fullscreen) work. Slides are NOT advanced from here.
- **Presenter** — `http://localhost:5173/?p` (the `?p` query param swaps
  `App` for `Presenter` in `main.ts`). This is the speaker's laptop screen:
  current + next slide preview, speaker notes, slide grid for jumping, a talk
  timer (`T` toggle, `R` reset) and wall clock, plus controls for the per-slide
  sub-states. A button inside opens the audience window.

The two windows stay in sync via `BroadcastChannel('deck-sync')` + a
`localStorage` mirror (`deck-idx`), so they work as two tabs OR two windows on
the same machine/profile. Deep-link to a slide with `#N` in the URL hash.

Build for a static handoff: `pnpm build` (runs `vue-tsc -b && vite build`),
output in `deck/dist/`. `pnpm preview` serves the build.

## File structure

```
tools/deck/
├── CLAUDE.md                 # this file — deck context for Claude
├── README.md                 # human-facing how-to
├── toolbox.json              # tool manifest (id primlux.deck, capabilities [])
├── icon.svg                  # tool icon (blue square, cyan C)
├── images/                   # all screenshots/renders (deck-owned)
├── index.html                # Vite entry, loads Inter webfont + /src/main.ts
├── package.json              # @toolbox/tool-deck — Vue 3, Vite 8, GSAP, @vueuse/core
├── vite.config.ts            # base: './' for file:// loading in the shell
├── public/
│   ├── images -> ../images   # SYMLINK to tools/deck/images
│   ├── icons.svg
│   └── favicon.svg
    └── src/
        ├── main.ts                  # ?p → Presenter, else App
        ├── App.vue                  # audience deck: stage, transitions, wordmark
        ├── Presenter.vue            # presenter console
        ├── slidesManifest.ts        # ORDERED list of slides (= playback order)
        ├── style.css                # design tokens + shared classes
        ├── composables/
        │   ├── useDeckSync.ts        # cross-window slide-index sync
        │   └── useSliderState.ts     # cross-window sub-state sync (sliders/variants)
        ├── components/
        │   ├── ZoomFrame.vue
        │   ├── StatCard.vue
        │   └── BeforeAfter.vue       # draggable before/after wipe
        └── slides/                   # one .vue per slide
```

**Images.** `tools/deck/public/images` is a symlink to `tools/deck/images`, so
paths in slides are `images/...`. Drop screenshots in `tools/deck/images`.

## The workflow being presented

Four-step pipeline, end-to-end owned by one person:

1. **CAD origin** — AutoCAD-style file with disciplined layers and standard block
   names following Primlux's internal nomenclature.
2. **SketchUp + Primlux extension** — Albert built a SketchUp extension (Ruby)
   that reads the CAD block names, looks them up in an internal 3D model library,
   and places each piece in its exact location. The extension's icon is **blue
   with a cyan C** — last on the right of SketchUp's extension panel.
3. **Manual fine-tuning** — A few minutes adding textures and details where they
   matter most.
4. **D5 Render Lite + AI** — D5 Lite is a free plugin that renders with AI
   *without leaving SketchUp* (no second program). On a GPU machine, iterate
   against four reference images supplied by the client. 20–60 s per image, all
   local.

Value prop: removes dependency on external professional renderers during the
exploration phase. Pro renderer still gets called for the *final* image.

## Slide map — source of truth is `src/slidesManifest.ts`

The manifest array order = playback order. Each entry has `{ component, title,
notes }`; the `notes` are the speaker notes shown in Presenter. **19 active
slides:**

| #  | Title (manifest)                 | Component                |
|----|----------------------------------|--------------------------|
| 01 | Portada                          | `Slide01_Cover`          |
| 02 | El problema                      | `Slide02_Problem`        |
| 03 | El flujo                         | `Slide03_Workflow`       |
| 04 | Paso 1 — CAD                     | `Slide04_CAD`            |
| 05 | Paso 2 — SketchUp                | `Slide05_SketchUp`       |
| 06 | Librería (3 sub-estados)         | `Slide07_Library`        |
| 07 | Antes / Después                  | `Slide10_BeforeAfter`    |
| 08 | Modelo listo                     | `Slide10b_Ready`         |
| 09 | Zoom D5 Lite                     | `Slide10c_ZoomD5`        |
| 10 | D5 panel abierto                 | `Slide11_Server`         |
| 11 | Zoom panel D5                    | `Slide11b_ZoomPanel`     |
| 12 | Referencias del cliente          | `Slide13_Refs`           |
| 13 | Estilo D5                        | `Slide14_Style`          |
| 14 | Prompt — instrucción a la IA     | `Slide15_Prompt`         |
| 15 | Ajustes                          | `Slide15b_Settings`      |
| 16 | Renderizando                     | `Slide16_Rendering`      |
| 17 | Render final · 4 variantes       | `Slide17_Final`          |
| 18 | Lo que cambia                    | `Slide18_Outcomes`       |
| 19 | Cierre                           | `Slide19_Close`          |

To reorder, edit the array in `slidesManifest.ts` — nothing else references
positions. The component file numbers (e.g. `Slide10c`) are historical labels,
NOT playback positions; don't trust them, trust the manifest.

**Spare on disk, not in the manifest:** `src/slides/Slide06_ZoomC.vue` (an older
zoom-to-cyan-C slide). Available to plug back in by importing it and inserting
into the manifest array.

## Per-slide sub-states (the interactive slides)

Some slides hold internal state (a draggable before/after wipe, a step-through
list, a render-variant cycler). That state lives in `useSliderState(key)` and is
**synced presenter ↔ audience** over `BroadcastChannel('deck-slider')` +
`localStorage('deck-slider:<key>')`. Default state `{ pos: 97, variant: 0 }`
(pos = wipe % from the right; variant = which image).

Keys currently wired in Presenter:

- `slide03` — workflow step-through (4 steps: CAD / 3D / Detalle / Render)
- `slide05` — SketchUp zoom-to-cyan-C sub-states (intro → zoom → extension copy)
- `slide07` — library reveal (Familias → Modelos → Variantes)
- `slide17` — final render, cycles 4 variants (`1_despues`…`4_despues`) and the
  before/after wipe against `1_antes`

If you add an interactive slide, give it a stable key and add matching controls
in `Presenter.vue` so the speaker can drive it.

## Motion

GSAP, in `App.vue`. Slide transitions: ~0.55s opacity-out, then 1.2s opacity-in,
with `[data-reveal]` children staggering in (`expo.out`, 0.14s stagger, 0.4s
delay). On mount, the first slide's reveals slide in with `back.out`. Easing
elsewhere: `cubic-bezier(0.4,0,0.2,1)`. No springs, no bounce, no Lottie. Mark
anything that should animate-in on a slide with `data-reveal`.

The audience stage renders into an inner 1600×900 box scaled to fit via a
`ResizeObserver` setting `--stage-scale`. Presenter previews reuse the same
mechanism on `.p-stage` elements.

## Primlux design system

Dark-canvas brand. Tokens are CSS variables at the top of `src/style.css`:

- **Canvas:** `--slate-950 #04060b` with layered radial blue-grey gradients
  (`--bg-canvas`).
- **Accent:** one chromatic axis — blue-grey. `--brand-300 #94a8ca` is the
  signature accent (eyebrow ticks, slash separators, accent text).
- **Primary fill:** `--brand-700 #36486e`.
- **Foreground hierarchy:** `--fg-primary #fff` (display), `--fg-secondary`
  (slate-100, H2), `--fg-tertiary` (slate-300, body), `--fg-muted` (slate-400,
  eyebrows), `--fg-faint` (slate-500, fine print).
- **Rules:** `--rule` `rgba(255,255,255,0.15)`, `--rule-strong` `0.20`,
  `--rule-soft` `0.10`.
- **Type:** Inter (Google Fonts) as the web substitute for Helvetica Neue.
  Weights 300–700. `--track-eyebrow 0.18em` for ALL-CAPS eyebrows,
  `--track-tight -0.01em` on display headlines.
- **Shape:** near-square. 2px radius default. No `rounded-lg` chrome on the dark
  canvas.

## Voice / copy guidelines

Primlux's brand voice is **engineering-led, restrained, formal**. Imagine
Stripe Atlas docs crossed with a Linear changelog and a McKinsey one-pager.

- Sentence case for body and headlines: *"De CAD a render fotorrealista."*
- ALL CAPS letter-spaced for eyebrows, labels, pills.
- No exclamation marks. Ever. No emoji. Ever.
- Em dashes (`—`) for rhetorical pauses. Never `--`.
- `↗` only for outbound links. `/` only in the wordmark.
- First-person plural (*"construimos", "necesitábamos"*) when speaking as
  Primlux. Sparing *"tú"* — only direct address.

Phrases that fit: *arquitectura, sistema, disciplina, intencional, nomenclatura
propia, autonomía, en producción, en horas no en semanas*. Avoid:
*revolucionario, mágico, sin fricción, journey, solución llave en mano,
disruptivo*.

## Pending decisions (ask Albert before changing)

1. **Speaker email on the close slide** — confirm before publishing one.
2. **Closing line** — `Slide19_Close`. Current: *"Renderizamos antes. Decidimos
   después. El orden cambia todo."* Albert may swap.
3. **Discrete Primlux wordmark** — bottom-left of inner slides (`App.vue`
   `.wordmark`, hidden on cover and close). Albert wanted it discreet; confirm
   before removing entirely.

## Conventions for editing

- One deck only — `deck/`. Don't resurrect the HTML or Slidev prototypes.
- Add a slide: create `src/slides/SlideXX_Name.vue`, import it in
  `slidesManifest.ts`, insert into the array at the right position with a
  `title` and `notes`. Order in the array is the only thing that matters.
- Keep dependencies minimal — Vue, Vite, GSAP, @vueuse/core. No Tailwind, no UI
  kit. Shared visual classes live in `style.css`; per-slide CSS in each `.vue`.
- Images go in repo-root `images/` (served via the `deck/public/images`
  symlink). Reference as `images/<name>`. Naming is case-sensitive.
- The only external runtime resource is the Inter webfont (`index.html`). Offline
  fallback is already in `--font` (`"Helvetica Neue",Arial,sans-serif`); drop the
  `<link>` if you need full offline.

## Known limits

- Keyboard slide-nav is intentionally disabled in the audience window — drive
  everything from Presenter (`?p`). If presenting from one screen only, open
  `?p`, then its "open audience" button, and put the audience window on the
  projector.
- Inter loads from the network on first run, then caches. Warm it once on the
  presenting laptop before the talk.
- Dependencies install at the monorepo root (`pnpm install`); `node_modules/` is
  gitignored. Run `pnpm build` from the root before loading the deck in the shell.
