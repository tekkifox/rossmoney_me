import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(resolve(process.cwd(), 'src/app/(frontend)/local-styles.css'), 'utf8')
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')

function luminance(hex: string): number {
  const raw = hex.replace('#', '')
  const value =
    raw.length === 3
      ? raw
          .split('')
          .map((character) => character + character)
          .join('')
      : raw
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

function tokenValue(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`).exec(tokens)
  if (!match) throw new Error(`Missing token --${name}`)
  return match[1]
}

describe('CV contrast', () => {
  it('keeps the document body, accent and headings above 4.5:1 on white', () => {
    const accent = /\.docx .docx-color-2386f5 \{ color: (#[0-9a-f]{6}) \}/.exec(styles)?.[1]
    const sectionHeading = /\.docx .docx-font-size-13-5 \{ font-size: 13\.5pt; color: (#[0-9a-f]{3,6}) \}/.exec(
      styles,
    )?.[1]

    expect(accent).toBeTruthy()
    expect(sectionHeading).toBeTruthy()
    expect(contrast('#555555', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(accent!, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(sectionHeading!, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the CV page eyebrow and lead legible on the page background', () => {
    const pageBackground = tokenValue('primitive-gray-50')
    const eyebrow = tokenValue('primitive-blue-500')
    const lead = tokenValue('primitive-gray-500')

    expect(contrast(eyebrow, pageBackground)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(lead, pageBackground)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the prominent download button on a passing primary token', () => {
    const primary = tokenValue('primitive-blue-500')
    const onPrimary = tokenValue('primitive-white')

    expect(styles).toContain('background: var(--primary); color: var(--on-primary)')
    expect(contrast(primary, onPrimary)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps table header text legible on the table header surface', () => {
    const headerSurface = tokenValue('primitive-gray-100')
    expect(contrast('#555555', headerSurface)).toBeGreaterThanOrEqual(4.5)
  })
})
