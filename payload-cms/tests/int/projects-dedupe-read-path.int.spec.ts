import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { assembleSite } from '@/utilities/assembleSite'
import { normalizeTitle } from '@/utilities/dedupeByTitle'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PROJECT_TITLE = 'Dedupe Read Path Project'
const EXPERIENCE_TITLE = 'Dedupe Read Path Experience'

let payload: Payload
const createdIds: Array<{ collection: 'projects' | 'experience'; id: number | string }> = []

describe('site read path de-duplication', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    for (const entry of createdIds.reverse()) {
      await payload.delete({
        collection: entry.collection,
        id: entry.id,
        context: { disableRevalidate: true },
      })
    }
  })

  it('returns one project when the database holds title variants', async () => {
    const ignored = await payload.create({
      collection: 'projects',
      data: { title: `  ${PROJECT_TITLE.toUpperCase()}  `, role: 'higher order', order: 9 },
      context: { disableRevalidate: true },
    })
    const preferred = await payload.create({
      collection: 'projects',
      data: { title: PROJECT_TITLE.toLowerCase(), role: 'lowest order', order: 2 },
      context: { disableRevalidate: true },
    })
    createdIds.push(
      { collection: 'projects', id: ignored.id },
      { collection: 'projects', id: preferred.id },
    )

    const site = await assembleSite(payload)
    const matches = site.projects.filter(
      (project) => normalizeTitle(project.title) === normalizeTitle(PROJECT_TITLE),
    )

    expect(matches).toHaveLength(1)
    expect(matches[0].id).toBe(preferred.id)
  })

  it('returns one experience entry when the database holds title variants', async () => {
    const ignored = await payload.create({
      collection: 'experience',
      data: { title: ` ${EXPERIENCE_TITLE} `, organization: 'higher order', order: 8 },
      context: { disableRevalidate: true },
    })
    const preferred = await payload.create({
      collection: 'experience',
      data: { title: EXPERIENCE_TITLE.toUpperCase(), organization: 'lowest order', order: 3 },
      context: { disableRevalidate: true },
    })
    createdIds.push(
      { collection: 'experience', id: ignored.id },
      { collection: 'experience', id: preferred.id },
    )

    const site = await assembleSite(payload)
    const matches = site.experience.filter(
      (entry) => normalizeTitle(entry.title) === normalizeTitle(EXPERIENCE_TITLE),
    )

    expect(matches).toHaveLength(1)
    expect(matches[0].id).toBe(preferred.id)
  })
})
