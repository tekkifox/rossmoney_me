// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CV_PDF_NOTE } from '@/utilities/cvFile'
import {
  convertCvFile,
  normalizeCvHeadingLevels,
  sanitizeCvHtml,
} from '@/utilities/cvRender'

const sampleDocx = () =>
  readFileSync(resolve(process.cwd(), 'tests/fixtures/cv-sample.docx'))

/** A small, standards-compliant PDF with a name, section label, bullets and a URL. */
function samplePdf(): Buffer {
  const content = `BT /F1 20 Tf 72 720 Td (ROSS MONEY) Tj ET
BT /F1 10 Tf 72 690 Td (Backend developer with ten years of experience) Tj ET
BT /F1 12 Tf 72 665 Td (SKILLS) Tj ET
BT /F1 10 Tf 72 645 Td (\\267 Led a team of five engineers) Tj ET
BT /F1 10 Tf 72 625 Td (\\267 Cut deploy time by half) Tj ET
BT /F1 10 Tf 72 595 Td (https://example.com/portfolio) Tj ET`

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ]

  let out = '%PDF-1.4\n'
  const offsets: number[] = [0]
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })

  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index += 1) {
    out += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

  return Buffer.from(out, 'latin1')
}

describe('CV conversion', () => {
  it('renders a DOCX into real headings, lists, tables and links', async () => {
    const result = await convertCvFile({ buffer: sampleDocx(), filename: 'cv.docx' })

    expect(result.source).toBe('docx')
    expect(result.note).toBeUndefined()
    expect(result.html).toContain('<h2 class="docx-title">')
    expect(result.html).toContain('ROSS MONEY')
    expect(result.html).toContain('<h3 class="docx-section-rule">')
    expect(result.html).toContain('<ul><li>')
    expect(result.html).toContain('<table>')
    expect(result.html).toContain('<a href="https://example.com/portfolio"')
    expect(result.html).not.toContain('<h1')
  })

  it('extracts PDF text into headings, lists and links and records the limitation', async () => {
    const result = await convertCvFile({ buffer: samplePdf(), filename: 'cv.pdf' })

    expect(result.source).toBe('pdf')
    expect(result.note).toBe(CV_PDF_NOTE)
    expect(result.html).toContain('<h2>ROSS MONEY</h2>')
    expect(result.html).toContain('<h3>SKILLS</h3>')
    expect(result.html).toContain('<ul><li>Led a team of five engineers</li>')
    expect(result.html).toContain('<a href="https://example.com/portfolio"')
  })

  it('rejects an unsupported file type', async () => {
    await expect(
      convertCvFile({ buffer: Buffer.from('text'), filename: 'cv.txt' }),
    ).rejects.toThrow('CV must be a .docx or .pdf file')
  })

  it('strips scripts, event handlers and unsafe link schemes from stored HTML', () => {
    const html = sanitizeCvHtml(
      '<h2 class="docx-title" onclick="alert(1)">Title</h2>' +
        '<script>alert(1)</script><p style="color:red">Body</p>' +
        '<a href="javascript:alert(1)">bad</a>' +
        '<a href="https://example.com">good</a>' +
        '<iframe src="https://example.com"></iframe>',
    )

    expect(html).toContain('<h2 class="docx-title">Title</h2>')
    expect(html).toContain('<p>Body</p>')
    expect(html).not.toContain('script')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('iframe')
    expect(html).toContain('href="https://example.com"')
  })

  it('keeps a single top-level heading by shifting document headings under the page h1', () => {
    expect(normalizeCvHeadingLevels('<h1>Name</h1><h2>Skills</h2>')).toBe(
      '<h2>Name</h2><h3>Skills</h3>',
    )
    expect(normalizeCvHeadingLevels('<h2>Name</h2><h3>Skills</h3>')).toBe(
      '<h2>Name</h2><h3>Skills</h3>',
    )
  })
})
