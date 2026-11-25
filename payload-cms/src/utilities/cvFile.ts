export type CvSource = 'docx' | 'pdf'

export const CV_EXTENSIONS = ['.docx', '.pdf'] as const

const CV_EXTENSION = /\.(docx|pdf)$/i

export const CV_PDF_NOTE =
  'This CV was supplied as a PDF. The HTML below is extracted from its text, so headings and lists are best-effort and tables or the original page layout may differ. Download the PDF for the authoritative version.'

export function cvSourceFromFilename(filename: string | null | undefined): CvSource | null {
  const match = CV_EXTENSION.exec(filename ?? '')
  return match ? (match[1].toLowerCase() as CvSource) : null
}

export function isCvFilename(filename: string | null | undefined): boolean {
  return cvSourceFromFilename(filename) !== null
}
