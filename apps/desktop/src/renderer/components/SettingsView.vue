<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { CheckCircle, AlertCircle, Loader, ChevronDown, ChevronRight } from 'lucide-vue-next'
import { PROVIDER_LABELS, type ProviderId } from '../../shared/ai-types'

const ids: ProviderId[] = ['claude', 'codex', 'opencode']

type FormConfig = { binPath: string; model: string }
type FormSettings = { active: ProviderId; providers: Record<ProviderId, FormConfig> }

const settings = ref<FormSettings>({
  active: 'claude',
  providers: {
    claude: { binPath: '', model: '' },
    codex: { binPath: '', model: '' },
    opencode: { binPath: '', model: '' },
  },
})
const loaded = ref(false)

// Per-provider test status: 'pending' | 'ok:vX' | 'fail:msg'
const testStatus = ref<Record<string, 'pending' | string>>({})
const models = ref<Record<string, string[]>>({})
const binPathOpen = ref<Record<string, boolean>>({})

async function load(): Promise<void> {
  const data = await window.shellApi.aiGet()
  settings.value = {
    active: data.active,
    providers: {
      claude: { binPath: data.providers.claude?.binPath ?? '', model: data.providers.claude?.model ?? '' },
      codex: { binPath: data.providers.codex?.binPath ?? '', model: data.providers.codex?.model ?? '' },
      opencode: { binPath: data.providers.opencode?.binPath ?? '', model: data.providers.opencode?.model ?? '' },
    },
  }
  loaded.value = true

  // Run tests and model loads in parallel per provider
  await Promise.all(
    ids.map(async (id) => {
      testStatus.value[id] = 'pending'
      const [testResult, modelList] = await Promise.allSettled([
        window.shellApi.aiTest(id),
        window.shellApi.aiModels(id),
      ])
      testStatus.value[id] =
        testResult.status === 'fulfilled' && testResult.value.ok
          ? `ok:${testResult.value.version ?? 'ok'}`
          : `fail:${testResult.status === 'fulfilled' ? (testResult.value.error ?? 'No encontrado') : 'No encontrado'}`
      models.value[id] =
        modelList.status === 'fulfilled' ? modelList.value : []
    }),
  )
}

onMounted(load)

async function setActive(id: ProviderId): Promise<void> {
  settings.value.active = id
  await window.shellApi.aiSet({ active: id })
}

async function setModel(id: ProviderId, model: string): Promise<void> {
  settings.value.providers[id].model = model
  await window.shellApi.aiSet({ providers: { [id]: { model } } })
}

async function setBinPath(id: ProviderId, binPath: string): Promise<void> {
  settings.value.providers[id].binPath = binPath
  await window.shellApi.aiSet({ providers: { [id]: { binPath } } })
  // Re-test after path change
  testStatus.value[id] = 'pending'
  const r = await window.shellApi.aiTest(id)
  testStatus.value[id] = r.ok
    ? `ok:${r.version ?? 'ok'}`
    : `fail:${r.error ?? 'No encontrado'}`
}

function toggleBinPath(id: ProviderId): void {
  binPathOpen.value[id] = !binPathOpen.value[id]
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto px-7 py-6">
    <h1 class="mb-1 text-2xl font-bold tracking-tight">Configuración</h1>
    <p class="mb-6 text-[13px] text-neutral-500">
      Personaliza el comportamiento de Open App Store.
    </p>

    <!-- AI Provider section -->
    <section class="mb-8 max-w-2xl">
      <h2 class="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        Proveedor de IA
      </h2>
      <p class="mb-4 text-[13px] text-neutral-500">
        Lo usan las apps de Open App Store (como Presenter). Elige el predeterminado.
      </p>

      <div v-if="!loaded" class="flex items-center gap-2 text-[13px] text-neutral-400">
        <Loader class="size-4 animate-spin" />
        Cargando…
      </div>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="id in ids"
          :key="id"
          class="rounded-xl border p-4 transition-all"
          :class="
            settings.active === id
              ? 'border-blue-500 bg-blue-500/5 ring-1 ring-blue-500/40 dark:border-blue-400 dark:ring-blue-400/30'
              : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50'
          "
        >
          <!-- Card header: radio + label + status chip -->
          <label class="flex cursor-pointer items-center gap-3">
            <input
              type="radio"
              :value="id"
              :checked="settings.active === id"
              name="ai-provider"
              class="accent-blue-500"
              @change="setActive(id)"
            />
            <span
              class="text-[15px] font-semibold"
              :class="settings.active === id ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-800 dark:text-neutral-100'"
            >
              {{ PROVIDER_LABELS[id] }}
            </span>

            <!-- status chip -->
            <span class="ml-auto flex items-center gap-1 text-[12px]">
              <template v-if="testStatus[id] === 'pending' || testStatus[id] === undefined">
                <Loader class="size-3 animate-spin text-neutral-400" />
                <span class="text-neutral-400">Comprobando…</span>
              </template>
              <template v-else-if="testStatus[id]?.startsWith('ok:')">
                <CheckCircle class="size-3 text-green-500" />
                <span class="font-medium text-green-600 dark:text-green-400">
                  ✓ {{ testStatus[id].slice(3) }}
                </span>
              </template>
              <template v-else>
                <AlertCircle class="size-3 text-amber-500" />
                <span class="text-amber-600 dark:text-amber-400">No encontrado</span>
              </template>
            </span>
          </label>

          <!-- Model selector -->
          <div class="mt-3">
            <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-neutral-400">
              Modelo
            </label>
            <select
              class="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-[13px] text-neutral-800 outline-none transition focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              :value="settings.providers[id].model"
              @change="setModel(id, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">Por defecto</option>
              <option
                v-if="
                  settings.providers[id].model &&
                  !(models[id] ?? []).includes(settings.providers[id].model)
                "
                :value="settings.providers[id].model"
              >
                {{ settings.providers[id].model }}
              </option>
              <option v-for="m in models[id] ?? []" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>

          <!-- Collapsible: binary path -->
          <div class="mt-3">
            <button
              class="flex items-center gap-1 text-[12px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              @click="toggleBinPath(id)"
            >
              <component :is="binPathOpen[id] ? ChevronDown : ChevronRight" class="size-3" />
              Ruta del binario
            </button>
            <div v-if="binPathOpen[id]" class="mt-2">
              <input
                type="text"
                placeholder="auto"
                class="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-[13px] text-neutral-800 outline-none transition focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                :value="settings.providers[id].binPath"
                @change="setBinPath(id, ($event.target as HTMLInputElement).value)"
              />
              <p class="mt-1 text-[11px] text-neutral-400">
                Déjalo vacío para detección automática. Solo si el binario no está en el PATH.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
