/**
 * Colours for the dynamic Open Graph card.
 *
 * `next/og` renders through Satori, which has no stylesheet cascade and cannot
 * read the custom properties in `src/styles/tokens.css`. These values are the
 * rendered equivalents of the tokens used by the static card
 * (`public/og.jpg`): the same surface, card, text, muted, primary, border and
 * brand-mark colours. `tests/int/og-theme.int.spec.ts` reads `tokens.css` and
 * fails if a primitive or semantic value drifts, so the tokens remain the
 * source of truth even though Satori needs literals.
 *
 * The three `hero*` stops are sampled from `public/og.jpg` itself. That blue
 * wash is part of the existing card artwork and has no token of its own; do not
 * reuse it elsewhere.
 */

export const OG_THEME = {
  heroFrom: '#4c8af1',
  heroMid: '#9ec7fb',
  heroTo: '#dbeaff',
  card: '#ffffff',
  text: '#212529',
  muted: '#5f6b76',
  primary: '#0b5ed7',
  primarySoft: '#6ea8fe',
  border: '#e9ecef',
  borderControl: '#858d94',
  gridStroke: 'rgba(148, 163, 184, 0.15)',
  cardShadow: 'rgba(33, 37, 41, 0.04)',
} as const

/**
 * Token names (in `src/styles/tokens.css`) that the card mirrors. The guard
 * test compares each entry against the stylesheet, so a rename or a palette
 * retune cannot silently drift the OG card away from the site.
 */
export const OG_THEME_TOKENS = {
  card: '--primitive-white',
  text: '--primitive-gray-800',
  muted: '--primitive-gray-500',
  primary: '--primitive-blue-500',
  primarySoft: '--primitive-blue-300',
  border: '--primitive-gray-200',
  borderControl: '--primitive-gray-450',
  gridStroke: '--primitive-grid-stroke',
  cardShadow: '--primitive-shadow-card',
} as const
