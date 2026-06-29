<script setup lang="ts">
import { onMounted, ref } from 'vue'

const props = defineProps<{ presId: string }>()
const url = ref('')
const frame = ref<HTMLIFrameElement | null>(null)
const deckIdx = ref(0)
const deckTotal = ref(0)

function getBase(): string {
  return location.href.split('?')[0].split('#')[0]
}

function onDeckMsg(e: MessageEvent): void {
  if (e.data?.type === 'deck-state') {
    deckIdx.value = e.data.idx
    deckTotal.value = e.data.total
  }
}
function nav(dir: 'prev' | 'next'): void {
  frame.value?.contentWindow?.postMessage({ type: 'deck-nav', dir }, '*')
}
function openPresenter(): void {
  window.open(`${getBase()}?pres=${props.presId}&p`, '_blank')
}
function goHome(): void {
  location.search = ''
}
function reload(): void {
  const base = getBase()
  url.value = `${base}?pres=${props.presId}&nav=1&t=${Date.now()}`
}

onMounted(() => {
  window.addEventListener('message', onDeckMsg)
  const base = getBase()
  url.value = `${base}?pres=${props.presId}&nav=1`
})

defineExpose({ reload })
</script>

<template>
  <div class="lp">
    <div class="lp-bar">
      <button class="lp-btn" @click="goHome">‹ Inicio</button>
      <div class="lp-nav">
        <button class="lp-arrow" title="Anterior" @click="nav('prev')">◀</button>
        <span class="lp-count">{{ deckTotal ? deckIdx + 1 : '–' }} / {{ deckTotal || '–' }}</span>
        <button class="lp-arrow" title="Siguiente" @click="nav('next')">▶</button>
      </div>
      <button class="lp-btn" @click="openPresenter">Presenter ↗</button>
    </div>
    <div class="lp-body">
      <div v-if="!url" class="lp-msg">Cargando preview…</div>
      <iframe v-else ref="frame" :src="url" class="lp-frame" title="Vista en vivo" />
    </div>
  </div>
</template>

<style scoped>
.lp {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--slate-950);
}
.lp-bar {
  flex-shrink: 0;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.75rem;
  border-bottom: 1px solid var(--rule);
}
.lp-btn {
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--rule);
  border-radius: 3px;
  font-size: 0.8rem;
  color: var(--slate-300);
}
.lp-btn:hover {
  border-color: var(--brand-500);
  color: var(--fg-primary);
}
.lp-nav {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.lp-arrow {
  width: 28px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 1px solid var(--rule);
  border-radius: 3px;
  color: var(--slate-300);
  font-size: 0.7rem;
}
.lp-arrow:hover {
  border-color: var(--brand-500);
  color: var(--fg-primary);
}
.lp-count {
  font-size: 0.78rem;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
  min-width: 4rem;
  text-align: center;
}
.lp-body {
  flex: 1;
  position: relative;
  min-height: 0;
}
.lp-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
.lp-msg {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--fg-muted);
  font-size: 0.9rem;
  padding: 2rem;
  text-align: center;
}
</style>
