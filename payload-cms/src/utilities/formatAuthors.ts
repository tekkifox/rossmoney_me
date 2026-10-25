import { isObjectLike } from '@/utilities/json'

export type AuthorReference = { name?: string | null } | null | undefined

export const formatAuthors = (authors: readonly unknown[] | null | undefined) => {
  if (!Array.isArray(authors)) return ''
  // Ensure we don't have any authors without a name
  const authorNames = authors
    .map((author) => (isObjectLike(author) ? author.name : undefined))
    .filter((name): name is string => typeof name === 'string' && name !== '')

  if (authorNames.length === 0) return ''
  if (authorNames.length === 1) return authorNames[0]
  if (authorNames.length === 2) return `${authorNames[0]} and ${authorNames[1]}`

  return `${authorNames.slice(0, -1).join(', ')} and ${authorNames[authorNames.length - 1]}`
}
