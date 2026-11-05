import fs from 'node:fs'

import { DatabaseHandoff, HANDOFF_FILE } from './vitest-db-handoff'

// Runs in the test worker before the spec (and `@/payload.config`) is imported.
// vitest.global-setup.ts writes the throwaway database URI here, so prefer it
// over any base URI the developer's environment carries and never let the suite
// touch the database named in MONGODB_URI/DATABASE_URL.
try {
  const handoff = JSON.parse(fs.readFileSync(HANDOFF_FILE, 'utf8')) as DatabaseHandoff
  if (handoff.uri) {
    process.env.MONGODB_URI = handoff.uri
  }
} catch {
  // No handoff file: use the configured MONGODB_URI/DATABASE_URL as-is.
}
