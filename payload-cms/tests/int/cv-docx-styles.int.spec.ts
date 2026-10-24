import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyCVDocxRunStyle,
  cvDocxStyleMap,
} from '../../src/components/CVViewer/cvDocxStyles'

const cvStyles = readFileSync(
  resolve(process.cwd(), 'src/app/(frontend)/local-styles.css'),
  'utf8',
)

describe('CV DOCX styles', () => {
  it('maps every benchmark font size to a renderable HTML class', () => {
    const titleRun = {
      type: 'run' as const,
      children: [],
      font: 'Arial',
      fontSize: 22,
      styleId: null,
      styleName: null,
      isBold: false,
      isUnderline: false,
    }

    expect(applyCVDocxRunStyle(titleRun).styleId).toBe('cvFontSize22AndFontFamilyarial')
    expect(cvDocxStyleMap).toContain(
      'r.cvFontSize22AndFontFamilyarial => span.docx-font-size-22.docx-font-family-arial:fresh',
    )

    for (const size of [9, 9.5, 10, 10.5, 11, 11.5, 13.5, 14, 22]) {
      const token = String(size).replace('.', '-')
      expect(cvDocxStyleMap).toContain(
        `r.cvFontSize${token} => span.docx-font-size-${token}:fresh`,
      )
      expect(cvStyles).toContain(
        `.docx .docx-font-size-${token} { font-size: ${size}pt`,
      )
    }
  })

  it('maps benchmark font families to renderable HTML classes', () => {
    const fontFamilies = [
      ['Arial', 'arial'],
      ['Segoe UI Emoji', 'segoe-ui-emoji'],
      ['Arial Unicode MS', 'arial-unicode-ms'],
      ['Times New Roman', 'times-new-roman'],
    ]

    for (const [font, token] of fontFamilies) {
      const run = {
        type: 'run' as const,
        children: [],
        font,
        fontSize: null,
        styleId: null,
        styleName: null,
        isBold: false,
        isUnderline: false,
      }

      expect(applyCVDocxRunStyle(run).styleId).toBe(`cvFontFamily${token}`)
      expect(cvDocxStyleMap).toContain(
        `r.cvFontFamily${token} => span.docx-font-family-${token}:fresh`,
      )
    }

    expect(cvStyles).toContain('.docx .docx-font-family-arial { font-family: Arial, sans-serif }')
    expect(cvStyles).toContain(
      '.docx .docx-font-family-segoe-ui-emoji { font-family: "Segoe UI Emoji", sans-serif }',
    )
    expect(cvStyles).toContain(
      '.docx .docx-font-family-arial-unicode-ms { font-family: "Arial Unicode MS", Arial, sans-serif }',
    )
    expect(cvStyles).toContain(
      '.docx .docx-font-family-times-new-roman { font-family: "Times New Roman", serif }',
    )
  })

  it('preserves underline formatting while applying font styles', () => {
    const run = {
      type: 'run' as const,
      children: [],
      font: undefined,
      fontSize: 9.5,
      styleId: 'ExistingStyle',
      styleName: 'Existing Style',
      isBold: true,
      isUnderline: true,
    }

    expect(cvDocxStyleMap).toContain('u => u')
    expect(applyCVDocxRunStyle(run)).toMatchObject({
      styleId: 'cvFontSize9-5',
      isBold: true,
      isUnderline: true,
    })
  })

  it('leaves ordinary runs un-underlined and maps explicitly underlined runs', () => {
    const ordinaryRun = {
      type: 'run' as const,
      children: [],
      font: 'Arial',
      fontSize: 10,
      styleId: null,
      styleName: null,
      isBold: false,
      isUnderline: false,
    }
    const underlinedRun = { ...ordinaryRun, isUnderline: true }

    expect(cvDocxStyleMap).toContain('u => u')
    expect(applyCVDocxRunStyle(ordinaryRun)).toMatchObject({ isUnderline: false })
    expect(applyCVDocxRunStyle(underlinedRun)).toMatchObject({ isUnderline: true })
    expect(cvStyles).toContain('.docx a { text-decoration: underline }')
  })

  it('leaves unsupported font sizes and font families unchanged', () => {
    const run = {
      type: 'run' as const,
      children: [],
      font: 'Unmapped Font',
      fontSize: 12,
      styleId: 'ExistingStyle',
      styleName: 'Existing Style',
      isBold: false,
      isUnderline: false,
    }

    expect(applyCVDocxRunStyle(run)).toBe(run)
  })
})
