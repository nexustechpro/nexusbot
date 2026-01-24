// ============================================================================
// auth-state.js - File-First Auth with Intelligent MongoDB Backup
// Always uses file storage for speed, MongoDB syncs based on mode & health
// ============================================================================

import { WAProto as proto, initAuthCreds } from "@nexustechpro/baileys"
import { createComponentLogger } from "../../utils/logger.js"
import fs from "fs/promises"
import path from "path"

const logger = createComponentLogger("AUTH_STATE")
const globalCollectionRefs = new Map()
const preKeyDebounceTimers = new Map()
const syncQueue = new Map()

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  MONGODB_TIMEOUT: 5000,
  INITIAL_SYNC_DELAY: 2000,
  BACKUP_INTERVAL: 1 * 60 * 1000, // 1 minute
  PREKEY_WRITE_DEBOUNCE: 100,
  SYNC_BATCH_SIZE: 10,
  SYNC_BATCH_DELAY: 50,
  HEALTH_CHECK_INTERVAL: 30000, // Check MongoDB health every 30s
}

// ============================================================================
// BUFFER SERIALIZATION
// ============================================================================

const BufferJSON = {
  replacer: (k, value) => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === "Buffer") {
      return { type: "Buffer", data: Buffer.from(value?.data || value).toString("base64") }
    }
    return value
  },
  reviver: (_, value) => {
    if (typeof value === "object" && value && (value.buffer === true || value.type === "Buffer")) {
      const val = value.data || value.value
      return typeof val === "string" ? Buffer.from(val, "base64") : Buffer.from(val || [])
    }
    return value
  },
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const getStorageMode = () => (process.env.STORAGE_MODE || "file").toLowerCase()
const isMongoDBMode = () => getStorageMode() === "mongodb"
const isFileMode = () => getStorageMode() === "file"
const hasMongoDBUri = () => !!process.env.MONGODB_URI
const sanitizeFileName = (name) => name?.replace(/::/g, "__").replace(/:/g, "-").replace(/[/\\]/g, "_")
const isPreKeyFile = (name) => /^pre[-_]?key/i.test(name)

// ============================================================================
// FILE STORAGE CLASS
// ============================================================================

class FileStorage {
  constructor(sessionId, baseDir = "./sessions") {
    this.sessionId = sessionId
    this.dir = path.join(baseDir, sessionId)
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true })
  }

  async read(fileName) {
    try {
      const filePath = path.join(this.dir, sanitizeFileName(fileName))
      const content = await fs.readFile(filePath, "utf8")
      return content ? JSON.parse(content, BufferJSON.reviver) : null
    } catch {
      return null
    }
  }

  async write(fileName, data) {
    try {
      const filePath = path.join(this.dir, sanitizeFileName(fileName))
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, JSON.stringify(data, BufferJSON.replacer, 2), "utf8")
      return true
    } catch (error) {
      logger.error(`[${this.sessionId}] File write failed ${fileName}: ${error.message}`)
      return false
    }
  }

  async delete(fileName) {
    try {
      await fs.unlink(path.join(this.dir, sanitizeFileName(fileName)))
      return true
    } catch {
      return false
    }
  }

  async cleanup() {
    try {
      await fs.rm(this.dir, { recursive: true, force: true })
      return true
    } catch {
      return false
    }
  }

  async listFiles(filterFn = null) {
    try {
      const files = await fs.readdir(this.dir)
      const jsonFiles = files.filter((f) => f.endsWith(".json"))
      return filterFn ? jsonFiles.filter(filterFn) : jsonFiles
    } catch {
      return []
    }
  }

  async exists(fileName) {
    try {
      await fs.access(path.join(this.dir, sanitizeFileName(fileName)))
      return true
    } catch {
      return false
    }
  }
}

// ============================================================================
// MONGODB BACKGROUND SYNC CLASS WITH INTELLIGENT BACKUP
// ============================================================================

class MongoBackgroundSync {
  constructor(storage, sessionId, storageMode) {
    this.storage = storage
    this.sessionId = sessionId
    this.storageMode = storageMode
    this.syncInProgress = false
    this.pendingWrites = new Map()
    this.syncStats = { attempted: 0, succeeded: 0, failed: 0 }
    this.isHealthy = true
    this.lastHealthCheck = Date.now()
    this.consecutiveFailures = 0
    this.isPostgres = !storage.client // Detect if PostgreSQL (no MongoDB client)
    
    // Start periodic health monitoring
    this._startHealthMonitoring()
  }

  get isConnected() {
    return this.storage?.isConnected
  }

  _startHealthMonitoring() {
    this.healthTimer = setInterval(() => {
      this._checkHealth()
    }, CONFIG.HEALTH_CHECK_INTERVAL)
  }

  async _checkHealth() {
    if (!this.isConnected) {
      if (this.isHealthy) {
        logger.warn(`[${this.sessionId}] ${this.isPostgres ? 'PostgreSQL' : 'MongoDB'} marked as unhealthy - not connected`)
      }
      this.isHealthy = false
      return
    }

    try {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("health check timeout")), 5000)
      )
      
      // Different health check for PostgreSQL vs MongoDB
      if (this.isPostgres) {
        await Promise.race([
          this.storage.pool.query('SELECT 1 as test'),
          timeout
        ])
      } else {
        await Promise.race([
          this.storage.client?.db("admin").command({ ping: 1 }),
          timeout
        ])
      }
      
      if (!this.isHealthy) {
        logger.info(`[${this.sessionId}] ${this.isPostgres ? 'PostgreSQL' : 'MongoDB'} connection restored`)
      }
      this.isHealthy = true
      this.consecutiveFailures = 0
      this.lastHealthCheck = Date.now()
    } catch (error) {
      this.consecutiveFailures++
      
      if (this.consecutiveFailures >= 3 && this.isHealthy) {
        logger.warn(`[${this.sessionId}] ${this.isPostgres ? 'PostgreSQL' : 'MongoDB'} marked as unhealthy after ${this.consecutiveFailures} failures`)
        this.isHealthy = false
      }
    }
  }

  // Determine what should be backed up based on mode and health
  shouldBackupFile(fileName) {
    const isPreKey = isPreKeyFile(fileName)
    const isCreds = fileName === "creds.json"
    
    // MongoDB mode: backup everything regardless of health
    if (isMongoDBMode()) {
      return true
    }
    
    // File mode with healthy storage: backup everything
    if (isFileMode() && this.isHealthy) {
      return true
    }
    
    // File mode with unhealthy storage: only backup creds.json
    if (isFileMode() && !this.isHealthy) {
      if (isPreKey) {
        return false // Skip pre-keys when unhealthy
      }
      return isCreds || !isPreKey // Backup creds and non-prekey files
    }
    
    return false
  }

  // Fire-and-forget write with intelligent backup logic
  fireWrite(fileName, data) {
    if (!this.isConnected) return

    // Check if we should backup this file
    if (!this.shouldBackupFile(fileName)) {
      if (isPreKeyFile(fileName)) {
        logger.debug(`[${this.sessionId}] Skipping pre-key backup (unhealthy ${this.isPostgres ? 'PostgreSQL' : 'MongoDB'} in file mode)`)
      }
      return
    }

    // Queue the write
    this.pendingWrites.set(fileName, data)

    // Process queue asynchronously
    setImmediate(() => this._processQueue())
  }

  async _processQueue() {
    if (this.syncInProgress || this.pendingWrites.size === 0) return
    if (!this.isConnected) return

    this.syncInProgress = true

    try {
      const entries = Array.from(this.pendingWrites.entries())
      this.pendingWrites.clear()

      // Filter entries based on backup policy
      const entriesToSync = entries.filter(([fileName]) => this.shouldBackupFile(fileName))
      
      if (entriesToSync.length === 0) {
        return
      }

      // Process in batches
      for (let i = 0; i < entriesToSync.length; i += CONFIG.SYNC_BATCH_SIZE) {
        const batch = entriesToSync.slice(i, i + CONFIG.SYNC_BATCH_SIZE)
        
        await Promise.allSettled(
          batch.map(([fileName, data]) => 
            this._safeWrite(fileName, data)
          )
        )

        if (i + CONFIG.SYNC_BATCH_SIZE < entriesToSync.length) {
          await new Promise(r => setTimeout(r, CONFIG.SYNC_BATCH_DELAY))
        }
      }
      
      // Log sync stats periodically
      if (this.syncStats.attempted > 0 && this.syncStats.attempted % 20 === 0) {
        const healthStatus = this.isHealthy ? "healthy" : "unhealthy"
        const storageType = this.isPostgres ? 'PostgreSQL' : 'MongoDB'
        logger.info(`[${this.sessionId}] ${storageType} sync (${healthStatus}): ${this.syncStats.succeeded}/${this.syncStats.attempted} succeeded`)
      }
    } catch (error) {
      logger.debug(`[${this.sessionId}] Background sync error: ${error.message}`)
    } finally {
      this.syncInProgress = false
      
      if (this.pendingWrites.size > 0) {
        setImmediate(() => this._processQueue())
      }
    }
  }

  async _safeWrite(fileName, data) {
    this.syncStats.attempted++
    try {
      const json = JSON.stringify(data, BufferJSON.replacer)
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT)
      )
      
      await Promise.race([
        this.storage.writeAuthData(this.sessionId, fileName, json),
        timeout
      ])
      
      this.syncStats.succeeded++
      logger.debug(`[${this.sessionId}] ✅ ${this.isPostgres ? 'PostgreSQL' : 'MongoDB'} synced: ${fileName}`)
    } catch (error) {
      this.syncStats.failed++
      this.consecutiveFailures++
      
      // Update health status on write failures
      if (this.consecutiveFailures >= 5) {
        this.isHealthy = false
      }
      
      logger.debug(`[${this.sessionId}] ❌ ${this.isPostgres ? 'PostgreSQL' : 'MongoDB'} sync failed for ${fileName}: ${error.message}`)
    }
  }

  // Fire-and-forget delete
  fireDelete(fileName) {
    if (!this.isConnected) return

    setImmediate(async () => {
      try {
        const timeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT)
        )
        
        await Promise.race([
          this.storage.deleteAuthData(this.sessionId, fileName),
          timeout
        ])
        
        logger.debug(`[${this.sessionId}] ✅ ${this.isPostgres ? 'PostgreSQL' : 'MongoDB'} deleted: ${fileName}`)
      } catch (error) {
        logger.debug(`[${this.sessionId}] ${this.isPostgres ? 'PostgreSQL' : 'MongoDB'} delete failed for ${fileName}: ${error.message}`)
      }
    })
  }

  // Safe read with timeout - used only for initial sync
  async safeRead(fileName) {
    if (!this.isConnected) return null

    try {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT)
      )
      
      const data = await Promise.race([
        this.storage.readAuthData(this.sessionId, fileName),
        timeout
      ])
      
      return data ? JSON.parse(data, BufferJSON.reviver) : null
    } catch (error) {
      logger.debug(`[${this.sessionId}] ${this.isPostgres ? 'PostgreSQL' : 'MongoDB'} read failed for ${fileName}: ${error.message}`)
      return null
    }
  }

  // Safe list with timeout - used only for initial sync
  async safeList() {
    if (!this.isConnected) return []

    try {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("timeout")), CONFIG.MONGODB_TIMEOUT)
      )
      
      return await Promise.race([
        this.storage.getAllAuthFiles(this.sessionId),
        timeout
      ])
    } catch (error) {
      logger.debug(`[${this.sessionId}] ${this.isPostgres ? 'PostgreSQL' : 'MongoDB'} list failed: ${error.message}`)
      return []
    }
  }

  // Fire-and-forget cleanup
  fireCleanup() {
    if (!this.isConnected) return

    setImmediate(async () => {
      try {
        await this.storage.deleteAuthState(this.sessionId)
        logger.info(`[${this.sessionId}] ✅ ${this.isPostgres ? 'PostgreSQL' : 'MongoDB'} cleanup completed`)
      } catch (error) {
        logger.debug(`[${this.sessionId}] ${this.isPostgres ? 'PostgreSQL' : 'MongoDB'} cleanup failed: ${error.message}`)
      }
    })
  }

  cleanup() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }

  getStats() {
    return {
      ...this.syncStats,
      isHealthy: this.isHealthy,
      consecutiveFailures: this.consecutiveFailures,
      pendingWrites: this.pendingWrites.size,
      mode: this.storageMode,
      storageType: this.isPostgres ? 'PostgreSQL' : 'MongoDB',
    }
  }
}

// ============================================================================
// CREDENTIAL VALIDATION
// ============================================================================

const hasBasicKeys = (creds) => !!(creds?.noiseKey && creds?.signedIdentityKey)

const validateCredsForWrite = (creds, sessionId) => {
  const missing = []

  if (!creds?.noiseKey) missing.push("noiseKey")
  if (!creds?.signedIdentityKey) missing.push("signedIdentityKey")
  if (!creds?.me) missing.push("me")
  if (!creds?.account) missing.push("account")
  if (creds?.registered !== true) missing.push("registered")

  if (missing.length > 0) {
    logger.warn(`[${sessionId}] Incomplete creds.json - Missing: ${missing.join(", ")}`)
    return false
  }

  return true
}

// ============================================================================
// INITIAL MONGODB SYNC
// ============================================================================

const performInitialSync = async (fileStore, mongoSync, sessionId) => {
  try {
    logger.info(`[${sessionId}] Checking MongoDB for existing auth data...`)

    const mongoFiles = await mongoSync.safeList()
    
    if (!mongoFiles || mongoFiles.length === 0) {
      logger.info(`[${sessionId}] No MongoDB data found, using file storage`)
      return { synced: 0, total: 0 }
    }

    const fileFiles = await fileStore.listFiles()
    const hasFileData = fileFiles.length > 0

    if (hasFileData) {
      logger.info(`[${sessionId}] File storage has data, skipping MongoDB pull`)
      return { synced: 0, total: mongoFiles.length, skipped: true }
    }

    logger.info(`[${sessionId}] Pulling ${mongoFiles.length} files from MongoDB...`)

    let synced = 0
    for (let i = 0; i < mongoFiles.length; i += CONFIG.SYNC_BATCH_SIZE) {
      const batch = mongoFiles.slice(i, i + CONFIG.SYNC_BATCH_SIZE)
      
      const results = await Promise.allSettled(
        batch.map(async (fileName) => {
          const data = await mongoSync.safeRead(fileName)
          if (data && await fileStore.write(fileName, data)) {
            synced++
            return true
          }
          return false
        })
      )

      if (i + CONFIG.SYNC_BATCH_SIZE < mongoFiles.length) {
        await new Promise(r => setTimeout(r, CONFIG.SYNC_BATCH_DELAY))
      }
    }

    logger.info(`[${sessionId}] ✅ Synced ${synced}/${mongoFiles.length} files from MongoDB to file storage`)
    return { synced, total: mongoFiles.length }
  } catch (error) {
    logger.error(`[${sessionId}] Initial sync failed: ${error.message}`)
    return { synced: 0, total: 0, error: error.message }
  }
}

// ============================================================================
// MAIN AUTH STATE FUNCTION
// ============================================================================

export const useMongoDBAuthState = async (mongoStorage, sessionId, isPairing = false, source = "telegram") => {
  if (!sessionId?.startsWith("session_")) {
    throw new Error(`Invalid sessionId: ${sessionId}`)
  }

  const mode = getStorageMode()
  
  // ============================================================================
  // USE THE STORAGE PASSED IN (MongoDB or PostgreSQL)
  // ============================================================================
  
  let backupStorage = null
  let storageType = 'none'
  
  // First, check if the storage object passed in is actually connected
  if (mongoStorage?.isConnected) {
    backupStorage = mongoStorage
    // Detect type based on the storage object properties
    storageType = mongoStorage.pool ? 'PostgreSQL' : 'MongoDB'
    logger.debug(`[${sessionId}] Using ${storageType} storage that was passed in`)
  } 
  // Fallback: try to get PostgreSQL from SessionStorage if nothing was passed
  else if (!mongoStorage && !hasMongoDBUri()) {
    try {
      const { getSessionStorage } = await import('./coordinator.js')
      const sessionStorage = getSessionStorage()
      if (sessionStorage?.postgresStorage?.isConnected) {
        backupStorage = sessionStorage.postgresStorage
        storageType = 'PostgreSQL'
        logger.debug(`[${sessionId}] Using PostgreSQL from SessionStorage fallback`)
      }
    } catch (error) {
      logger.debug(`[${sessionId}] PostgreSQL fallback not available: ${error.message}`)
    }
  }
  
  logger.info(`[${sessionId}] Auth: FILE-FIRST | Mode: ${mode.toUpperCase()} | Backup: ${storageType} | Source: ${source} | Pairing: ${isPairing}`)

  // Always initialize file storage
  const fileStore = new FileStorage(sessionId)
  await fileStore.init()

  // Initialize background sync with available backup storage
  const mongoSync = backupStorage 
    ? new MongoBackgroundSync(backupStorage, sessionId, mode)
    : null

  if (mongoSync) {
    globalCollectionRefs.set(sessionId, backupStorage)
    
    if (isMongoDBMode()) {
      logger.info(`[${sessionId}] 📦 ${storageType} backup: FULL (all files including pre-keys)`)
    } else if (isFileMode()) {
      logger.info(`[${sessionId}] 📦 ${storageType} backup: INTELLIGENT (creds always, pre-keys only when healthy)`)
    }
  } else {
    logger.warn(`[${sessionId}] ⚠️ No backup storage available - using FILE ONLY`)
  }

  // ============================================================================
  // INITIAL SYNC FROM BACKUP STORAGE (MUST HAPPEN BEFORE LOADING CREDS)
  // ============================================================================

  if (mongoSync && isMongoDBMode()) {
    logger.info(`[${sessionId}] Checking for ${storageType} auth data to restore...`)
    const result = await performInitialSync(fileStore, mongoSync, sessionId)
    if (result.synced > 0) {
      logger.info(`[${sessionId}] ✅ Restored ${result.synced}/${result.total} files from ${storageType}`)
    } else if (result.total > 0 && result.skipped) {
      logger.info(`[${sessionId}] File storage exists, keeping local data`)
    } else if (result.total === 0) {
      logger.info(`[${sessionId}] No ${storageType} data found, will create new credentials`)
    }
  } else if (mongoSync && isFileMode()) {
    // FILE MODE: Pull from backup on startup
    logger.info(`[${sessionId}] FILE MODE: Checking ${storageType} for session backup...`)
    const result = await performInitialSync(fileStore, mongoSync, sessionId)
    
    if (result.synced > 0) {
      logger.info(`[${sessionId}] ✅ Pulled ${result.synced}/${result.total} files from ${storageType} backup`)
    } else if (result.total > 0 && result.skipped) {
      logger.info(`[${sessionId}] Local files exist, skipping pull`)
    } else {
      const mongoFiles = await mongoSync.safeList()
      if (mongoFiles.length > 0) {
        logger.info(`[${sessionId}] 📊 ${storageType} has ${mongoFiles.length} backup files available`)
      }
    }
    
    // ALSO: Push existing local files to backup if they don't exist there
    logger.info(`[${sessionId}] 📤 Pushing local auth files to ${storageType} for backup...`)
    const localFiles = await fileStore.listFiles()
    if (localFiles.length > 0) {
      let pushed = 0
      for (const fileName of localFiles) {
        const data = await fileStore.read(fileName)
        if (data) {
          mongoSync.fireWrite(fileName, data)
          pushed++
        }
      }
      if (pushed > 0) {
        logger.info(`[${sessionId}] ✅ Queued ${pushed}/${localFiles.length} local files for ${storageType} backup`)
      }
    }
  }

  // ============================================================================
  // READ OPERATION - ALWAYS FROM FILE
  // ============================================================================

  const readData = async (fileName) => {
    return await fileStore.read(fileName)
  }

  // ============================================================================
  // WRITE OPERATION - FILE FIRST, BACKUP STORAGE BACKGROUND
  // ============================================================================

  const writeData = async (data, fileName) => {
    await fs.mkdir(fileStore.dir, { recursive: true }).catch(() => {})

    // Special handling for creds.json
    if (fileName === "creds.json") {
      const isValid = validateCredsForWrite(data, sessionId)
      
      // If invalid and NOT pairing, block the write
      if (!isValid && !isPairing) {
        logger.error(`[${sessionId}] 🚫 BLOCKED incomplete creds.json write (not pairing)`)
        return false
      }
      
      // If invalid but pairing, allow it with warning
      if (!isValid && isPairing) {
        logger.warn(`[${sessionId}] ⚠️ Writing incomplete creds.json (pairing in progress)`)
      }

      // Write to file (primary storage)
      const fileSuccess = await fileStore.write(fileName, data)

      // Backup sync strategy based on mode
      if (mongoSync && isMongoDBMode()) {
        // MongoDB/PostgreSQL mode: always sync immediately
        mongoSync.fireWrite(fileName, data)
        
        if (fileSuccess) {
          logger.info(`[${sessionId}] ✅ creds.json written to file${mongoSync.isHealthy ? ` (${storageType} syncing)` : ` (${storageType} backup queued)`}`)
        }
      } else if (fileSuccess) {
        // File mode: only log file write (backup happens on schedule)
        logger.info(`[${sessionId}] ✅ creds.json written to file`)
      }

      return fileSuccess
    }

    // For all other files
    const isPreKey = isPreKeyFile(fileName)

    if (isPreKey) {
      // Pre-keys: debounced write to file
      debouncePreKeyWrite(sessionId, fileName, async () => {
        await fileStore.write(fileName, data)
        // MongoDB/PostgreSQL mode: sync pre-keys immediately
        if (mongoSync && isMongoDBMode()) {
          mongoSync.fireWrite(fileName, data)
        }
        // File mode: pre-keys only backed up on schedule
      })
      return true
    }

    // Regular files: write to file first
    const success = await fileStore.write(fileName, data)
    
    // MongoDB/PostgreSQL mode: sync immediately
    if (success && mongoSync && isMongoDBMode()) {
      mongoSync.fireWrite(fileName, data)
    }
    // File mode: regular files only backed up on schedule

    return success
  }

  // ============================================================================
  // DELETE OPERATION - FILE FIRST, BACKUP STORAGE BACKGROUND
  // ============================================================================

  const removeData = async (fileName) => {
    await fileStore.delete(fileName)

    if (mongoSync) {
      mongoSync.fireDelete(fileName)
    }
  }

  // ============================================================================
  // LOAD OR CREATE CREDENTIALS
  // ============================================================================

  const existing = await readData("creds.json")
  const creds = hasBasicKeys(existing) ? existing : initAuthCreds()
  const isNew = !existing

  if (isNew) {
    logger.info(`[${sessionId}] Creating new credentials`)
    await writeData(creds, "creds.json")
  } else {
    logger.info(`[${sessionId}] Loaded credentials from file storage`)
  }

  // ============================================================================
  // PERIODIC BACKUP TO DATABASE (FILE MODE ONLY)
  // ============================================================================

  let backupTimer = null

  if (isFileMode() && mongoSync) {
    const backup = async () => {
      try {
        const files = await fileStore.listFiles()
        const stats = mongoSync.getStats()
        
        logger.info(`[${sessionId}] 📦 Starting backup of ${files.length} files to ${storageType} (health: ${stats.isHealthy ? "good" : "poor"})`)

        let backedUp = 0
        for (const file of files) {
          // Check if file should be backed up based on current health
          if (!mongoSync.shouldBackupFile(file)) {
            continue
          }
          
          const data = await fileStore.read(file)
          if (data) {
            mongoSync.fireWrite(file, data)
            backedUp++
          }
        }

        logger.info(`[${sessionId}] ✅ Backup queued: ${backedUp}/${files.length} files to ${storageType}`)
      } catch (error) {
        logger.error(`[${sessionId}] Backup failed: ${error.message}`)
      }
    }

    // Start backup immediately, then repeat every BACKUP_INTERVAL
    logger.info(`[${sessionId}] 📅 Scheduling ${storageType} backup: every ${CONFIG.BACKUP_INTERVAL / 60000} minute(s)`)
    
    // Run first backup after 5 seconds
    setTimeout(async () => {
      logger.info(`[${sessionId}] 🚀 Running initial ${storageType} backup...`)
      await backup()
      
      // Then schedule recurring backups
      backupTimer = setInterval(backup, CONFIG.BACKUP_INTERVAL)
    }, 5000) // 5 seconds initial delay
  }

  // ============================================================================
  // RETURN AUTH STATE OBJECT
  // ============================================================================

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {}
          for (const id of ids) {
            const fileName = `${type}-${id}.json`
            let value = await readData(fileName)

            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value)
            }

            if (value) data[id] = value
          }
          return data
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const file = `${category}-${id}.json`
              if (value) {
                await writeData(value, file)
              } else {
                await removeData(file)
              }
            }
          }
        },
      },
    },
    saveCreds: () => writeData(creds, "creds.json"),
    cleanup: async () => {
      if (backupTimer) clearInterval(backupTimer)

      // Log sync stats before cleanup
      if (mongoSync) {
        const stats = mongoSync.getStats()
        if (stats.attempted > 0) {
          logger.info(`[${sessionId}] ${storageType} sync final: ${stats.succeeded}/${stats.attempted} succeeded, ${stats.failed} failed (health: ${stats.isHealthy ? "good" : "poor"})`)
        }
        mongoSync.cleanup()
      }

      // Cleanup file storage
      await fileStore.cleanup()

      // Background cleanup backup storage
      if (mongoSync) {
        mongoSync.fireCleanup()
      }

      globalCollectionRefs.delete(sessionId)
      preKeyDebounceTimers.delete(sessionId)

      logger.info(`[${sessionId}] Cleanup complete`)
    },
  }
}

// ============================================================================
// DEBOUNCE HELPER
// ============================================================================

const debouncePreKeyWrite = (sessionId, fileName, writeFn) => {
  if (!preKeyDebounceTimers.has(sessionId)) {
    preKeyDebounceTimers.set(sessionId, new Map())
  }

  const sessionTimers = preKeyDebounceTimers.get(sessionId)

  if (sessionTimers.has(fileName)) {
    clearTimeout(sessionTimers.get(fileName))
  }

  sessionTimers.set(
    fileName,
    setTimeout(async () => {
      sessionTimers.delete(fileName)
      try {
        await writeFn()
      } catch (error) {
        // Silent failure
      }
    }, CONFIG.PREKEY_WRITE_DEBOUNCE)
  )
}

// ============================================================================
// EXPORTED UTILITY FUNCTIONS
// ============================================================================

export const cleanupSessionAuthData = async (mongoStorage, sessionId) => {
  try {
    // Cleanup file storage
    const fileStore = new FileStorage(sessionId)
    await fileStore.init()
    await fileStore.cleanup()

    // Background cleanup MongoDB if available and connected
    if (hasMongoDBUri() && mongoStorage?.isConnected) {
      const mongoSync = new MongoBackgroundSync(mongoStorage, sessionId, getStorageMode())
      mongoSync.fireCleanup()
    }

    globalCollectionRefs.delete(sessionId)
    preKeyDebounceTimers.delete(sessionId)

    logger.info(`[${sessionId}] Session cleanup initiated`)
    return true
  } catch (error) {
    logger.error(`[${sessionId}] Cleanup failed: ${error.message}`)
    return false
  }
}

export const hasValidAuthData = async (mongoStorage, sessionId) => {
  try {
    // Always check file storage first
    const fileStore = new FileStorage(sessionId)
    await fileStore.init()

    const fileCreds = await fileStore.read("creds.json")
    if (hasBasicKeys(fileCreds)) return true

    // Fallback to MongoDB if file doesn't exist and MongoDB is available
    if (hasMongoDBUri() && mongoStorage?.isConnected) {
      return await mongoStorage.hasValidAuthData(sessionId)
    }

    return false
  } catch {
    return false
  }
}

export const checkAuthAvailability = async (mongoStorage, sessionId) => {
  const fileStore = new FileStorage(sessionId)
  await fileStore.init()

  const hasFile = await fileStore.exists("creds.json")
  let hasMongo = false

  if (hasMongoDBUri() && mongoStorage?.isConnected) {
    try {
      hasMongo = await mongoStorage.hasValidAuthData(sessionId)
    } catch {
      hasMongo = false
    }
  }

  return {
    hasFile,
    hasMongo,
    hasAuth: hasFile || hasMongo,
    preferred: "file",
    mode: "file-first-with-intelligent-backup",
    mongoAvailable: hasMongoDBUri() && mongoStorage?.isConnected,
  }
}

export const getAuthStorageStats = () => {
  const mode = getStorageMode()
  const hasMongo = hasMongoDBUri()
  
  let backupStrategy = "none"
  if (hasMongo) {
    if (isMongoDBMode()) {
      backupStrategy = "full (all files including pre-keys)"
    } else if (isFileMode()) {
      backupStrategy = "intelligent (creds always, pre-keys when healthy)"
    }
  }
  
  return {
    storageMode: "FILE-FIRST",
    configuredMode: mode.toUpperCase(),
    mongodbAvailable: hasMongo,
    backupStrategy,
    initialSyncDelay: `${CONFIG.INITIAL_SYNC_DELAY / 1000}s`,
    backupInterval: `${CONFIG.BACKUP_INTERVAL / 60000}min`,
    syncBatchSize: CONFIG.SYNC_BATCH_SIZE,
    activeCollectionRefs: globalCollectionRefs.size,
    description: "Always uses file storage for reads/writes, MongoDB syncs intelligently based on mode and health"
  }
}