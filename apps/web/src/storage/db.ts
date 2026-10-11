/**
 * The IndexedDB side of autosave: where the project JSON actually lands.
 *
 * IndexedDB rather than localStorage because localStorage is synchronous (it blocks the main thread,
 * which costs frames during a drag), capped at a few megabytes, and strings only — a project with
 * thousands of clips would have to be serialised by hand on every save.
 *
 * Browser-only: this does not run under Vitest's Node environment, so it has no unit tests. The logic
 * worth testing — debouncing and validating what comes back — lives in `autosave.ts` and `restore.ts`
 * behind injected functions, which is why those two are covered and this is not.
 */

import type { Project } from '../editor/types'
import { parseStoredProject } from './restore'

const DB_NAME = 'mini-cut'
const DB_VERSION = 1
const STORE = 'projects'

/** Single-project build; M8 can turn this into a real project list. */
export const CURRENT_PROJECT_ID = 'current'

type StoredRow = { id: string; project: Project; savedAt: number }

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    // Another tab is holding an older version open; it will resolve once that tab closes.
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'))
  })
}

/**
 * Write the project, replacing whatever was there.
 *
 * Last write wins, which is why `autosave.ts` serialises its writes: two overlapping transactions
 * could otherwise land out of order and leave an older project stored.
 */
export async function saveProject(project: Project, id = CURRENT_PROJECT_ID): Promise<void> {
  const db = await openDatabase()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const row: StoredRow = { id, project, savedAt: Date.now() }
    tx.objectStore(STORE).put(row)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('save aborted'))
    })
  } finally {
    db.close()
  }
}

/**
 * Read the project back, or `null` when nothing is stored.
 *
 * Throws `RestoreError` when the row exists but is not a project this build can read — see
 * `restore.ts` for why a newer save is reported rather than silently discarded.
 */
export async function loadProject(id = CURRENT_PROJECT_ID): Promise<Project | null> {
  const db = await openDatabase()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const row = await request<StoredRow | undefined>(tx.objectStore(STORE).get(id))
    if (!row) return null
    return parseStoredProject(row.project)
  } finally {
    db.close()
  }
}

/** Remove the stored project. Used when the user discards an unreadable save. */
export async function clearProject(id = CURRENT_PROJECT_ID): Promise<void> {
  const db = await openDatabase()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/**
 * Ask the browser not to evict this origin's storage under pressure.
 *
 * Without it, OPFS media and the saved project are "best effort" and can be cleared when the device
 * runs low — which for a 2 GB import is exactly when it is most likely to happen. Returns whether the
 * grant was given; browsers may decide on their own, so this is a request, not a guarantee.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  return navigator.storage.persist()
}
