import { DOMParser as XmlDOMParser, XMLSerializer as XmlXMLSerializer } from '@xmldom/xmldom'
import type { MammothRun } from 'mammoth'

const CV_FONT_SIZES = [9, 9.5, 10, 10.5, 11, 11.5, 13.5, 14, 22] as const
const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// w:sz is measured in half-points. A 20pt+ run is the document title; 13pt+
// runs are the CV's uppercase section labels. The Word source uses direct
// formatting rather than Heading styles, so these thresholds are what turn the
// visual outline into real <h2>/<h3> elements.
const TITLE_MIN_HALF_POINTS = 40
const SECTION_MIN_HALF_POINTS = 26

/** Paragraph style ids whose meaning is generic enough to replace with a heading. */
const REPLACEABLE_PARAGRAPH_STYLES = /^(?:Body A A|Default|cvSectionRule|cvEntryRule)?$/i

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

function paragraphStyleId(paragraph: Element): string | undefined {
  const properties = wordChild(paragraph, 'pPr')
  if (!properties) return undefined
  return wordChild(properties, 'pStyle')?.getAttributeNS(WORD_NAMESPACE, 'val') ?? undefined
}

function setParagraphStyle(document: Document, paragraph: Element, styleId: string) {
  let properties = wordChild(paragraph, 'pPr')
  if (!properties) {
    properties = document.createElementNS(WORD_NAMESPACE, 'w:pPr')
    paragraph.insertBefore(properties, paragraph.firstChild)
  }

  let paragraphStyle = wordChild(properties, 'pStyle')
  if (!paragraphStyle) {
    paragraphStyle = document.createElementNS(WORD_NAMESPACE, 'w:pStyle')
    properties.insertBefore(paragraphStyle, properties.firstChild)
  }
  paragraphStyle.setAttributeNS(WORD_NAMESPACE, 'w:val', styleId)
}

function paragraphHasSectionRule(paragraph: Element): boolean {
  return paragraphStyleId(paragraph) === 'cvSectionRule'
}

function largestRunHalfPoints(paragraph: Element): number {
  const sizes = [
    ...Array.from(paragraph.getElementsByTagNameNS(WORD_NAMESPACE, 'sz')),
    ...Array.from(paragraph.getElementsByTagNameNS(WORD_NAMESPACE, 'szCs')),
  ]
  let largest = 0
  for (const size of sizes) {
    const value = Number(size.getAttributeNS(WORD_NAMESPACE, 'val') ?? 0)
    if (Number.isFinite(value) && value > largest) largest = value
  }
  return largest
}

function paragraphText(paragraph: Element): string {
  return Array.from(paragraph.getElementsByTagNameNS(WORD_NAMESPACE, 't'))
    .map((text) => text.textContent ?? '')
    .join('')
    .trim()
}

/**
 * Promote direct-formatted title and section-label paragraphs to style ids the
 * style map turns into real headings. This runs after the border pass so a
 * section heading keeps its rule class instead of losing it to the heading.
 */
function promoteHeadings(document: Document): boolean {
  let changed = false
  const paragraphs = document.getElementsByTagNameNS(WORD_NAMESPACE, 'p')
  for (const paragraph of Array.from(paragraphs)) {
    const text = paragraphText(paragraph)
    if (!text) continue

    const existingStyle = paragraphStyleId(paragraph)
    if (existingStyle && !REPLACEABLE_PARAGRAPH_STYLES.test(existingStyle)) continue

    const halfPoints = largestRunHalfPoints(paragraph)
    if (halfPoints >= TITLE_MIN_HALF_POINTS) {
      setParagraphStyle(document, paragraph, 'cvTitleHeading')
      changed = true
      continue
    }

    // Section labels are short. A long paragraph at 13-14pt is more likely a
    // lead-in than a heading; leave it as a paragraph.
    if (halfPoints >= SECTION_MIN_HALF_POINTS && text.length <= 80) {
      setParagraphStyle(
        document,
        paragraph,
        paragraphHasSectionRule(paragraph) ? 'cvSectionHeadingRule' : 'cvSectionHeading',
      )
      changed = true
    }
  }
  return changed
}

export function normalizeCVDocxXml(xmlText: string): string {
  // Conversion runs during the upload hook in the Node runtime, where
  // DOMParser/XMLSerializer do not exist. The same parser is used by the
  // jsdom tests so both paths share this implementation.
  const document = new XmlDOMParser().parseFromString(
    xmlText,
    'application/xml',
  ) as unknown as Document
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

  if (promoteHeadings(document)) changed = true

  return changed
    ? new XmlXMLSerializer().serializeToString(
        document as unknown as Parameters<XmlXMLSerializer['serializeToString']>[0],
      )
    : xmlText
}

export async function normalizeCVDocxForRendering(arrayBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  // The upload hook runs in Node, so use mammoth's Node zip reader. It reads
  // the package from memory; no temporary file is written.
  // Mammoth drops run colours, so record the benchmark colours as run styles.
  // An omitted w:u val means "no underline" in the benchmark (as in LibreOffice
  // and Mammoth); explicit values such as "single" are preserved by Mammoth.
  const { openZip } = await import('mammoth/lib/unzip')
  const zip = await openZip({ arrayBuffer, buffer: arrayBuffer })
  const xmlText: string = await zip.read('word/document.xml', 'utf-8')
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
  // The page owns the single <h1>, so the document title becomes <h2> and its
  // section labels become <h3>.
  'p.cvTitleHeading => h2.docx-title:fresh',
  'p.cvSectionHeading => h3:fresh',
  'p.cvSectionHeadingRule => h3.docx-section-rule:fresh',
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
  // Conversion is server-side (the media upload hook), so use mammoth's Node
  // entry point with a Buffer. The browser bundle was only needed when the page
  // parsed the DOCX in the client, which it no longer does.
  const mammoth = await import('mammoth')
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(arrayBuffer) }, {
    styleMap: cvDocxStyleMap,
    transformDocument: mammoth.transforms.run(applyCVDocxRunStyle),
    // Experience separators are empty paragraphs. Mammoth drops those by
    // default, which would discard the rules tagged in normalizeCVDocxXml();
    // keep them and let local-styles.css hide every empty paragraph except
    // the rule classes.
    ignoreEmptyParagraphs: false,
  })
  return result.value ?? ''
}
