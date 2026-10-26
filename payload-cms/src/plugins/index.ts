import { formBuilderPlugin } from '@payloadcms/plugin-form-builder'
import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import { redirectsPlugin } from '@payloadcms/plugin-redirects'
import { seoPlugin } from '@payloadcms/plugin-seo'
import { vercelBlobStorage } from '@payloadcms/storage-vercel-blob'
import { Plugin } from 'payload'
import { revalidateRedirects } from '@/hooks/revalidateRedirects'
import { GenerateTitle, GenerateURL } from '@payloadcms/plugin-seo/types'
import { FixedToolbarFeature, HeadingFeature, lexicalEditor } from '@payloadcms/richtext-lexical'

import { Page, Post } from '@/payload-types'
import { getServerSideURL } from '@/utilities/getURL'
import { rejectHoneypot } from '@/hooks/rejectHoneypot'

const siteName = 'Ross Money - Developer & DevOps Portfolio'
const generateTitle: GenerateTitle<Post | Page> = ({ doc }) => {
  return doc?.title ? `${doc.title} | ${siteName}` : siteName
}

const generateURL: GenerateURL<Post | Page> = ({ doc }) => {
  const url = getServerSideURL()

  return doc?.slug ? `${url}/${doc.slug}` : url
}

export const plugins: Plugin[] = [
  // Always register the plugin, even without a token. Its client upload handler
  // is added to the admin import map unconditionally (to keep dev and prod
  // import maps identical), so registering it only when a token exists makes
  // the admin config reference a component the committed import map lacks.
  // Without `BLOB_READ_WRITE_TOKEN` the plugin disables itself and Payload keeps
  // using local disk storage in `public/media` (self-hosted Portainer).
  vercelBlobStorage({
    collections: {
      media: true,
    },
    // Vercel caps a serverless request body at 4.5 MB, so large media cannot
    // travel through the Payload route. With client uploads the admin instead
    // asks Payload for a short-lived, receipt-backed Vercel Blob token and the
    // browser PUTs the bytes straight to Blob. Access is still enforced twice:
    // Payload checks this collection's `access.create` and the plugin's
    // default access requires a signed-in user.
    //
    // The async route this adds (`/api/vercel-blob-client-upload-route`) only
    // exists when a token is configured, so the no-token Portainer path keeps
    // using ordinary local-disk form uploads.
    clientUploads: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  }),
  redirectsPlugin({
    collections: ['pages', 'posts'],
    overrides: {
      // @ts-expect-error - This is a valid override, mapped fields don't resolve to the same type
      fields: ({ defaultFields }) => {
        return defaultFields.map((field) => {
          if ('name' in field && field.name === 'from') {
            return {
              ...field,
              admin: {
                description: 'You will need to rebuild the website when changing this field.',
              },
            }
          }
          return field
        })
      },
      hooks: {
        afterChange: [revalidateRedirects],
      },
    },
  }),
  nestedDocsPlugin({
    collections: ['categories'],
    generateURL: (docs) => docs.reduce((url, doc) => `${url}/${doc.slug}`, ''),
  }),
  seoPlugin({
    generateTitle,
    generateURL,
  }),
  formBuilderPlugin({
    fields: {
      payment: false,
    },
    formOverrides: {
      fields: ({ defaultFields }) => {
        return defaultFields.map((field) => {
          if ('name' in field && field.name === 'confirmationMessage') {
            return {
              ...field,
              editor: lexicalEditor({
                features: ({ rootFeatures }) => {
                  return [
                    ...rootFeatures,
                    FixedToolbarFeature(),
                    HeadingFeature({ enabledHeadingSizes: ['h1', 'h2', 'h3', 'h4'] }),
                  ]
                },
              }),
            }
          }
          return field
        })
      },
    },
    formSubmissionOverrides: {
      hooks: {
        beforeChange: [rejectHoneypot],
      },
    },
  })
]
