<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Boxes,
  House,
  Store,
  Search,
  RefreshCw,
  X,
  Loader,
  TriangleAlert,
  ShieldCheck,
  PackageOpen,
} from 'lucide-vue-next'
import type { TabsState, ToolStatus, ToolSummary } from '../shared/types'

type View = 'home' | 'market'

const isMac = navigator.platform.toLowerCase().includes('mac')

const tools = ref<ToolSummary[]>([])
const tabs = ref<TabsState>({ tabs: [], activeId: null })
const activeStatus = ref<ToolStatus | null>(null)
const view = ref<View>('home')
const query = ref('')

const fallbackIcon =
  '<svg viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="14" fill="currentColor" opacity="0.12"/><rect x="20" y="20" width="24" height="24" rx="6" fill="currentColor" opacity="0.5"/></svg>'

const activeId = computed(() => tabs.value.activeId)
const iconOf = (toolId: string) => tools.value.find((t) => t.id === toolId)?.iconSvg ?? fallbackIcon

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return tools.value
  return tools.value.filter(
    (t) => t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q),
  )
})

async function refresh(): Promise<void> {
  tools.value = await window.shellApi.listTools()
  tabs.value = await window.shellApi.getTabs()
}

function openTool(toolId: string): void {
  activeStatus.value = 'loading'
  void window.shellApi.openTool(toolId)
}
function activateTab(instanceId: string): void {
  void window.shellApi.activateTool(instanceId)
}
function closeTab(instanceId: string): void {
  void window.shellApi.closeTool(instanceId)
}
function reloadTool(): void {
  activeStatus.value = 'loading'
  void window.shellApi.reloadActiveTool()
}
function goHome(): void {
  void window.shellApi.showHome()
}

onMounted(() => {
  void refresh()
  window.shellApi.onToolsChanged(() => void refresh())
  window.shellApi.onTabs((s) => {
    tabs.value = s
    if (!s.activeId) activeStatus.value = null
  })
  window.shellApi.onToolStatus((e) => {
    if (e.id === tabs.value.activeId) activeStatus.value = e.status
  })
})
</script>

<template>
  <div
    class="flex h-screen w-screen flex-col overflow-hidden bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
  >
    <!-- Persistent tab bar -->
    <div
      class="drag flex h-10 shrink-0 items-center gap-1 border-b border-neutral-200 pr-2 dark:border-neutral-800"
      :class="isMac ? 'pl-20' : 'pl-2'"
    >
      <button
        class="no-drag grid size-7 shrink-0 place-items-center rounded-md transition-colors"
        :class="
          !activeId
            ? 'bg-neutral-200/80 text-neutral-900 dark:bg-neutral-800 dark:text-white'
            : 'text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-white'
        "
        title="Inicio"
        @click="goHome"
      >
        <House class="size-4" />
      </button>

      <TransitionGroup name="tab" tag="div" class="relative flex items-center gap-1 overflow-hidden">
        <button
          v-for="t in tabs.tabs"
          :key="t.instanceId"
          class="tab no-drag group flex max-w-44 items-center gap-2 rounded-md px-2 py-1 text-[12px] transition-colors"
          :class="
            activeId === t.instanceId
              ? 'bg-neutral-200/80 text-neutral-900 dark:bg-neutral-800 dark:text-white'
              : 'text-neutral-500 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'
          "
          @click="activateTab(t.instanceId)"
        >
          <span class="tool-glyph grid size-4 shrink-0 place-items-center overflow-hidden" v-html="iconOf(t.toolId)"></span>
          <span class="truncate">{{ t.title }}</span>
          <span
            class="grid size-4 place-items-center rounded text-neutral-400 hover:bg-neutral-300/60 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-white"
            @click.stop="closeTab(t.instanceId)"
          >
            <X class="size-3" />
          </span>
        </button>
      </TransitionGroup>

      <div class="flex-1" />

      <button
        v-if="activeId"
        class="no-drag grid size-7 place-items-center rounded-md text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-white"
        title="Recargar"
        @click="reloadTool"
      >
        <RefreshCw class="size-4" />
      </button>
    </div>

    <!-- Body -->
    <div class="relative flex-1 overflow-hidden">
      <!-- Active tool instance: native view sits here; loading/crash underneath -->
      <template v-if="activeId">
        <Transition name="fade">
          <div
            v-if="activeStatus === 'loading'"
            key="loading"
            class="absolute inset-0 flex flex-col items-center justify-center gap-3"
          >
            <Loader class="size-7 animate-spin text-indigo-500" />
            <p class="text-[13px] text-neutral-500">Cargando…</p>
          </div>
          <div
            v-else-if="activeStatus === 'crashed'"
            key="crashed"
            class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
          >
            <TriangleAlert class="size-7 text-amber-500" />
            <p class="text-sm font-semibold">La herramienta ha fallado</p>
            <button
              class="mt-1 rounded-lg bg-indigo-500 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-indigo-600"
              @click="reloadTool"
            >
              Recargar
            </button>
          </div>
        </Transition>
      </template>

      <!-- Launcher -->
      <div v-else class="h-full overflow-y-auto">
        <div class="mx-auto max-w-5xl px-8 py-10">
          <header class="mb-6 flex items-center gap-3">
            <div
              class="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm"
            >
              <Boxes class="size-5" />
            </div>
            <div>
              <h1 class="text-xl font-semibold tracking-tight">Alberts Toolbox</h1>
              <p class="text-[12px] text-neutral-500">Abre una herramienta — cada una en su pestaña.</p>
            </div>
          </header>

          <div class="mb-6 flex items-center gap-3">
            <div
              class="flex flex-1 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <Search class="size-4 text-neutral-400" />
              <input
                v-model="query"
                type="text"
                placeholder="Buscar herramientas"
                class="w-full bg-transparent text-[13px] outline-none placeholder:text-neutral-400"
              />
            </div>
            <div class="flex rounded-lg border border-neutral-200 p-0.5 dark:border-neutral-800">
              <button
                class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors"
                :class="view === 'home' ? 'bg-neutral-200/80 dark:bg-neutral-800' : 'text-neutral-500'"
                @click="view = 'home'"
              >
                <House class="size-3.5" /> Inicio
              </button>
              <button
                class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors"
                :class="view === 'market' ? 'bg-neutral-200/80 dark:bg-neutral-800' : 'text-neutral-500'"
                @click="view = 'market'"
              >
                <Store class="size-3.5" /> Marketplace
              </button>
            </div>
          </div>

          <p v-if="view === 'market'" class="mb-5 max-w-xl text-[13px] leading-relaxed text-neutral-500">
            La instalación de herramientas de la comunidad desde un registro en GitHub llega en una
            fase posterior. De momento se muestran las herramientas first-party incluidas.
          </p>

          <div
            v-if="filtered.length"
            class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3"
          >
            <button
              v-for="(t, i) in filtered"
              :key="t.id"
              class="card-in group flex flex-col items-start gap-2 rounded-xl border border-neutral-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
              :style="{ animationDelay: i * 0.03 + 's' }"
              @click="openTool(t.id)"
            >
              <span
                class="tool-glyph grid size-11 place-items-center overflow-hidden rounded-lg bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:ring-neutral-700"
                v-html="t.iconSvg ?? fallbackIcon"
              ></span>
              <span class="mt-1 text-[15px] font-semibold tracking-tight">{{ t.name }}</span>
              <span class="line-clamp-2 text-[12px] leading-relaxed text-neutral-500">
                {{ t.description }}
              </span>
              <span
                class="mt-1 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400"
              >
                <ShieldCheck class="size-3" />
                {{ t.capabilities.length ? t.capabilities.length + ' permisos' : 'sin permisos' }}
              </span>
            </button>
          </div>

          <div
            v-else
            class="flex max-w-md flex-col items-start gap-2 rounded-xl border border-dashed border-neutral-300 p-7 dark:border-neutral-700"
          >
            <PackageOpen class="size-6 text-neutral-400" />
            <p class="text-[15px] font-semibold">
              {{ query ? 'Sin resultados' : 'No hay herramientas todavía' }}
            </p>
            <p class="text-[13px] leading-relaxed text-neutral-500">
              <template v-if="query">Prueba otra búsqueda.</template>
              <template v-else>
                Copia <code class="text-indigo-500">templates/tool-starter</code> en
                <code class="text-indigo-500">tools/</code> y reconstruye.
              </template>
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
