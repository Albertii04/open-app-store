<script setup lang="ts">
import { onMounted, onUnmounted, nextTick } from 'vue'
import gsap from 'gsap'
import type { Presentation } from './types'

const props = defineProps<{ presentation: Presentation }>()

// This component's <style> is global (it must reach html/body/#app and @page,
// which scoped styles can't). Mark the document so those resets ONLY apply on the
// export route — otherwise they'd leak into the normal Presenter UI and break its
// fixed full-screen layout. Added now (setup runs before paint), removed on unmount.
if (typeof document !== 'undefined') document.documentElement.classList.add('deck-export')
onUnmounted(() => {
  if (typeof document !== 'undefined') document.documentElement.classList.remove('deck-export')
})
const slides = props.presentation.slides
const themeVars = props.presentation.theme?.vars ?? {}

// Deck chrome — the persistent thread/"índice" bar, wordmark and page counter —
// is normally drawn by the LIVE deck wrappers (AudienceDeck/SoloDeck), NOT by the
// slide component. ExportDeck mounts only `s.component`, so without this it would
// drop everything the chrome contributes to each slide. Replicate it here, reading
// the same `presentation.thread` / per-slide `thread` state and reusing the global
// engine.css chrome classes so the PDF matches what's on screen.
const threadSteps = props.presentation.thread?.steps ?? null
const wordmark = props.presentation.theme?.wordmark ?? null
const lastIdx = slides.length - 1

function threadStepState(
  state: { active?: string; complete?: boolean } | undefined,
  i: number,
): 'active' | 'done' | 'todo' {
  if (!state) return 'todo'
  if (state.complete) return 'done'
  const a = (threadSteps ?? []).findIndex((s) => s.key === state.active)
  if (i === a) return 'active'
  if (a >= 0 && i < a) return 'done'
  return 'todo'
}

function paddedNum(n: number): string {
  return String(n).padStart(2, '0')
}

// Preset every "variants" control to ONE PAST its last option BEFORE the slide
// components mount (useSliderState reads localStorage on setup). A stepper then
// renders with all steps "past" — every card shown, none left in the live
// "active" state whose animated mask-composite glow border fills solid (and hides
// the text) in printToPDF. The export window uses an isolated session, so this
// write never leaks into the live deck's slider state.
try {
  for (const s of slides) {
    for (const c of s.controls ?? []) {
      const ctl = c as { stateKey?: string; options?: unknown[] }
      if (ctl.stateKey && Array.isArray(ctl.options)) {
        localStorage.setItem(
          `deck-slider:${ctl.stateKey}`,
          JSON.stringify({ pos: 97, variant: ctl.options.length }),
        )
      }
    }
  }
} catch {
  /* storage may be unavailable */
}

onMounted(async () => {
  await nextTick()
  // An offscreen (hidden) window ticks requestAnimationFrame unreliably, so slide
  // intro tweens (count-ups, reveal slabs, title masks) may never advance — the
  // PDF would capture a half-built frame. Force GSAP's global clock far forward so
  // every finite tween lands on its END value synchronously, independent of rAF.
  // (Infinite/ambient float tweens just settle at some bounded position — fine.)
  try {
    gsap.globalTimeline.time(30)
  } catch {
    /* gsap not in use on this deck */
  }
})
</script>

<template>
  <!-- One fixed 1280×720 page per slide. The deck's GSAP never runs here, so
       [data-reveal] content sits at its natural (visible) state = final look.
       theme.vars supply --deck-bg and the palette, exactly like the live deck.
       Multi-step slides are pre-set to their fully-advanced state (above). -->
  <div class="export-root" :style="themeVars">
    <section v-for="(s, i) in slides" :key="i" class="export-page">
      <div class="slide-host">
        <component :is="s.component" />
      </div>

      <!-- Deck chrome, mirroring the live deck so the PDF shows everything the
           slide shows. .export-page is position:relative, so these absolutely
           positioned chrome elements anchor to the page just like .deck-stage. -->
      <div
        v-if="threadSteps && s.thread"
        class="thread-chrome visible"
      >
        <template v-for="(step, si) in threadSteps" :key="step.key">
          <span class="tc-step" :class="threadStepState(s.thread, si)">{{ step.label }}</span>
          <span v-if="si < threadSteps.length - 1" class="tc-sep"></span>
        </template>
      </div>

      <div v-if="wordmark && i !== 0 && i !== lastIdx" class="wordmark">
        <span class="wm-primary">{{ wordmark.primary }}</span><span class="wm-slash">/</span><span class="wm-suffix">{{ wordmark.suffix }}</span>
      </div>
      <div v-if="i !== 0" class="counter">
        <span>{{ paddedNum(i + 1) }}</span><span class="sep">/</span><span>{{ paddedNum(slides.length) }}</span>
      </div>
    </section>
  </div>
</template>

<style>
/* 16:9 page at 1280×720 = 13.333in × 7.5in @96dpi. Electron printToPDF with
   preferCSSPageSize:true honours this; one .export-page == one PDF page.
   (@page only affects printing, so it's inert in the normal UI.) */
@page { size: 13.333in 7.5in; margin: 0; }
/* engine.css pins html/body/#app to height:100% + overflow:hidden for the live
   (fixed) deck. That would clip our tall stacked document to a single screen —
   one PDF page. Release those constraints so all slides lay out and paginate.
   Gated on .deck-export (added by this component) so it never touches the normal
   Presenter UI, where these rules would break the fixed full-screen layout. */
html.deck-export,
html.deck-export body,
html.deck-export #app {
  height: auto !important;
  width: auto !important;
  overflow: visible !important;
  margin: 0;
  background: var(--bg-canvas);
}
/* Hide the scrollbar so per-slide screenshots don't catch a strip of it. */
html.deck-export { scrollbar-width: none; }
html.deck-export::-webkit-scrollbar { display: none; }
.export-page {
  position: relative;
  width: 1280px;
  height: 720px;
  overflow: hidden;
  background: var(--deck-bg, var(--bg-canvas));
  break-after: page;
  page-break-after: always;
}
.export-page:last-child { break-after: auto; page-break-after: auto; }
</style>
