import { installHostModules } from './runtime/hostModules'
import { createApp, type Component } from 'vue'
import './engine/engine.css'
import { AudienceDeck, PresenterConsole, ExportDeck, SoloDeck } from './engine'
import { loadPresentation } from './presentations'
import type { Presentation } from './engine/types'
import Home from './Home.vue'
import Onboarding from './Onboarding.vue'
import CodeEditor from './CodeEditor.vue'
import LivePreview from './LivePreview.vue'

const params = new URLSearchParams(location.search)
const isPresenter = params.has('p')

function showLoading(): void {
  const el = document.getElementById('app')
  if (el) el.textContent = 'Cargando presentación…'
}

function showError(msg: string): void {
  const el = document.getElementById('app')
  if (el) {
    el.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#f66'
    el.textContent = `Error: ${msg}`
  }
}

function mountDeck(presentation: Presentation): void {
  document.title = presentation.meta.name
  // A presentation may ship its own presenter console (escape hatch).
  const Root: Component = isPresenter ? (presentation.Presenter ?? PresenterConsole) : AudienceDeck
  // ?nav enables editor-preview navigation (arrow keys + postMessage from the
  // parent); ?clicker lets the live audience window be driven by the clicker.
  createApp(Root, {
    presentation,
    navigable: params.has('nav'),
    clicker: params.has('clicker'),
  }).mount('#app')
}

// Routes:
//   ?preview=<id> → live HMR preview (iframe of the dev server)
//   ?edit=<id>    → AI chat editor (Claude Code) + live preview
//   ?pres=<id>    → play a runtime-compiled presentation
//   ?p            → presenter console (with ?pres)
//   otherwise     → Home dashboard
async function boot(): Promise<void> {
  installHostModules()
  const previewId = params.get('preview')
  if (previewId) {
    document.title = 'Vista en vivo'
    createApp(LivePreview, { presId: previewId }).mount('#app')
    return
  }
  if (params.has('new')) {
    document.title = 'Nueva presentación'
    createApp(Onboarding).mount('#app')
    return
  }
  const editId = params.get('edit')
  if (editId) {
    document.title = 'Editor'
    createApp(CodeEditor, { presId: editId }).mount('#app')
    return
  }
  const exportId = params.get('export')
  if (exportId) {
    showLoading()
    try {
      const p = await loadPresentation(exportId)
      if (p) {
        document.title = `${p.meta.name} — export`
        createApp(ExportDeck, { presentation: p }).mount('#app')
        return
      }
      showError(`No se encontró la presentación "${exportId}"`)
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err))
    }
    return
  }
  // ?solo=<id>&n=<i> → a single static slide (used inside the presenter console's
  // preview iframes, where it fills the iframe viewport at full fidelity).
  const soloId = params.get('solo')
  if (soloId) {
    showLoading()
    try {
      const p = await loadPresentation(soloId)
      const n = Math.max(0, parseInt(params.get('n') ?? '0', 10) || 0)
      if (p) {
        document.title = p.meta.name
        createApp(SoloDeck, { presentation: p, index: n }).mount('#app')
        return
      }
      showError(`No se encontró la presentación "${soloId}"`)
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err))
    }
    return
  }
  const presId = params.get('pres')
  if (presId) {
    showLoading()
    try {
      const p = await loadPresentation(presId)
      if (p) {
        mountDeck(p)
        return
      }
      showError(`No se encontró la presentación "${presId}"`)
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err))
    }
    return
  }
  document.title = 'Presenter'
  createApp(Home).mount('#app')
}

void boot()
