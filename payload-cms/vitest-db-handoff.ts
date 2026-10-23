import path from 'node:path'

// Written by vitest.global-setup.ts in the Vitest main process and read by
// vitest.setup-db.ts in each test worker, so the self-provisioned MongoDB URI is
// available before `@/payload.config` (and its database adapter) is imported.
export const HANDOFF_FILE = path.resolve(process.cwd(), 'node_modules/.cache/rossmoney-test-db.json')

export type DatabaseHandoff = {
  uri: string
}
