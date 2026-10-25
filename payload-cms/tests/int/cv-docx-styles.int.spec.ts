import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import mammoth from 'mammoth'
import {
  applyCVDocxRunStyle,
  cvDocxStyleMap,
  normalizeCVDocxForRendering,
  normalizeCVDocxXml,
} from '../../src/components/CVViewer/cvDocxStyles'

const cvStyles = readFileSync(resolve(process.cwd(), 'src/app/(frontend)/local-styles.css'), 'utf8')
const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// A real DOCX package shaped like the benchmark CV: the body runs carry
// <w:u w:color="…"/> without a value on plain text, colours are per run, the
// section heading has a thick bottom border, and the link uses a field-free
// hyperlink relationship. The fixture is converted by Mammoth, not mocked.
const benchmarkDocxBase64 =
  'UEsDBBQAAAAIAFYJWV1iiMjyBQEAALECAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbK2Su27DIBSGXwWxRjZph6qqbGfoZWw7pA9A4dhGgQPi4DR+++I49VClzZIR/tsnRLU5OMv2EMl4rPlNueYMUHltsKv5x/aluOeMkkQtrUeo+QjEN021HQMQy1mkmvcphQchSPXgJJU+AGal9dHJlI+xE0GqnexA3K7Xd0J5TICpSFMHb6onaOVgE3s+5OuZI4Ilzh5n47RVcxmCNUqmrIs96l8rxWmhzMmjh3oTaJUNXJxdmJS/B065t/ww0Whg7zKmV+myS3z5qIX2anA5Wf5fc4bTt61RsOSnthC9AqL84s6Wi+KkwdUlDkqjBbo+xdx7cR4H9wkxR65PsFT/QIjjl2u+AVBLAwQUAAAACABWCVldm/036q0AAAApAQAACwAAAF9yZWxzLy5yZWxzjc87DsIwDAbgq0TeaVoGhFDTLgipKyoHsBI3rWgeSsKjtycDA0UMjLZ/f5br9mlmdqcQJ2cFVEUJjKx0arJawKU/bfbAYkKrcHaWBCwUoW3qM82Y8kocJx9ZNmwUMKbkD5xHOZLBWDhPNk8GFwymXAbNPcorauLbstzx8GnA2mSdEhA6VQHrF0//2G4YJklHJ2+GbPpx4iuRZQyakoCHC4qrd7vILPCm5qsXmxdQSwMEFAAAAAgAVglZXUrN2GzBAAAAPwEAABwAAAB3b3JkL19yZWxzL2RvY3VtZW50LnhtbC5yZWxzjc9BasMwEAXQq4jZ13K7CKFYzqYtBJJNSA8wSGNbRJoRklqc20cQCg100eXw+e8zw26NQX1TLl7YwHPXgyK24jzPBj7PH09bUKUiOwzCZOBKBXbjcKKAtVXK4lNRzeBiYKk1vWpd7EIRSyeJuCWT5Ii1nXnWCe0FZ9Ivfb/R+bcBj6baOwN57w6eL6DO10T/4WWavKU3sV+RuP6xopcm5XBHMc9U72xpLq0YU6DOSvwJj+La7vtaKTMG0OOgHx4fb1BLAwQUAAAACABWCVldL5MHaOYAAADAAQAADwAAAHdvcmQvc3R5bGVzLnhtbJ2QwU7DMAyGX6XKnaUggVDVbDcEF8QBHsBKvbYicSI7W+nb41ZjoMGJXBL/v//PVtrdRwzVEVnGRM5cb2pTIfnUjdQ78/b6cHVvKilAHYRE6MyMYnbbdmqkzAGl0jhJMzkzlJIba8UPGEE2KSOpt08coWjJvZ0Sd5mTRxGlx2Bv6vrORhjJnIHV1JQ565wMDD1DHoxKHe7hEIrut1Rr41PnzPMCD2uYIC7ZI4SzbLetPTX/xvtB+b4gXwAJ/8Cp+A/Yo3ocRnrXP71k/vTsYvILL9dBG3wKiZ25Xc9p8Gp/L/D1ku0nUEsDBBQAAAAIAFYJWV2d7WkZ4wAAAHoBAAASAAAAd29yZC9udW1iZXJpbmcueG1sXZA9bsMwDIWvInBvJGcoCiNKtgDp0Ck9gCwxiQH9GJJsp1vP0qP1JKVV20i7iOD3yMcH7Q53Z9mAMbXBS6g2Ahh6HUzrrxLez8enF2ApK2+UDR4lfGCCw3431r53DUYaY+TgUz1KuOXc1ZwnfUOn0iZ06Em7hOhUpjZe+Rii6WLQmBJtOsu3Qjxzp1oPk6dqUo5K57fesT/dyUgQZcQOlqSWykIoXczEBkWoAj6HO7oVNr21mH8VWjzjfZW+P79W/qoXavFSxnnhpT6EmQ+w8k7Jqv/hT2ZxErONn9b4w6/tfwBQSwMEFAAAAAgAVglZXRfVwHWAAgAAcggAABEAAAB3b3JkL2RvY3VtZW50LnhtbNVW207jMBB9368Y5WlXK5q0sCxb0aJyR+JSUbrSPhpnSiwc27KdtuHrmSRtepOqSgikzUPiGY/H5xzPJDk+maYSxmid0KoTNBtRAKi4joV66QTDp8u9owCcZypmUivsBDm64KR7PGnHmmcpKg+UQLn2pBMk3pt2GDqeYMpcQxtUNDfSNmWeTPsSTrSNjdUcnaP8qQxbUXQYpkyoYJbG7pJGj0aC4/kMQJXEomSeOLhEGBcUAJ91nHe/0cAUli1v/epxqZV3MGkzx4XoBD0rmAzITnrK1XZYJiHvmElSprLd29xxcFB4wjqp7579hSfhJRZOX02Vd7NAYapYM/C5xHmmUwIKPehVO5jT2FbwvdfpPKbQS2KBkWupSaVmeRUO90ZWqxwZxumIohmwKlNY77oiwQqCezraavcPSFMCq30VvDXNWr8rT7bBY03K/uPD5cVgcPNw37uFwfDurvf47yOyfpoIK6R/ldc66eafDdKLwBXS1304xzFKKnnKKXwCzegn5MisAz0CnJJfUHciMG61c8BeyMqBuhOE2kt05hA8stRt0eorq6C1f3Q42hCktb8hyCJwWZBBRi2gHAwQYwffr5iBPr2ptFIof+xKcXcqSwijBcLl9lvDdzE1UnBq+RwyFaOVQmEMTmeWF+cw9V+CcQ3UKbO4gAMps6+zatKZBwa0OPvgK0plaRUk5FjOQ6J67iZeqYmwXvBfdOEdU9RWMQyfM+UzcGjp6wiGeZ5QEUBWlAKcMaWV4EzCLTWf48xgY4umSW7K43gF2xZxJ7A38S1ZwXYpruerGtFnKLJc5FsVuUKVFaVUQFknWTNbouyQ+76tkpQf4WIw/13ovgNQSwECFAMUAAAACABWCVldYojI8gUBAACxAgAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAFYJWV2b/TfqrQAAACkBAAALAAAAAAAAAAAAAACAATYBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAFYJWV1KzdhswQAAAD8BAAAcAAAAAAAAAAAAAACAAQwCAAB3b3JkL19yZWxzL2RvY3VtZW50LnhtbC5yZWxzUEsBAhQDFAAAAAgAVglZXS+TB2jmAAAAwAEAAA8AAAAAAAAAAAAAAIABBwMAAHdvcmQvc3R5bGVzLnhtbFBLAQIUAxQAAAAIAFYJWV2d7WkZ4wAAAHoBAAASAAAAAAAAAAAAAACAARoEAAB3b3JkL251bWJlcmluZy54bWxQSwECFAMUAAAACABWCVldF9XAdYACAAByCAAAEQAAAAAAAAAAAAAAgAEtBQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAYABgCAAQAA3AcAAAAA'

const benchmarkDocx = () => {
  const bytes = Uint8Array.from(Buffer.from(benchmarkDocxBase64, 'base64'))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function renderCVDocx(html: string) {
  const stylesheet = document.createElement('style')
  stylesheet.textContent = cvStyles
  document.head.append(stylesheet)
  const rendered = document.createElement('div')
  rendered.className = 'docx'
  rendered.innerHTML = html
  document.body.append(rendered)
  return {
    rendered,
    cleanup: () => {
      rendered.remove()
      stylesheet.remove()
    },
  }
}

function spanWithText(root: ParentNode, text: string) {
  return Array.from(root.querySelectorAll('span')).find((span) => span.textContent?.trim() === text)
}

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
      expect(cvDocxStyleMap).toContain(`r.cvFontSize${token} => span.docx-font-size-${token}:fresh`)
      expect(cvStyles).toContain(`.docx .docx-font-size-${token} { font-size: ${size}pt`)
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

  it('maps benchmark run colours to renderable HTML classes', () => {
    const blueCompanyRun = {
      type: 'run' as const,
      children: [],
      font: 'Arial',
      fontSize: 11.5,
      styleId: 'cvColor2386f5',
      styleName: null,
      isBold: true,
      isUnderline: false,
    }

    expect(applyCVDocxRunStyle(blueCompanyRun).styleId).toBe(
      'cvFontSize11-5AndFontFamilyarialAndColor2386f5',
    )
    expect(cvDocxStyleMap).toContain(
      'r.cvFontSize11-5AndFontFamilyarialAndColor2386f5 => span.docx-font-size-11-5.docx-font-family-arial.docx-color-2386f5:fresh',
    )
    expect(cvStyles).toContain('.docx .docx-color-555555 { color: #555 }')
    expect(cvStyles).toContain('.docx .docx-color-111111 { color: #111 }')
    expect(cvStyles).toContain('.docx .docx-color-2386f5 { color: #2386f5 }')
  })

  it('records benchmark colours and section rules without touching underline values', () => {
    const xml = `<w:document xmlns:w="${WORD_NAMESPACE}"><w:body>
      <w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12"/></w:pBdr></w:pPr><w:r><w:rPr><w:rStyle w:val="None"/><w:color w:val="2386F5"/><w:u w:color="2386F5"/></w:rPr><w:t>Heading</w:t></w:r></w:p>
      <w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="2"/></w:pBdr></w:pPr></w:p>
      <w:p><w:r><w:rPr><w:rStyle w:val="RealStyle"/><w:color w:val="2386f5"/><w:u w:val="single"/></w:rPr><w:t>Styled</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="RealParagraph"/><w:pBdr><w:bottom w:val="single" w:sz="12"/></w:pBdr></w:pPr></w:p>
    </w:body></w:document>`

    const normalized = normalizeCVDocxXml(xml)
    const doc = new DOMParser().parseFromString(normalized, 'application/xml')
    const runs = Array.from(doc.getElementsByTagNameNS(WORD_NAMESPACE, 'r'))
    const paragraphs = Array.from(doc.getElementsByTagNameNS(WORD_NAMESPACE, 'p'))
    const styleId = (element: Element) =>
      element
        .getElementsByTagNameNS(WORD_NAMESPACE, 'rStyle')[0]
        ?.getAttributeNS(WORD_NAMESPACE, 'val')

    expect(styleId(runs[0])).toBe('cvColor2386f5')
    expect(styleId(runs[1])).toBe('RealStyle')
    expect(
      paragraphs[0]
        .getElementsByTagNameNS(WORD_NAMESPACE, 'pStyle')[0]
        ?.getAttributeNS(WORD_NAMESPACE, 'val'),
    ).toBe('cvSectionRule')
    expect(paragraphs[1].getElementsByTagNameNS(WORD_NAMESPACE, 'pStyle')).toHaveLength(0)
    expect(
      paragraphs[3]
        .getElementsByTagNameNS(WORD_NAMESPACE, 'pStyle')[0]
        ?.getAttributeNS(WORD_NAMESPACE, 'val'),
    ).toBe('RealParagraph')
    expect(
      runs[0].getElementsByTagNameNS(WORD_NAMESPACE, 'u')[0]?.getAttributeNS(WORD_NAMESPACE, 'val'),
    ).toBeNull()
    expect(
      runs[1].getElementsByTagNameNS(WORD_NAMESPACE, 'u')[0]?.getAttributeNS(WORD_NAMESPACE, 'val'),
    ).toBe('single')
  })

  it('converts benchmark-shaped DOCX runs without adding underline', async () => {
    const arrayBuffer = await normalizeCVDocxForRendering(benchmarkDocx())
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(arrayBuffer) },
      {
        styleMap: cvDocxStyleMap,
        transformDocument: mammoth.transforms.run(applyCVDocxRunStyle),
      },
    )
    const { rendered, cleanup } = renderCVDocx(result.value)

    try {
      const plainRun = spanWithText(
        rendered,
        'PHP Developer with 10+ years of experience across agency and in-house teams',
      )
      const titleRun = spanWithText(rendered, 'CV Title')
      const sectionHeading = spanWithText(rendered, 'PROFESSIONAL SUMMARY')
      const companyRun = spanWithText(rendered, 'Suttons Seeds (Gap Personnel)')
      const underlinedRun = Array.from(rendered.querySelectorAll('u')).find(
        (element) => element.textContent === 'Explicitly underlined source text',
      )
      const bareUnderlineRun = spanWithText(rendered, 'Bare underline marker without a value')
      const listItem = Array.from(rendered.querySelectorAll('li')).find((element) =>
        element.textContent?.includes('Managed Ubuntu server patching'),
      )
      const link = Array.from(rendered.querySelectorAll('a')).find(
        (element) => element.textContent === 'Genuine link',
      )
      const sectionParagraph = sectionHeading?.closest('p')

      expect(rendered.querySelectorAll('u')).toHaveLength(1)
      expect(plainRun).toBeDefined()
      expect(plainRun?.closest('u')).toBeNull()
      expect(plainRun?.classList.contains('docx-font-size-9-5')).toBe(true)
      expect(plainRun?.classList.contains('docx-font-family-arial')).toBe(true)
      expect(plainRun?.classList.contains('docx-color-555555')).toBe(true)
      expect(getComputedStyle(plainRun!).color).toBe('rgb(85, 85, 85)')

      expect(titleRun?.classList.contains('docx-font-size-22')).toBe(true)
      expect(titleRun?.querySelector('strong')?.textContent).toBe('CV Title')

      expect(sectionHeading?.querySelector('strong')?.textContent).toBe('PROFESSIONAL SUMMARY')
      expect(sectionHeading?.classList.contains('docx-color-111111')).toBe(true)
      expect(sectionParagraph?.classList.contains('docx-section-rule')).toBe(true)

      expect(companyRun?.querySelector('strong')?.textContent).toBe('Suttons Seeds (Gap Personnel)')
      expect(companyRun?.classList.contains('docx-color-2386f5')).toBe(true)
      expect(getComputedStyle(companyRun!).color).toBe('rgb(35, 134, 245)')

      expect(underlinedRun?.textContent).toBe('Explicitly underlined source text')
      expect(bareUnderlineRun?.closest('u')).toBeNull()
      expect(listItem?.textContent).toContain('Managed Ubuntu server patching')
      expect(link?.getAttribute('href')).toBe('https://example.com')
      expect(getComputedStyle(link!).color).toBe('rgb(85, 85, 85)')
      expect(getComputedStyle(link!).textDecoration).toBe('underline')
      expect(cvStyles).toContain('.docx p.docx-section-rule { border-bottom: 1.5pt solid #111')
    } finally {
      cleanup()
    }
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
