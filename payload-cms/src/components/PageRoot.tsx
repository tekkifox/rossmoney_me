import React from 'react'

/**
 * The wrapper every public page renders. It hands the browser the API URL and
 * the ArchView project of the source the page resolved, so the client polls
 * the same project the sampler does.
 */
export function PageRoot({
  architectureApi,
  architectureProject,
  children,
}: {
  architectureApi: string
  architectureProject?: string
  children?: React.ReactNode
}) {
  return (
    <article
      id="page-root"
      className="pt-16 pb-24"
      data-architecture-api={architectureApi}
      data-architecture-project={architectureProject}
    >
      {children}
    </article>
  )
}

export default PageRoot
