const architectureUrl = document.body.dataset.architectureUrl || document.querySelector('meta[name="architecture-api"]')?.content || '/api/architecture';

const architectureState = {
  title: document.getElementById('architecture-title'),
  status: document.getElementById('architecture-status'),
  description: document.getElementById('architecture-description'),
  facts: document.getElementById('architecture-facts'),
  highlights: document.getElementById('architecture-highlights'),
  diagram: document.getElementById('architecture-diagram'),
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

const localCommitSnapshot = [
  'e51912d Update info on page and pull live github commits',
  '9b37ee7 compose file updates, docker security',
  '0ec63e5 Update README.md',
  'c29898f initial commit'
];

let currentArchitecturePayload = null;

const demoArchitecturePayload = {
  title: 'Preview architecture snapshot',
  description: 'This local preview is shown because the page is opened from file://. Serve the site over HTTP to pull live data from the host Go service.',
  status: 'preview',
  environment: 'local',
  region: 'preview-region-1',
  cluster: 'portfolio-cluster',
  updatedAt: 'Preview only',
  services: [
    { name: 'portfolio-web' },
    { name: 'architecture-api' },
    { name: 'observability-gateway' },
    { name: 'deploy-controller' }
  ],
  docker: {
    images: [
      { repoTags: ['ghcr.io/tekkifox/rossmoney_me:latest'], sizeBytes: 148723456, created: 1757420000 },
      { repoTags: ['ghcr.io/tekkifox/rossmoney_me-proxy:latest'], sizeBytes: 27188032, created: 1757420300 },
      { repoTags: ['ghcr.io/tekkifox/archview:latest'], sizeBytes: 63200448, created: 1757420500 },
      { repoTags: ['lscr.io/linuxserver/socket-proxy:latest'], sizeBytes: 19845120, created: 1757420600 }
    ]
  },
  nodes: ['edge-node-a', 'edge-node-b', 'batch-worker-01'],
  regions: ['preview-region-1', 'preview-region-2'],
  pipelines: ['commit', 'scan', 'deploy', 'verify'],
  diagram: [
    'browser',
    '  -> portfolio site',
    '     -> /api/architecture',
    '        -> host Go service'
  ].join('\n')
};

architectureState.refresh.addEventListener('click', () => {
  void loadArchitecture(true);
});

void loadArchitecture();
void loadGitHubCommits();

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

function buildHighlights(payload) {
  const serviceList = normalizeList(pickFirst(payload, ['services', 'components', 'apps']));
  const regionList = normalizeList(pickFirst(payload, ['regions', 'availabilityZones', 'zones']));
  const pipelineList = normalizeList(pickFirst(payload, ['pipelines', 'deployments', 'routes']));

  return [
    {
      label: 'Services',
      value: serviceList.length ? serviceList.slice(0, 6) : ['Waiting on feed']
    },
    {
      label: 'Regions',
      value: regionList.length ? regionList.slice(0, 6) : ['Unknown']
    },
    {
      label: 'Delivery',
      value: pipelineList.length ? pipelineList.slice(0, 6) : ['No pipeline data']
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
    `# ${message}`,
    ...localCommitSnapshot
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
    if (window.location.protocol === 'file:') {
      renderArchitecture(demoArchitecturePayload, 'Preview only');
      architectureState.updated.textContent = 'Open over HTTP for live data';
      return;
    }

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
