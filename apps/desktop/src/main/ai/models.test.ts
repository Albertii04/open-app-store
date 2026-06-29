import { describe, it, expect } from 'vitest'
import { listModels } from './models.js'

describe('listModels', () => {
  it('returns curated list for claude', async () => {
    const models = await listModels('claude')
    expect(models).toEqual(['opus', 'sonnet', 'haiku'])
  })

  it('returns curated list for codex and includes gpt-5-codex', async () => {
    const models = await listModels('codex')
    expect(models).toContain('gpt-5-codex')
  })
})
