// Minimal IndexedDB key/value store for lab sessions. Weights are large
// typed arrays, which IndexedDB stores natively (localStorage can't).
const DB = 'rig-lab'
const STORE = 'sessions'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function run(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.oncomplete = () => { db.close(); resolve(req?.result) }
        tx.onerror = () => { db.close(); reject(tx.error) }
      }),
  )
}

export const idbGet = (key) => run('readonly', (s) => s.get(key))
export const idbPut = (key, value) => run('readwrite', (s) => s.put(value, key))
export const idbDelete = (key) => run('readwrite', (s) => s.delete(key))
