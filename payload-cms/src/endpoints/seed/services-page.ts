import type { RequiredDataFromCollectionSlug } from 'payload'

export const services: RequiredDataFromCollectionSlug<'pages'> = {
  slug: 'services',
  _status: 'draft',
  hero: {
    type: 'none',
  },
  eyebrow: 'Services',
  title: 'Websites, DevOps, and infrastructure support, priced by the day.',
  lead:
    'I build and operate production websites and the systems behind them. This page is for teams that need an independent developer or DevOps engineer for a scoped piece of work, without a permanent hire.',
  data: {
    heroStats: {
      ariaLabel: 'Services at a glance',
      servicesLabel: 'scoped services',
      rangeLabel: 'published day-rate range',
      reviewLabel: 'rate review',
      reviewed: 'October 2026',
    },
    secondaryButton: {
      label: 'See services and rates',
      href: '#services',
    },
    servicesSection: {
      eyebrow: 'Services',
      title: 'Six ways to get the work moving.',
      lead:
        'Each service is priced as a day-rate range, so the shape of the work is clear before we scope it.',
      detailLabel: 'Read the detail',
    },
    services: [
      {
        slug: 'website-build',
        name: 'Website build',
        badge: 'Front end',
        summary:
          'Design and build responsive, production-ready websites using modern front-end tooling and a maintainable component system.',
        focus: 'Design, build, and handover',
        includes: [
          'Responsive page templates built with Tailwind utility classes',
          'Accessible navigation, forms, and interactive components',
          'Performance and cross-browser checks before handover',
          'Deployment-ready build with clear handover notes',
        ],
        detail:
          'Best for a new marketing site, a rebuild of an ageing front end, or a focused set of pages that need to ship quickly. The work follows the existing design system where there is one, so the result stays consistent with the rest of the estate.',
        bestFor: 'New sites, front-end rebuilds, and production-ready page templates.',
        rate: {
          min: 450,
          max: 550,
          currency: 'GBP',
          unit: 'day',
        },
      },
      {
        slug: 'cms-integration',
        name: 'CMS integration',
        badge: 'Content',
        summary:
          'Connect content-managed pages and collections to an existing site so editors can update content without a deployment.',
        focus: 'Payload, Statamic, and Laravel',
        includes: [
          'Payload CMS collections and page templates',
          'Statamic and Laravel content models where the stack already uses them',
          'Admin-friendly field structure with preview support',
          'Seed data and migration notes for existing content',
        ],
        detail:
          'The work covers the content model, the editing experience, and the front-end binding. Existing content can be mapped into the new structure, with a short handover so editors know which fields control which parts of the page.',
        bestFor: 'Teams moving from hard-coded pages to an editable CMS.',
        rate: {
          min: 450,
          max: 600,
          currency: 'GBP',
          unit: 'day',
        },
      },
      {
        slug: 'devops-ci-cd',
        name: 'DevOps and CI/CD',
        badge: 'Delivery',
        summary:
          'Automate builds, tests, and deployments so releases are repeatable rather than manual.',
        focus: 'GitHub Actions, Docker, releases',
        includes: [
          'GitHub Actions pipelines for build, test, and publish',
          'Dockerised development and runtime environments',
          'Environment and secret handling across stages',
          'Release checks, rollback notes, and runbooks',
        ],
        detail:
          'This is hands-on pipeline and release work: removing manual steps, making environments consistent, and leaving the team with a process it can operate without me. It can start from an existing pipeline or a blank repository.',
        bestFor: 'Teams still deploying by hand or maintaining brittle release scripts.',
        rate: {
          min: 500,
          max: 650,
          currency: 'GBP',
          unit: 'day',
        },
      },
      {
        slug: 'cloud-infrastructure',
        name: 'Cloud and infrastructure',
        badge: 'Platform',
        summary:
          'Set up and maintain the servers, containers, and cloud resources a site or service runs on.',
        focus: 'Linux, AWS, containers',
        includes: [
          'Linux server setup with a documented hardening baseline',
          'Docker and reverse-proxy configuration',
          'AWS networking, storage, and access policies',
          'Infrastructure documentation and handover',
        ],
        detail:
          'The work is sized to the estate in front of me, from a single host running a handful of containers to a small AWS environment that needs clearer boundaries. The aim is a setup another engineer can understand and operate.',
        bestFor: 'Small platforms that need a dependable, documented foundation.',
        rate: {
          min: 525,
          max: 675,
          currency: 'GBP',
          unit: 'day',
        },
      },
      {
        slug: 'monitoring-observability',
        name: 'Monitoring and observability',
        badge: 'Reliability',
        summary:
          'Make production behaviour visible with uptime checks, logs, metrics, and alerts that lead to action.',
        focus: 'Uptime, logs, metrics, alerts',
        includes: [
          'Uptime and health-check coverage for public services',
          'Log and metric collection for running services',
          'Dashboards that show the state of the stack',
          'Alert routes with first-response notes',
        ],
        detail:
          'The result is not a wall of charts. It is a small set of signals that tell you whether the site is available, whether it is healthy, and who should look when something changes.',
        bestFor: 'Services that currently fail silently or are checked by hand.',
        rate: {
          min: 500,
          max: 650,
          currency: 'GBP',
          unit: 'day',
        },
      },
      {
        slug: 'security-hardening',
        name: 'Security hardening',
        badge: 'Security',
        summary:
          'Close the common gaps in an existing site or server estate without disrupting delivery.',
        focus: 'WAF, patching, TLS, access',
        includes: [
          'WAF and reverse-proxy rule review',
          'Operating-system and dependency patching routines',
          'TLS, access, and secret-handling checks',
          'Prioritised findings with practical fixes',
        ],
        detail:
          'This is defensive hardening rather than a formal penetration test or certification programme. It focuses on the controls that are cheap to get wrong and expensive to leave open: exposed services, stale packages, weak access paths, and missing transport security.',
        bestFor: 'Existing deployments that need a pragmatic security baseline.',
        rate: {
          min: 550,
          max: 700,
          currency: 'GBP',
          unit: 'day',
        },
      },
    ],
    pricingTable: {
      eyebrow: 'Rate card',
      title: 'Day rates at a glance.',
      lead:
        'Indicative ranges for scoped contract work. The final rate is confirmed after the scope conversation.',
      serviceColumn: 'Service',
      focusColumn: 'Typical focus',
      rateColumn: 'Day rate',
      caption: 'Day-rate ranges for each service.',
    },
    accordion: {
      eyebrow: 'Service detail',
      title: 'What each service covers.',
      lead: 'Open a service for the working detail behind the summary.',
      bestForLabel: 'Best for',
    },
    engagement: {
      eyebrow: 'How it works',
      title: 'Simple, scoped engagements.',
      lead:
        'Every piece of work starts with a short scoping conversation so the days, deliverables, and access are clear before the first invoice.',
      items: [
        {
          label: 'Minimum engagement',
          value:
            'One working day. Larger pieces are broken into day blocks, with the scope reviewed as the work progresses.',
        },
        {
          label: 'Working pattern',
          value:
            'Remote collaboration by default. On-site attendance can be agreed at scoping.',
        },
        {
          label: 'What a day includes',
          value:
            'One working day on the agreed scope, a short written update, and handover notes for completed work.',
        },
        {
          label: 'Not included',
          value:
            'Travel, hardware, licences, and third-party fees are agreed separately before the work starts.',
        },
      ],
    },
    cta: {
      eyebrow: 'Next step',
      title: 'Need a day rate for a specific piece of work?',
      lead:
        'Send the scope, timeline, and any constraints. You will get a short response with the relevant service, a day estimate, and the next practical step.',
      label: 'Start a conversation',
      href: '/contact',
    },
    pricingBasis: {
      note:
        'Ranges were derived from advertised UK contract day rates reviewed on 23 October 2026. Each range is pegged to the service specialism rather than the top of the market. The site does not currently state a VAT position, so this page does not assert one; invoicing terms are confirmed before work starts. Final rates depend on scope, seniority, clearance, and location.',
      summary:
        'Ranges derived from advertised UK contract rates reviewed in October 2026. Final rates depend on scope, seniority, clearance, and location.',
      sourcesLabel: 'View the market sources',
      sources: [
        {
          label: 'ITJobsWatch — Developer contract rates, 6 months to 22 October 2026',
          url: 'https://www.itjobswatch.co.uk/contracts/uk/developer.do',
        },
        {
          label: 'ITJobsWatch — DevOps Engineer contract rates, 6 months to 22 October 2026',
          url: 'https://www.itjobswatch.co.uk/contracts/uk/devops%20engineer.do',
        },
        {
          label: 'ITJobsWatch — AWS DevOps Engineer contract rates, 6 months to 22 October 2026',
          url: 'https://www.itjobswatch.co.uk/contracts/uk/aws%20devops%20engineer.do',
        },
        {
          label:
            'ITJobsWatch — Cybersecurity Consultant contract rates, 6 months to 22 October 2026',
          url: 'https://www.itjobswatch.co.uk/contracts/uk/cyber%20security%20consultant.do',
        },
        {
          label: 'Hurren & Hope — UK contractor day rate index, reviewed 29 September 2026',
          url: 'https://www.hurrenandhope.com/uk-contractor-day-rates',
        },
        {
          label: 'Contractor Calculator — Tech contractor day rates by role, 20 July 2026',
          url: 'https://contractorcalc.co.uk/newsroom/tech-contractor-day-rates-2026',
        },
        {
          label: 'ContractorUK — DevOps Engineer day rates, updated 23 October 2026',
          url: 'https://www.contractoruk.com/devops-engineer-day-rate',
        },
        {
          label: 'Cloud Computing Jobs — UK cloud contractor day rates, June 2026',
          url: 'https://cloudcomputingjobs.co.uk/career-advice/cloud-computing-jobs-uk-2026-contractor-day-rates-ir35',
        },
      ],
    },
  },
  layout: [],
  meta: {
    title: 'Services',
    description:
      'Day-rate services for website builds, CMS integration, DevOps and CI/CD, cloud infrastructure, monitoring, and security hardening.',
  },
} as any
