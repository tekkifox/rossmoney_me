import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ProjectCards } from '@/components/ProjectCards'
import { Projects, validateProjectUrl } from '@/collections/Projects'

const linkedProject = {
  title: 'Morphsites',
  role: 'Backend developer',
  summary: 'Built and maintained Laravel and legacy PHP sites.',
  url: 'https://example.com/work/morphsites',
}

const plainProject = {
  title: 'Rawnet Ltd.',
  role: 'PHP Developer',
  summary: 'Supported developers and AWS infrastructure.',
}

afterEach(cleanup)

describe('project links', () => {
  it('renders a linked card when the project has a URL', () => {
    const { getByRole } = render(
      React.createElement(ProjectCards, { projects: [linkedProject] }),
    )

    const link = getByRole('link', { name: /Morphsites/ }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('https://example.com/work/morphsites')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.textContent).toContain('Morphsites')
    expect(link.className).toBe('feature-card card')
  })

  it('keeps the plain article when the project has no URL', () => {
    const { container, getByRole, queryByRole } = render(
      React.createElement(ProjectCards, { projects: [plainProject] }),
    )

    expect(queryByRole('link')).toBeNull()
    expect(getByRole('article')).toBeTruthy()
    expect(container.querySelector('article')?.className).toBe('feature-card card')
    expect(container.querySelector('article')?.textContent).toContain('Rawnet Ltd.')
  })

  it('mixes linked and unlinked cards without changing the card class', () => {
    const { container, getAllByRole } = render(
      React.createElement(ProjectCards, { projects: [linkedProject, plainProject] }),
    )

    expect(getAllByRole('link')).toHaveLength(1)
    expect(container.querySelectorAll('.feature-card.card')).toHaveLength(2)
  })

  it('accepts absolute http(s) URLs and empty values', () => {
    expect(validateProjectUrl('https://example.com/work')).toBe(true)
    expect(validateProjectUrl('http://example.com/work')).toBe(true)
    expect(validateProjectUrl('')).toBe(true)
    expect(validateProjectUrl(null)).toBe(true)
    expect(validateProjectUrl(undefined)).toBe(true)
  })

  it('rejects relative, non-http and credential-bearing URLs', () => {
    for (const value of ['example.com/work', '/work', 'ftp://example.com', 'mailto:dev@example.com']) {
      expect(validateProjectUrl(value)).not.toBe(true)
    }
    expect(validateProjectUrl('https://user:secret@example.com/work')).not.toBe(true)
  })

  it('wires the validator into the collection field', () => {
    const urlField = Projects.fields.find(
      (field) => 'name' in field && field.name === 'url',
    )

    expect(urlField).toBeDefined()
    expect('validate' in urlField! ? urlField.validate : undefined).toBe(validateProjectUrl)
  })
})
