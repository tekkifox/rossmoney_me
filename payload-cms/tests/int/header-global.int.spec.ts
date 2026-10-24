import { getPayload } from 'payload'
import config from '@/payload.config'

import { describe, expect, it } from 'vitest'

describe('Header global', () => {
  it('saves all eight configured navigation items', async () => {
    const payload = await getPayload({ config: await config })
    const createNavItems = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        link: {
          type: 'custom' as const,
          label: `Navigation item ${index + 1}`,
          url: `/navigation-${index + 1}`,
        },
      }))

    const updatedHeader = await payload.updateGlobal({
      slug: 'header',
      data: { navItems: createNavItems(8) },
      context: { disableRevalidate: true },
    })

    expect(updatedHeader.navItems).toHaveLength(8)
    await expect(
      payload.updateGlobal({
        slug: 'header',
        data: { navItems: createNavItems(9) },
        context: { disableRevalidate: true },
      }),
    ).rejects.toMatchObject({ name: 'ValidationError' })
  })
})
