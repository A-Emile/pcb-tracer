
export function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('pcbtracer', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('projects', { keyPath: 'id' });
      d.createObjectStore('files');
      d.createObjectStore('tiles');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export function idbGet(db, store, key) {
  return new Promise<any>((res, rej) => {
    const r = db.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export function idbPutMany(db, store, entries) {
  return new Promise<void>((res, rej) => {
    const tx = db.transaction(store, 'readwrite'), os = tx.objectStore(store);
    for (const [k, v] of entries) k === null ? os.put(v) : os.put(v, k);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Speichern abgebrochen'));
  });
}
