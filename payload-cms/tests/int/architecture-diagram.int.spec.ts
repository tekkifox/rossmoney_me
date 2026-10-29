import { describe, expect, it } from 'vitest'

import { renderDiagram } from '@/utilities/archHelpers'

const architectureLine = (payload: unknown): string | undefined =>
  renderDiagram(payload)
    .split('\n')
    .find((line) => line.includes('/api/architecture'))

describe('renderDiagram endpoint annotation', () => {
  it('annotates /api/architecture with the endpoint named architecture', () => {
    const payload = {
      endpoints: [
        { name: 'overview', url: 'https://archview.rossmoney.me/api/overview' },
        { name: 'architecture', url: 'https://archview.rossmoney.me/api/architecture?project=rossmoney_me' },
        { name: 'metrics', url: 'https://archview.rossmoney.me/api/metrics' },
      ],
    }

    expect(architectureLine(payload)).toBe(
      '     -> /api/architecture (https://archview.rossmoney.me/api/architecture?project=rossmoney_me)',
    )
  })

  it('falls back to the first usable endpoint when none is named architecture', () => {
    const payload = {
      endpoints: [
        { name: 'script', url: 'javascript:alert(1)' },
        { name: 'overview', url: 'https://archview.rossmoney.me/api/overview' },
        { name: 'metrics', url: 'https://archview.rossmoney.me/api/metrics' },
      ],
    }

    expect(architectureLine(payload)).toBe(
      '     -> /api/architecture (https://archview.rossmoney.me/api/overview)',
    )
  })

  it('leaves the line unchanged when endpoints are absent', () => {
    expect(architectureLine({})).toBe('     -> /api/architecture')
    expect(architectureLine(null)).toBe('     -> /api/architecture')
  })

  it('leaves the line unchanged when no endpoint has an http(s) URL', () => {
    const payload = {
      endpoints: [
        { name: 'architecture', url: 'javascript:alert(1)' },
        { name: 'overview', url: '/api/overview' },
      ],
    }

    expect(architectureLine(payload)).toBe('     -> /api/architecture')
    expect(architectureLine(payload)).not.toContain('(')
  })

  it('leaves the line unchanged for an empty endpoints array', () => {
    expect(architectureLine({ endpoints: [] })).toBe('     -> /api/architecture')
  })
})
