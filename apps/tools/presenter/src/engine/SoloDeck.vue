<script setup lang="ts">
// Renders a SINGLE slide faithfully inside the deck stage (16:9, fills its own
// viewport — so vw/vh units resolve exactly like the audience view). No sync, no
// navigation: used inside an <iframe> for the presenter console's slide previews.
import { computed } from 'vue'
import type { Presentation } from './types'

const props = defineProps<{ presentation: Presentation; index: number }>()
const themeVars = computed(() => props.presentation.theme?.vars ?? {})
const slide = computed(() => props.presentation.slides[props.index])
</script>

<template>
  <!-- .deck and .slide-host come from engine.css; .deck paints --deck-bg and
       centres the stage, the stage is sized 16:9 to the iframe viewport. -->
  <div class="deck" :style="themeVars">
    <div class="solo-stage">
      <div class="slide-host">
        <component :is="slide.component" v-if="slide" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.solo-stage {
  position: relative;
  width: min(100vw, calc(100vh * 16 / 9));
  height: min(100vh, calc(100vw * 9 / 16));
  overflow: hidden;
}
</style>
