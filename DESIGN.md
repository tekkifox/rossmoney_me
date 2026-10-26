# rossmoney.me — design system

This document describes the site **as it ships today**. It is not a redesign
proposal. Every value here was copied from the existing CSS; the token layer
exists so future work extends the current look instead of drifting from it.

- **Zero visual change is the contract.** Tokens are a refactor of the values,
  not a retune.
- **`payload-cms/src/styles/tokens.css` is the single source of truth** for
  colour, type, spacing, radii and shadows.
- **The public site is deliberately light in both OS themes.** The dark token
  block is retained for fidelity but the local light palette wins on the
  document root (see [Theming](#how-to-theme-this-site)).

## How the tokens are wired

`payload-cms/src/app/(frontend)/layout.tsx` imports, in this order:

```ts
import './globals.css'
import '../../styles/tokens.css'
import './local-styles.css'
```

Why this order: the stylesheets used to cascade `globals.css` → `local-styles.css`.
`local-styles.css` carried both the local light palette and a deliberate remap
that wins over the Tailwind/shadcn tokens, including the dark block. Moving the
palette and remap into `tokens.css` and placing it **between** the two keeps every
selector in the same relative order:

1. Tailwind entry, `@theme inline`, base layer and background graphics
   (`globals.css`).
2. shadcn/Tailwind token blocks, the local light palette and the light-theme
   remap (`tokens.css`).
3. Public component rules (`local-styles.css`).

`local-styles.css` now contains only component rules; its `:root` palette and
remap blocks were moved verbatim into `tokens.css`. Payload's admin styling
(`src/app/(payload)/custom.scss`) is untouched.

## Palette

### Core public palette (effective in both themes)

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#f8f9fa` | Page background (primitive `--primitive-gray-50`) |
| `--card-bg` | `#ffffff` | Card, panel and secondary-button surface (`--primitive-white`) |
| `--text` | `#212529` | Body and heading text (`--primitive-gray-800`) |
| `--muted` | `#6c757d` | Secondary text, nav links, captions, borders-adjacent copy (`--primitive-gray-500`) |
| `--primary` | `#0d6efd` | Links, primary actions, eyebrow/status accents (`--primitive-blue-500`) |
| `--primary-hover` | `#0b5ed7` | Primary hover (`--primitive-blue-600`) |
| `--border` | `#e9ecef` | Borders, nav hover surface, input/accent surface (`--primitive-gray-200`) |

`--muted` intentionally shadows the Tailwind `--muted` token, so `bg-muted` and
`text-muted` resolve to the mid grey `#6c757d`, not to a light surface. This is
existing behaviour, not a new decision.

### Tailwind / shadcn bridge (after the light remap)

| Token | Light | Dark (on the document root) | Role |
| --- | --- | --- | --- |
| `--background` | `#f8f9fa` | `#f8f9fa` | Page background |
| `--foreground` | `#212529` | `#212529` | Default text |
| `--card` | `#ffffff` | `#ffffff` | Card surface |
| `--card-foreground` | `#212529` | `#212529` | Card text |
| `--popover` | `#ffffff` | `#ffffff` | Popover surface |
| `--popover-foreground` | `#212529` | `#212529` | Popover text |
| `--primary` | `#0d6efd` | `#0d6efd` | Primary action colour |
| `--primary-foreground` | `#ffffff` | `#ffffff` | Text on primary |
| `--secondary` | `#eef2f6` | `#eef2f6` | Secondary surface |
| `--secondary-foreground` | `#212529` | `#212529` | Text on secondary |
| `--muted` | `#6c757d` | `#6c757d` | Muted surface/text (overridden by local palette) |
| `--muted-foreground` | `#6c757d` | `#6c757d` | Muted text |
| `--accent` | `#e9ecef` | `#e9ecef` | Hover/selected surface |
| `--accent-foreground` | `#212529` | `#212529` | Text on accent |
| `--border` | `#e9ecef` | `#e9ecef` | Borders |
| `--input` | `#e9ecef` | `#e9ecef` | Input borders |
| `--ring` | `#0d6efd` | `#0d6efd` | Focus ring |

The source blocks in `tokens.css` still carry the original shadcn values
(`oklch(...)`) for `--background`, `--foreground`, `--card`, `--primary`,
`--muted`, etc., because both the light `:root` block and the
`[data-theme='dark']` block are preserved. The local palette and remap override
them on `:root`. That is why the effective values above are hex.

### shadcn tokens that were never remapped

These keep the original shadcn light/dark values; they are used by the shadcn UI
primitives (buttons, inputs, pagination) and are not part of the public visual
identity.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--destructive` | `oklch(57.7% 0.245 27.325deg)` | `oklch(39.6% 0.141 25.723deg)` | Destructive action |
| `--destructive-foreground` | `oklch(57.7% 0.245 27.325deg)` | `oklch(63.7% 0.237 25.331deg)` | Text on destructive |
| `--chart-1` | `oklch(64.6% 0.222 41.116deg)` | `oklch(48.8% 0.243 264.376deg)` | Chart series 1 |
| `--chart-2` | `oklch(60% 0.118 184.704deg)` | `oklch(69.6% 0.17 162.48deg)` | Chart series 2 |
| `--chart-3` | `oklch(39.8% 0.07 227.392deg)` | `oklch(76.9% 0.188 70.08deg)` | Chart series 3 |
| `--chart-4` | `oklch(82.8% 0.189 84.429deg)` | `oklch(62.7% 0.265 303.9deg)` | Chart series 4 |
| `--chart-5` | `oklch(76.9% 0.188 70.08deg)` | `oklch(64.5% 0.246 16.439deg)` | Chart series 5 |
| `--sidebar` | `oklch(98.5% 0 0deg)` | `oklch(20.5% 0 0deg)` | Admin sidebar surface |
| `--sidebar-foreground` | `oklch(14.5% 0 0deg)` | `oklch(98.5% 0 0deg)` | Admin sidebar text |
| `--sidebar-primary` | `oklch(20.5% 0 0deg)` | `oklch(48.8% 0.243 264.376deg)` | Admin sidebar primary |
| `--sidebar-primary-foreground` | `oklch(98.5% 0 0deg)` | `oklch(98.5% 0 0deg)` | Admin sidebar primary text |
| `--sidebar-accent` | `oklch(97% 0 0deg)` | `oklch(26.9% 0 0deg)` | Admin sidebar accent |
| `--sidebar-accent-foreground` | `oklch(20.5% 0 0deg)` | `oklch(98.5% 0 0deg)` | Admin sidebar accent text |
| `--sidebar-border` | `oklch(92.2% 0 0deg)` | `oklch(26.9% 0 0deg)` | Admin sidebar border |
| `--sidebar-ring` | `oklch(70.8% 0 0deg)` | `oklch(43.9% 0 0deg)` | Admin sidebar ring |
| `--success` | `oklch(78% 0.08 200deg)` | `oklch(28% 0.1 200deg)` | Success state |
| `--warning` | `oklch(89% 0.1 75deg)` | `oklch(35% 0.08 70deg)` | Warning state |
| `--error` | `oklch(75% 0.15 25deg)` | `oklch(45% 0.1 25deg)` | Error state |

### Component-role colours

| Token | Value | Role |
| --- | --- | --- |
| `--on-primary` | `#ffffff` | Text/icon on primary blue and the brand mark |
| `--button-secondary-bg` | `#ffffff` | Secondary button surface |
| `--status-pill-bg` | `rgba(13, 110, 253, 0.08)` | Status pill fill |
| `--status-pill-border` | `rgba(13, 110, 253, 0.12)` | Status pill border |
| `--tint-primary-06` | `rgba(13, 110, 253, 0.06)` | CV download control fill |
| `--tint-primary-12` | `rgba(13, 110, 253, 0.12)` | CV download control hover |
| `--diagram-bg` | `#f1f3f5` | Architecture diagram surface |
| `--diagram-text` | `#0b1220` | Architecture diagram text |
| `--brand-mark-gradient` | `linear-gradient(135deg, #0d6efd, #6ea8fe)` | Brand mark background |
| `--surface-glow` | blue/green radial glows + indigo linear wash | Fixed page background glaze |
| `--background-grid` | SVG data URI | Fixed 200px grid pattern |
| `--docx-text` | `#555555` | DOCX body fallback |
| `--docx-heading` | `#111111` | DOCX heading fallback |
| `--docx-accent` | `#2386f5` | DOCX company/accent fallback |
| `--docx-rule` | `rgba(17, 17, 17, 0.2)` | DOCX experience separator |
| `--docx-section-rule` | `#111111` | DOCX section rule |

The background glaze expands to:

```css
radial-gradient(circle at 20% 10%, rgba(59, 130, 246, 0.08) 0%, transparent 40%),
radial-gradient(circle at 80% 90%, rgba(16, 185, 129, 0.08) 0%, transparent 40%),
linear-gradient(180deg, transparent 0%, rgba(99, 102, 241, 0.03) 100%)
```

The grid SVG embeds `rgba(148, 163, 184, 0.15)` for strokes,
`rgba(59, 130, 246, 0.4)` for the blue point and `rgba(16, 185, 129, 0.4)` for
the green point. SVG data URIs cannot interpolate CSS custom properties, so the
whole URI is the token `--primitive-grid-pattern`; the colours are documented
here rather than split into separate variables.

## Type

### Families

| Role | Family | Token |
| --- | --- | --- |
| Public body / UI | `Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial` | `--primitive-font-sans` |
| Code / diagram | `monospace` | `--primitive-font-mono` |
| Brand mark initials | `Georgia, serif` | `--primitive-font-brand` |
| DOCX body | `Arial, sans-serif` | `--primitive-font-docx` |
| DOCX emoji | `"Segoe UI Emoji", sans-serif` | `--primitive-font-docx-emoji` |
| DOCX Unicode | `"Arial Unicode MS", Arial, sans-serif` | `--primitive-font-docx-unicode` |
| DOCX serif | `"Times New Roman", serif` | `--primitive-font-docx-serif` |

Tailwind's `--font-sans`/`--font-mono` still point at the Geist CSS variables in
`globals.css` (`@theme`), but the public body overrides the family with the Inter
stack above. Geist remains available to utilities.

### Scale in use

| Role | Size | Line height | Weight | Source |
| --- | --- | --- | --- | --- |
| Body | browser default 16px | normal | 400 | `body` |
| `h1` (hero) | `2.4rem` | `1.05` | 400 (globals unsets heading weight) | `.hero h1` / `h1` |
| `h1` on ≤720px | `1.8rem` | `1.05` | 400 | mobile media query |
| Section heading | Tailwind `text-3xl` → `1.875rem`, `sm:text-4xl` → `2.25rem` | Tailwind default | 500 (`font-medium`) | `Section`, templates |
| Eyebrow | `0.75rem` | default | 400 | `.eyebrow`, uppercase, `0.12em` tracking |
| Panel kicker | `0.8rem` | default | 400 | `.panel-kicker`, uppercase, `0.08em` tracking |
| Lead | 16px | default | 400 | `.lead`, muted |
| Brand subtitle | `0.9rem` | default | 400 | `.brand-subtitle` |
| Status pill | `0.85rem` | `1.2` | 400 | `.status-pill` |
| Metric value | `1.25rem` | `1` | 800 | `.metric-value` |
| Metric label | `0.85rem` | default | 400 | `.metric-label` |
| Metric card label | `0.78rem` | default | 400 | `.metric-card-label` |
| Metric card value | `0.98rem` | default | 700 | `.metric-card-value` |
| Timeline heading | `1.05rem` | default | inherited | `.timeline-item h3` |
| Image description | `0.95rem` | default | 400 | `.image-desc` |
| Diagram | `0.9rem` | default | 400 | `.diagram-view` |
| Small utility | `0.9rem` | default | 400 | `.small` |
| Prose `h1` | `2.5rem` (`md`: `3.5rem`) | plugin default | normal | `tailwind.config.mjs` |
| Prose `h2` | `1.25rem` (`md`: `1.5rem`) | plugin default | 600 | `tailwind.config.mjs` |
| DOCX | `9pt`–`22pt` | `1.4` | as authored | `.docx-*` classes |

Tailwind utilities add the rest of the live type: `text-xs` (0.75rem),
`text-sm` (0.875rem), `text-lg` (1.125rem), `text-xl` (1.25rem), `text-2xl`
(1.5rem), `text-3xl` (1.875rem), `text-4xl` (2.25rem), plus `font-medium` (500),
`font-semibold` (600) and `leading-6` (1.5rem). Those are Tailwind defaults, not
values redefined in `tokens.css` (see [Known gaps](#not-yet-tokenised--known-gaps)).

Scale primitives: `--primitive-font-size-{75,78,80,85,90,95,98,105,125,180,240}`,
`--primitive-line-height-{1,105,12,125,14}`,
`--primitive-font-weight-{600,700,800}` and
`--primitive-tracking-{008,012}`.

## Space, radii, containers and shadows

### Spacing steps

| Token | Value | Typical use |
| --- | --- | --- |
| `--primitive-space-1` | `4px` | Tight offsets, timeline year top padding |
| `--primitive-space-15` | `6px` | Pill padding, small gaps |
| `--primitive-space-2` | `8px` | Nav padding, card heading margin |
| `--primitive-space-25` | `10px` | Button vertical padding |
| `--primitive-space-3` | `12px` | Standard gap, card inner rhythm |
| `--primitive-space-35` | `14px` | Card grid gap |
| `--primitive-space-4` | `16px` | Page padding, button horizontal padding |
| `--primitive-space-45` | `18px` | Hero gap, metrics top margin |
| `--primitive-space-5` | `20px` | Card padding, section top margin |
| `--primitive-space-6` | `24px` | Large section rhythm |
| `--primitive-space-8` | `32px` | Page bottom padding |
| `--primitive-space-10` | `40px` | Services section padding |
| `--primitive-space-11` | `44px` | Mobile nav toggle / tap target |
| `--primitive-space-12` | `48px` | Brand mark size |
| `--primitive-space-21` | `84px` | Timeline year column |

Tailwind utility spacing (e.g. `gap-4` = 1rem, `p-6` = 1.5rem) is still the
Tailwind 0.25rem scale. It is not duplicated in `tokens.css`.

### Radii

| Token | Value | Use |
| --- | --- | --- |
| `--primitive-radius-8` | `8px` | Buttons, nav links, small controls, diagram |
| `--primitive-radius-10` | `10px` | Brand mark, metric cards, timeline items |
| `--primitive-radius-12` | `12px` | `--radius`; cards and panels |
| `--primitive-radius-pill` | `999px` | Status pills |
| `--radius` | `12px` | Card/panel radius; feeds Tailwind `radius-sm/md/lg/xl` via `@theme inline` |

Tailwind's `@theme inline` derives `--radius-sm: calc(var(--radius) - 4px)`
(8px), `--radius-md: calc(var(--radius) - 2px)` (10px),
`--radius-lg: var(--radius)` (12px) and `--radius-xl: calc(var(--radius) + 4px)`
(16px). Templates also use `rounded-3xl` (24px), `rounded-2xl` (16px) and
`rounded-[0.8rem]`; these are Tailwind/arbitrary utility values, not redefined.

### Containers

| Token / rule | Value | Notes |
| --- | --- | --- |
| `--container-max` | `1140px` | Public `.container` max width |
| `.container` padding | `0 12px` | Local rule wins over the Tailwind container utility |
| `.page-shell` | `16px 12px 32px` (`16px 12px` ≤720px) | Page wrapper |
| `--gutter` | `16px` | Legacy row/column grid |
| `@theme` breakpoints | `40rem` / `48rem` / `64rem` / `80rem` / `86rem` | `sm`–`2xl`, used by Tailwind utilities |

The `globals.css` `.container` utility (max width per breakpoint) is still in the
cascade, but the unlayered `.container` in `local-styles.css` wins: the public
site is capped at 1140px with 12px inline padding at every width.

### Shadows

| Token | Value | Use |
| --- | --- | --- |
| `--shadow-card` | `0 6px 18px rgba(33, 37, 41, 0.04)` | Cards and panels |
| `--shadow-metric` | `0 6px 12px rgba(16, 24, 40, 0.04)` | Metric cards, image cards |
| Tailwind `shadow-sm` | Tailwind default | Utility cards in templates |

## Component recipes

### Card / panel

```css
background: var(--card-bg);
border: 1px solid var(--border);
border-radius: var(--radius);      /* 12px */
box-shadow: var(--shadow-card);
padding: 20px;                     /* --primitive-space-5 */
```

Applies to `.card`, `.glass-card`, `.feature-card`, `.architecture-summary`,
`.architecture-diagram` and `.contact-card`. `.card h2/h3/h4` get
`margin: 0 0 8px`.

### Button

Base `.btn`: inline-flex, centred, `padding: 10px 16px`, `border-radius: 8px`,
`border: 1px solid transparent`, `font-weight: 600`, pointer cursor.

| Variant | Recipe |
| --- | --- |
| Primary `.btn-primary` | `background: var(--primary)`; `color: var(--on-primary)`; hover `background: var(--primary-hover)` |
| Secondary `.btn-secondary` | `background: var(--button-secondary-bg)` (`#fff`); `border: 1px solid var(--border)`; `color: var(--text)` |
| Quiet | There is no `.btn-quiet` class. Quiet actions are `.topnav a` / `.topnav .cmslink` (transparent background, `--muted` text, hover `--border` background) or shadcn `Button` `ghost`/`link` variants. |

On ≤720px every `.btn` becomes full width.

### Status pill

```css
background: var(--status-pill-bg);
color: var(--primary);
padding: 6px 10px;
border-radius: 999px;
border: 1px solid var(--status-pill-border);
font-size: 0.85rem;
line-height: 1.2;
display: inline-flex;
white-space: nowrap;
font-variant-numeric: tabular-nums;
```

### Top navigation

- `.topbar`: flex, space-between, `padding: 12px 0`.
- `.topnav`: flex, `gap: 12px`, centre aligned.
- `.topnav a` / `.cmslink`: `padding: 8px 12px`, `border-radius: 8px`,
  `color: var(--muted)`, transparent background; hover background
  `var(--border)`, text `var(--text)`.
- ≤720px: `.nav-toggle` becomes an inline 44×44 control with an 8px radius,
  `--border`, `--card-bg` and `--text`; `.topnav` is hidden until
  `[data-open="true"]`, then stacks vertically with 4px gaps and 44px minimum
  row heights.

### Brand lockup

- `.brand-lockup`: flex, `gap: 12px`.
- `.brand-mark`: 48×48 (40×40 ≤720px), `border-radius: 10px`,
  `background: var(--brand-mark-gradient)` (`#0d6efd` → `#6ea8fe`), white text,
  `font-weight: 700`, Georgia serif.
- `.brand-subtitle`: `margin: 0`, `color: var(--muted)`, `font-size: 0.9rem`.
- The “Ross Money” wordmark itself is inline `font-weight: 600` and
  `color: var(--text)` in `Header/Component.client.tsx`.

### Panel header

`.panel-header`: flex-wrap, `align-items: flex-start`, space-between,
`gap: 8px 12px`, `margin-bottom: 12px`. The heading (`h2`/`h3`) gets
`margin: 4px 0 0` and `line-height: 1.25`. `.panel-kicker` is the small uppercase
muted label above it.

### Hero

```css
.hero { display:flex; gap:18px; padding-block:8px; align-items:stretch; flex-wrap:wrap; }
.hero-copy { flex:1 1 520px; padding:12px 6px; display:flex; flex-direction:column; justify-content:center; }
.hero-panel { flex:0 0 320px; min-width:240px; padding:12px; }
```

(The file contains the earlier `gap:20px` rule too; the later `18px` rule wins.)
≤992px the hero stacks, panel second; `.hero-copy .lead` is capped at `48rem`.

### Form field

The public form is the Payload form builder rendered through shadcn primitives:

- Input/textarea/select: `h-9` (36px), `rounded-md` (10px), transparent
  background, border `--input` (`#e9ecef`), `text-base` then `md:text-sm`,
  focus ring `--ring` at 10% opacity, invalid border/ring `--destructive`.
- Labels: `text-sm`, medium weight; required marker uses `.required`.
- Form shell: `padding: 16px` (`lg: 24px`), `border: 1px solid --border`,
  `border-radius: 0.8rem`.
- Form blocks are spaced with `margin-bottom: 24px`; submit button uses the
  shadcn default variant (`bg-primary`, `text-primary-foreground`).
- Errors: `text-red-500 text-sm` (Tailwind default red — see known gaps).

### Prose / typography

Rich text uses the Tailwind typography plugin via
`RichText` (`prose md:prose-md`). The customisation in `tailwind.config.mjs`:

```css
--tw-prose-body: var(--text);
--tw-prose-headings: var(--text);
h1 { font-weight: normal; margin-bottom: 0.25em; }
base h1 { font-size: 2.5rem; }
base h2 { font-size: 1.25rem; font-weight: 600; }
md h1 { font-size: 3.5rem; }
md h2 { font-size: 1.5rem; }
```

All other prose sizes, margins and colours are the typography plugin defaults.
Headings outside prose have their size/weight unset by the base layer in
`globals.css`, so they inherit unless a component or utility sets them.

### Page background

- `body::before`: fixed, `z-index: -2`, `--surface-glow` (blue and green radial
  glows plus an indigo wash).
- `body::after`: fixed, `z-index: -1`, opacity `0.4`, `--background-grid`,
  tiled at `200px 200px`.

## How to theme this site

1. Change **primitives only** in `payload-cms/src/styles/tokens.css`
   (`--primitive-*`), or a local semantic alias when the role changes but the raw
   value does not.
2. Keep the order of the token blocks: light shadcn block → dark shadcn block →
   local light palette → light-theme remap → component roles. The remap is what
   keeps the public site light on a dark OS preference.
3. Review these six routes at 1440px and 390px:
   - `/` (home/hero/panels)
   - `/work` (projects listing)
   - `/services` (services listing, pricing table, accordion)
   - `/travelling` (article-style `[slug]` page)
   - `/contact` (links + form)
   - `/this-page-does-not-exist` (404)
4. Check both `data-theme="light"` and `data-theme="dark"` on `<html>`. The
   rendered result should stay identical because the remap wins.
5. If a theme change needs a component edit, the token set is wrong. Add or
   correct a semantic token instead.
6. Run `pnpm --dir payload-cms lint:tokens` after any colour change.

## Not yet tokenised / known gaps

### Resolved: root `styles.css` duplicate

The root `styles.css` was a dead copy of the pre-Payload static site's
stylesheet. It had no importers, was not served by Vercel (root directory is
`payload-cms`) and was not copied by Docker/nginx. It was removed in this
change; `local-styles.css` is the single public stylesheet. The only remaining
`styles.css` references are the `./local-styles.css` import, a comment in
`CVViewer/cvDocxStyles.ts`, and the DOCX test that reads `local-styles.css` by
path.

### DOCX literal colour exceptions (9 lines)

`tests/int/cv-docx-styles.int.spec.ts` asserts the exact text of these rules, so
their literals cannot move to `tokens.css` without changing the DOCX integration
contract. `scripts/check-tokens.mjs` skips them with named exceptions:

- `.docx { color: #555; ... }`
- `.docx-font-size-13-5 { ... color: #111 }`
- `.docx-font-size-14 { ... color: #2386f5 }`
- `.docx-font-size-22 { ... color: #111 }`
- `.docx-color-555555`, `.docx-color-111111`, `.docx-color-2386f5`
- `.docx p.docx-section-rule { border-bottom: 1.5pt solid #111; ... }`
- `.docx p.docx-entry-rule { border-bottom: 1px solid rgba(17, 17, 17, 0.2); ... }`

The DOCX *source* colour matchers in
`src/components/CVViewer/cvDocxStyles.ts` (`555555`, `111111`, `2386f5`) are
input matchers, not paint values; the paint values above are the fallback CSS.
That file has no `#` prefix, so the guard does not treat it as a CSS literal.

### Tailwind palette/utility gaps

These are pre-existing utility classes, not raw literals, so the guard does not
catch them. They are the remaining places where a colour or size is not sourced
from `tokens.css`:

- Footer: `bg-black dark:bg-card text-white`.
- Code block: `bg-black`, `text-white/25`.
- Form error: `text-red-500`.
- Template utilities: `rounded-3xl` (24px), `rounded-2xl` (16px),
  `rounded-[0.8rem]`, `text-[11px]`, tracking values such as `tracking-[0.24em]`.
- Tailwind's spacing/type/radius defaults used by utilities.

Fixing these means adding semantic tokens (for example a true `--color-black`
role and an error foreground) and editing component class names. That is a
component change and should be reviewed as such.

### One-off values left in place

These are layout/content constants rather than reusable design steps, so they
stay where they are:

- Brand mark 48px (40px ≤720px), hero panel `320px` / `min-width: 240px`,
  hero copy `flex-basis: 520px`, metric `min-height: 74px` / `64px`.
- `.page-shell`/`.container` paddings and `--container-max` (1140px), which are
  documented above but intentionally not part of the spacing scale.
- `48rem` lead/prose widths and the `200px` grid tile.
- DOCX margins, `pt` sizes and line-height values (content-derived).
- `--primitive-grid-pattern` as one URI because SVG data URIs cannot interpolate
  custom properties.

### Sharp edges that need a design decision

- **Nested `data-theme`:** the local palette is declared on `:root`; a nested
  `[data-theme='dark']` element (used by the HighImpact hero/header) resolves
  `--primary`, `--muted` and `--border` from the shadcn dark block instead of the
  local palette. This is preserved from the old cascade. Fixing it would be a
  product decision about dark headers.
- **`--muted` overload:** it is both the local mid-grey text colour and the
  Tailwind `--muted` surface token. `bg-muted` is therefore `#6c757d`, not a
  light surface. This is existing behaviour and is documented rather than
  “fixed”.
- **`--radius` source value:** the shadcn light block still says `0.625rem`, but
  the local palette overrides it to `12px`. The effective value is `12px`.

## Authoritative files

| File | Authoritative for |
| --- | --- |
| `payload-cms/src/styles/tokens.css` | Every colour, type, spacing, radius and shadow value; primitives and semantics |
| `payload-cms/src/app/(frontend)/globals.css` | Tailwind entry, `@theme inline` mapping, base layer, page background graphics |
| `payload-cms/src/app/(frontend)/local-styles.css` | Public component rules and layout; DOCX contract rules |
| `payload-cms/src/app/(frontend)/layout.tsx` | CSS import order (globals → tokens → local-styles) |
| `payload-cms/tailwind.config.mjs` | Typography plugin overrides |
| `payload-cms/scripts/check-tokens.mjs` | Raw-colour guard and its named exceptions |
| `payload-cms/src/app/(payload)/custom.scss` | Payload admin styling (empty, untouched) |
| `AGENTS.md` | Operational rules for agents |
| root `styles.css` | Removed; no longer authoritative |
