import type { MammothRun } from 'mammoth'

const CV_FONT_SIZES = [9, 9.5, 10, 10.5, 11, 11.5, 13.5, 14, 22] as const

const CV_FONT_FAMILIES = [
  { name: 'Arial', token: 'arial' },
  { name: 'Segoe UI Emoji', token: 'segoe-ui-emoji' },
  { name: 'Arial Unicode MS', token: 'arial-unicode-ms' },
  { name: 'Times New Roman', token: 'times-new-roman' },
] as const

function fontSizeToken(fontSize: number): string {
  return String(fontSize).replace('.', '-')
}

function fontFamilyStyle(runFont: string | undefined) {
  return CV_FONT_FAMILIES.find(({ name }) => name === runFont)
}

export const cvDocxStyleMap = [
  'u => u',
  ...CV_FONT_SIZES.map((fontSize) => {
    const token = fontSizeToken(fontSize)
    return `r.cvFontSize${token} => span.docx-font-size-${token}:fresh`
  }),
  ...CV_FONT_FAMILIES.map(({ token }) =>
    `r.cvFontFamily${token} => span.docx-font-family-${token}:fresh`,
  ),
  ...CV_FONT_SIZES.flatMap((fontSize) => {
    const sizeToken = fontSizeToken(fontSize)
    return CV_FONT_FAMILIES.map(({ token }) =>
      `r.cvFontSize${sizeToken}AndFontFamily${token} => span.docx-font-size-${sizeToken}.docx-font-family-${token}:fresh`,
    )
  }),
]

export function applyCVDocxRunStyle(run: MammothRun): MammothRun {
  const fontSize = run.fontSize != null && CV_FONT_SIZES.some((size) => size === run.fontSize)
    ? run.fontSize
    : null
  const fontFamily = fontFamilyStyle(run.font)
  const styleParts = [
    fontSize == null ? null : `FontSize${fontSizeToken(fontSize)}`,
    fontFamily == null ? null : `FontFamily${fontFamily.token}`,
  ].filter((part): part is string => part != null)

  if (styleParts.length === 0) return run

  return { ...run, styleId: `cv${styleParts.join('And')}` }
}
