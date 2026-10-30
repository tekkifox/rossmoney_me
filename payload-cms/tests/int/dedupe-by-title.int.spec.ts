import { describe, expect, it } from 'vitest'

import {
  dedupeByTitle,
  normalizeTitle,
  partitionDuplicatesByTitle,
} from '@/utilities/dedupeByTitle'

describe('dedupeByTitle', () => {
  it('keeps one entry per duplicate title', () => {
    const docs = [
      { id: 'a', title: 'Morphsites', order: 2 },
      { id: 'b', title: 'Morphsites', order: 1 },
      { id: 'c', title: 'Rawnet Ltd.', order: 3 },
    ]

    const result = dedupeByTitle(docs)

    expect(result.map((doc) => doc.id)).toEqual(['b', 'c'])
  })

  it('matches titles case-insensitively and ignores surrounding whitespace', () => {
    const docs = [
      { id: 'high', title: '  Project Better Energy ', order: 9 },
      { id: 'low', title: 'PROJECT BETTER ENERGY', order: 1 },
      { id: 'unrelated', title: 'Something else', order: 2 },
    ]

    const result = dedupeByTitle(docs)

    expect(result.map((doc) => doc.id)).toEqual(['low', 'unrelated'])
  })

  it('breaks a tie on order by keeping the oldest createdAt', () => {
    const docs = [
      { id: 'newer', title: 'Platform support', order: 1, createdAt: '2026-10-02T00:00:00.000Z' },
      { id: 'older', title: 'Platform support', order: 1, createdAt: '2026-10-01T00:00:00.000Z' },
    ]

    const result = dedupeByTitle(docs)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('older')
  })

  it('treats a missing order as the lowest priority', () => {
    const docs = [
      { id: 'unordered', title: 'Experience', order: null },
      { id: 'ordered', title: 'Experience', order: 42 },
    ]

    const result = dedupeByTitle(docs)

    expect(result.map((doc) => doc.id)).toEqual(['ordered'])
  })

  it('returns the input untouched when there are no duplicates', () => {
    const docs = [
      { id: 'a', title: 'One', order: 1 },
      { id: 'b', title: 'Two', order: 2 },
      { id: 'c', title: 'Three', order: 3 },
    ]

    expect(dedupeByTitle(docs)).toEqual(docs)
  })

  it('reports exactly which entries would be removed', () => {
    const docs = [
      { id: 'keep', title: 'Rawnet Ltd.', order: 1 },
      { id: 'extra', title: 'rawnet ltd.', order: 2 },
    ]

    const result = partitionDuplicatesByTitle(docs)

    expect(result.kept.map((doc) => doc.id)).toEqual(['keep'])
    expect(result.duplicates.map((doc) => doc.id)).toEqual(['extra'])
  })

  it('keeps untitled documents instead of merging them together', () => {
    const docs = [
      { id: 'a', title: '', order: 1 },
      { id: 'b', title: null, order: 2 },
    ]

    expect(dedupeByTitle(docs)).toEqual(docs)
  })

  it('normalises the key used by the read path and the seed check', () => {
    expect(normalizeTitle('  Morphsites ')).toBe('morphsites')
    expect(normalizeTitle(undefined)).toBe('')
  })
})
