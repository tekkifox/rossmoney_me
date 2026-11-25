import type { ProjectDoc } from '@/app/(frontend)/templates/shared'

export const PROJECT_CARDS_LIMIT = 6

/**
 * "Selected work" cards. A project with a URL becomes an anchor so the whole
 * card is clickable; one without a URL stays the plain article it always was.
 *
 * The anchor is the card itself, so it keeps the same classes and grid slot as
 * the article. `a { color: var(--primary) }` is unlayered in local-styles.css,
 * so the body colour has to be restored inline to keep the heading identical.
 */
export function ProjectCards({
  projects,
  limit = PROJECT_CARDS_LIMIT,
}: {
  projects: ProjectDoc[]
  limit?: number
}) {
  return (
    <div className="cards-grid" id="cms-projects">
      {projects.slice(0, limit).map((project, index) => {
        const body = (
          <>
            <p className="card-kicker">{project.role}</p>
            <h3>{project.title}</h3>
            <p>{project.summary}</p>
          </>
        )

        if (!project.url) {
          return (
            <article key={index} className="feature-card card">
              {body}
            </article>
          )
        }

        return (
          <a
            key={index}
            className="feature-card card"
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--text)' }}
          >
            {body}
          </a>
        )
      })}
    </div>
  )
}
