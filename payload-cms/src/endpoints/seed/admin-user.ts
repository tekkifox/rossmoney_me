import type { Payload } from 'payload'

export type SeedAdminOutcome = 'created' | 'exists' | 'skipped'

/**
 * Optional dev admin, seeded on startup from `PAYLOAD_SEED_ADMIN_EMAIL` and
 * `PAYLOAD_SEED_ADMIN_PASSWORD`.
 *
 * This is deliberately create-only and idempotent: an existing user is never
 * updated, its password is never reset and no user is ever deleted. With either
 * variable unset the function does nothing, so deployments that do not opt in
 * behave exactly as before. The password is never logged.
 */
export async function seedAdminUser(
  payload: Payload,
  env: Record<string, string | undefined> = process.env,
): Promise<SeedAdminOutcome> {
  const email = env.PAYLOAD_SEED_ADMIN_EMAIL?.trim()
  const password = env.PAYLOAD_SEED_ADMIN_PASSWORD

  if (!email || !password) {
    return 'skipped'
  }

  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
  })

  if (existing.docs.length > 0) {
    payload.logger.info(`Dev admin seed: user ${email} already exists, leaving it untouched.`)
    return 'exists'
  }

  await payload.create({
    collection: 'users',
    data: { email, password },
    depth: 0,
    overrideAccess: true,
  })

  payload.logger.info(`Dev admin seed: created user ${email}.`)
  return 'created'
}
