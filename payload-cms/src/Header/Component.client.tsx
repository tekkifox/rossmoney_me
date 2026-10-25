'use client'
import { useHeaderTheme } from '@/providers/HeaderTheme'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useEffect, useSyncExternalStore } from 'react'

import type { Header } from '@/payload-types'

// Use a simple repo-branded mark instead of the default Payload logo
import { HeaderNav } from './Nav'

interface HeaderClientProps {
  data: Header
}

/* The header theme lives in React context, so nothing external needs subscribing to.
 * useSyncExternalStore is used only for its server/client snapshot split. */
const subscribeToHeaderTheme = () => () => {}

export const HeaderClient: React.FC<HeaderClientProps> = ({ data }) => {
  const { headerTheme, setHeaderTheme } = useHeaderTheme()
  const pathname = usePathname()

  /* During SSR the context has no theme yet. Returning null from the server snapshot
   * keeps the first client render identical to the server markup (no data-theme), then
   * the post-hydration render picks up the context value — the same no-flash timing the
   * previous effect provided. */
  const theme = useSyncExternalStore(
    subscribeToHeaderTheme,
    () => headerTheme ?? null,
    () => null,
  )

  useEffect(() => {
    setHeaderTheme(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return (
    <header className="container relative z-20   " {...(theme ? { 'data-theme': theme } : {})}>
      <div className="topbar py-6 flex justify-between">
        <Link href="/" className="brand-lockup">
          <span className="brand-mark">RM</span>
          <div>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>Ross Money</span>
            <p className="brand-subtitle">Developer</p>
          </div>
        </Link>
        <HeaderNav data={data} />
      </div>
    </header>
  )
}
