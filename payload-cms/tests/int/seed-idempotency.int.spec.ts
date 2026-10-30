import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { normalizeTitle } from '@/utilities/dedupeByTitle'

import { beforeAll, describe, expect, it } from 'vitest'

const DEFAULT_PROJECT_TITLES = ['Morphsites', 'Rawnet Ltd.', 'Project Better Energy']
const DEFAULT_EXPERIENCE_TITLES = ['Personal infrastructure', 'Platform support']

let payload: Payload
let payloadConfig: Awaited<typeof config>

async function runStartupSeeding() {
  await payloadConfig.onInit?.(payload)
}

async function countByTitle(
  collection: 'projects' | 'experience',
): Promise<Map<string, number>> {
  const result = await payload.find({
    collection,
    depth: 0,
    limit: 1000,
    pagination: false,
    select: { title: true },
  })

  const counts = new Map<string, number>()
  for (const doc of result.docs) {
    const key = normalizeTitle(doc.title)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

describe('startup seeding idempotency', () => {
  beforeAll(async () => {
    payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })
  })

  it('leaves one project and experience row per title after two consecutive runs', async () => {
    await runStartupSeeding()
    await runStartupSeeding()

    const projects = await countByTitle('projects')
    const experience = await countByTitle('experience')

    for (const title of DEFAULT_PROJECT_TITLES) {
      expect(projects.get(normalizeTitle(title)), `projects: ${title}`).toBe(1)
    }

    for (const title of DEFAULT_EXPERIENCE_TITLES) {
      expect(experience.get(normalizeTitle(title)), `experience: ${title}`).toBe(1)
    }
  })

  it('recognises an existing title with different case and whitespace', async () => {
    const variant = await payload.create({
      collection: 'experience',
      data: { title: '  PLATFORM SUPPORT  ', organization: 'variant', order: 99 },
      context: { disableRevalidate: true },
    })

    try {
      await runStartupSeeding()

      const exact = await payload.find({
        collection: 'experience',
        depth: 0,
        limit: 1000,
        pagination: false,
        where: { title: { equals: 'Platform support' } },
        select: { title: true },
      })
      const normalized = await countByTitle('experience')

      expect(exact.docs).toHaveLength(1)
      expect(normalized.get(normalizeTitle('Platform support'))).toBe(2)
    } finally {
      await payload.delete({
        collection: 'experience',
        id: variant.id,
        context: { disableRevalidate: true },
      })
    }
  })
})
