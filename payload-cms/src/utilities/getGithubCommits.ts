export interface CommitItem {
  sha: string
  message: string
}

export interface GetGithubCommitsOptions {
  /** Seconds to cache the response. 0 disables caching. */
  revalidate?: number
  /** Request cache mode. Defaults to undefined so `revalidate` applies. */
  cache?: RequestCache
}

// A short window keeps the commits list close to fresh without hammering the
// unauthenticated GitHub API (60 requests/hour per IP), which is the limit the
// site runs under: GITHUB_TOKEN is not set anywhere in this deployment.
const DEFAULT_REVALIDATE = 300

export async function getGithubCommits(
  owner: string,
  repo: string,
  branch = 'main',
  perPage = 5,
  options?: GetGithubCommitsOptions,
): Promise<CommitItem[]> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN_SECRET
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'rossmoney-me',
  }
  if (token) {
    headers.Authorization = `token ${token}`
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=${perPage}&sha=${encodeURIComponent(branch)}`

  // Previously this used `cache: 'force-cache'`, which persists the response in
  // the Next data cache with no expiry. The route is force-dynamic, but an
  // explicit force-cache still bypasses revalidation, so the homepage served a
  // commit list captured weeks ago indefinitely.
  //
  // A bounded `next.revalidate` is the correct primitive: fresh enough for a
  // "recent commits" panel, bounded enough to survive a rate limit.
  const revalidate = options?.revalidate ?? DEFAULT_REVALIDATE

  const res = await fetch(url, {
    headers,
    next: revalidate > 0 ? { revalidate } : undefined,
  })
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}`)
  }

  const data = await res.json().catch(() => [])
  if (!Array.isArray(data)) return []

  return data.map((commit: any) => ({
    sha: commit?.sha || '',
    message: commit?.commit?.message?.split('\n')[0] || 'No commit message',
  }))
}
