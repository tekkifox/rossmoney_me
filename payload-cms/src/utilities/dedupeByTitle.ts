/**
 * De-duplicate documents that share a title.
 *
 * The live site must never render the same project or experience twice, even if
 * several deployments have seeded the shared database. Titles are compared
 * case-insensitively and with surrounding whitespace ignored. The entry with the
 * lowest numeric `order` wins; the oldest `createdAt` breaks a tie. Documents
 * without a title are always kept because there is no safe key to merge them on.
 *
 * The function is pure and deliberately independent of Payload so the same rules
 * can be reused by the read path, the startup seeding and the cleanup script.
 */
export interface DedupeCandidate {
  title?: string | null
  order?: number | null
  createdAt?: string | Date | null
}

export interface DedupeResult<T> {
  /** One document per normalised title, in first-seen order. */
  kept: T[]
  /** Every document that lost to the kept entry. */
  duplicates: T[]
}

/** Normalised key used for both read-path de-duplication and the seed check. */
export function normalizeTitle(title: unknown): string {
  return typeof title === 'string' ? title.trim().toLowerCase() : ''
}

function orderRank(order: unknown): number {
  return typeof order === 'number' && Number.isFinite(order) ? order : Number.POSITIVE_INFINITY
}

function createdAtRank(createdAt: unknown): number {
  if (createdAt instanceof Date) {
    const time = createdAt.getTime()
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY
  }

  if (typeof createdAt === 'string' || typeof createdAt === 'number') {
    const time = new Date(createdAt).getTime()
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY
  }

  return Number.POSITIVE_INFINITY
}

/** True when `candidate` should replace `current` for the same title. */
export function isPreferredTitleEntry<T extends DedupeCandidate>(candidate: T, current: T): boolean {
  const candidateOrder = orderRank(candidate.order)
  const currentOrder = orderRank(current.order)

  if (candidateOrder !== currentOrder) {
    return candidateOrder < currentOrder
  }

  return createdAtRank(candidate.createdAt) < createdAtRank(current.createdAt)
}

export function partitionDuplicatesByTitle<T extends DedupeCandidate>(
  docs: readonly T[],
): DedupeResult<T> {
  const kept: T[] = []
  const duplicates: T[] = []
  const indexByKey = new Map<string, number>()

  for (const doc of docs) {
    const key = normalizeTitle(doc.title)

    // A missing title cannot be matched safely; keep every such document.
    if (!key) {
      kept.push(doc)
      continue
    }

    const existingIndex = indexByKey.get(key)
    if (existingIndex === undefined) {
      indexByKey.set(key, kept.length)
      kept.push(doc)
      continue
    }

    const current = kept[existingIndex]
    if (isPreferredTitleEntry(doc, current)) {
      kept[existingIndex] = doc
      duplicates.push(current)
    } else {
      duplicates.push(doc)
    }
  }

  return { kept, duplicates }
}

export function dedupeByTitle<T extends DedupeCandidate>(docs: readonly T[]): T[] {
  return partitionDuplicatesByTitle(docs).kept
}
