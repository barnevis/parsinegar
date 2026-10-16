// Shared in-memory storage fake for sync plugin tests: plain records
// keyed by id (or key), structured clones across the boundary.
export function memoryStorage(initial = {}) {
  const data = new Map();
  for (const [collection, records] of Object.entries(initial)) {
    data.set(collection, new Map((records ?? []).map((record) => [record.id ?? record.key, structuredClone(record)])));
  }
  const keyOf = (record) => record.id ?? record.key;
  return {
    async read(collection, key) {
      return structuredClone(data.get(collection)?.get(key) ?? null);
    },
    async write(collection, record) {
      if (!data.has(collection)) {
        data.set(collection, new Map());
      }
      data.get(collection).set(keyOf(record), structuredClone(record));
      return structuredClone(record);
    },
    async delete(collection, key) {
      data.get(collection)?.delete(key);
    },
    async query(collection) {
      return [...(data.get(collection)?.values() ?? [])].map((record) => structuredClone(record));
    },
  };
}
