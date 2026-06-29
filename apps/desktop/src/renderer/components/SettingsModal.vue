<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { PROVIDER_LABELS, type ProviderId } from '../../shared/ai-types'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

// Internal form shape with required strings to avoid undefined v-model issues
type FormConfig = { binPath: string; model: string }
type FormSettings = { active: ProviderId; providers: Record<ProviderId, FormConfig> }

const ids: ProviderId[] = ['claude', 'codex', 'opencode']

const defaultForm = (): FormSettings => ({
  active: 'claude',
  providers: {
    claude: { binPath: '', model: '' },
    codex: { binPath: '', model: '' },
    opencode: { binPath: '', model: '' },
  },
})

const settings = ref<FormSettings>(defaultForm())
const loaded = ref(false)
const testing = ref<Record<string, string>>({})
const models = ref<Record<string, string[]>>({})

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
  // Load model lists in parallel; ignore individual failures
  await Promise.all(
    ids.map(async (id) => {
      try {
        models.value[id] = await window.shellApi.aiModels(id)
      } catch {
        models.value[id] = []
      }
    }),
  )
}
onMounted(load)

async function save(): Promise<void> {
  await window.shellApi.aiSet({
    active: settings.value.active,
    providers: settings.value.providers,
  })
}

async function test(id: ProviderId): Promise<void> {
  testing.value[id] = '…'
  const r = await window.shellApi.aiTest(id)
  testing.value[id] = r.ok ? `✓ ${r.version ?? 'ok'}` : `✕ ${r.error ?? 'error'}`
}
</script>

<template>
  <div v-if="open && loaded" class="overlay" @click.self="emit('close')">
    <div class="modal">
      <header class="sm-head">
        <h2>Ajustes · IA</h2>
        <button class="sm-x" @click="emit('close')">✕</button>
      </header>
      <p class="hint">Proveedor que edita las presentaciones. La autenticación la gestiona cada CLI.</p>
      <section v-for="id in ids" :key="id" class="prov">
        <label class="row">
          <input type="radio" :value="id" v-model="settings.active" @change="save" />
          <strong>{{ PROVIDER_LABELS[id] }}</strong>
          <button class="test" @click="test(id)">Probar</button>
          <span class="status">{{ testing[id] }}</span>
        </label>
        <input
          class="path"
          placeholder="Ruta del binario (vacío = auto)"
          v-model="settings.providers[id].binPath"
          @change="save"
        />
        <select
          class="model-sel"
          :value="settings.providers[id].model"
          @change="settings.providers[id].model = ($event.target as HTMLSelectElement).value; save()"
        >
          <option value="">Por defecto</option>
          <!-- If the saved model isn't in the fetched list, show it so it isn't lost -->
          <option
            v-if="settings.providers[id].model && !(models[id] ?? []).includes(settings.providers[id].model)"
            :value="settings.providers[id].model"
          >{{ settings.providers[id].model }}</option>
          <option v-for="m in (models[id] ?? [])" :key="m" :value="m">{{ m }}</option>
        </select>
      </section>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: grid;
  place-items: center;
  z-index: 100;
}
.modal {
  background: #15151b;
  color: #eee;
  width: 540px;
  max-width: 92vw;
  border-radius: 12px;
  padding: 20px;
}
.sm-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sm-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.sm-x {
  background: none;
  border: none;
  color: #aaa;
  cursor: pointer;
  font-size: 16px;
}
.sm-x:hover {
  color: #eee;
}
.hint {
  opacity: 0.7;
  font-size: 13px;
  margin: 4px 0 12px;
}
.prov {
  border-top: 1px solid #2a2a33;
  padding: 12px 0;
  display: grid;
  gap: 8px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.test {
  margin-left: auto;
  cursor: pointer;
  background: #2a2a3a;
  border: 1px solid #3a3a4a;
  color: #ccc;
  border-radius: 6px;
  padding: 2px 10px;
  font-size: 12px;
}
.test:hover {
  background: #34344a;
  color: #eee;
}
.status {
  font-size: 12px;
  opacity: 0.85;
  min-width: 60px;
}
.path,
.model-sel {
  width: 100%;
  padding: 6px 8px;
  background: #0c0c10;
  border: 1px solid #2a2a33;
  border-radius: 6px;
  color: #eee;
  box-sizing: border-box;
  font-size: 13px;
}
.path:focus,
.model-sel:focus {
  outline: none;
  border-color: #4a4a6a;
}
.model-sel {
  appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23aaa' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 28px;
  cursor: pointer;
}
.model-sel option {
  background: #15151b;
  color: #eee;
}
</style>
