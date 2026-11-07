#!/usr/bin/env node
/**
 * Small MongoDB helper for the browser-smoke workflow.
 *
 * The self-hosted runner has Node and the project's `mongodb` driver but not
 * `mongosh`, Docker or the MongoDB Database Tools. This script covers the three
 * operations the workflow needs:
 *
 *   MONGO_URI=... node scripts/mongo-db.mjs ping
 *   MONGO_URI=... SOURCE_DB=rossmoney_dev TARGET_DB=rossmoney_shots_1 \
 *     node scripts/mongo-db.mjs copy
 *   MONGO_URI=... DROP_DBS=rossmoney_ci_1,rossmoney_shots_1 \
 *     node scripts/mongo-db.mjs drop
 *   MONGO_URI=... node scripts/mongo-db.mjs count
 *   MONGO_URI=... node scripts/mongo-db.mjs media-filenames
 *
 * The source database is only read. The copy targets a different database and
 * drops/recreates that target, so the seeded `rossmoney_dev` is never written
 * to or dropped.
 */
import { MongoClient } from 'mongodb'

const uri = process.env.MONGO_URI?.trim() || process.env.MONGODB_URI?.trim()
const command = process.argv[2]

const fail = (message) => {
  // Driver errors can echo a connection string. Never print the URI or a value
  // derived from it, even when a connection attempt fails.
  const value = String(message ?? 'unknown error')
  const redacted = uri ? value.split(uri).join('[redacted]') : value
  console.error(redacted)
  process.exitCode = 1
}

if (!uri) {
  fail('MONGO_URI is not configured')
} else if (!['ping', 'copy', 'drop', 'count', 'media-filenames'].includes(command)) {
  fail('usage: mongo-db.mjs <ping|copy|drop|count|media-filenames>')
} else {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 })

  try {
    await client.connect()

    if (command === 'ping') {
      await client.db().admin().ping()
      console.log(1)
    }

    if (command === 'count') {
      const collections = await client.db().listCollections().toArray()
      console.log(collections.length)
    }

    if (command === 'media-filenames') {
      // The workflow's fallback downloads these from the public media mirror.
      // Only the original filename is served there; size variants have no
      // `filename` of their own for the documents CI copies.
      const filenames = await client.db().collection('media').distinct('filename')
      const usable = filenames
        .filter((name) => typeof name === 'string' && name.trim() !== '')
        .sort()
      for (const name of usable) {
        console.log(name)
      }
    }

    if (command === 'copy') {
      const sourceName = process.env.SOURCE_DB
      const targetName = process.env.TARGET_DB

      if (!sourceName || !targetName) {
        throw new Error('SOURCE_DB and TARGET_DB must both be set')
      }
      if (sourceName === targetName) {
        throw new Error('SOURCE_DB and TARGET_DB must be different')
      }
      if (targetName === 'rossmoney_dev') {
        throw new Error('refusing to overwrite the seeded rossmoney_dev database')
      }

      const source = client.db(sourceName)
      const target = client.db(targetName)

      await target.dropDatabase()

      const collections = await source.listCollections({}, { nameOnly: false }).toArray()
      let documents = 0

      for (const info of collections) {
        if (info.name.startsWith('system.')) {
          continue
        }

        if (info.type === 'view') {
          await target.createCollection(info.name, {
            viewOn: info.options?.viewOn,
            pipeline: info.options?.pipeline,
            collation: info.options?.collation,
          })
          continue
        }

        await target.createCollection(info.name, info.options || {})

        const sourceCollection = source.collection(info.name)
        const targetCollection = target.collection(info.name)
        let batch = []

        const flush = async () => {
          if (batch.length === 0) return
          await targetCollection.insertMany(batch, { ordered: false })
          documents += batch.length
          batch = []
        }

        for await (const document of sourceCollection.find({})) {
          batch.push(document)
          if (batch.length >= 1000) {
            await flush()
          }
        }
        await flush()

        const indexes = await sourceCollection.indexes()
        for (const index of indexes) {
          if (index.name === '_id_') {
            continue
          }
          await targetCollection.createIndex(index.key, indexOptions(index))
        }
      }

      console.log(
        `Copied ${collections.length} collections and ${documents} documents from ${sourceName} to ${targetName}`,
      )
    }

    if (command === 'drop') {
      const names = (process.env.DROP_DBS || '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)

      if (names.length === 0) {
        console.log('No databases to drop')
      }

      for (const name of names) {
        if (name === 'rossmoney_dev') {
          throw new Error('refusing to drop the seeded rossmoney_dev database')
        }
        await client.db(name).dropDatabase()
        console.log(`dropped ${name}`)
      }
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : error)
  } finally {
    await client.close().catch(() => undefined)
  }
}

/**
 * `key`, `v` and `ns` describe an existing index rather than options that
 * `createIndex` accepts. Everything else is copied only when it is present.
 */
function indexOptions(index) {
  const options = { name: index.name }
  const names = [
    'unique',
    'sparse',
    'expireAfterSeconds',
    'partialFilterExpression',
    'collation',
    'weights',
    'default_language',
    'language_override',
    'textIndexVersion',
    '2dsphereIndexVersion',
    'bits',
    'min',
    'max',
    'bucketSize',
    'wildcardProjection',
    'hidden',
    'storageEngine',
  ]

  for (const name of names) {
    if (index[name] !== undefined) {
      options[name] = index[name]
    }
  }

  return options
}
