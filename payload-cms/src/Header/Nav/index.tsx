'use client'

import React, { useEffect, useState } from 'react'

import type { Header as HeaderType } from '@/payload-types'

import { CMSLink } from '@/components/Link'
import { usePathname } from 'next/navigation'

/** Toggle state rules for the mobile menu. */
class NavMenu {
  static readonly id = 'site-nav-links'

  static toggle(open: boolean): boolean {
    return !open
  }

  static closeOnEscape(event: KeyboardEvent, close: () => void): void {
    if (event.key === 'Escape') close()
  }
}

export const HeaderNav: React.FC<{ data: HeaderType }> = ({ data }) => {
  const navItems = data?.navItems || []
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const [previousPathname, setPreviousPathname] = useState(pathname)

  // Close the mobile menu when navigation happens. Adjusting state during render
  // (rather than in an effect) avoids an extra render pass with the menu still open.
  if (pathname !== previousPathname) {
    setPreviousPathname(pathname)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => NavMenu.closeOnEscape(e, () => setOpen(false))
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <nav className="topnav-wrap" aria-label="Main">
      <button
        type="button"
        className="nav-toggle"
        aria-controls={NavMenu.id}
        aria-expanded={open}
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen(NavMenu.toggle)}
      >
        <span aria-hidden="true">{open ? '✕' : '☰'}</span>
      </button>
      <div id={NavMenu.id} className="topnav flex gap-3 items-center" data-open={open}>
        {navItems.map(({ link }, i) => {
          return <CMSLink key={i} {...link} appearance="link" />
        })}
      </div>
    </nav>
  )
}
