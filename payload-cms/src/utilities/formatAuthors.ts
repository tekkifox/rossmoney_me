export const formatAuthors = (authors: any[]) => {
  if (!Array.isArray(authors)) return ''
  // Ensure we don't have any authors without a name
  const authorNames = authors.map((author) => author?.name).filter(Boolean)

  if (authorNames.length === 0) return ''
  if (authorNames.length === 1) return authorNames[0]
  if (authorNames.length === 2) return `${authorNames[0]} and ${authorNames[1]}`

  return `${authorNames.slice(0, -1).join(', ')} and ${authorNames[authorNames.length - 1]}`
}
