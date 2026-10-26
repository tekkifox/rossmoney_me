'use client'

import { useEffect } from 'react'

import { installErrorReporting } from '@/utilities/reportClientError'

/**
 * Installs the browser error listeners. Renders nothing, does not block
 * rendering, and is mounted once in the public root layout.
 */
export function ErrorReporter() {
  useEffect(() => installErrorReporting(), [])

  return null
}
