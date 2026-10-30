import { buildConfig, type BaseDatabaseAdapter, type DatabaseAdapterObj, type Payload } from 'payload';
import { mongooseAdapter } from '@payloadcms/db-mongodb';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

import { Footer } from './Footer/config'
import { Header } from './Header/config'
import { plugins } from './plugins'
import { getServerSideURL } from './utilities/getURL'
import { resolveServerURL } from './utilities/serverURL'
import { SAMPLER_INTERVAL_MS } from './utilities/hostUsage'
import { resendAdapter } from '@payloadcms/email-resend'
import { contact as contactPageData } from './endpoints/seed/contact-page';
import { contactForm as contactFormData } from './endpoints/seed/contact-form';
import { home } from './endpoints/seed/home';
import { Pages } from './collections/Pages';
import { Users } from './collections/Users';
import { Projects } from './collections/Projects';
import { Experience } from './collections/Experience';
import { Media } from './collections/Media';
import { Posts } from './collections/Posts';
import { Categories } from './collections/Categories';
import { ErrorLogs } from './collections/ErrorLogs';
import { ArchviewSources } from './collections/ArchviewSources';
import { HostSamples } from './collections/HostSamples';
import { travelling as travellingPage } from './endpoints/seed/travelling-page';
import { services as servicesPage } from './endpoints/seed/services-page';
import { gameservers } from './endpoints/seed/game-servers-page';
import { cv } from './endpoints/seed/cv-page';
import { seedArchviewSources, type SeededArchviewSources } from './endpoints/seed/archview-sources';
import { asRecord } from './utilities/json';
import type { Form } from './payload-types';
import fs from 'fs'
import os from 'os'

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

/**
 * Inert database adapter used for production builds (and any DB-less run).
 * It answers the handful of calls `onInit` makes with empty results and never
 * connects anywhere. `Payload` requires the full adapter surface, so the stub is
 * narrowed to that interface at this single boundary rather than leaking `any`.
 */
const noopAdapter = {
  connect: async () => undefined,
  destroy: async () => undefined,
  create: async () => ({}),
  update: async () => ({}),
  delete: async () => ({}),
  find: async () => ({ docs: [], totalDocs: 0 }),
  findOne: async () => null,
  count: async () => 0,
  countVersions: async () => 0,
  createGlobal: async () => ({}),
  updateGlobal: async () => ({}),
  findGlobal: async () => null,
  createMigration: async () => ({}),
  migrate: async () => undefined,
  rollbackMigration: async () => undefined,
  transaction: async <T>(fn: () => Promise<T>) => fn?.(),
} as unknown as BaseDatabaseAdapter;

const noopDb: DatabaseAdapterObj = {
  defaultIDType: 'text',
  name: 'noop',
  init: () => noopAdapter,
};

const useNoopDb = process.env.SKIP_DB === 'true' || process.env.NEXT_PHASE === 'phase-production-build';

const emailFromAddress = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'dev@rossmoney.me';
const emailFromName = process.env.EMAIL_FROM_NAME || process.env.SMTP_FROM_NAME || 'Ross Money';

const emailAdapter = resendAdapter({
  apiKey: process.env.RESEND_API_KEY || '',
  defaultFromAddress: emailFromAddress,
  defaultFromName: emailFromName,
});

export default buildConfig({
  serverURL: resolveServerURL(),
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
  collections: [Users, Pages, Posts, Categories, Projects, Experience, Media, ErrorLogs, ArchviewSources, HostSamples],
  cors: [getServerSideURL()].filter(Boolean),
  csrf: [getServerSideURL()].filter(Boolean),      // Crucial for cookie auth
  email: emailAdapter,
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
    // Ensure public/media directory exists and is writable when possible.
    // Blob storage owns uploads when a token is present, so the local directory
    // is not needed there (and the Vercel filesystem is read-only anyway).
    // Every filesystem call below is guarded, so this stays harmless on a
    // read-only filesystem.
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const publicMedia = path.resolve(process.cwd(), 'public', 'media')
        if (!fs.existsSync(publicMedia)) {
          try {
            fs.mkdirSync(publicMedia, { recursive: true })
            // try to set permissive mode on POSIX systems
            if (os.platform() !== 'win32') {
              try { fs.chmodSync(publicMedia, 0o755) } catch { /* ignore */ }
            }
            if (payload.logger?.info) payload.logger.info(`Created public media directory at ${publicMedia}`)
          } catch (e) {
            if (payload.logger?.warn) payload.logger.warn(`Could not create public media directory: ${e}`)
          }
        }
      } catch (err) {
        // ignore any file-system errors here; upload will fail later with a clearer error
        console.warn('public media dir check failed', err)
      }
    }
    try {
      const pClient = payload;

      // Ensure header global is seeded/synced on every startup
        try {
          const headerData = {
            navItems: [
              { link: { type: 'custom', label: 'Work', url: '/#work' } },
              { link: { type: 'custom', label: 'Travelling', url: '/travelling' } },
              { link: { type: 'custom', label: 'Game Servers', url: '/game-servers' } },
              { link: { type: 'custom', label: 'Experience', url: '/#experience' } },
              { link: { type: 'custom', label: 'Architecture', url: '/#architecture' } },
              { link: { type: 'custom', label: 'CV', url: '/cv' } },
              { link: { type: 'custom', label: 'Contact', url: '/contact' } },
            ],
          };

          const currentHeader = await pClient.db
            .findGlobal<{ navItems?: Array<{ link?: { label?: string | null; url?: string | null } }> }>({ slug: 'header' })
            .catch(() => null);
          if (!currentHeader) {
            await pClient.db.createGlobal({ slug: 'header', data: headerData });
            payload.logger.info('Header global created and seeded successfully.');
          } else if (!Array.isArray(currentHeader.navItems) || currentHeader.navItems.length === 0 || process.env.PAYLOAD_SEED === 'true') {
            await pClient.db.updateGlobal({ slug: 'header', data: headerData });
            payload.logger.info('Header global updated and seeded successfully.');
          } else {
            const navItems = currentHeader.navItems;
            const correctedNavItems = navItems.map((item) => {
              if (item?.link?.label === 'Contact' && item.link.url === '/#contact') {
                return { ...item, link: { ...item.link, url: '/contact' } };
              }
              return item;
            });
            if (JSON.stringify(correctedNavItems) !== JSON.stringify(navItems)) {
              await pClient.db.updateGlobal({ slug: 'header', data: { navItems: correctedNavItems } });
              payload.logger.info('Corrected header Contact link to /contact');
            }
          }
        } catch (err) {
          payload.logger.warn(`Header global seed note: ${err}`);
        }

      // Default documents are created on an empty database, and any that are
      // missing are added on later startups. Existing documents are only
      // overwritten when PAYLOAD_SEED=true so editor changes are preserved.
      const forceSeed = process.env.PAYLOAD_SEED === 'true';
      // Cache revalidation needs a Next.js request context. `onInit` runs at
      // server start, so tell the collection hooks to skip revalidation.
      const seedContext = { disableRevalidate: true };

      payload.logger.info('Ensuring default Payload CMS documents exist...');

      let seededArchviewSources: SeededArchviewSources = {};
      try {
        seededArchviewSources = await seedArchviewSources(payload);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        payload.logger.warn(`ArchView source seed note: ${message}`);
      }

      const defaultPages = [
        home,
        contactPageData,
        travellingPage,
        servicesPage,
        gameservers,
        cv,
      ];

      const existingPages = await pClient.find({ collection: 'pages', limit: 1000 });
      for (const pageData of defaultPages) {
        const found = existingPages.docs.find((p) => p.slug === pageData.slug);
        const pageDataWithSource =
          pageData.slug === 'game-servers' && seededArchviewSources.vortexserversId !== undefined
            ? { ...pageData, archviewSource: seededArchviewSources.vortexserversId }
            : pageData;
        try {
          if (found && forceSeed) {
            await pClient.update({
              collection: 'pages',
              id: found.id,
              data: pageDataWithSource,
              context: seedContext,
            });
          } else if (!found) {
            await pClient.create({
              collection: 'pages',
              data: pageDataWithSource,
              context: seedContext,
            });
            payload.logger.info(`Seeded default page: ${pageData.slug}`);
          } else if (
            found.slug === 'game-servers' &&
            !found.archviewSource &&
            seededArchviewSources.vortexserversId !== undefined
          ) {
            // Link existing game-servers pages to the seeded source without
            // touching any other editor change.
            await pClient.update({
              collection: 'pages',
              id: found.id,
              data: { archviewSource: seededArchviewSources.vortexserversId },
              context: seedContext,
            });
            payload.logger.info('Linked game-servers page to the Vortexservers ArchView source');
          } else if (found.slug === 'home') {
            // Narrow, idempotent correction: older databases still store the
            // homepage button as the retired in-page anchor. Only rewrite that
            // exact value so editor changes to the page are preserved.
            const data = asRecord(found.data);
            const primaryButton = asRecord(data.primaryButton);
            if (primaryButton.href === '#contact') {
              await pClient.update({
                collection: 'pages',
                id: found.id,
                data: {
                  data: {
                    ...data,
                    primaryButton: { ...primaryButton, href: '/contact' },
                  },
                },
                context: seedContext,
              });
              payload.logger.info('Corrected home page primary button link to /contact');
            }
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          payload.logger.error(`Failed to seed page "${pageData.slug}": ${message}`);
        }
      }

      const existingContactForm = await pClient.find({
        collection: 'forms',
        where: { title: { equals: contactFormData.title } },
        limit: 1,
        depth: 0,
      });
      if (existingContactForm.docs.length === 0) {
        try {
          await pClient.create({
            collection: 'forms',
            data: contactFormData,
            depth: 0,
          });
          payload.logger.info(`Seeded default contact form: ${contactFormData.title}`);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          payload.logger.error(`Failed to seed contact form "${contactFormData.title}": ${message}`);
        }
      } else {
        const existingForm = existingContactForm.docs[0];
        const desiredEmails = contactFormData.emails || [];
        const normalizeEmails = (emails: NonNullable<Form['emails']>) => emails.map((email) => ({
          emailFrom: email.emailFrom,
          emailTo: email.emailTo,
          message: email.message,
          replyTo: email.replyTo,
          subject: email.subject,
          ...(email.cc !== undefined ? { cc: email.cc } : {}),
          ...(email.bcc !== undefined ? { bcc: email.bcc } : {}),
        }));
        if (JSON.stringify(normalizeEmails(existingForm.emails || [])) !== JSON.stringify(desiredEmails)) {
          try {
            await pClient.update({
              collection: 'forms',
              id: existingForm.id,
              data: { emails: desiredEmails },
              depth: 0,
            });
            payload.logger.info(`Updated contact form email delivery: ${contactFormData.title}`);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            payload.logger.error(`Failed to update contact form email delivery: ${message}`);
          }
        }
      }

      const defaultProjects = [
        { title: 'Morphsites', role: 'Backend developer across Laravel and legacy PHP', summary: 'Built and maintained new Laravel projects and older PHP/Statamic sites, while handling support tickets autonomously through Jira.', tags: [{ tag: 'Laravel' }, { tag: 'Statamic' }, { tag: 'Jira support' }], order: 1 },
        { title: 'Rawnet Ltd.', role: 'PHP Developer with DevOps responsibility', summary: 'Supported in-house developers and AWS infrastructure, built local Docker setup commands, handled WAF blocking, monitored uptime, and managed Ubuntu patching with Canonical Landscape.', tags: [{ tag: 'AWS' }, { tag: 'Docker' }, { tag: 'Ubuntu' }], order: 2 },
        { title: 'Project Better Energy', role: 'Full stack PHP and Vue work for business tooling', summary: 'Worked in a small team maintaining Laravel applications, built Vue.js finance wizards, and delivered a stockist map feature for EV chargers.', tags: [{ tag: 'Laravel' }, { tag: 'Vue.js' }, { tag: 'Tailwind / Bootstrap' }], order: 3 }
      ];

      const existingProjects = await pClient.find({ collection: 'projects', limit: 100 });
      for (const proj of defaultProjects) {
        const found = existingProjects.docs.find((p) => p.title === proj.title);
        try {
          if (found && forceSeed) {
            await pClient.update({ collection: 'projects', id: found.id, data: proj });
          } else if (!found) {
            await pClient.create({ collection: 'projects', data: proj });
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          payload.logger.error(`Failed to seed project "${proj.title}": ${message}`);
        }
      }

      const defaultExperience = [
        { year: '2024 - Present', title: 'Personal infrastructure', organization: 'Homelab and service automation', summary: 'Building portfolio tooling, reverse-proxy deployments, and containerized services that I can operate end-to-end.', highlights: [{ highlight: 'Docker' }, { highlight: 'NGINX' }, { highlight: 'Go services' }], order: 1 },
        { year: '2021 - 2024', title: 'Platform support', organization: 'Managed hosting and application teams', summary: 'Kept production systems stable, handled support workloads, and improved developer delivery paths across PHP and AWS stacks.', highlights: [{ highlight: 'AWS' }, { highlight: 'Ubuntu' }, { highlight: 'Support' }], order: 2 }
      ];

      const existingExp = await pClient.find({ collection: 'experience', limit: 100 });
      for (const exp of defaultExperience) {
        const found = existingExp.docs.find((e) => e.title === exp.title);
        try {
          if (found && forceSeed) {
            await pClient.update({ collection: 'experience', id: found.id, data: exp });
          } else if (!found) {
            await pClient.create({ collection: 'experience', data: exp });
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          payload.logger.error(`Failed to seed experience "${exp.title}": ${message}`);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      payload.logger.error(`Error seeding default documents: ${message}`);
    }

    // Independent host sampler: covers hosts that nobody browses. Runs in the
    // long-lived Node process (disabled on Vercel/serverless where an interval
    // cannot survive). Retention (30 days) happens in the same sweep, daily.
    // Cadence lives in utilities/hostUsage.ts next to the "last hour" bucket
    // width; the two are deliberately equal (one sample per bucket).
    const { sampleAllEnabledHosts, shouldRunHostSampler } = await import('./utilities/hostSampling')
    if (process.env.NODE_ENV === 'production' && shouldRunHostSampler(process.env)) {
    try {
      const interval = setInterval(() => {
        void sampleAllEnabledHosts(payload)
      }, SAMPLER_INTERVAL_MS)
      interval.unref?.()
    } catch (err) {
      console.warn('host sampler schedule failed:', err)
    }
  }
  },
});
