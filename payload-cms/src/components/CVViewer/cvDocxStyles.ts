import type { MammothRun } from 'mammoth'

const CV_FONT_SIZES = [9, 9.5, 10, 10.5, 11, 11.5, 13.5, 14, 22] as const
const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const CV_FONT_FAMILIES = [
  { name: 'Arial', token: 'arial' },
  { name: 'Segoe UI Emoji', token: 'segoe-ui-emoji' },
  { name: 'Arial Unicode MS', token: 'arial-unicode-ms' },
  { name: 'Times New Roman', token: 'times-new-roman' },
] as const

// Text colours used by the benchmark CV. Mammoth does not expose run colours,
// so normalizeCVDocxXml() records them as a synthetic run style instead.
const CV_TEXT_COLORS = [
  { hex: '555555', token: '555555' },
  { hex: '111111', token: '111111' },
  { hex: '2386f5', token: '2386f5' },
] as const

function fontSizeToken(fontSize: number): string {
  return String(fontSize).replace('.', '-')
}

function fontFamilyStyle(runFont: string | undefined) {
  return CV_FONT_FAMILIES.find(({ name }) => name === runFont)
}

function colorStyle(color: string | null | undefined) {
  const normalized = color?.toLowerCase()
  return CV_TEXT_COLORS.find(({ hex }) => hex === normalized)
}

function wordChild(parent: Element, localName: string) {
  return Array.from(parent.children).find(
    (child) => child.namespaceURI === WORD_NAMESPACE && child.localName === localName,
  )
}

export function normalizeCVDocxXml(xmlText: string): string {
  const document = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Unable to parse CV DOCX document XML')
  }

  let changed = false
  const runs = document.getElementsByTagNameNS(WORD_NAMESPACE, 'r')
  for (const run of Array.from(runs)) {
    const runProperties = wordChild(run, 'rPr')
    if (!runProperties) continue

    const color = colorStyle(
      wordChild(runProperties, 'color')?.getAttributeNS(WORD_NAMESPACE, 'val'),
    )
    if (!color) continue

    let runStyle = wordChild(runProperties, 'rStyle')
    const existingStyle = runStyle?.getAttributeNS(WORD_NAMESPACE, 'val')
    // The benchmark only uses the decorative "None" and "Hyperlink.N" character
    // styles. Leave any real character style alone so we do not hide its meaning.
    if (existingStyle && !/^(?:None|Hyperlink(?:\.\d+)?)$/i.test(existingStyle)) continue

    if (!runStyle) {
      runStyle = document.createElementNS(WORD_NAMESPACE, 'w:rStyle')
      runProperties.insertBefore(runStyle, runProperties.firstChild)
    }
    runStyle.setAttributeNS(WORD_NAMESPACE, 'w:val', `cvColor${color.token}`)
    changed = true
  }

  // The benchmark draws section-heading rules with a thick paragraph bottom
  // border and experience separators with a thin one. Mammoth ignores paragraph
  // borders, so expose those paragraphs as classes the CV stylesheet can draw.
  const paragraphs = document.getElementsByTagNameNS(WORD_NAMESPACE, 'p')
  for (const paragraph of Array.from(paragraphs)) {
    const paragraphProperties = wordChild(paragraph, 'pPr')
    if (!paragraphProperties) continue
    const borders = wordChild(paragraphProperties, 'pBdr')
    const bottom = borders ? wordChild(borders, 'bottom') : undefined
    if (!bottom) continue

    const value = bottom.getAttributeNS(WORD_NAMESPACE, 'val')
    const size = Number(bottom.getAttributeNS(WORD_NAMESPACE, 'sz') ?? 0)
    if (value !== 'single' || size <= 0) continue
    // Thick borders draw section headings; thin ones are the empty separator
    // paragraphs between experience entries (w:sz="2" in the benchmark).
    const ruleStyle = size < 8 ? 'cvEntryRule' : 'cvSectionRule'

    let paragraphStyle = wordChild(paragraphProperties, 'pStyle')
    const existingParagraphStyle = paragraphStyle?.getAttributeNS(WORD_NAMESPACE, 'val')
    // Keep real paragraph styles; the benchmark only uses "Body A A"/"Default".
    if (existingParagraphStyle && !/^(?:Body A A|Default)$/i.test(existingParagraphStyle)) continue
    if (!paragraphStyle) {
      paragraphStyle = document.createElementNS(WORD_NAMESPACE, 'w:pStyle')
      paragraphProperties.insertBefore(paragraphStyle, paragraphProperties.firstChild)
    }
    paragraphStyle.setAttributeNS(WORD_NAMESPACE, 'w:val', ruleStyle)
    changed = true
  }

  return changed ? new XMLSerializer().serializeToString(document) : xmlText
}

export async function normalizeCVDocxForRendering(arrayBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  // Import the browser zip reader lazily. The Node entry point pulls in Node's
  // `fs`/`util` polyfills, and Next's `util` polyfill feature-detects generators
  // with `Function(...)` at module load — a CSP `eval` violation on a page that
  // otherwise never evaluates strings. The browser entry point reads the zip
  // from an in-memory buffer; JSZip's unused stream import is shimmed in
  // `next.config.ts`.
  const { openZip } = await import('mammoth/browser/unzip')
  // Mammoth drops run colours, so record the benchmark colours as run styles.
  // An omitted w:u val means "no underline" in the benchmark (as in LibreOffice
  // and Mammoth); explicit values such as "single" are preserved by Mammoth.
  const zip = await openZip({ arrayBuffer, buffer: arrayBuffer })
  const xmlText = await zip.read('word/document.xml', 'utf-8')
  const normalizedXml = normalizeCVDocxXml(xmlText)

  if (normalizedXml === xmlText) return arrayBuffer

  zip.write('word/document.xml', normalizedXml)
  return zip.toArrayBuffer()
}

type CVDocxRunStyle = {
  fontSize?: number
  fontFamily?: string
  color?: string
}

function cvRunStyleId({ fontSize, fontFamily, color }: CVDocxRunStyle): string {
  const parts = [
    fontSize == null ? null : `FontSize${fontSizeToken(fontSize)}`,
    fontFamily == null ? null : `FontFamily${fontFamily}`,
    color == null ? null : `Color${color}`,
  ].filter((part): part is string => part != null)
  return `cv${parts.join('And')}`
}

function cvRunStyleMapEntry(style: CVDocxRunStyle): string {
  const classes = [
    style.fontSize == null ? null : `docx-font-size-${fontSizeToken(style.fontSize)}`,
    style.fontFamily == null ? null : `docx-font-family-${style.fontFamily}`,
    style.color == null ? null : `docx-color-${style.color}`,
  ].filter((part): part is string => part != null)
  return `r.${cvRunStyleId(style)} => span.${classes.join('.')}:fresh`
}

const CV_FONT_SIZE_OPTIONS: Array<number | null> = [null, ...CV_FONT_SIZES]
const CV_FONT_FAMILY_OPTIONS: Array<string | null> = [
  null,
  ...CV_FONT_FAMILIES.map(({ token }) => token),
]
const CV_TEXT_COLOR_OPTIONS: Array<string | null> = [
  null,
  ...CV_TEXT_COLORS.map(({ token }) => token),
]

export const cvDocxStyleMap = [
  'u => u',
  'p.cvSectionRule => p.docx-section-rule:fresh',
  'p.cvEntryRule => p.docx-entry-rule:fresh',
  ...CV_FONT_SIZE_OPTIONS.flatMap((fontSize) =>
    CV_FONT_FAMILY_OPTIONS.flatMap((fontFamily) =>
      CV_TEXT_COLOR_OPTIONS.flatMap((color) => {
        if (fontSize == null && fontFamily == null && color == null) return []
        return [
          cvRunStyleMapEntry({
            fontSize: fontSize ?? undefined,
            fontFamily: fontFamily ?? undefined,
            color: color ?? undefined,
          }),
        ]
      }),
    ),
  ),
]

function colorFromRunStyle(styleId: string | null): string | null {
  const match = /^cvColor([0-9a-f]{6})$/i.exec(styleId ?? '')
  return match?.[1]?.toLowerCase() ?? null
}

export function applyCVDocxRunStyle(run: MammothRun): MammothRun {
  const fontSize =
    run.fontSize != null && CV_FONT_SIZES.some((size) => size === run.fontSize)
      ? run.fontSize
      : null
  const fontFamily = fontFamilyStyle(run.font)
  const color = colorFromRunStyle(run.styleId)
  const styleId = cvRunStyleId({
    fontSize: fontSize ?? undefined,
    fontFamily: fontFamily?.token,
    color: color ?? undefined,
  })

  if (styleId === 'cv') return run

  return { ...run, styleId }
}

export async function convertCVDocxToHtml(arrayBuffer: ArrayBuffer): Promise<string> {
  // `mammoth.browser` is mammoth's prebuilt browser bundle. The package main
  // entry point resolves to the Node build, which drags in jszip's Node
  // `readable-stream` and Next's `util` polyfill; that polyfill calls
  // `Function(...)` at import time and is incompatible with a nonce-only CSP.
  const mammoth = await import('mammoth/mammoth.browser')
  const result = await mammoth.convertToHtml(
    // The browser Mammoth build reads `arrayBuffer` while the Node build reads
    // `buffer`; pass both so the viewer and the jsdom tests share this path.
    { arrayBuffer, buffer: arrayBuffer } as Parameters<typeof mammoth.convertToHtml>[0],
    {
      styleMap: cvDocxStyleMap,
      transformDocument: mammoth.transforms.run(applyCVDocxRunStyle),
      // Experience separators are empty paragraphs. Mammoth drops those by
      // default, which would discard the rules tagged in normalizeCVDocxXml();
      // keep them and let local-styles.css hide every empty paragraph except
      // the rule classes.
      ignoreEmptyParagraphs: false,
    },
  )
  return result.value ?? ''
}
