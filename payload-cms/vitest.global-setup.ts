// Development-only test helper: `pnpm test:int` starts a disposable MongoDB
// when no database is configured. Nothing here runs in the CMS, the build or
// the deployment — Vitest only.
import 'dotenv/config'

import fs from 'node:fs'
import path from 'node:path'

import { MongoMemoryServer } from 'mongodb-memory-server'

import { DatabaseHandoff, HANDOFF_FILE } from './vitest-db-handoff'

export default async function setup() {
  // A developer or CI database always wins and is never modified.
  if (process.env.MONGODB_URI || process.env.DATABASE_URL) {
    console.log('[test:int] Using the externally configured MongoDB (MONGODB_URI/DATABASE_URL).')
    removeHandoff()
    return
  }

  const databaseName = `rossmoney_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const server = await MongoMemoryServer.create()
  const uri = server.getUri(databaseName)

  // Workers usually inherit this, but vitest.setup-db.ts reads the handoff file
  // so the URI is guaranteed to be set before the test file is imported.
  process.env.MONGODB_URI = uri
  writeHandoff(uri)
  console.log(`[test:int] Started disposable MongoDB at ${uri}`)

  return async () => {
    removeHandoff()
    await server.stop()
    console.log('[test:int] Stopped disposable MongoDB.')
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
