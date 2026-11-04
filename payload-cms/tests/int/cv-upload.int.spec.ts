// @vitest-environment node
//
// Uploading a CV must convert it once and store the HTML on the media
// document. This uses a real Payload instance so it also proves the
// collection hook receives `req.file` in the runtime the deployment uses.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Payload } from 'payload'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CV_PDF_NOTE } from '@/utilities/cvFile'

const previousBlobToken = process.env.BLOB_READ_WRITE_TOKEN
delete process.env.BLOB_READ_WRITE_TOKEN

let payload: Payload
const createdMediaIds: Array<number | string> = []

const sampleDocx = () => readFileSync(resolve(process.cwd(), 'tests/fixtures/cv-sample.docx'))

function samplePdf(): Buffer {
  const content = `BT /F1 20 Tf 72 720 Td (ROSS MONEY) Tj ET
BT /F1 10 Tf 72 690 Td (Backend developer) Tj ET
BT /F1 12 Tf 72 665 Td (EXPERIENCE) Tj ET
BT /F1 10 Tf 72 645 Td (\\267 Built reliable systems) Tj ET`

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

describe('CV upload rendering', () => {
  beforeAll(async () => {
    const { default: config } = await import('@/payload.config')
    payload = await getPayload({ config: await config })
  }, 120_000)

  afterAll(async () => {
    for (const id of createdMediaIds) {
      await payload.delete({ collection: 'media', id })
    }
    await payload.destroy()

    if (previousBlobToken !== undefined) {
      process.env.BLOB_READ_WRITE_TOKEN = previousBlobToken
    }
  })

  it('stores semantic HTML when a DOCX is uploaded', async () => {
    const doc = await payload.create({
      collection: 'media',
      data: { alt: 'CV upload DOCX test' },
      file: {
        data: sampleDocx(),
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        name: `cv-upload-${Date.now()}.docx`,
        size: sampleDocx().byteLength,
      },
    })
    createdMediaIds.push(doc.id)

    expect(doc.cvHtml).toContain('<h2 class="docx-title">')
    expect(doc.cvHtml).toContain('<h3 class="docx-section-rule">')
    expect(doc.cvHtml).toContain('<ul><li>')
    expect(doc.cvHtml).toContain('<table>')
    expect(doc.cvRenderNote).toBeNull()
  })

  it('stores best-effort HTML and a note when a PDF is uploaded', async () => {
    const doc = await payload.create({
      collection: 'media',
      data: { alt: 'CV upload PDF test' },
      file: {
        data: samplePdf(),
        mimetype: 'application/pdf',
        name: `cv-upload-${Date.now()}.pdf`,
        size: samplePdf().byteLength,
      },
    })
    createdMediaIds.push(doc.id)

    expect(doc.cvHtml).toContain('<h2>ROSS MONEY</h2>')
    expect(doc.cvHtml).toContain('<h3>EXPERIENCE</h3>')
    expect(doc.cvHtml).toContain('<ul><li>Built reliable systems</li>')
    expect(doc.cvRenderNote).toBe(CV_PDF_NOTE)
  })

  it('leaves non-CV uploads alone', async () => {
    const body = Buffer.from('not a CV')
    const doc = await payload.create({
      collection: 'media',
      data: { alt: 'Plain text upload' },
      file: {
        data: body,
        mimetype: 'text/plain',
        name: `notes-${Date.now()}.txt`,
        size: body.byteLength,
      },
    })
    createdMediaIds.push(doc.id)

    expect(doc.cvHtml ?? null).toBeNull()
  })
})
