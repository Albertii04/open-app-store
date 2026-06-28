import type { Component } from 'vue'

/** A presenter-side control for a slide's synced sub-state. Rendered generically
 *  by the presenter console so it stays presentation-agnostic.
 *  - `variants` drives the slider state's `variant` field (button row).
 *  - `range` drives the `pos` field (a 0–100 slider). */
export type PresenterControl =
  | { kind: 'variants'; label: string; stateKey: string; options: string[] }
  | {
      kind: 'range'
      label: string
      stateKey: string
      min?: number
      max?: number
      step?: number
      lowLabel?: string
      highLabel?: string
    }

/** One step of the optional persistent "thread" chrome bar (a process tracker
 *  pinned above the slides, e.g. SAP → Datasets → … → Dashboard). */
export interface ThreadStep {
  key: string
  label: string
}

export interface SlideEntry {
  component: Component
  title: string
  notes: string
  /** Optional presenter controls for this slide's internal sub-states. */
  controls?: PresenterControl[]
  /** Optional state for the persistent thread bar on this slide. Omit to hide
   *  the bar on this slide. `active` lights one step; `complete` lights all. */
  thread?: { active?: string; complete?: boolean }
}

export interface Wordmark {
  primary: string
  suffix: string
}

export interface ThemeTokens {
  /** CSS custom properties applied to the deck root, e.g. { '--brand-300': '#94a8ca' }. */
  vars?: Record<string, string>
  wordmark?: Wordmark
}

export interface PresentationMeta {
  id: string
  name: string
  description?: string
  date?: string
}

export interface Presentation {
  meta: PresentationMeta
  slides: SlideEntry[]
  theme?: ThemeTokens
  /** Optional persistent process-tracker bar shown above slides that declare a
   *  `thread` state. Rendered as deck chrome so it stays mounted across slides —
   *  only the highlighted step animates on navigation. */
  thread?: { steps: ThreadStep[] }
  /** Optional full replacement for the presenter console (escape hatch). */
  Presenter?: Component
}

/** Imperative API a slide may expose via defineExpose so the engine can drive
 *  its internal sub-states on navigation. All optional. */
export interface SlideInstance {
  tryAdvance?(): boolean
  tryBack?(): boolean
  resetForward?(): void
  resetBackward?(): void
}
