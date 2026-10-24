import { describe, expect, it } from 'vitest'
import { applyCVDocxRunStyle, cvDocxStyleMap } from '../../src/components/CVViewer/cvDocxStyles'

describe('CV DOCX styles', () => {
  it('preserves the benchmark font sizes as renderable classes', () => {
    const titleRun = {
      type: 'run' as const,
      children: [],
      fontSize: 22,
      styleId: null,
      styleName: null,
      isUnderline: false,
    }

    const styledRun = applyCVDocxRunStyle(titleRun)

    expect(styledRun.styleId).toBe('cvFontSize22')
    expect(styledRun.fontSize).toBe(22)
    expect(cvDocxStyleMap).toContain('r.cvFontSize22 => span.docx-font-size-22:fresh')
    expect(cvDocxStyleMap).toContain('r.cvFontSize13-5 => span.docx-font-size-13-5:fresh')
  })

  it('preserves underline formatting while styling supported font sizes', () => {
    const run = {
      type: 'run' as const,
      children: [],
      fontSize: 9.5,
      styleId: 'ExistingStyle',
      styleName: 'Existing Style',
      isUnderline: true,
    }

    expect(cvDocxStyleMap).toContain('u => u')
    expect(applyCVDocxRunStyle(run)).toMatchObject({
      styleId: 'cvFontSize9-5',
      isUnderline: true,
    })
  })

  it('leaves unsupported font sizes and their underline state unchanged', () => {
    const run = {
      type: 'run' as const,
      children: [],
      fontSize: 12,
      styleId: 'ExistingStyle',
      styleName: 'Existing Style',
      isUnderline: false,
    }

    expect(applyCVDocxRunStyle(run)).toBe(run)
  })
})
