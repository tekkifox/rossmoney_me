import { MongoClient } from 'mongodb'

// Integration tests and the rate-limit proof never touch the database named in
// the configured URI. They append their own throwaway database to the same
// server and drop it afterwards.
const URI_VARIABLES = ['MONGODB_URI', 'DATABASE_URL', 'DEV_MONGO_URI'] as const

export type ScratchDatabase = {
  uri: string
  databaseName: string
}

export function resolveBaseMongoUri(env: NodeJS.ProcessEnv = process.env): string {
  for (const name of URI_VARIABLES) {
    const value = env[name]?.trim()
    if (value) {
      return value
    }
  }

  throw new Error(
    'No MongoDB URI configured: set MONGODB_URI (or DATABASE_URL, or DEV_MONGO_URI) to a MongoDB server; tests use a throwaway database on it.',
  )
}

export function createScratchDatabase(baseUri: string, prefix = 'rossmoney_int'): ScratchDatabase {
  // Keep the authority (credentials, host, port) and the query string (auth
  // mechanism, authSource, TLS flags) exactly as configured; replace only the
  // database path.
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?#]*)(?:\/[^?#]*)?(\?[^#]*)?(#.*)?$/i.exec(
    baseUri.trim(),
  )

  if (!match) {
    throw new Error(
      'The configured MongoDB URI is not a mongodb:// or mongodb+srv:// connection string.',
    )
  }

  const [, authority, query = '', fragment = ''] = match
  const databaseName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  return {
    uri: `${authority}/${databaseName}${query}${fragment}`,
    databaseName,
  }
}

export async function dropScratchDatabase(database: ScratchDatabase): Promise<void> {
  const client = new MongoClient(database.uri, { serverSelectionTimeoutMS: 15_000 })

  try {
    await client.connect()
    await client.db(database.databaseName).dropDatabase()
  } finally {
    await client.close().catch(() => undefined)
  }
}
