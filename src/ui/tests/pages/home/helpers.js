// Shared test helpers for the home page suite.
//
// One mount/settle/service-stub toolkit for every co-located test file:
// children are asserted through their public surface (shadow content and
// bubbled CustomEvents), documents and settings come as in-memory service
// doubles, and mounting always waits a full settled frame.
import { TAG } from '../../../pages/home/home.js';
import catalog from '../../../i18n/catalog.js';

export function createEvents() {
  return {
    subscribe: () => () => {},
    publish: () => ({ success: true }),
  };
}

export function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function nextFrame() {
  await new Promise((resolve) => globalThis.requestAnimationFrame(() => resolve()));
}

export async function settled() {
  await flush();
  await nextFrame();
  await flush();
}

export function translate(key, params) {
  const template = catalog.fa[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => params?.[name] ?? `{${name}}`);
}

export const ASSET_BASE_URL = 'http://localhost/assets/';

export function baseRefs(extra = {}) {
  return { t: translate, assetBaseUrl: ASSET_BASE_URL, events: createEvents(), ...extra };
}

export function child(home, tag) {
  return home.shadowRoot.querySelector(tag);
}

export function inChild(home, tag, selector) {
  return child(home, tag)?.shadowRoot?.querySelector(selector) ?? null;
}

export function inChildAll(home, tag, selector) {
  return [...(child(home, tag)?.shadowRoot?.querySelectorAll(selector) ?? [])];
}

export function createDocuments(initial = []) {
  const docs = new Map(initial.map((document) => [document.id, { ...document }]));
  const folders = new Map();
  let counter = docs.size;
  let folderCounter = 0;
  const service = {
    calls: [],
    async listDocuments() {
      return [...docs.values()].sort((left, right) => right.updatedAt - left.updatedAt);
    },
    async listFolders() {
      return [...folders.values()];
    },
    async openDocument(id) {
      return docs.get(id) ?? null;
    },
    async saveDocument(input = {}) {
      const record = {
        id: input.id ?? `generated-${++counter}`,
        title: input.title ?? 't',
        content: input.content ?? '',
        folderId: input.folderId ?? null,
        updatedAt: Date.now(),
      };
      docs.set(record.id, record);
      service.calls.push(['save', record]);
      return record;
    },
    async createDocument(title, folderId = null) {
      return service.saveDocument({ title, content: '', folderId });
    },
    async setReadOnly(id, readOnly) {
      const record = docs.get(id) ?? null;
      if (!record) {
        return null;
      }
      const updated = { ...record, readOnly: readOnly === true, updatedAt: Date.now() };
      docs.set(id, updated);
      service.calls.push(['lock', { id, readOnly: updated.readOnly }]);
      return updated;
    },
    async createFolder(name, parentId = null) {
      const folder = { id: `folder-${++folderCounter}`, name, parentId: parentId ?? null, createdAt: Date.now() };
      folders.set(folder.id, folder);
      return folder;
    },
    async renameFolder(id, name) {
      const folder = folders.get(id) ?? null;
      if (!folder) {
        return null;
      }
      const renamed = { ...folder, name };
      folders.set(id, renamed);
      return renamed;
    },
    async deleteFolder(id) {
      folders.delete(id);
      for (const [docId, record] of docs) {
        if ((record.folderId ?? null) === id) {
          docs.delete(docId);
        }
      }
    },
    async moveDocument(id, folderId = null) {
      const record = docs.get(id) ?? null;
      if (!record) {
        return null;
      }
      const updated = { ...record, folderId: folderId ?? null, updatedAt: Date.now() };
      docs.set(id, updated);
      return updated;
    },
    async renameDocument(id, title) {
      const record = docs.get(id) ?? null;
      if (!record) {
        return null;
      }
      const duplicate = [...docs.values()].some((item) => item.title === title && item.id !== id);
      if (duplicate) {
        throw Object.assign(new Error('taken'), { code: 'DOCUMENT_TITLE_DUPLICATE' });
      }
      const renamed = { ...record, title, updatedAt: Date.now() };
      docs.set(id, renamed);
      service.calls.push(['rename', { id, title }]);
      return renamed;
    },
    async deleteDocument(id) {
      docs.delete(id);
      service.calls.push(['delete', id]);
    },
  };
  return service;
}

export async function mountWithDocuments(documents, extraServices = {}) {
  const element = document.createElement(TAG);
  element.connect({
    infrastructure: { events: createEvents() },
    refs: { t: translate, assetBaseUrl: ASSET_BASE_URL, events: createEvents(), services: { 'parsinegar.documents.service': documents, ...extraServices } },
  });
  document.body.append(element);
  await settled();
  return element;
}

export async function deleteViaMenu(element, id) {
  inChild(element, 'parsi-side-panel', `[data-doc-menu="${id}"]`).click();
  await settled();
  inChild(element, 'parsi-side-panel', `[data-file-delete="${id}"]`).click();
  await settled();
}

export function createSettings(initial = { theme: 'device', direction: 'auto', fontSize: 16 }) {
  let current = { ...initial };
  const service = {
    calls: [],
    async getSettings() {
      return { ...current };
    },
    async saveSettings(patch = {}) {
      current = { ...current, ...patch };
      service.calls.push({ ...patch });
      return { ...current };
    },
  };
  return service;
}

export async function mountWithSettings(documents, settings, extraServices = {}) {
  const element = document.createElement(TAG);
  element.connect({
    infrastructure: { events: createEvents() },
    refs: {
      t: translate,
      assetBaseUrl: ASSET_BASE_URL,
      events: createEvents(),
      services: {
        'parsinegar.documents.service': documents,
        'parsinegar.settings.service': settings,
        ...extraServices,
      },
    },
  });
  document.body.append(element);
  await settled();
  return element;
}
