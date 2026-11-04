import PageTemplate, { generateMetadata } from './[slug]/page'

// Route segment config is not inherited through a re-export. The homepage reads
// draft mode and the live snapshot, so it must stay request-rendered; the
// snapshot itself is cached by `loadArchitectureSnapshot`.
export const dynamic = 'force-dynamic'

export default PageTemplate

export { generateMetadata }
