import type { Payload } from 'payload'

/**
 * The configuration the bot runs with today, moved out of its environment.
 *
 * These are names and ids, not credentials: the BookStack `token` values
 * (`vortex`, `operator`) are Portainer variable names the agent resolves at run
 * time.
 */
export const BOT_SETTINGS_SEED = {
  targets: [
    {
      name: 'admin-chat',
      channel_id: '1314326014318481458',
      connected_account_id: 'ca_VNMfOQ8NwnlH',
      host_scope: ['vortexservers.co.uk'],
      allow_content: false,
      allow_runbooks: true,
      bookstack: {
        url: 'https://bookstack.vortexservers.co.uk',
        books: 'v-rising,scripts',
        token: 'vortex',
      },
    },
    {
      name: 'automations',
      channel_id: '1549913741280157818',
      connected_account_id: 'ca_ia_wDVGF1Pbe',
      host_scope: ['rossmoney.me', 'photos.rossmoney.me', 'vortexservers.co.uk'],
      allow_content: false,
      allow_runbooks: true,
      bookstack: {
        url: 'https://bookstack.rossmoney.me',
        books: 'runbooks',
        token: 'operator',
      },
    },
  ],
}

/**
 * Seeds the current configuration so the panel opens with real values.
 *
 * A database that already holds targets is left alone — an editor may have
 * changed them — unless `PAYLOAD_SEED=true` asks for the defaults again, which
 * matches how the rest of `onInit` seeds.
 */
export const seedBotSettings = async (payload: Payload, force = false): Promise<boolean> => {
  const existing = await payload.db
    .findGlobal<{ targets?: unknown }>({ slug: 'bot-settings' })
    .catch(() => null)

  const existingTargets = existing?.targets
  if (!force && Array.isArray(existingTargets) && existingTargets.length > 0) {
    return false
  }

  await payload.updateGlobal({
    slug: 'bot-settings',
    data: BOT_SETTINGS_SEED,
    depth: 0,
    overrideAccess: true,
  })

  return true
}
