<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDeckSync } from './composables/useDeckSync'
import { useSliderState } from './composables/useSliderState'
import type { Presentation } from './types'

const props = defineProps<{ presentation: Presentation }>()
const slides = computed(() => props.presentation.slides)
const wordmark = computed(() => props.presentation.theme?.wordmark ?? null)

const { idx } = useDeckSync(0)
// Read initial hash if present
const hash = parseInt(location.hash.replace('#', ''), 10)
if (!isNaN(hash) && hash >= 1 && hash <= slides.value.length) idx.value = hash - 1

const total = computed(() => slides.value.length)
const current = computed(() => slides.value[idx.value])
const next = computed(() => idx.value < total.value - 1 ? slides.value[idx.value + 1] : null)
const currentControls = computed(() => current.value?.controls ?? [])

// Preview iframes render the real deck, so vw/vh units resolve to the iframe
// viewport — pixel-faithful to the audience view.
// "Actual" is the live audience deck, kept in sync via BroadcastChannel; its src
// is fixed (initial slide in the hash) so it never reloads while presenting.
const presId = props.presentation.meta.id
const audienceSrc = `${location.pathname}?pres=${presId}#${idx.value + 1}`
// "Siguiente" is a static single slide; its src tracks idx (a small reload on
// each step is fine for a peek-ahead preview).
const nextSrc = computed(() =>
  idx.value < total.value - 1 ? `${location.pathname}?solo=${presId}&n=${idx.value + 1}` : '',
)

// Presentation clicker (Logitech & co. send PageUp/PageDown). Off by default;
// when ON, those keys (and arrows) drive the deck — otherwise they do nothing.
const clickerOn = ref(false)
function toggleClicker() {
  clickerOn.value = !clickerOn.value
}

// Key detector — shows the last key the app received (key · code · keyCode), so a
// clicker's actual emitted keys can be diagnosed live.
const lastKey = ref('—')

// Presenter controls are declared per-slide and driven generically, so the
// console carries no presentation-specific logic. Pre-create a synced state per
// referenced key (composables must run during setup).
const sliderStates = new Map<string, ReturnType<typeof useSliderState>>()
for (const s of slides.value) {
  for (const c of s.controls ?? []) {
    if (!sliderStates.has(c.stateKey)) sliderStates.set(c.stateKey, useSliderState(c.stateKey))
  }
}
function stateFor(key: string) {
  let st = sliderStates.get(key)
  if (!st) {
    st = useSliderState(key)
    sliderStates.set(key, st)
  }
  return st
}

// All navigation is delegated to the live deck (the "Actual" preview iframe) via
// a deck-nav postMessage, so the console walks EXACTLY the same steps as the deck
// — its next()/prev() handle declared controls AND slides' internal reveal steps
// (tryAdvance), and the change syncs to every window. Keeps console ⇆ audience
// behaviour identical.
const frameEl = ref<HTMLIFrameElement | null>(null)
function postNav(dir: 'next' | 'prev') {
  frameEl.value?.contentWindow?.postMessage({ type: 'deck-nav', dir }, '*')
}
function advance() { postNav('next') }
function back() { postNav('prev') }
// Mirror the synced index into this window's hash (for reload/deep-link).
watch(idx, (v) => history.replaceState(null, '', `#${v + 1}`))

function onKey(e: KeyboardEvent) {
  // Record every key for the detector (before any early-return below).
  lastKey.value = `${e.key} · ${e.code} · ${e.keyCode}`
  switch (e.key) {
    case 't': case 'T':
      toggleTimer(); return
    case 'r': case 'R':
      resetTimer(); return
  }
  // Slide navigation by keyboard works ONLY while the clicker is enabled.
  // Clicker layout: PageUp (top) = forward through steps, PageDown (bottom) =
  // backward through steps. Every step is walked — nothing is skipped.
  if (!clickerOn.value) return
  switch (e.key) {
    case 'PageUp': case 'ArrowUp': case 'ArrowRight':
      e.preventDefault(); advance(); break
    case 'PageDown': case 'ArrowDown': case 'ArrowLeft':
      e.preventDefault(); back(); break
  }
}

// Timer
const startTime = ref<number | null>(null)
const pausedAccum = ref(0)
const tick = ref(0)
let tickInt: number | null = null
const running = computed(() => startTime.value !== null)

function startTicker() {
  if (tickInt) return
  tickInt = window.setInterval(() => { tick.value++ }, 250)
}
function stopTicker() {
  if (tickInt) { clearInterval(tickInt); tickInt = null }
}
function toggleTimer() {
  if (running.value) {
    pausedAccum.value += Date.now() - (startTime.value || 0)
    startTime.value = null
    stopTicker()
  } else {
    startTime.value = Date.now()
    startTicker()
  }
}
function resetTimer() {
  startTime.value = null
  pausedAccum.value = 0
  tick.value = 0
  stopTicker()
}

const elapsedMs = computed(() => {
  tick.value
  if (running.value) return pausedAccum.value + (Date.now() - (startTime.value || Date.now()))
  return pausedAccum.value
})
const elapsedFmt = computed(() => {
  const ms = elapsedMs.value
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`
})

const clockNow = ref(new Date())
let clockInt: number | null = null
const clockFmt = computed(() => {
  const d = clockNow.value
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
})

onMounted(() => {
  document.addEventListener('keydown', onKey)
  clockInt = window.setInterval(() => { clockNow.value = new Date() }, 1000)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  if (clockInt) clearInterval(clockInt)
  stopTicker()
})

function openAudience() {
  // &clicker → the audience window also responds to the presentation clicker.
  window.open(`${location.pathname}?pres=${props.presentation.meta.id}&clicker`, '_blank')
}
</script>

<template>
  <div class="presenter">
    <header class="p-header">
      <div class="p-brand">
        <span class="wm-primary">{{ wordmark?.primary ?? 'PRESENTER' }}</span><span class="wm-slash">/</span><span class="wm-suffix">PRESENTER</span>
      </div>
      <div class="p-status">
        <div class="p-keydet" title="Última tecla recibida (key · code · keyCode)">
          <span class="p-keydet-lbl">Tecla</span>
          <span class="p-keydet-val">{{ lastKey }}</span>
        </div>
        <button
          @click="toggleClicker"
          class="p-btn p-clicker"
          :class="{ on: clickerOn }"
          :title="clickerOn ? 'Clicker activo: PageUp/PageDown pasan diapos' : 'Activar mando/clicker'"
        >
          {{ clickerOn ? '● Clicker ON' : 'Clicker' }}
        </button>
        <button @click="openAudience" class="p-btn">Abrir vista audiencia ↗</button>
        <div class="p-clock">{{ clockFmt }}</div>
      </div>
    </header>

    <main class="p-grid">
      <section class="p-current">
        <div class="p-label">Actual <span class="num">{{ String(idx + 1).padStart(2, '0') }} / {{ String(total).padStart(2, '0') }}</span></div>
        <div class="p-stage">
          <iframe ref="frameEl" :src="audienceSrc" class="p-stage-frame" title="Diapositiva actual"></iframe>
        </div>
        <div class="p-title">{{ current.title }}</div>
      </section>

      <aside class="p-side">
        <div class="p-block">
          <div class="p-label">Siguiente</div>
          <div class="p-stage small">
            <iframe v-if="nextSrc" :src="nextSrc" class="p-stage-frame" title="Diapositiva siguiente"></iframe>
            <div class="p-stage-empty" v-else>— Fin —</div>
          </div>
          <div class="p-subtitle" v-if="next">{{ next.title }}</div>
        </div>

        <div class="p-block timer-block">
          <div class="p-label">Timer · <kbd>T</kbd> play/pause · <kbd>R</kbd> reset</div>
          <div class="p-timer" :class="{ running }">{{ elapsedFmt }}</div>
        </div>

        <div v-for="(ctrl, ci) in currentControls" :key="ci" class="p-block slider-block">
          <div class="p-label">{{ ctrl.label }}</div>

          <template v-if="ctrl.kind === 'range'">
            <input
              type="range"
              :min="ctrl.min ?? 0"
              :max="ctrl.max ?? 100"
              :step="ctrl.step ?? 0.5"
              v-model.number="stateFor(ctrl.stateKey).pos.value"
              class="p-range"
            />
            <div class="p-range-labels">
              <span>{{ ctrl.lowLabel ?? '' }}</span>
              <span class="p-range-val">{{ Math.round(stateFor(ctrl.stateKey).pos.value) }}%</span>
              <span>{{ ctrl.highLabel ?? '' }}</span>
            </div>
          </template>

          <div v-else class="p-variant-row">
            <button
              v-for="(lbl, i) in ctrl.options"
              :key="i"
              class="p-btn p-variant"
              :class="{ active: stateFor(ctrl.stateKey).variant.value === i }"
              @click="stateFor(ctrl.stateKey).variant.value = i"
            >{{ lbl }}</button>
          </div>
        </div>

        <div class="p-block notes-block">
          <div class="p-label">Notas</div>
          <p class="p-notes">{{ current.notes }}</p>
        </div>

        <div class="p-controls">
          <button @click="back" class="p-btn p-btn-lg" :disabled="idx === 0">← Atrás</button>
          <button @click="advance" class="p-btn p-btn-lg primary" :disabled="idx === total - 1">Siguiente →</button>
        </div>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.presenter {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100vh;
  width: 100vw;
  background: #04060b;
  color: var(--fg-tertiary);
  overflow: hidden;
}
.p-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 1.2rem;
  border-bottom: 1px solid var(--rule);
  background: rgba(15,23,42,0.4);
  flex-wrap: wrap;
}
.p-brand {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--fg-primary);
  white-space: nowrap;
}
.p-brand .wm-slash { color: var(--brand-300); margin: 0 0.4rem; }
.p-brand .wm-suffix { font-weight: 300; color: var(--slate-300); }
.p-status { display: flex; align-items: center; gap: 0.9rem; flex-wrap: wrap; }
.p-clock {
  font-variant-numeric: tabular-nums;
  font-size: 0.8rem;
  color: var(--fg-muted);
  letter-spacing: 0.05em;
}

.p-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(260px, 1fr);
  gap: 1rem;
  padding: 1rem 1.2rem 1.2rem;
  min-height: 0;
  overflow: hidden;
}

/* Tablet / narrow — stack vertically */
@media (max-width: 960px) {
  .p-grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    overflow-y: auto;
    padding: 0.8rem;
    gap: 0.8rem;
  }
  .p-current { max-height: 45vh; }
  .p-side { padding-right: 0; }
}

@media (max-width: 540px) {
  .p-header { padding: 0.55rem 0.8rem; font-size: 0.65rem; }
  .p-grid { padding: 0.6rem; }
  .p-timer { font-size: 1.7rem; }
  .p-notes { font-size: 0.82rem; }
  .p-btn { font-size: 0.65rem; padding: 0.5rem 0.5rem; }
}

.p-current {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-height: 0;
  min-width: 0;
}
.p-side {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  padding-right: 0.3rem;
}
.p-side::-webkit-scrollbar { width: 6px; }
.p-side::-webkit-scrollbar-thumb { background: var(--rule); border-radius: 3px; }

.p-block { display: flex; flex-direction: column; gap: 0.45rem; min-height: 0; flex-shrink: 0; }
.p-label {
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--brand-300);
}
.p-label .num { color: var(--fg-muted); margin-left: 0.5rem; font-variant-numeric: tabular-nums; }
.p-title {
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--fg-primary);
  margin-top: 0.1rem;
}
.p-subtitle {
  font-size: 0.8rem;
  color: var(--slate-300);
}

/* Slide preview area — fluid scale via container query */
.p-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16/9;
  flex: 0 0 auto;
  border: 1px solid var(--rule);
  border-radius: 2px;
  overflow: hidden;
  background:
    radial-gradient(920px 420px at 12% 4%, rgba(67,87,128,0.20), transparent 64%),
    radial-gradient(860px 460px at 84% 30%, rgba(52,70,108,0.16), transparent 68%),
    linear-gradient(180deg, #07090e 0%, #05070b 44%, #04060b 100%);
  container-type: inline-size;
}
.p-current .p-stage { flex: 1 1 auto; min-height: 0; }

.p-stage-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  /* it's a preview — drive the deck from the console buttons/clicker. */
  pointer-events: none;
}
.p-stage-empty {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  color: var(--fg-muted);
  font-size: 0.8rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.timer-block {
  border: 1px solid var(--rule);
  border-radius: 2px;
  padding: 0.75rem 0.9rem;
  background: rgba(15,23,42,0.5);
}
.p-timer {
  font-size: 2.1rem;
  font-weight: 300;
  letter-spacing: -0.02em;
  color: var(--fg-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.p-timer.running { color: var(--brand-300); }

.notes-block {
  border: 1px solid var(--rule);
  border-radius: 2px;
  padding: 0.75rem 0.9rem;
  background: rgba(15,23,42,0.5);
  flex: 1 1 auto;
  min-height: 6rem;
  overflow-y: auto;
}
.p-notes {
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--fg-secondary);
  white-space: pre-wrap;
}

.p-controls {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  position: sticky;
  bottom: 0;
  background: #04060b;
  padding-top: 0.4rem;
  z-index: 2;
}
.p-btn {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--rule-strong);
  border-radius: 2px;
  background: rgba(15,23,42,0.5);
  color: var(--fg-secondary);
  cursor: pointer;
  transition: background 200ms var(--ease), color 200ms var(--ease);
  white-space: nowrap;
}
.p-btn:hover:not(:disabled) { background: rgba(54,72,110,0.4); color: var(--fg-primary); }
.p-btn:disabled { opacity: 0.35; cursor: default; }
.p-btn-lg { padding: 0.85rem 1rem; font-weight: 600; }
.p-btn.primary { background: rgba(54,72,110,0.55); color: var(--fg-primary); border-color: var(--brand-400); }
.p-btn.primary:hover:not(:disabled) { background: rgba(54,72,110,0.8); }
.p-clicker.on {
  background: rgba(34, 197, 94, 0.16);
  border-color: rgba(34, 197, 94, 0.7);
  color: #86efac;
}
.p-clicker.on:hover { background: rgba(34, 197, 94, 0.24); color: #bbf7d0; }
.p-keydet {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--rule-strong);
  border-radius: 2px;
  background: rgba(15, 23, 42, 0.5);
}
.p-keydet-lbl {
  font-size: 0.55rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--brand-300);
}
.p-keydet-val {
  font-family: var(--font);
  font-size: 0.72rem;
  color: var(--fg-primary);
  font-variant-numeric: tabular-nums;
  min-width: 11rem;
  white-space: nowrap;
}

.slider-block {
  border: 1px solid var(--brand-400);
  border-radius: 2px;
  padding: 0.85rem 1rem;
  background: rgba(54,72,110,0.18);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.p-range {
  width: 100%;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: rgba(255,255,255,0.12);
  outline: none;
  cursor: pointer;
}
.p-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: var(--brand-300);
  border: 2px solid #04060b;
  cursor: grab;
}
.p-range::-moz-range-thumb {
  width: 18px; height: 18px;
  border-radius: 50%;
  background: var(--brand-300);
  border: 2px solid #04060b;
  cursor: grab;
}
.p-range-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.625rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--fg-muted);
}
.p-range-val { color: var(--brand-300); font-variant-numeric: tabular-nums; }
.p-variant-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(70px, 1fr));
  gap: 0.4rem;
}
.p-variant {
  padding: 0.55rem 0.4rem;
  font-size: 0.65rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.p-variant.active {
  background: rgba(148,168,202,0.3);
  color: var(--fg-primary);
  border-color: var(--brand-300);
}

kbd {
  display: inline-block;
  padding: 1px 5px;
  border: 1px solid var(--rule);
  border-radius: 2px;
  font-family: var(--font);
  font-size: 0.65rem;
  margin: 0 2px;
  color: var(--slate-300);
}
</style>
