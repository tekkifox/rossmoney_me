export const gameservers = {
  slug: 'game-servers',
  _status: 'published',
  hero: {
    type: 'none',
  },
  eyebrow: 'Game Servers',
  title: 'VortexServers.co.uk — Community game server hosting and tooling',
  lead:
    'Live game server deployments, provisioning, and monitoring for VortexServers.co.uk.',
  focus: {
    kicker: 'Project',
    title: 'VortexServers.co.uk infrastructure',
    status: 'Live',
  },
  archviewUrl: 'https://archview.vortexservers.co.uk',
  data: {
    commitRepository: 'vortexservers_co_uk',
    commitBranch: 'main',
    archviewUrl: 'https://archview.vortexservers.co.uk',
    liveUrl: 'https://www.vortexservers.co.uk',
    metrics: [
      { value: 'Tech', label: 'Docker, Pelican panel, Go services' },
      { value: 'Ops', label: 'Provisioning and telemetry' },
      { value: 'Enterprise', label: 'SSO Auth services, restic backups' },
    ],
    summaryTitle: 'VortexServers operational view',
    summaryLead:
      'This page surfaces project telemetry and recent commits for the VortexServers.co.uk project.',
    cards: [],
    architecture: {
      eyebrow: 'Vortex architecture feed',
      title: 'Architecture for VortexServers.co.uk.',
    },
  },
  layout: [],
  meta: {
    title: 'Game Servers',
    description: 'Infrastructure and operational view for VortexServers.co.uk',
  },
} as any
