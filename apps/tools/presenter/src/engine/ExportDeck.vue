<script setup lang="ts">
import type { Presentation } from './types'

const props = defineProps<{ presentation: Presentation }>()
const slides = props.presentation.slides
const themeVars = props.presentation.theme?.vars ?? {}
</script>

<template>
  <!-- One fixed 1280×720 page per slide. The deck's GSAP never runs here, so
       [data-reveal] content sits at its natural (visible) state = final look.
       theme.vars supply --deck-bg and the palette, exactly like the live deck. -->
  <div class="export-root" :style="themeVars">
    <section v-for="(s, i) in slides" :key="i" class="export-page">
      <div class="slide-host">
        <component :is="s.component" />
      </div>
    </section>
  </div>
</template>

<style>
/* 16:9 page at 1280×720 = 13.333in × 7.5in @96dpi. Electron printToPDF with
   preferCSSPageSize:true honours this; one .export-page == one PDF page. */
@page { size: 13.333in 7.5in; margin: 0; }
html, body { margin: 0; }
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
