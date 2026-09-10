import { buildConfig, Payload } from 'payload';
import { mongooseAdapter } from '@payloadcms/db-mongodb';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

import { Footer } from './Footer/config'
import { Header } from './Header/config'
import { plugins } from './plugins'
import { getServerSideURL } from './utilities/getURL'
import { Pages } from './collections/Pages';
import { Users } from './collections/Users';
import { Projects } from './collections/Projects';
import { Experience } from './collections/Experience';
import { Media } from './collections/Media';
import { Posts } from './collections/Posts';
import { Categories } from './collections/Categories';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const noopDb = {
  connect: async () => undefined,
  destroy: async () => undefined,
  create: async () => ({}) as any,
  update: async () => ({}) as any,
  delete: async () => ({}) as any,
  find: async () => ({ docs: [], totalDocs: 0 }) as any,
  findOne: async () => null as any,
  count: async () => 0,
  countVersions: async () => 0,
  createGlobal: async () => ({}) as any,
  updateGlobal: async () => ({}) as any,
  findGlobal: async () => null as any,
  createMigration: async () => ({}) as any,
  migrate: async () => undefined,
  rollbackMigration: async () => undefined,
  transaction: async (fn: any) => fn?.(),
} as any;

const useNoopDb = process.env.SKIP_DB === 'true' || process.env.NEXT_PHASE === 'phase-production-build';

export default buildConfig({
  serverURL: process.env.SERVER_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:8082',
  editor: lexicalEditor(),
  admin: {
    components: {
      // The `BeforeLogin` component renders a message that you see while logging into your admin panel.
      // Feel free to delete this at any time. Simply remove the line below.
      beforeLogin: ['@/components/BeforeLogin'],
      // The `BeforeDashboard` component renders the 'welcome' block that you see after logging into your admin panel.
      // Feel free to delete this at any time. Simply remove the line below.
      beforeDashboard: ['@/components/BeforeDashboard'],
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
    user: Users.slug,
    livePreview: {
      breakpoints: [
        {
          label: 'Mobile',
          name: 'mobile',
          width: 375,
          height: 667,
        },
        {
          label: 'Tablet',
          name: 'tablet',
          width: 768,
          height: 1024,
        },
        {
          label: 'Desktop',
          name: 'desktop',
          width: 1440,
          height: 900,
        },
      ],
    },
  },
  collections: [Users, Pages, Posts, Categories, Projects, Experience, Media],
  cors: [getServerSideURL()].filter(Boolean),
  csrf: [getServerSideURL()].filter(Boolean),      // Crucial for cookie auth
  globals: [Header, Footer],
  plugins,
  db: useNoopDb
    ? noopDb
    : mongooseAdapter({
        url: process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://127.0.0.1:27017/rossmoney_me',
      }),
  secret: process.env.PAYLOAD_SECRET || 'rossmoney_payload_secret_key_change_me',
  sharp,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  onInit: async (payload: Payload) => {
    try {
      const pClient = payload as any;

      // Ensure header global is seeded/synced on every startup
        try {
          const headerData = {
            navItems: [
              { link: { type: 'custom', label: 'Work', url: '#work' } },
              { link: { type: 'custom', label: 'Experience', url: '#experience' } },
              { link: { type: 'custom', label: 'Architecture', url: '#architecture' } },
              { link: { type: 'custom', label: 'Commits', url: '#commits' } },
              { link: { type: 'custom', label: 'Contact', url: '#contact' } },
            ],
          };

          const currentHeader = await pClient.db.findGlobal({ slug: 'header' }).catch(() => null);
          if (!currentHeader) {
            await pClient.db.createGlobal({ slug: 'header', data: headerData });
            payload.logger.info('Header global created and seeded successfully.');
          } else if (!Array.isArray((currentHeader as any).navItems) || (currentHeader as any).navItems.length === 0 || process.env.PAYLOAD_SEED === 'true') {
            await pClient.db.updateGlobal({ slug: 'header', data: headerData });
            payload.logger.info('Header global updated and seeded successfully.');
          }
        } catch (err) {
          payload.logger.warn(`Header global seed note: ${err}`);
        }

      const existingPages = await pClient.find({ collection: 'pages', limit: 10 });
      const shouldSeed = existingPages.totalDocs === 0 || process.env.PAYLOAD_SEED === 'true';

      if (shouldSeed) {
        payload.logger.info('Seeding/syncing default Payload CMS documents...');

        const defaultPages = [
          {
            slug: 'home',
            eyebrow: 'Available for devops and developer roles',
            title: 'Building dependable systems with operational discipline.',
            lead: 'I design and ship resilient developer experiences, automation layers, and production-ready interfaces. This portfolio can now be edited in Payload CMS and persisted in MongoDB.',
            focus: {
              kicker: 'Current focus',
              title: 'Building personal infrastructure',
              status: 'Live',
              items: [
                { label: 'Role', value: 'DevOps-focused developer working on personal projects' },
                { label: 'Specialty', value: 'Storage servers, media servers, and reliable self-hosted services' },
                { label: 'Current build', value: 'Custom connectors and tooling for homelab and service automation' },
                { label: 'Delivery model', value: 'Small iterations, practical ops, and systems I can run myself' }
              ]
            },
            data: {
              primaryButton: { label: 'Start a conversation', href: '#contact' },
              secondaryButton: { label: 'Inspect live architecture', href: '#architecture' },
              metrics: [
                { value: '99.95%', label: 'availability target' },
                { value: '24/7', label: 'operations mindset' },
                { value: 'DX', label: 'developer experience focus' }
              ]
            }
          },
          {
            slug: 'contact',
            eyebrow: 'Contact',
            title: 'Open to platform, DevOps, and development work.',
            lead: 'I am available for contract and full-time work, and I enjoy collaborating with teams to improve delivery and reliability.',
            data: {
              links: [
                { label: 'dev@rossmoney.me', href: 'mailto:dev@rossmoney.me' },
                { label: 'github.com/tekkifox', href: 'https://github.com/tekkifox' },
                { label: 'linkedin.com/in/rossmoney', href: 'https://www.linkedin.com/in/rossmoney' }
              ]
            }
          },
          { slug: 'architecture', eyebrow: 'Live architecture example', title: 'Data streamed from the host Go service.' },
          { slug: 'commits', eyebrow: 'Recent commits', title: 'Last few GitHub commits from my portfolio repo.' },
          { slug: 'work', eyebrow: 'Selected work', title: 'Real roles and projects from my CV.' },
          { slug: 'experience-page', eyebrow: 'Experience', title: 'Recent delivery history.' },
          { slug: 'navigation', data: { links: [{ label: 'Work', href: '#work' }, { label: 'Experience', href: '#experience' }, { label: 'Architecture', href: '#architecture' }, { label: 'Commits', href: '#commits' }, { label: 'Contact', href: '#contact' }] } }
        ];

        for (const pageData of defaultPages) {
          const found = existingPages.docs.find((p: any) => p.slug === pageData.slug);
          if (found) {
            await pClient.update({
              collection: 'pages',
              id: found.id,
              data: pageData,
            });
          } else {
            await pClient.create({
              collection: 'pages',
              data: pageData,
            });
          }
        }

        const defaultProjects = [
          { title: 'Morphsites', role: 'Backend developer across Laravel and legacy PHP', summary: 'Built and maintained new Laravel projects and older PHP/Statamic sites, while handling support tickets autonomously through Jira.', tags: [{ tag: 'Laravel' }, { tag: 'Statamic' }, { tag: 'Jira support' }], order: 1 },
          { title: 'Rawnet Ltd.', role: 'PHP Developer with DevOps responsibility', summary: 'Supported in-house developers and AWS infrastructure, built local Docker setup commands, handled WAF blocking, monitored uptime, and managed Ubuntu patching with Canonical Landscape.', tags: [{ tag: 'AWS' }, { tag: 'Docker' }, { tag: 'Ubuntu' }], order: 2 },
          { title: 'Project Better Energy', role: 'Full stack PHP and Vue work for business tooling', summary: 'Worked in a small team maintaining Laravel applications, built Vue.js finance wizards, and delivered a stockist map feature for EV chargers.', tags: [{ tag: 'Laravel' }, { tag: 'Vue.js' }, { tag: 'Tailwind / Bootstrap' }], order: 3 }
        ];

        const existingProjects = await pClient.find({ collection: 'projects', limit: 10 });
        for (const proj of defaultProjects) {
          const found = existingProjects.docs.find((p: any) => p.title === proj.title);
          if (found) {
            await pClient.update({ collection: 'projects', id: found.id, data: proj });
          } else {
            await pClient.create({ collection: 'projects', data: proj });
          }
        }

        const defaultExperience = [
          { year: '2024 - Present', title: 'Personal infrastructure', organization: 'Homelab and service automation', summary: 'Building portfolio tooling, reverse-proxy deployments, and containerized services that I can operate end-to-end.', highlights: [{ highlight: 'Docker' }, { highlight: 'NGINX' }, { highlight: 'Go services' }], order: 1 },
          { year: '2021 - 2024', title: 'Platform support', organization: 'Managed hosting and application teams', summary: 'Kept production systems stable, handled support workloads, and improved developer delivery paths across PHP and AWS stacks.', highlights: [{ highlight: 'AWS' }, { highlight: 'Ubuntu' }, { highlight: 'Support' }], order: 2 }
        ];

        const existingExp = await pClient.find({ collection: 'experience', limit: 10 });
        for (const exp of defaultExperience) {
          const found = existingExp.docs.find((e: any) => e.title === exp.title);
          if (found) {
            await pClient.update({ collection: 'experience', id: found.id, data: exp });
          } else {
            await pClient.create({ collection: 'experience', data: exp });
          }
        }

        payload.logger.info('Default Payload CMS documents seeded/synced successfully.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      payload.logger.error(`Error seeding default documents: ${message}`);
    }
  },
});
