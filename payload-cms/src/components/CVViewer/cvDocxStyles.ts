import type { MammothRun } from 'mammoth'

const CV_FONT_SIZES = [9, 9.5, 10, 10.5, 11, 11.5, 13.5, 14, 22] as const

function fontSizeToken(fontSize: number): string {
  return String(fontSize).replace('.', '-')
}

export const cvDocxStyleMap = [
  'u => u',
  ...CV_FONT_SIZES.map((fontSize) => {
    const token = fontSizeToken(fontSize)
    return `r.cvFontSize${token} => span.docx-font-size-${token}:fresh`
  }),
]

export function applyCVDocxRunStyle(run: MammothRun): MammothRun {
  const styleId = run.fontSize != null && CV_FONT_SIZES.some((fontSize) => fontSize === run.fontSize)
    ? `cvFontSize${fontSizeToken(run.fontSize)}`
    : run.styleId

  return styleId === run.styleId ? run : { ...run, styleId }
}
