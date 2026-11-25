import type { Payload, RequiredDataFromCollectionSlug } from 'payload'

export const cv: RequiredDataFromCollectionSlug<'pages'> = {
  slug: 'cv',
  template: 'cv',
  _status: 'published',
  // The CV page is a single CV viewer, so it explicitly opts out of the hero.
  hero: {
    type: 'none',
  },
  title: 'CV',
  eyebrow: 'My CV',
  lead: 'Download or view my curriculum vitae.',
  data: {},
  meta: {
    title: 'CV',
    description: 'Curriculum Vitae',
  },
}

/**
 * A CV page only renders once it references a media document. A database that
 * was created by the seed has never had one, so dev, CI and any fresh install
 * showed the "CV document is not available" card. Seed a small sample CV (the
 * same document the conversion tests use) and link it to the default page, but
 * never replace an upload an editor has already made.
 */
export const CV_SEED_FILENAME = 'rossmoney_cv-sample.docx'
export const CV_SEED_ALT = 'Sample CV for the default CV page'
const CV_SEED_MIMETYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const CV_SEED_DOCX_BASE64 = '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'

export function cvSeedFile(): Buffer {
  return Buffer.from(CV_SEED_DOCX_BASE64, 'base64')
}

/**
 * Media document the seeded CV page should link to, created on first use.
 * Looking it up by the stable `alt` marker keeps this idempotent even when
 * Payload has to rename the upload because the filename is already on disk.
 */
export async function ensureSeededCvMedia(payload: Payload): Promise<string> {
  const existing = await payload.find({
    collection: 'media',
    where: { alt: { equals: CV_SEED_ALT } },
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
  })
  const found = existing.docs[0]
  if (found) return found.id

  const file = cvSeedFile()
  const created = await payload.create({
    collection: 'media',
    data: { alt: CV_SEED_ALT },
    file: {
      data: file,
      mimetype: CV_SEED_MIMETYPE,
      name: CV_SEED_FILENAME,
      size: file.byteLength,
    },
    depth: 0,
    context: { disableRevalidate: true },
    overrideAccess: true,
  })

  return created.id
}

/** Attach the seeded CV to a page that has never had a document. */
export async function attachSeededCv(
  payload: Payload,
  page: { cvFile?: unknown; id: number | string },
): Promise<boolean> {
  if (page.cvFile) return false

  const mediaId = await ensureSeededCvMedia(payload)
  await payload.update({
    collection: 'pages',
    id: page.id,
    data: { cvFile: mediaId },
    context: { disableRevalidate: true },
  })

  return true
}
