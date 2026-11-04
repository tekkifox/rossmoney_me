// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { GET } from '@/app/api/og/route'
import {
  DEFAULT_OG_DESCRIPTION,
  DEFAULT_OG_TITLE,
  OG_IMAGE_CACHE_CONTROL,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  resolveOgContent,
} from '@/utilities/ogImage'
import { OG_INPUT_LIMITS } from '@/utilities/ogSanitize'

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

const pngSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  return { width: view.getUint32(16), height: view.getUint32(20) }
}

const requestFor = (query = '') =>
  GET(new Request(`http://localhost/api/og${query ? `?${query}` : ''}`))

const readImage = async (query?: string) => {
  const response = await requestFor(query)

  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('image/png')
  expect(response.headers.get('cache-control')).toBe(OG_IMAGE_CACHE_CONTROL)

  const bytes = new Uint8Array(await response.arrayBuffer())

  return { response, bytes }
}

describe('GET /api/og', () => {
  it('renders a 1200x630 PNG with the long public cache lifetime', async () => {
    const { bytes } = await readImage(
      'title=Contact&description=Get%20in%20touch%20about%20platform%20and%20DevOps%20work.',
    )

    expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_SIGNATURE)
    expect(bytes.byteLength).toBeGreaterThan(1_000)
    expect(pngSize(bytes)).toEqual({ width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT })
  }, 120_000)

  it('still renders a bounded card for a hostile, oversized, non-ASCII title', async () => {
    const hostile = `Ünïcödé — façade ${'\u202e'.repeat(10)}${'<script>alert("x")</script>'.repeat(40)}${'A'.repeat(5_000)}`

    const content = resolveOgContent(
      new URLSearchParams({ title: hostile, description: hostile }),
    )

    expect(content.title).toHaveLength(OG_INPUT_LIMITS.title)
    expect(content.description).toHaveLength(OG_INPUT_LIMITS.description)
    expect(content.title).not.toContain('\u202e')
    expect(content.title).toContain('Ünïcödé — façade')

    const { bytes } = await readImage(
      `title=${encodeURIComponent(hostile)}&description=${encodeURIComponent(hostile)}`,
    )

    expect(pngSize(bytes)).toEqual({ width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT })
  }, 120_000)

  it('falls back to the site defaults when the parameters are absent', async () => {
    expect(resolveOgContent(new URLSearchParams())).toEqual({
      title: DEFAULT_OG_TITLE,
      description: DEFAULT_OG_DESCRIPTION,
    })

    // `leader` is a Payload parameter, not one this card renders.
    expect(resolveOgContent(new URLSearchParams({ leader: 'ignored' }))).toEqual({
      title: DEFAULT_OG_TITLE,
      description: DEFAULT_OG_DESCRIPTION,
    })

    const { bytes } = await readImage()
    expect(pngSize(bytes)).toEqual({ width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT })
  }, 120_000)
})

