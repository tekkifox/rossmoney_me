import React from 'react'

/**
 * The wrapper every public page renders. It hands the browser the API URL and
 * the ArchView project of the source the page resolved, so the client polls
 * the same project the sampler does.
 */
export function PageRoot({
  architectureApi,
  architectureProject,
  architectureUnavailable,
  children,
}: {
  architectureApi: string
  architectureProject?: string
  architectureUnavailable?: boolean
  children?: React.ReactNode
}) {
  return (
    <article
      id="page-root"
      className="pt-16 pb-24"
      data-architecture-api={architectureApi}
      data-architecture-project={architectureProject}
      data-architecture-unavailable={architectureUnavailable ? 'true' : undefined}
    >
      {children}
    </article>
  )
}

export default PageRoot
