import type { CollectionConfig, UploadConfig } from 'payload'

import {
  FixedToolbarFeature,
  InlineToolbarFeature,
  lexicalEditor,
} from '@payloadcms/richtext-lexical'
import fs from 'fs'
import path from 'path'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'

// One absolute directory for both writing and serving. A bundler may rewrite
// `import.meta.url`, so resolving from the process working directory (the
// `payload-cms` package, also the Docker runtime `WORKDIR`) keeps the upload
// path and Payload's file route on the same directory.
const localMediaDir = path.resolve(process.cwd(), 'public/media')

// Vercel Blob owns uploads when a token is present (see `src/plugins/index.ts`).
// Without a token the collection keeps writing to local disk, which is what the
// self-hosted Portainer deployment relies on.
const blobStorageEnabled = Boolean(process.env.BLOB_READ_WRITE_TOKEN)

const notFound = () =>
  Response.json({ errors: [{ message: 'Not Found' }] }, { status: 404 })

// Payload's local-disk file route answers a file that is absent from disk with
// a 500 ("Something went wrong."). A media document can outlive its file (a
// self-hosted redeploy replaces the container filesystem, for example), and the
// CV viewer then shows a fetch error instead of falling back to its download
// link. Answer 404 for the missing file; returning nothing lets Payload stream
// an existing file exactly as before.
const localMediaFileHandler: NonNullable<UploadConfig['handlers']>[number] = (_req, { params }) => {
  const { filename } = params

  if (!filename) {
    return notFound()
  }

  const filePath = path.resolve(localMediaDir, filename)

  if (!filePath.startsWith(localMediaDir + path.sep)) {
    return Response.json({ errors: [{ message: 'Invalid filename.' }] }, { status: 400 })
  }

  if (!fs.existsSync(filePath)) {
    return notFound()
  }
}

export const Media: CollectionConfig = {
  slug: 'media',
  folders: true,
  access: {
    create: authenticated,
    delete: authenticated,
    read: anyone,
    update: authenticated,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      //required: true,
    },
    {
      name: 'caption',
      type: 'richText',
      editor: lexicalEditor({
        features: ({ rootFeatures }) => {
          return [...rootFeatures, FixedToolbarFeature(), InlineToolbarFeature()]
        },
      }),
    },
  ],
  upload: {
    // With Vercel Blob active the adapter owns the files; never write them to
    // local disk as well. Otherwise upload to the public/media directory in
    // Next.js, making them publicly accessible even outside of Payload.
    ...(blobStorageEnabled
      ? { disableLocalStorage: true }
      : { staticDir: localMediaDir, handlers: [localMediaFileHandler] }),
    adminThumbnail: 'thumbnail',
    focalPoint: true,
    imageSizes: [
      {
        name: 'thumbnail',
        width: 300,
      },
      {
        name: 'square',
        width: 500,
        height: 500,
      },
      {
        name: 'small',
        width: 600,
      },
      {
        name: 'medium',
        width: 900,
      },
      {
        name: 'large',
        width: 1400,
      },
      {
        name: 'xlarge',
        width: 1920,
      },
      {
        name: 'og',
        width: 1200,
        height: 630,
        crop: 'center',
      },
    ],
  },
}
