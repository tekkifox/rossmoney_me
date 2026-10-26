'use client'

import Link from 'next/link'
import React, { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { reportReactError } from '@/utilities/reportClientError'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Keep the technical detail in the console, never in the visitor-facing UI.
    console.error('Page render error', error)
    reportReactError(error)
  }, [error])

  return (
    <div className="container py-28" role="alert">
      <div className="prose max-w-none">
        <h1 style={{ marginBottom: 0 }}>Something went wrong</h1>
        <p className="mb-4">This page could not be loaded. Please try again.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="default" onClick={() => reset()}>
          Try again
        </Button>
        <Button asChild variant="secondary">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  )
}
