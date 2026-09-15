export interface CommitItem {
  sha: string
  message: string
}

export async function getGithubCommits(
  owner: string,
  repo: string,
  branch = 'main',
  perPage = 5,
  options?: { cache?: RequestCache | 'force-cache' },
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

  // Default to cached fetch on the server so pages remain static-friendly
  const cacheMode = options?.cache ?? 'force-cache'

  const res = await fetch(url, { headers, cache: cacheMode })
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
