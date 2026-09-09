const architectureUrl = document.body.dataset.architectureUrl || document.querySelector('meta[name="architecture-api"]')?.content || '/api/architecture';
const cmsUrl = document.body.dataset.cmsUrl || '/api/cms/site';

const architectureState = {
  title: document.getElementById('architecture-title'),
  status: document.getElementById('architecture-status'),
  description: document.getElementById('architecture-description'),
  facts: document.getElementById('architecture-facts'),
  highlights: document.getElementById('architecture-highlights'),
  diagram: document.getElementById('architecture-diagram'),
  systemStats: document.getElementById('architecture-system-stats'),
  images: document.getElementById('architecture-images'),
  imagesCount: document.getElementById('architecture-images-count'),
  raw: document.getElementById('architecture-raw'),
  updated: document.getElementById('architecture-updated'),
  refresh: document.getElementById('refresh-architecture')
};

const commitsState = {
  output: document.getElementById('github-commits'),
  status: document.getElementById('github-commits-status')
};

const githubRepo = {
  owner: 'tekkifox',
  repo: 'rossmoney_me',
  branch: 'main'
};

let currentArchitecturePayload = null;

architectureState.refresh.addEventListener('click', () => {
  void loadArchitecture(true);
});

void loadArchitecture();
void loadGitHubCommits();
void loadCmsContent();

function formatValue(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  if (value instanceof Date) {
    return value.toLocaleString();
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  return String(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function pickFirst(payload, keys) {
  for (const key of keys) {
    if (payload && payload[key] !== undefined && payload[key] !== null && payload[key] !== '') {
      return payload[key];
    }
  }

  return null;
}

function normalizeList(items) {
  return asArray(items).flatMap((item) => {
    if (item === null || item === undefined) {
      return [];
    }

    if (typeof item === 'string' || typeof item === 'number') {
      return [String(item)];
    }

    if (typeof item === 'object') {
      return [
        item.name || item.label || item.id || item.service || item.node || item.region || JSON.stringify(item)
      ];
    }

    return [];
  });
}

function buildFacts(payload) {
  const dockerImages = extractDockerImages(payload);

  return [
    ['Environment', pickFirst(payload, ['environment', 'env', 'stage'])],
    ['Region', pickFirst(payload, ['region', 'primaryRegion', 'zone'])],
    ['Cluster', pickFirst(payload, ['cluster', 'clusterName', 'namespace'])],
    ['Updated', pickFirst(payload, ['updatedAt', 'lastUpdated', 'syncedAt', 'timestamp'])],
    ['Services', normalizeList(pickFirst(payload, ['services', 'components', 'apps'])).length || pickFirst(payload, ['servicesCount'])],
    ['Nodes', normalizeList(pickFirst(payload, ['nodes', 'hosts', 'instances'])).length || pickFirst(payload, ['nodeCount'])],
    ['Images', dockerImages.length || pickFirst(payload, ['imagesCount'])]
  ];
}

function formatCmsText(value, fallback = '') {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  return String(value);
}

function formatBytesHuman(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatUptime(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) {
    return '—';
  }

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function sumNetworkBytes(network) {
  return asArray(network).reduce((acc, item) => {
    acc.received += Number(item?.receivedBytes || item?.received || 0);
    acc.sent += Number(item?.sentBytes || item?.sent || 0);
    return acc;
  }, { received: 0, sent: 0 });
}

function renderSystemStats(payload) {
  if (!architectureState.systemStats) {
    return;
  }

  const system = payload?.system || {};
  const loadAverage = asArray(system.loadAverage || system.load || system.avgLoad);
  const memory = system.memory || {};
  const network = asArray(system.network || system.interfaces || system.net);
  const networkTotals = sumNetworkBytes(network);

  architectureState.systemStats.innerHTML = '';

  const cpuCard = document.createElement('article');
  cpuCard.className = 'system-card system-card-cpu';

  const cpuHeader = document.createElement('div');
  cpuHeader.className = 'system-card-header';
  const cpuKicker = document.createElement('span');
  cpuKicker.className = 'panel-kicker';
  cpuKicker.textContent = 'CPU';
  const cpuTitle = document.createElement('h4');
  cpuTitle.textContent = `${formatValue(system.cpuCount || system.CPUCount || '—')} cores`;
  cpuHeader.append(cpuKicker, cpuTitle);

  const cpuBody = document.createElement('p');
  cpuBody.className = 'system-card-summary';
  cpuBody.textContent = `Load average ${loadAverage.slice(0, 3).map((item) => formatValue(item)).join(' / ') || '—'} · uptime ${formatUptime(system.uptimeSeconds || system.uptime || 0)}`;

  const nestedGrid = document.createElement('div');
  nestedGrid.className = 'system-nested-grid';

  const memoryCard = document.createElement('article');
  memoryCard.className = 'system-mini-card';
  memoryCard.innerHTML = `
    <span class="panel-label">Memory</span>
    <p>${formatBytesHuman(memory.usedBytes || 0)} used of ${formatBytesHuman(memory.totalBytes || 0)}</p>
    <p>${formatValue(memory.usedPercent || 0)}% used · ${formatBytesHuman(memory.availableBytes || memory.freeBytes || 0)} available</p>
  `;

  const networkCard = document.createElement('article');
  networkCard.className = 'system-mini-card';
  networkCard.innerHTML = `
    <span class="panel-label">Network</span>
    <p>${formatBytesHuman(networkTotals.received)} received</p>
    <p>${formatBytesHuman(networkTotals.sent)} sent across ${network.length} interface${network.length === 1 ? '' : 's'}</p>
  `;

  nestedGrid.append(memoryCard, networkCard);
  cpuCard.append(cpuHeader, cpuBody, nestedGrid);
  architectureState.systemStats.append(cpuCard);
}

function renderButton(element, button, fallbackLabel, fallbackHref) {
  if (!element) {
    return;
  }

  const label = formatCmsText(button?.label, fallbackLabel);
  const href = formatCmsText(button?.href, fallbackHref);
  element.textContent = label;
  element.setAttribute('href', href);
}

function renderHeroContent(home) {
  const eyebrow = document.getElementById('hero-eyebrow');
  const title = document.getElementById('hero-title');
  const lead = document.getElementById('hero-lead');
  const primaryButton = document.getElementById('hero-primary-button');
  const secondaryButton = document.getElementById('hero-secondary-button');
  const metrics = document.getElementById('hero-metrics');
  const heroPanel = document.querySelector('.hero-panel');

  if (eyebrow) {
    eyebrow.textContent = formatCmsText(home?.eyebrow, eyebrow.textContent);
  }
  if (title) {
    title.textContent = formatCmsText(home?.title, title.textContent);
  }
  if (lead) {
    lead.textContent = formatCmsText(home?.lead, lead.textContent);
  }

  renderButton(primaryButton, home?.primaryButton, primaryButton?.textContent || 'Start a conversation', '#contact');
  renderButton(secondaryButton, home?.secondaryButton, secondaryButton?.textContent || 'Inspect live architecture', '#architecture');

  if (metrics && Array.isArray(home?.metrics) && home.metrics.length > 0) {
    metrics.innerHTML = '';
    for (const metric of home.metrics.slice(0, 3)) {
      const article = document.createElement('article');
      const value = document.createElement('span');
      value.className = 'metric-value';
      value.textContent = formatCmsText(metric.value, '—');
      const label = document.createElement('span');
      label.className = 'metric-label';
      label.textContent = formatCmsText(metric.label, 'Metric');
      article.append(value, label);
      metrics.append(article);
    }
  }

  if (heroPanel && home?.focus) {
    const focusHeading = heroPanel.querySelector('h2');
    const focusStatus = heroPanel.querySelector('.status-pill');
    const focusGrid = heroPanel.querySelector('.panel-grid');

    if (focusHeading) {
      focusHeading.textContent = formatCmsText(home.focus.title, focusHeading.textContent);
    }

    if (focusStatus) {
      focusStatus.textContent = formatCmsText(home.focus.status, focusStatus.textContent);
    }

    if (focusGrid && Array.isArray(home.focus.items) && home.focus.items.length > 0) {
      focusGrid.innerHTML = '';
      for (const item of home.focus.items.slice(0, 4)) {
        const cell = document.createElement('div');
        const labelNode = document.createElement('span');
        labelNode.className = 'panel-label';
        labelNode.textContent = formatCmsText(item.label, 'Item');
        const valueNode = document.createElement('p');
        valueNode.textContent = formatCmsText(item.value, '');
        cell.append(labelNode, valueNode);
        focusGrid.append(cell);
      }
    }
  }
}

function renderProjectCards(projects) {
  const container = document.getElementById('cms-projects');
  if (!container || !Array.isArray(projects) || projects.length === 0) {
    return;
  }

  container.innerHTML = '';
  for (const project of projects) {
    const card = document.createElement('article');
    card.className = 'glass-card feature-card';

    const kicker = document.createElement('p');
    kicker.className = 'card-kicker';
    kicker.textContent = formatCmsText(project.role, 'Project');

    const heading = document.createElement('h3');
    heading.textContent = formatCmsText(project.title, 'Untitled project');

    const summary = document.createElement('p');
    summary.textContent = formatCmsText(project.summary, '');

    const tags = document.createElement('ul');
    tags.className = 'tag-list';
    for (const tag of asArray(project.tags).slice(0, 6)) {
      const li = document.createElement('li');
      li.textContent = formatCmsText(tag, 'Tag');
      tags.append(li);
    }

    card.append(kicker, heading, summary);
    if (tags.children.length > 0) {
      card.append(tags);
    }
    container.append(card);
  }
}

function renderExperienceEntries(entries) {
  const container = document.getElementById('cms-experience');
  if (!container || !Array.isArray(entries) || entries.length === 0) {
    return;
  }

  container.innerHTML = '';
  for (const entry of entries) {
    const item = document.createElement('article');
    item.className = 'timeline-item';

    const year = document.createElement('p');
    year.className = 'timeline-year';
    year.textContent = formatCmsText(entry.year, '—');

    const body = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = [entry.title, entry.organization].filter(Boolean).join(' · ') || 'Experience';
    const summary = document.createElement('p');
    summary.textContent = formatCmsText(entry.summary, '');
    body.append(heading, summary);

    const highlights = asArray(entry.highlights);
    if (highlights.length > 0) {
      const list = document.createElement('ul');
      list.className = 'tag-list';
      for (const highlight of highlights.slice(0, 6)) {
        const li = document.createElement('li');
        li.textContent = formatCmsText(highlight, 'Highlight');
        list.append(li);
      }
      body.append(list);
    }

    item.append(year, body);
    container.append(item);
  }
}

function renderContactContent(contact) {
  const eyebrow = document.getElementById('contact-eyebrow');
  const title = document.getElementById('contact-title');
  const lead = document.getElementById('contact-lead');
  const links = document.getElementById('contact-links');

  if (eyebrow) {
    eyebrow.textContent = formatCmsText(contact?.eyebrow, eyebrow.textContent);
  }
  if (title) {
    title.textContent = formatCmsText(contact?.title, title.textContent);
  }
  if (lead) {
    lead.textContent = formatCmsText(contact?.lead, lead.textContent);
  }

  if (links && Array.isArray(contact?.links) && contact.links.length > 0) {
    links.innerHTML = '';
    for (const link of contact.links.slice(0, 6)) {
      const anchor = document.createElement('a');
      anchor.href = formatCmsText(link.href, '#');
      anchor.rel = 'noreferrer';
      anchor.textContent = formatCmsText(link.label, link.href || 'Contact');
      links.append(anchor);
    }
  }
}

function renderArchitectureSectionContent(arch) {
  const eyebrow = document.getElementById('architecture-section-eyebrow');
  const title = document.getElementById('architecture-section-title');
  if (eyebrow) {
    eyebrow.textContent = formatCmsText(arch?.eyebrow, eyebrow.textContent);
  }
  if (title) {
    title.textContent = formatCmsText(arch?.title, title.textContent);
  }
}

function renderCommitsSectionContent(com) {
  const eyebrow = document.getElementById('commits-section-eyebrow');
  const title = document.getElementById('commits-section-title');
  if (eyebrow) {
    eyebrow.textContent = formatCmsText(com?.eyebrow, eyebrow.textContent);
  }
  if (title) {
    title.textContent = formatCmsText(com?.title, title.textContent);
  }
}

function renderNavigationContent(nav) {
  const topnav = document.querySelector('.topnav');
  if (!topnav || !Array.isArray(nav?.links) || nav.links.length === 0) {
    return;
  }

  topnav.innerHTML = '';
  for (const link of nav.links.slice(0, 10)) {
    const a = document.createElement('a');
    a.href = formatCmsText(link.href, '#');
    a.textContent = formatCmsText(link.label, 'Link');
    topnav.append(a);
  }
}

function renderCmsContent(payload) {
  renderHeroContent(payload?.home);
  renderProjectCards(payload?.projects);
  renderExperienceEntries(payload?.experience);
  renderContactContent(payload?.contact);
  renderArchitectureSectionContent(payload?.architecture);
  renderCommitsSectionContent(payload?.commits);
  renderNavigationContent(payload?.navigation);
}

function buildHighlights(payload) {
  const serviceList = normalizeList(pickFirst(payload, ['services', 'components', 'apps']));
  const regionList = normalizeList(pickFirst(payload, ['regions', 'availabilityZones', 'zones']));

  return [
    {
      label: 'Services',
      value: serviceList.length ? serviceList.slice(0, 6) : ['Waiting on feed']
    },
    {
      label: 'Regions',
      value: regionList.length ? regionList.slice(0, 6) : ['Unknown']
    }
  ];
}

function determineStatus(payload) {
  const status = String(pickFirst(payload, ['status', 'health', 'state']) || 'loading').toLowerCase();

  if (status.includes('warn') || status.includes('degrad')) {
    return { label: 'Degraded', className: 'status-pill status-warning' };
  }

  if (status.includes('fail') || status.includes('down') || status.includes('error')) {
    return { label: 'Offline', className: 'status-pill is-error' };
  }

  if (status.includes('ready') || status.includes('ok') || status.includes('healthy') || status.includes('live')) {
    return { label: 'Healthy', className: 'status-pill status-live' };
  }

  if (status === 'loading') {
    return { label: 'Loading', className: 'status-pill status-muted' };
  }

  return { label: status.charAt(0).toUpperCase() + status.slice(1), className: 'status-pill status-muted' };
}

function renderFacts(payload) {
  architectureState.facts.innerHTML = '';

  const facts = buildFacts(payload);
  for (const [label, value] of facts) {
    const term = document.createElement('dt');
    term.textContent = label;

    const description = document.createElement('dd');
    description.textContent = formatValue(value);

    architectureState.facts.append(term, description);
  }
}

function renderHighlights(payload) {
  architectureState.highlights.innerHTML = '';

  for (const section of buildHighlights(payload)) {
    const card = document.createElement('article');
    card.className = 'mini-card';

    const label = document.createElement('span');
    label.className = 'mini-label';
    label.textContent = section.label;

    const value = document.createElement('div');
    value.className = 'mini-value';

    const items = Array.isArray(section.value) ? section.value : [section.value];
    if (items.length > 1) {
      const list = document.createElement('ul');
      for (const item of items) {
        const li = document.createElement('li');
        li.textContent = formatValue(item);
        list.append(li);
      }
      value.append(list);
    } else {
      value.textContent = formatValue(items[0]);
    }

    card.append(label, value);
    architectureState.highlights.append(card);
  }
}

function renderDiagram(payload) {
  const explicitDiagram = pickFirst(payload, ['diagram', 'topology', 'graph', 'architecture']);
  if (typeof explicitDiagram === 'string') {
    architectureState.diagram.textContent = explicitDiagram;
    return;
  }

  const services = normalizeList(pickFirst(payload, ['services', 'components', 'apps']));
  const nodes = normalizeList(pickFirst(payload, ['nodes', 'hosts', 'instances']));
  const regions = normalizeList(pickFirst(payload, ['regions', 'availabilityZones', 'zones']));

  const lines = [];
  lines.push('client');
  lines.push('  -> portfolio site');
  lines.push('     -> /api/architecture');
  lines.push('        -> host Go service');
  lines.push('');
  lines.push('services');
  lines.push(services.length ? services.map((item) => `  - ${item}`).join('\n') : '  - awaiting live service list');
  lines.push('');
  lines.push('nodes');
  lines.push(nodes.length ? nodes.map((item) => `  - ${item}`).join('\n') : '  - awaiting live node list');
  lines.push('');
  lines.push('regions');
  lines.push(regions.length ? regions.map((item) => `  - ${item}`).join('\n') : '  - awaiting live region list');

  architectureState.diagram.textContent = lines.join('\n');
}

function normalizeImageRef(ref) {
  const value = String(ref || '').trim();
  if (!value) {
    return '';
  }

  const withoutDigest = value.split('@')[0];
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  return lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) {
    return 'Unknown size';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDockerTime(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) {
    return 'Unknown';
  }

  const milliseconds = time > 1e12 ? time : time * 1000;
  return new Date(milliseconds).toLocaleString();
}

function extractDockerImages(payload) {
  const docker = payload?.docker || payload?.Docker || payload;
  const rawImages = asArray(docker?.images || docker?.Images || payload?.images);

  return rawImages.flatMap((item) => {
    if (item === null || item === undefined) {
      return [];
    }

    if (typeof item === 'string') {
      return [{ name: item }];
    }

    if (typeof item !== 'object') {
      return [];
    }

    const tags = asArray(item.repoTags || item.RepoTags || item.tags || item.Tags);
    const name = tags.find(Boolean) || item.repository || item.Repository || item.image || item.Image || item.name || item.Name || item.id || item.ID;

    return [{
      name: String(name),
      sizeBytes: item.sizeBytes ?? item.SizeBytes ?? item.size ?? item.Size,
      created: item.created ?? item.Created
    }];
  }).filter((image, index, list) => image.name && list.findIndex((entry) => entry.name === image.name) === index);
}

function renderDockerImages(payload) {
  const images = extractDockerImages(payload);

  if (architectureState.imagesCount) {
    architectureState.imagesCount.textContent = images.length ? `${images.length} project image${images.length === 1 ? '' : 's'}` : 'No project images';
  }

  architectureState.images.innerHTML = '';

  if (images.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'image-empty';
    empty.textContent = 'No project images were returned by the Docker feed.';
    architectureState.images.append(empty);
    return;
  }

  for (const image of images) {
    const card = document.createElement('article');
    card.className = 'image-card';

    const name = document.createElement('div');
    name.className = 'image-name';
    name.textContent = image.name;

    const meta = document.createElement('div');
    meta.className = 'image-meta';

    const size = document.createElement('span');
    size.textContent = formatBytes(image.sizeBytes);

    const created = document.createElement('span');
    created.textContent = `Created ${formatDockerTime(image.created)}`;

    meta.append(size, created);
    card.append(name, meta);
    architectureState.images.append(card);
  }
}

function setLoading(isLoading) {
  architectureState.refresh.disabled = isLoading;
  architectureState.refresh.textContent = isLoading ? 'Refreshing...' : 'Refresh snapshot';
  architectureState.title.classList.toggle('is-loading', isLoading);
}

function renderArchitecture(payload, sourceLabel = 'Live') {
  currentArchitecturePayload = payload;
  const title = pickFirst(payload, ['title', 'name', 'service', 'system', 'application']) || 'Live architecture snapshot';
  const description = pickFirst(payload, ['description', 'summary', 'notes', 'detail']) || 'A current view of services, nodes, and release topology sourced from the host service.';
  const status = determineStatus(payload);
  const updated = pickFirst(payload, ['updatedAt', 'lastUpdated', 'syncedAt', 'timestamp']) || sourceLabel;

  architectureState.title.textContent = formatValue(title);
  architectureState.description.textContent = formatValue(description);
  architectureState.status.className = status.className;
  architectureState.status.textContent = status.label;
  architectureState.updated.textContent = formatValue(updated);

  renderFacts(payload);
  renderHighlights(payload);
  renderDiagram(payload);
  renderSystemStats(payload);
  renderDockerImages(payload);
  architectureState.raw.textContent = JSON.stringify(payload, null, 2);
}

function renderError(message) {
  architectureState.title.textContent = 'Architecture feed unavailable';
  architectureState.description.textContent = message;
  architectureState.status.className = 'status-pill is-error';
  architectureState.status.textContent = 'Error';
  architectureState.updated.textContent = 'Retry when the host service is ready';
  architectureState.facts.innerHTML = '';
  architectureState.highlights.innerHTML = '';
  architectureState.diagram.textContent = 'No live topology was returned.';
  if (architectureState.systemStats) {
    architectureState.systemStats.innerHTML = '';
  }
  if (architectureState.images) {
    architectureState.images.innerHTML = '';
  }
  if (architectureState.imagesCount) {
    architectureState.imagesCount.textContent = 'No project images';
  }
  architectureState.raw.textContent = JSON.stringify({ error: message }, null, 2);
}

function renderCommitFallback(message) {
  commitsState.status.textContent = 'Snapshot';
  commitsState.output.textContent = [
    '$ git log --oneline -n 5',
    `# ${message}`
  ].join('\n');
}

function formatCommitLine(commit) {
  const sha = commit.sha.slice(0, 7);
  const message = commit.commit?.message?.split('\n')[0] || 'No commit message';
  return `${sha} ${message}`;
}

async function loadGitHubCommits() {
  if (window.location.protocol === 'file:') {
    renderCommitFallback('Local preview mode');
    return;
  }

  commitsState.status.textContent = 'Live';

  try {
    const response = await fetch(`https://api.github.com/repos/${githubRepo.owner}/${githubRepo.repo}/commits?per_page=5&sha=${githubRepo.branch}`, {
      headers: {
        Accept: 'application/vnd.github+json'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const commits = await response.json();
    if (!Array.isArray(commits) || commits.length === 0) {
      throw new Error('No commits returned');
    }

    commitsState.output.textContent = [
      '$ git log --oneline -n 5',
      ...commits.map(formatCommitLine)
    ].join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load recent commits';
    renderCommitFallback(`${message}. Showing local repo history snapshot.`);
  }
}

async function loadArchitecture(force = false) {
  if (force && currentArchitecturePayload) {
    setLoading(true);
  } else if (!currentArchitecturePayload) {
    architectureState.status.textContent = 'Loading';
  }

  try {
    architectureState.description.textContent = 'Fetching the current system shape from the host service.';
    const response = await fetch(`${architectureUrl}${architectureUrl.includes('?') ? '&' : '?'}t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`Architecture service returned ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : { raw: await response.text(), title: 'Architecture feed', description: 'Non-JSON payload received from the host service.' };

    renderArchitecture(payload, 'Updated just now');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load the architecture feed.';
    renderError(message);
  } finally {
    setLoading(false);
  }
}

async function loadCmsContent() {
  try {
    const response = await fetch(`${cmsUrl}${cmsUrl.includes('?') ? '&' : '?'}t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`CMS API returned ${response.status}`);
    }

    const payload = await response.json();
    renderCmsContent(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load CMS content.';
    console.warn(message);
  }
}
