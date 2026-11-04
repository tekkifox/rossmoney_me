import sanitizeHtml from 'sanitize-html'

import { convertCVDocxToHtml, normalizeCVDocxForRendering } from '@/components/CVViewer/cvDocxStyles'
import { CV_PDF_NOTE, cvSourceFromFilename, type CvSource } from '@/utilities/cvFile'

export type CvConversion = {
  html: string
  source: CvSource
  /** Shown next to the document when the conversion is not the whole story. */
  note?: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * The stored HTML is rendered directly into the page, so keep only the
 * structural elements a CV needs. Classes are allowed because mammoth uses
 * `docx-*` classes to carry the source document's formatting; scripts, styles,
 * inline event handlers, images and non-http(s) links are removed.
 */
export function sanitizeCvHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'ul',
      'ol',
      'li',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      'caption',
      'a',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'sup',
      'sub',
      'br',
      'span',
      'hr',
      'blockquote',
      'code',
      'pre',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'rel'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
      ol: ['start'],
      '*': ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { a: ['http', 'https', 'mailto', 'tel'] },
    transformTags: {
      a: (tagName, attributes) => ({
        tagName,
        attribs: { ...attributes, rel: 'noopener noreferrer' },
      }),
    },
  })
}

/**
 * The page owns the one <h1>. Shift any document headings down so the stored
 * outline starts at <h2> without losing its relative order (Word "Heading 1"
 * becomes the CV name, "Heading 2" a section, and so on).
 */
export function normalizeCvHeadingLevels(html: string): string {
  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]))
  if (levels.length === 0) return html

  const shift = 2 - Math.min(...levels)
  if (shift === 0) return html

  return html.replace(/<(\/?)h([1-6])\b/gi, (_match, closing: string, level: string) => {
    const next = Math.min(6, Math.max(1, Number(level) + shift))
    return `<${closing}h${next}`
  })
}

/** Home of the PDF text extractor's intermediate blocks. */
type PdfLine = {
  text: string
  size: number
  urls: string[]
}

type PdfTextItem = {
  str: string
  height: number
  transform: number[]
}

type PdfAnnotation = {
  rect?: number[]
  url?: string
  unsafeUrl?: string
}

const BULLET = /^\s*(?:[•▪◦‣·*–—-])\s+/
const NUMBERED = /^\s*(?:\d+|[a-zA-Z]|[ivxlcdm]+)[.)]\s+/i
const URL_OR_EMAIL = /(https?:\/\/[^\s<>"']+|[\w.+-]+@[\w.-]+(?:\.[a-z]{2,})+)/gi

function linkifyLine(text: string, annotationUrls: string[]): string {
  const escaped = escapeHtml(text)
  let linked = false
  const withLinks = escaped.replace(URL_OR_EMAIL, (match) => {
    linked = true
    // `match` is already HTML-escaped, so it is safe inside both the href and
    // the link text. Escaping it again would turn `&amp;` into `&amp;amp;`.
    const href = match.includes('@') && !/^https?:/i.test(match) ? `mailto:${match}` : match
    return `<a href="${href}">${match}</a>`
  })

  if (!linked && annotationUrls.length === 1) {
    return `<a href="${escapeHtml(annotationUrls[0])}">${escaped}</a>`
  }

  return withLinks
}

function isSafeUrl(value: string | undefined): value is string {
  return typeof value === 'string' && /^(?:https?:|mailto:|tel:)/i.test(value.trim())
}

function groupLines(items: PdfTextItem[], annotations: PdfAnnotation[]): PdfLine[] {
  const positioned = items
    .filter((item) => item.str.trim() !== '')
    .map((item) => ({
      text: item.str,
      size: item.height > 0 ? item.height : Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) || 10,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
    }))
    .sort((a, b) => (Math.abs(b.y - a.y) > 1 ? b.y - a.y : a.x - b.x))

  const lines: PdfLine[] = []
  let current: { y: number; size: number; parts: string[]; xs: number[] } | null = null

  const flush = () => {
    if (!current) return
    const text = current.parts.join(' ').replace(/\s+/g, ' ').trim()
    if (text) {
      const minX = Math.min(...current.xs)
      const maxX = Math.max(...current.xs)
      const urls = annotations
        .filter((annotation) => {
          const rect = annotation.rect
          if (!rect || rect.length !== 4) return false
          const centerY = current ? current.y : 0
          const centerX = (minX + maxX) / 2
          return (
            centerX >= Math.min(rect[0], rect[2]) &&
            centerX <= Math.max(rect[0], rect[2]) &&
            centerY >= Math.min(rect[1], rect[3]) &&
            centerY <= Math.max(rect[1], rect[3])
          )
        })
        .map((annotation) => annotation.url ?? annotation.unsafeUrl)
        .filter(isSafeUrl)
      lines.push({ text, size: current.size, urls: [...new Set(urls)] })
    }
    current = null
  }

  for (const item of positioned) {
    if (!current || Math.abs(item.y - current.y) > Math.max(2, item.size * 0.5)) {
      flush()
      current = { y: item.y, size: item.size, parts: [item.text], xs: [item.x] }
      continue
    }
    current.parts.push(item.text)
    current.xs.push(item.x)
    current.size = Math.max(current.size, item.size)
  }
  flush()

  return lines
}

function modalBodySize(items: PdfTextItem[]): number {
  const weights = new Map<number, number>()
  for (const item of items) {
    const size = item.height > 0 ? item.height : 10
    const key = Math.round(size * 2) / 2
    weights.set(key, (weights.get(key) ?? 0) + item.str.trim().length)
  }

  let body = 10
  let best = 0
  for (const [size, weight] of weights) {
    if (weight > best) {
      body = size
      best = weight
    }
  }
  return body
}

function linesToHtml(lines: PdfLine[], bodySize: number): string {
  const html: string[] = []
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null

  const flushList = () => {
    if (!list) return
    html.push(`<${list.tag}>${list.items.map((item) => `<li>${item}</li>`).join('')}</${list.tag}>`)
    list = null
  }

  for (const line of lines) {
    const heading =
      line.size >= bodySize * 1.6 ? 2 : line.size >= bodySize * 1.15 && line.text.length <= 80 ? 3 : null

    if (heading && !BULLET.test(line.text) && !NUMBERED.test(line.text)) {
      flushList()
      html.push(`<h${heading}>${linkifyLine(line.text, line.urls)}</h${heading}>`)
      continue
    }

    const bullet = BULLET.exec(line.text)
    if (bullet) {
      const text = linkifyLine(line.text.slice(bullet[0].length), line.urls)
      if (!list || list.tag !== 'ul') {
        flushList()
        list = { tag: 'ul', items: [] }
      }
      list.items.push(text)
      continue
    }

    const numbered = NUMBERED.exec(line.text)
    if (numbered) {
      const text = linkifyLine(line.text.slice(numbered[0].length), line.urls)
      if (!list || list.tag !== 'ol') {
        flushList()
        list = { tag: 'ol', items: [] }
      }
      list.items.push(text)
      continue
    }

    flushList()
    html.push(`<p>${linkifyLine(line.text, line.urls)}</p>`)
  }

  flushList()
  return html.join('\n')
}

async function convertPdfToHtml(buffer: Buffer): Promise<string> {
  // pdfjs-dist is pure JavaScript and runs in the existing Node runtime. The
  // optional @napi-rs/canvas dependency is only used to rasterise pages; text
  // extraction does not need it, which is all the CV page does.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise

  try {
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const annotations = (await page.getAnnotations()) as unknown as PdfAnnotation[]
      const items = content.items as unknown as PdfTextItem[]
      const lines = groupLines(items, annotations)
      if (lines.length === 0) continue
      pages.push(linesToHtml(lines, modalBodySize(items)))
      page.cleanup()
    }

    return pages.join('\n<hr />\n')
  } finally {
    await document.destroy()
  }
}

/**
 * Convert an uploaded CV file to the HTML stored on the media document. DOCX
 * keeps its real Word structure (headings, lists, tables and links). PDF text
 * has no structure to recover, so the extractor reconstructs headings from
 * relative font size, lists from bullet/number markers and links from
 * annotations or visible URLs; `note` tells the reader that.
 */
export async function convertCvFile({
  buffer,
  filename,
}: {
  buffer: Buffer | Uint8Array
  filename: string
}): Promise<CvConversion> {
  const source = cvSourceFromFilename(filename)
  if (!source) throw new Error('CV must be a .docx or .pdf file')

  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer

  const raw =
    source === 'docx'
      ? await convertCVDocxToHtml(await normalizeCVDocxForRendering(arrayBuffer))
      : await convertPdfToHtml(bytes)

  const html = normalizeCvHeadingLevels(sanitizeCvHtml(raw)).trim()
  if (!html) throw new Error('No readable content was found in the CV')

  return {
    html,
    source,
    ...(source === 'pdf' ? { note: CV_PDF_NOTE } : {}),
  }
}

export function cvRenderFailureNote(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `Automatic HTML rendering failed (${message}). Download the original file below.`
}
