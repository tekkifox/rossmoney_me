// @vitest-environment node
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { OG_THEME, OG_THEME_TOKENS } from '@/utilities/ogTheme'

describe('OG theme', () => {
  it('mirrors the token values the static card uses', async () => {
    const tokens = await readFile(
      path.join(process.cwd(), 'src', 'styles', 'tokens.css'),
      'utf8',
    )

    for (const [key, token] of Object.entries(OG_THEME_TOKENS)) {
      const match = tokens.match(new RegExp(`${token}\\s*:\\s*([^;]+);`))

      expect(match, `${token} is missing from tokens.css`).not.toBeNull()
      expect(OG_THEME[key as keyof typeof OG_THEME], `${key} drifted from ${token}`).toBe(
        match?.[1].trim(),
      )
    }
  })
})
