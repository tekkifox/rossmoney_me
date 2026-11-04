import { existsSync } from 'node:fs'
import path from 'node:path'

import sanitizeHtml from 'sanitize-html'

import { convertCVDocxToHtml, normalizeCVDocxForRendering } from '@/components/CVViewer/cvDocxStyles'
import { CV_PDF_NOTE, cvSourceFromFilename, type CvSource } from '@/utilities/cvFile'

// pdfjs falls back to a "fake worker" in Node and imports this module
// dynamically, so the standalone tracer cannot discover it from the bundle.
// `next.config.ts` traces `pdfjs-dist/legacy/build/*.mjs` into the output; this
// resolves the traced package pointer explicitly.
//
// This deliberately does not use `createRequire(...).resolve(...)`: Turbopack
// folds a static specifier into a bundled module id (a number, which pdfjs
// rejects as `workerSrc`) and refuses dynamic specifiers at runtime.
const PDFJS_WORKER_RELATIVE = path.join(
  'node_modules',
  'pdfjs-dist',
  'legacy',
  'build',
  'pdf.worker.mjs',
)

const PDFJS_WORKER_PNPM_RELATIVE = path.join(
  'node_modules',
  '.pnpm',
  'node_modules',
  'pdfjs-dist',
  'legacy',
  'build',
  'pdf.worker.mjs',
)

/**
 * Absolute path to the pdfjs worker in the installed package. Exported so the
 * regression test can assert the path exists without running a conversion.
 */
export function resolvePdfjsWorkerPath(): string {
  const roots = [process.cwd(), path.resolve(process.cwd(), '..')]
  for (const root of roots) {
    for (const relative of [PDFJS_WORKER_RELATIVE, PDFJS_WORKER_PNPM_RELATIVE]) {
      const candidate = path.join(root, relative)
      if (existsSync(candidate)) return candidate
    }
  }

  throw new Error(
    `Cannot find the pdfjs worker; expected it at ${path.join(process.cwd(), PDFJS_WORKER_RELATIVE)}`,
  )
}

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
  y: number
  urls: string[]
  column?: 'left' | 'right'
}

type PdfTextItem = {
  str: string
  width?: number
  height: number
  transform: number[]
}

type PositionedItem = {
  text: string
  size: number
  x: number
  maxX: number
  y: number
}

type ColumnBand = {
  top: number
  bottom: number
}

type ColumnLayout = {
  gutter: number
  bands: ColumnBand[]
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

/**
 * Find a real two-column gutter, or return null to keep the single-stream
 * reading order. A candidate only wins when there are plenty of non-trivial
 * items on both sides, a clear empty gap, and the two sides overlap vertically
 * enough to be columns rather than a heading plus a footer/date rail.
 */
function detectColumnLayout(items: PositionedItem[], pageWidth: number): ColumnLayout | null {
  if (items.length < 8 || !Number.isFinite(pageWidth) || pageWidth <= 0) return null

  // A real right column has a consistent left edge. Find the strongest start-x
  // cluster in the middle/right of the page; anything left of it is the left
  // column. This avoids treating the widest possible split (which cuts through
  // normal left-column lines) as the gutter.
  const rightCandidates = items
    .map((item) => item.x)
    .filter((x) => x >= pageWidth * 0.35 && x <= pageWidth * 0.8)
    .sort((a, b) => a - b)

  const clusters: Array<{ start: number; values: number[] }> = []
  for (const x of rightCandidates) {
    const cluster = clusters.at(-1)
    if (cluster && x - cluster.start <= 12) {
      cluster.values.push(x)
    } else {
      clusters.push({ start: x, values: [x] })
    }
  }

  const rightCluster = clusters
    .map((cluster) => ({
      start: cluster.values[Math.floor(cluster.values.length / 2)],
      count: cluster.values.length,
    }))
    .filter((cluster) => cluster.count >= 4)
    .sort((a, b) => b.count - a.count)[0]
  if (!rightCluster) return null

  const rightStart = rightCluster.start
  const left = items.filter((item) => item.maxX <= rightStart - 4)
  const right = items.filter((item) => item.x >= rightStart - 4)
  if (left.length < 4 || right.length < 4) return null

  const minimumWidth = 24
  if (left.filter((item) => item.maxX - item.x >= minimumWidth).length < 3) return null
  if (right.filter((item) => item.maxX - item.x >= minimumWidth).length < 3) return null

  const leftCharacters = left.reduce((total, item) => total + item.text.trim().length, 0)
  const rightCharacters = right.reduce((total, item) => total + item.text.trim().length, 0)
  if (leftCharacters < 40 || rightCharacters < 40) return null

  const leftEdge = Math.max(...left.map((item) => item.maxX))
  const rightEdge = Math.min(...right.map((item) => item.x))
  const gutterGap = rightEdge - leftEdge
  if (gutterGap < 4) return null

  // Only rows that have text on both sides count towards the column band. This
  // keeps a one-line footer/interests row or the page header from stretching
  // the band around the actual column region.
  const pairedRows = [
    ...new Set(
      left
        .filter((item) => right.some((other) => Math.abs(other.y - item.y) <= 12))
        .map((item) => Math.round(item.y * 10) / 10),
    ),
  ].sort((a, b) => b - a)
  if (pairedRows.length < 3) return null

  const regions: number[][] = []
  let region: number[] = []
  for (const y of pairedRows) {
    if (region.length > 0 && region[region.length - 1] - y > 40) {
      regions.push(region)
      region = []
    }
    region.push(y)
  }
  if (region.length > 0) regions.push(region)

  const rightYs = right.map((item) => item.y).sort((a, b) => b - a)
  const bands = regions
    .filter((rows) => rows.length >= 3)
    .map((rows) => {
      const top = Math.max(...rows) + 6
      let bottom = Math.min(...rows) - 6

      // The right column can continue below the last row that had left-column
      // text beside it. Follow it while the vertical gap stays small; a larger
      // gap is a new section (or a footer) and must not join the band.
      for (const y of rightYs) {
        if (y >= bottom) continue
        if (bottom - y > 25) break
        bottom = y - 6
      }

      return { top, bottom }
    })
  if (bands.length === 0) return null

  return {
    gutter: (leftEdge + rightEdge) / 2,
    bands,
  }
}

function positionedItems(items: PdfTextItem[]): PositionedItem[] {
  return items
    .filter((item) => item.str.trim() !== '')
    .map((item) => {
      const size =
        item.height > 0 ? item.height : Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) || 10
      const x = item.transform[4] ?? 0
      // `width` is in the same user-space units as `transform[4]`. Older text
      // items may omit it; a character estimate still gives a usable box.
      const width =
        typeof item.width === 'number' && Number.isFinite(item.width) && item.width > 0
          ? item.width
          : item.str.length * size * 0.5
      return { text: item.str, size, x, maxX: x + width, y: item.transform[5] ?? 0 }
    })
}

function lineFromItems(
  lineItems: PositionedItem[],
  annotations: PdfAnnotation[],
  column?: 'left' | 'right',
): PdfLine | null {
  const text = lineItems
    .map((item) => item.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null

  const minX = Math.min(...lineItems.map((item) => item.x))
  const maxX = Math.max(...lineItems.map((item) => item.maxX))
  const centerX = (minX + maxX) / 2
  const centerY = lineItems[0].y
  const urls = annotations
    .filter((annotation) => {
      const rect = annotation.rect
      if (!rect || rect.length !== 4) return false
      return (
        centerX >= Math.min(rect[0], rect[2]) &&
        centerX <= Math.max(rect[0], rect[2]) &&
        centerY >= Math.min(rect[1], rect[3]) &&
        centerY <= Math.max(rect[1], rect[3])
      )
    })
    .map((annotation) => annotation.url ?? annotation.unsafeUrl)
    .filter(isSafeUrl)

  return {
    text,
    size: Math.max(...lineItems.map((item) => item.size)),
    y: centerY,
    urls: [...new Set(urls)],
    ...(column ? { column } : {}),
  }
}

function groupLines(
  items: PdfTextItem[],
  annotations: PdfAnnotation[],
  pageWidth: number,
): PdfLine[] {
  const positioned = positionedItems(items).sort((a, b) =>
    Math.abs(b.y - a.y) > 1 ? b.y - a.y : a.x - b.x,
  )
  const layout = detectColumnLayout(positioned, pageWidth)

  const groups: PositionedItem[][] = []
  let current: PositionedItem[] = []
  for (const item of positioned) {
    if (current.length === 0 || Math.abs(item.y - current[0].y) > Math.max(2, item.size * 0.5)) {
      if (current.length > 0) groups.push(current)
      current = [item]
      continue
    }
    current.push(item)
  }
  if (current.length > 0) groups.push(current)

  const lines: PdfLine[] = []
  for (const group of groups) {
    const y = group[0].y
    const insideBand =
      layout !== null && layout.bands.some((band) => y <= band.top && y >= band.bottom)
    if (!insideBand) {
      const line = lineFromItems(group, annotations)
      if (line) lines.push(line)
      continue
    }

    const left = group.filter((item) => item.maxX <= layout.gutter)
    const right = group.filter((item) => item.x >= layout.gutter)

    // An item spanning the gutter means this is a full-width line (a section
    // label, table row, or similar), not two column fragments.
    if (left.length + right.length < group.length) {
      const line = lineFromItems(group, annotations)
      if (line) lines.push(line)
      continue
    }

    if (left.length > 0) {
      const line = lineFromItems(left, annotations, 'left')
      if (line) lines.push(line)
    }
    if (right.length > 0) {
      const line = lineFromItems(right, annotations, 'right')
      if (line) lines.push(line)
    }
  }

  // Emit each two-column band left side first, then right side. A full-width
  // line (or the band boundary) ends the band.
  const ordered: PdfLine[] = []
  let leftBand: PdfLine[] = []
  let rightBand: PdfLine[] = []
  const flushBand = () => {
    ordered.push(...leftBand, ...rightBand)
    leftBand = []
    rightBand = []
  }

  for (const line of lines) {
    if (line.column === 'left') {
      leftBand.push(line)
    } else if (line.column === 'right') {
      rightBand.push(line)
    } else {
      flushBand()
      ordered.push(line)
    }
  }
  flushBand()

  return ordered
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

// The DOCX path only emits classes for sizes in this list (see
// `cvDocxStyleMap`). Map the PDF's measured font size onto the nearest one so
// the stored HTML uses the same stylesheet hooks, without adding new sizes.
const PDF_SIZE_TOKENS = [9, 9.5, 10, 10.5, 11, 11.5, 13.5, 14, 22] as const

function pdfSizeClass(size: number): string | null {
  if (!Number.isFinite(size) || size <= 0) return null
  if (size >= 20) return 'docx-font-size-22'

  let closest = PDF_SIZE_TOKENS[0] as number
  for (const token of PDF_SIZE_TOKENS) {
    if (Math.abs(token - size) < Math.abs(closest - size)) closest = token
  }
  if (Math.abs(closest - size) > 1) return null
  return `docx-font-size-${String(closest).replace('.', '-')}`
}

function cvSpan(
  innerHtml: string,
  size: number,
  color: '111111' | '555555',
  strong = false,
): string {
  const classes = [
    pdfSizeClass(size),
    'docx-font-family-arial',
    `docx-color-${color}`,
  ].filter((value): value is string => value !== null)
  const content = strong ? `<strong>${innerHtml}</strong>` : innerHtml
  return `<span class="${classes.join(' ')}">${content}</span>`
}

/** Uppercase labels are the CV's section headings (e.g. "KEY ACHIEVEMENTS"). */
function isUppercaseLabel(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '')
  return letters.length >= 3 && letters === letters.toUpperCase()
}

function linesToHtml(lines: PdfLine[], bodySize: number): string {
  const html: string[] = []
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null
  let currentSection = ''
  let lastEntryY: number | null = null
  let hasEntry = false

  const flushList = () => {
    if (!list) return
    html.push(`<${list.tag}>${list.items.map((item) => `<li>${item}</li>`).join('')}</${list.tag}>`)
    list = null
  }

  for (const line of lines) {
    const text = linkifyLine(line.text, line.urls)

    // The right-hand CV column uses 10.5pt bold subheadings against 9.5pt body
    // text. Promote those short labels only in a detected right column, so a
    // single-column PDF keeps the original heading threshold exactly.
    const rightColumnLabel =
      line.column === 'right' &&
      line.size >= bodySize * 1.08 &&
      line.text.length <= 40 &&
      !/[;:,]$/.test(line.text)
    const uppercaseLabel = isUppercaseLabel(line.text) && line.text.length <= 80
    const subtitle = line.size >= bodySize * 1.35 && line.text.length <= 80
    const title = line.size >= bodySize * 1.6

    if (title) {
      flushList()
      html.push(`<h2 class="docx-title">${cvSpan(text, 22, '111111', true)}</h2>`)
      currentSection = ''
      hasEntry = false
      continue
    }

    if ((uppercaseLabel || rightColumnLabel) && !BULLET.test(line.text)) {
      flushList()
      html.push(`<h3 class="docx-section-rule">${cvSpan(text, line.size, '111111', true)}</h3>`)
      if (uppercaseLabel) {
        currentSection = line.text.trim().toUpperCase()
        hasEntry = false
        lastEntryY = null
      }
      continue
    }

    if (subtitle && !BULLET.test(line.text)) {
      flushList()
      html.push(`<h3>${cvSpan(text, line.size, '111111', true)}</h3>`)
      continue
    }

    const bullet = BULLET.exec(line.text)
    if (bullet) {
      const bulletText = linkifyLine(line.text.slice(bullet[0].length), line.urls)
      if (!list || list.tag !== 'ul') {
        flushList()
        list = { tag: 'ul', items: [] }
      }
      list.items.push(cvSpan(bulletText, line.size, '555555'))
      continue
    }

    const numbered = NUMBERED.exec(line.text)
    if (numbered) {
      const numberedText = linkifyLine(line.text.slice(numbered[0].length), line.urls)
      if (!list || list.tag !== 'ol') {
        flushList()
        list = { tag: 'ol', items: [] }
      }
      list.items.push(cvSpan(numberedText, line.size, '555555'))
      continue
    }

    flushList()

    // Larger, short, non-uppercase lines are the CV's job/entry titles. Mirror
    // the DOCX paragraphs with a bold span, and put the experience separator
    // between entries (never inside a title/company pair).
    const entryLike = line.size >= bodySize * 1.08 && line.text.length <= 80
    if (entryLike) {
      if (
        currentSection === 'EXPERIENCE' &&
        hasEntry &&
        lastEntryY !== null &&
        lastEntryY - line.y > 24
      ) {
        html.push('<p class="docx-entry-rule"></p>')
      }
      html.push(`<p>${cvSpan(text, line.size, '111111', true)}</p>`)
      if (currentSection === 'EXPERIENCE') {
        hasEntry = true
        lastEntryY = line.y
      }
      continue
    }

    html.push(`<p>${cvSpan(text, line.size, '555555')}</p>`)
  }

  flushList()
  return html.join('\n')
}

async function convertPdfToHtml(buffer: Buffer): Promise<string> {
  // pdfjs-dist is pure JavaScript and runs in the existing Node runtime. The
  // optional @napi-rs/canvas dependency is only used to rasterise pages; text
  // extraction does not need it, which is all the CV page does.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfjsWorkerPath()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  })
  const document = await loadingTask.promise

  try {
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const annotations = (await page.getAnnotations()) as unknown as PdfAnnotation[]
      const items = content.items as unknown as PdfTextItem[]
      const lines = groupLines(items, annotations, viewport.width)
      if (lines.length === 0) continue
      pages.push(linesToHtml(lines, modalBodySize(items)))
      page.cleanup()
    }

    return pages.join('\n<hr />\n')
  } finally {
    await loadingTask.destroy()
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
