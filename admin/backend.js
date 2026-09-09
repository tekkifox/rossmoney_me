(function () {
  const DEFAULT_API_ROOT = '/api/cms';

  function cleanPath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '');
  }

  function withoutExtension(path) {
    return path.replace(/\.[^.]+$/, '');
  }

  function slugFromPath(path) {
    const clean = cleanPath(path);
    const parts = clean.split('/');
    return withoutExtension(parts[parts.length - 1] || clean);
  }

  function collectionFromPath(path, folders) {
    const clean = cleanPath(path);
    let match = null;
    for (const [collection, folder] of folders.entries()) {
      const normalizedFolder = cleanPath(folder);
      if (clean === normalizedFolder || clean.startsWith(`${normalizedFolder}/`)) {
        if (!match || normalizedFolder.length > match.folder.length) {
          match = { collection, folder: normalizedFolder };
        }
      }
    }
    return match;
  }

  function jsonHeaders() {
    return { 'Content-Type': 'application/json' };
  }

  function extractDocData(doc) {
    if (!doc) {
      return {};
    }

    if (doc.data && typeof doc.data === 'object') {
      return doc.data;
    }

    const data = {};
    for (const [key, value] of Object.entries(doc)) {
      if (key === 'id' || key === 'slug' || key === 'collection' || key === 'updatedAt') {
        continue;
      }
      data[key] = value;
    }
    return data;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      headers: jsonHeaders(),
      ...options,
    });
    if (!response.ok) {
      throw new Error(`CMS API returned ${response.status}`);
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  class MongoBackend {
    constructor(config) {
      this.apiRoot = String(config?.backend?.api_root || DEFAULT_API_ROOT).replace(/\/$/, '') || DEFAULT_API_ROOT;
      this.mediaFolder = config?.media_folder || '';
      this.collectionFolders = new Map();
      for (const collection of config?.collections || []) {
        if (collection.folder) {
          this.collectionFolders.set(collection.name, collection.folder);
        }
        if (collection.files) {
          const firstFile = collection.files[0]?.file || collection.files[0]?.path || '';
          const folder = cleanPath(firstFile).split('/').slice(0, -1).join('/');
          this.collectionFolders.set(collection.name, folder || collection.name);
        }
      }
    }

    isGitBackend() {
      return false;
    }

    status() {
      return Promise.resolve({ auth: { status: true }, api: { status: true, statusPage: '' } });
    }

    authComponent() {
      return function MongoAuth() {
        return null;
      };
    }

    restoreUser() {
      return this.authenticate();
    }

    authenticate() {
      return Promise.resolve({ name: 'Mongo CMS' });
    }

    logout() {
      return null;
    }

    getToken() {
      return Promise.resolve('');
    }

    async entriesByFolder(folder, extension) {
      const collectionEntry = collectionFromPath(folder, this.collectionFolders);
      if (!collectionEntry) {
        return [];
      }

      const docs = await fetchJson(`${this.apiRoot}/collections/${collectionEntry.collection}`);
      return docs.map((doc) => ({
        file: { path: `${collectionEntry.folder}/${doc.slug}.${extension || 'json'}`, id: `${collectionEntry.collection}/${doc.slug}` },
        data: JSON.stringify(extractDocData(doc), null, 2),
      }));
    }

    async entriesByFiles(files) {
      return Promise.all(files.map(async (file) => {
        const entry = collectionFromPath(file.path, this.collectionFolders);
        if (!entry) {
          return { file, data: '{}' };
        }
        const slug = slugFromPath(file.path);
        const doc = await fetchJson(`${this.apiRoot}/collections/${entry.collection}/${slug}`);
        return {
          file,
          data: JSON.stringify(extractDocData(doc), null, 2),
        };
      }));
    }

    async getEntry(path) {
      const entry = collectionFromPath(path, this.collectionFolders);
      if (!entry) {
        throw new Error(`Unknown collection for ${path}`);
      }
      const slug = slugFromPath(path);
      const doc = await fetchJson(`${this.apiRoot}/collections/${entry.collection}/${slug}`);
      return {
        file: { path, id: `${entry.collection}/${slug}` },
        data: JSON.stringify(extractDocData(doc), null, 2),
      };
    }

    async persistEntry(entry, options) {
      const collection = options.collectionName;
      const dataFile = entry.dataFiles[0];
      const slug = dataFile.slug || slugFromPath(dataFile.path || options.path || 'entry');
      const raw = dataFile.raw ?? dataFile.data ?? '{}';
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;

      await fetchJson(`${this.apiRoot}/collections/${collection}/${slug}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      return Promise.resolve();
    }

    async deleteFiles(paths) {
      await Promise.all(paths.map(async (path) => {
        const entry = collectionFromPath(path, this.collectionFolders);
        if (!entry) {
          return;
        }
        const slug = slugFromPath(path);
        await fetchJson(`${this.apiRoot}/collections/${entry.collection}/${slug}`, { method: 'DELETE' });
      }));
      return Promise.resolve();
    }

    getMedia() {
      return Promise.resolve([]);
    }

    persistMedia() {
      return Promise.resolve(null);
    }

    deleteMedia() {
      return Promise.resolve();
    }

    async getMediaFile(path) {
      return { id: path, displayURL: path, path, name: path.split('/').pop() || path, size: 0, url: path };
    }

    getNotes() {
      return Promise.resolve([]);
    }

    addNote() {
      return Promise.resolve(null);
    }

    updateNote() {
      return Promise.resolve(null);
    }

    deleteNote() {
      return Promise.resolve();
    }

    toggleNoteResolution() {
      return Promise.resolve(null);
    }

    getDeployPreview() {
      return Promise.resolve(null);
    }
  }

  if (window.CMS) {
    window.CMS.registerBackend('mongo', MongoBackend);
  }
})();
