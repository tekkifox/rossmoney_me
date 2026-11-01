import type { CollectionConfig } from 'payload'

import { authenticated } from '../../access/authenticated'

/**
 * Payload's auth defaults are `cookies: { sameSite: 'Lax', secure: false }`, and
 * `auth: true` does not change them. The session cookie must be `Secure` on the
 * HTTPS deployments without making `pnpm dev` (plain HTTP on localhost) unable
 * to keep a session.
 *
 * - `next dev` always runs with NODE_ENV=development, so local development is
 *   never secure even if a developer has copied a production SERVER_URL into
 *   `.env`.
 * - In production an explicitly configured HTTPS origin (Portainer pins
 *   `SERVER_URL=https://www.rossmoney.me`) enables the flag.
 * - Vercel leaves the application URL unset to keep the admin same-origin (see
 *   AGENTS.md), so its deployments are identified by `VERCEL` instead. Vercel
 *   only serves HTTPS.
 * - A local production build over `http://localhost` stays insecure so the
 *   Playwright/admin checks can log in.
 */
export const sessionCookieIsSecure = (
  env: Record<string, string | undefined> = process.env,
): boolean => {
  if (env.NODE_ENV !== 'production') {
    return false
  }

  const configuredURL = env.SERVER_URL || env.NEXT_PUBLIC_SERVER_URL
  if (configuredURL) {
    return configuredURL.startsWith('https://')
  }

  return Boolean(env.VERCEL)
}

export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    admin: authenticated,
    create: authenticated,
    delete: authenticated,
    read: authenticated,
    update: authenticated,
  },
  admin: {
    defaultColumns: ['name', 'email'],
    useAsTitle: 'name',
  },
  auth: {
    cookies: {
      sameSite: 'Lax',
      secure: sessionCookieIsSecure(),
    },
    /**
     * Machine callers (the notification bot) authenticate as a dedicated user
     * with a Payload API key, exactly like a signed-in admin but revocable on
     * its own. `GET /api/bot-settings` documents the header format.
     */
    useAPIKey: true,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
    },
  ],
  timestamps: true,
}
