// Development-only test helper: `pnpm test:int` connects to the MongoDB server
// configured in MONGODB_URI/DATABASE_URL/DEV_MONGO_URI and runs the suite in a
// throwaway database there. Nothing here runs in the CMS, the build or the
// deployment — Vitest only.
import 'dotenv/config'

import fs from 'node:fs'
import path from 'node:path'

import {
  createScratchDatabase,
  dropScratchDatabase,
  resolveBaseMongoUri,
} from './scripts/scratch-db'
import { DatabaseHandoff, HANDOFF_FILE } from './vitest-db-handoff'

export default async function setup() {
  const scratch = createScratchDatabase(resolveBaseMongoUri())

  // Workers usually inherit this, but vitest.setup-db.ts reads the handoff file
  // so the scratch URI is guaranteed to be set before the test file is imported.
  process.env.MONGODB_URI = scratch.uri
  writeHandoff(scratch.uri)
  console.log(
    `[test:int] Using throwaway database ${scratch.databaseName} on the configured MongoDB server.`,
  )

  return async () => {
    removeHandoff()
    try {
      await dropScratchDatabase(scratch)
      console.log(`[test:int] Dropped throwaway database ${scratch.databaseName}.`)
    } catch {
      throw new Error(
        `Could not drop throwaway database ${scratch.databaseName}; remove it from the MongoDB server manually.`,
      )
    }
  }
}

function writeHandoff(uri: string) {
  const handoff: DatabaseHandoff = { uri }
  fs.mkdirSync(path.dirname(HANDOFF_FILE), { recursive: true })
  fs.writeFileSync(HANDOFF_FILE, JSON.stringify(handoff))
}

function removeHandoff() {
  try {
    fs.unlinkSync(HANDOFF_FILE)
  } catch {
    // Nothing to clean up.
  }
}
