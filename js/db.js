// ── db.js — IndexedDB layer ───────────────────────────────────────────────────
// Meta DB   : 'feed-manager-meta'  stores: projects, saved_filters
// Project DB: 'feed-{id}'          store:  items  (only for files < idbSizeLimit)

const META_DB_NAME = 'feed-manager-meta';
let _metaDB = null;
const _projectDBs = {};

// ── helpers ───────────────────────────────────────────────────────────────────

function _openDB(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = e => upgrade(e.target.result);
    req.onsuccess       = e => resolve(e.target.result);
    req.onerror         = e => reject(e.target.error);
  });
}

// ── meta DB init ──────────────────────────────────────────────────────────────

async function initMetaDB() {
  _metaDB = await _openDB(META_DB_NAME, 1, db => {
    if (!db.objectStoreNames.contains('projects')) {
      db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
    }
    if (!db.objectStoreNames.contains('saved_filters')) {
      const s = db.createObjectStore('saved_filters', { keyPath: 'id', autoIncrement: true });
      s.createIndex('projectId', 'projectId');
    }
  });
}

function _genId() {
  return Math.random().toString(36).slice(2, 10);
}

// ── projects ──────────────────────────────────────────────────────────────────

async function getProjects() {
  return new Promise((resolve, reject) => {
    const req = _metaDB.transaction('projects').objectStore('projects').getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function saveProject(project) {
  if (!project.id) project.id = _genId();
  return new Promise((resolve, reject) => {
    const tx = _metaDB.transaction('projects', 'readwrite');
    const r  = tx.objectStore('projects').put(project);
    r.onsuccess = e => resolve(e.target.result);
    r.onerror   = e => reject(e.target.error);
  });
}

async function deleteProject(id) {
  // Step 1: delete project entry
  await new Promise((resolve, reject) => {
    const tx = _metaDB.transaction('projects', 'readwrite');
    const r  = tx.objectStore('projects').delete(id);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
    r.onerror     = e => reject(e.target.error);
  });
  // Step 2: delete associated saved filters
  await new Promise((resolve, reject) => {
    const tx  = _metaDB.transaction('saved_filters', 'readwrite');
    const req = tx.objectStore('saved_filters').index('projectId').openCursor(id);
    req.onsuccess = e => {
      const c = e.target.result;
      if (c) { c.delete(); c.continue(); }
    };
    req.onerror   = e => reject(e.target.error);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
  // Step 3: delete per-project items DB if it exists
  delete _projectDBs[id];
  await new Promise(resolve => {
    const r = indexedDB.deleteDatabase('feed-' + id);
    r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve;
  });
}

async function deleteAllData() {
  const projects = await getProjects();
  await new Promise((resolve, reject) => {
    const tx = _metaDB.transaction(['projects', 'saved_filters'], 'readwrite');
    tx.objectStore('projects').clear();
    tx.objectStore('saved_filters').clear();
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
  for (const p of projects) {
    delete _projectDBs[p.id];
    await new Promise(resolve => {
      const r = indexedDB.deleteDatabase('feed-' + p.id);
      r.onsuccess = resolve; r.onerror = resolve; r.onblocked = resolve;
    });
  }
}

// ── project items DB ──────────────────────────────────────────────────────────

async function _getProjectDB(projectId) {
  if (_projectDBs[projectId]) return _projectDBs[projectId];
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('feed-' + projectId, 1);
    req.onupgradeneeded = e => {
      if (!e.target.result.objectStoreNames.contains('items'))
        e.target.result.createObjectStore('items', { keyPath: '_id', autoIncrement: true });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
  _projectDBs[projectId] = db;
  return db;
}

async function clearProjectItems(projectId) {
  const db = await _getProjectDB(projectId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('items', 'readwrite');
    tx.objectStore('items').clear();
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function insertItems(projectId, items) {
  const db = await _getProjectDB(projectId);
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('items', 'readwrite');
    const store = tx.objectStore('items');
    items.forEach(item => store.put(item));
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function filterItems(projectId, filterFn, onProgress, signal) {
  const db = await _getProjectDB(projectId);
  return new Promise((resolve, reject) => {
    const results = []; let scanned = 0;
    const tx  = db.transaction('items');
    const req = tx.objectStore('items').openCursor();
    req.onsuccess = e => {
      if (signal?.cancelled) { resolve(results); return; }
      const cursor = e.target.result;
      if (!cursor) { resolve(results); return; }
      scanned++;
      if (filterFn(cursor.value)) results.push(cursor.value);
      if (onProgress && scanned % 5000 === 0) onProgress(scanned);
      cursor.continue();
    };
    req.onerror = e => reject(e.target.error);
  });
}

// Single cursor pass counting matches for several filters at once (per-branch counts).
async function countByFilters(projectId, filterFns, onProgress, signal) {
  const db = await _getProjectDB(projectId);
  return new Promise((resolve, reject) => {
    const counts = new Array(filterFns.length).fill(0);
    let scanned = 0;
    const tx  = db.transaction('items');
    const req = tx.objectStore('items').openCursor();
    req.onsuccess = e => {
      if (signal?.cancelled) { resolve(counts); return; }
      const cursor = e.target.result;
      if (!cursor) { resolve(counts); return; }
      scanned++;
      const item = cursor.value;
      for (let i = 0; i < filterFns.length; i++) if (filterFns[i](item)) counts[i]++;
      if (onProgress && scanned % 5000 === 0) onProgress(scanned);
      cursor.continue();
    };
    req.onerror = e => reject(e.target.error);
  });
}

async function getFirstItems(projectId, limit) {
  const db = await _getProjectDB(projectId);
  return new Promise((resolve, reject) => {
    const results = [];
    const tx  = db.transaction('items');
    const req = tx.objectStore('items').openCursor();
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor || results.length >= limit) { resolve(results); return; }
      results.push(cursor.value);
      cursor.continue();
    };
    req.onerror = e => reject(e.target.error);
  });
}

// ── saved filters ─────────────────────────────────────────────────────────────

async function getSavedFilters(projectId) {
  return new Promise((resolve, reject) => {
    const tx  = _metaDB.transaction('saved_filters');
    const req = tx.objectStore('saved_filters').index('projectId').getAll(projectId);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function saveFilter(filterObj) {
  return new Promise((resolve, reject) => {
    const tx = _metaDB.transaction('saved_filters', 'readwrite');
    const r  = tx.objectStore('saved_filters').put(filterObj);
    r.onsuccess = e => resolve(e.target.result);
    r.onerror   = e => reject(e.target.error);
  });
}

async function deleteSavedFilter(id) {
  return new Promise((resolve, reject) => {
    const tx = _metaDB.transaction('saved_filters', 'readwrite');
    const r  = tx.objectStore('saved_filters').delete(id);
    r.onsuccess = () => resolve();
    r.onerror   = e => reject(e.target.error);
  });
}
