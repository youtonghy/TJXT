import { mkdir } from 'fs/promises'
import path from 'path'
import { safeStorage } from 'electron'
import { dataDir } from './dirs'

type StoredValue = {
  value: string
  encrypted: boolean
}

type StoreFile = {
  version: 1
  values: Record<string, StoredValue>
}

const STORE_VERSION: StoreFile['version'] = 1
const storePath = path.join(dataDir(), 'secure-store.json')
let storeCache: StoreFile | null = null
let storeLoading: Promise<StoreFile> | null = null

async function loadStore(): Promise<StoreFile> {
  if (storeCache) return storeCache
  if (storeLoading) return storeLoading

  storeLoading = (async () => {
    try {
      const { readFile } = await import('fs/promises')
      const raw = await readFile(storePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<StoreFile> | null
      if (parsed?.values && typeof parsed.values === 'object') {
        return { version: STORE_VERSION, values: parsed.values }
      }
    } catch {}
    return { version: STORE_VERSION, values: {} }
  })()

  storeCache = await storeLoading
  storeLoading = null
  return storeCache
}

async function persistStore(store: StoreFile): Promise<void> {
  storeCache = store
  await mkdir(dataDir(), { recursive: true })
  const { writeFile } = await import('fs/promises')
  await writeFile(storePath, JSON.stringify(store, null, 2), 'utf-8')
}

function encryptValue(value: string): StoredValue {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(value)
    return { value: encrypted.toString('base64'), encrypted: true }
  }
  return { value, encrypted: false }
}

function decryptValue(entry: StoredValue): string | null {
  if (!entry.encrypted) {
    return entry.value
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return null
  }
  try {
    const buffer = Buffer.from(entry.value, 'base64')
    return safeStorage.decryptString(buffer)
  } catch {
    return null
  }
}

export function isSecureStoreAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export async function secureStoreGet(key: string): Promise<string | null> {
  const store = await loadStore()
  const entry = store.values[key]
  if (!entry) return null
  return decryptValue(entry)
}

export async function secureStoreSet(key: string, value: string): Promise<void> {
  const store = await loadStore()
  store.values[key] = encryptValue(value)
  await persistStore(store)
}

export async function secureStoreDelete(key: string): Promise<void> {
  const store = await loadStore()
  if (key in store.values) {
    delete store.values[key]
    await persistStore(store)
  }
}
