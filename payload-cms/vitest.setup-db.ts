import fs from 'node:fs'

import { DatabaseHandoff, HANDOFF_FILE } from './vitest-db-handoff'

// Runs in the test worker before the spec (and `@/payload.config`) is imported.
// An externally supplied database is left exactly as it is; otherwise the
// disposable MongoDB started by vitest.global-setup.ts is used.
if (!process.env.MONGODB_URI && !process.env.DATABASE_URL) {
  try {
    const handoff = JSON.parse(fs.readFileSync(HANDOFF_FILE, 'utf8')) as DatabaseHandoff
    if (handoff.uri) {
      process.env.MONGODB_URI = handoff.uri
    }
  } catch {
    // No handoff file: fall back to the adapter's own default.
  }
}
