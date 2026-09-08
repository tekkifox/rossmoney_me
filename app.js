const architectureUrl = document.body.dataset.architectureUrl || document.querySelector('meta[name="architecture-api"]')?.content || '/api/architecture';

const architectureState = {
  title: document.getElementById('architecture-title'),
  status: document.getElementById('architecture-status'),
  description: document.getElementById('architecture-description'),
  facts: document.getElementById('architecture-facts'),
  highlights: document.getElementById('architecture-highlights'),
  diagram: document.getElementById('architecture-diagram'),
  raw: document.getElementById('architecture-raw'),
  updated: document.getElementById('architecture-updated'),
  refresh: document.getElementById('refresh-architecture')
};

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
  return [
    ['Environment', pickFirst(payload, ['environment', 'env', 'stage'])],
    ['Region', pickFirst(payload, ['region', 'primaryRegion', 'zone'])],
    ['Cluster', pickFirst(payload, ['cluster', 'clusterName', 'namespace'])],
    ['Updated', pickFirst(payload, ['updatedAt', 'lastUpdated', 'syncedAt', 'timestamp'])],
    ['Services', normalizeList(pickFirst(payload, ['services', 'components', 'apps'])).length || pickFirst(payload, ['servicesCount'])],
    ['Nodes', normalizeList(pickFirst(payload, ['nodes', 'hosts', 'instances'])).length || pickFirst(payload, ['nodeCount'])]
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
  architectureState.raw.textContent = JSON.stringify({ error: message }, null, 2);
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