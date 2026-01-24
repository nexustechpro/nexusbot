// config/database.js
// Hybrid database configuration - PostgreSQL OR SQLite fallback
import { Pool } from "pg";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import { createComponentLogger } from "../utils/logger.js";
import fs from "fs";
import path from "path";

dotenv.config();

const logger = createComponentLogger("DATABASE");

// Determine which database to use
const USE_SQLITE = !process.env.DATABASE_URL;
const SQLITE_PATH = process.env.SQLITE_PATH || "./data/whatsapp.db";

logger.info(`Database mode: ${USE_SQLITE ? "SQLite" : "PostgreSQL"}`);

// ==================== PostgreSQL Setup ====================
let pgPool = null;
const circuitBreaker = {
  state: 'CLOSED',
  failureCount: 0,
  failureThreshold: 10,
  successThreshold: 3,
  timeout: 30000,
  nextAttempt: Date.now(),
};

if (!USE_SQLITE) {
  const dbConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    max: 50,
    min: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    acquireTimeoutMillis: 60000,
    createTimeoutMillis: 20000,
    destroyTimeoutMillis: 5000,
    reapIntervalMillis: 1000,
    createRetryIntervalMillis: 500,
    maxUses: 7500,
    allowExitOnIdle: false,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  };

  pgPool = new Pool(dbConfig);

  pgPool.on("connect", () => logger.debug("PostgreSQL client connected"));
  pgPool.on("error", (err) => {
    logger.error("PostgreSQL pool error:", err.message);
    circuitBreaker.failureCount++;
    if (circuitBreaker.failureCount >= circuitBreaker.failureThreshold) {
      if (circuitBreaker.state !== 'OPEN') {
        circuitBreaker.state = 'OPEN';
        circuitBreaker.nextAttempt = Date.now() + circuitBreaker.timeout;
        logger.error(`Circuit breaker OPENED`);
      }
    }
  });
}

// ==================== SQLite Setup ====================
let sqliteDb = null;

if (USE_SQLITE) {
  const dbDir = path.dirname(SQLITE_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  sqliteDb = new Database(SQLITE_PATH);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('synchronous = NORMAL');
  sqliteDb.pragma('cache_size = 10000');
  sqliteDb.pragma('temp_store = MEMORY');
  
  logger.info(`SQLite database initialized: ${SQLITE_PATH}`);
}

// ==================== Unified Query Interface ====================

/**
 * Convert PostgreSQL parameterized query ($1, $2) to SQLite (?, ?)
 */
function convertToSQLite(text, params) {
  let sqliteQuery = text;
  
  // Find all $N placeholders and track how many times each is used
  const paramMatches = text.match(/\$\d+/g) || [];
  const paramCounts = {};
  
  paramMatches.forEach(match => {
    const num = parseInt(match.substring(1));
    paramCounts[num] = (paramCounts[num] || 0) + 1;
  });
  
  const maxParam = paramMatches.length > 0 
    ? Math.max(...paramMatches.map(m => parseInt(m.substring(1)))) 
    : 0;
  
  // Build new params array with duplicates for reused parameters
  const newParams = [];
  for (let i = 1; i <= maxParam; i++) {
    const count = paramCounts[i] || 0;
    for (let j = 0; j < count; j++) {
      newParams.push(params[i - 1]);
    }
  }
  
  // Replace $N with ? in order of appearance
  sqliteQuery = sqliteQuery.replace(/\$\d+/g, '?');
  
  // Convert PostgreSQL-specific syntax to SQLite
  sqliteQuery = sqliteQuery
    .replace(/CURRENT_TIMESTAMP/gi, "datetime('now')")
    .replace(/NOW\(\)/gi, "datetime('now')")
    .replace(/INTERVAL\s+'(\d+)\s+days?'/gi, (match, days) => `'-${days} days'`)
    .replace(/ON CONFLICT.*?DO UPDATE SET/gis, 'ON CONFLICT DO UPDATE SET')
    .replace(/::text/gi, '')
    .replace(/::int/gi, '')
    .replace(/::integer/gi, '')
    .replace(/::jsonb/gi, '')
    .replace(/::bigint/gi, '')
    .replace(/jsonb_build_object/gi, 'json_object')
    .replace(/to_jsonb/gi, 'json')
    .replace(/\s+RETURNING\s+\w+/gi, '');
  
  return { query: sqliteQuery, params: newParams };
}

/**
 * Execute query on SQLite
 */
function executeSQLite(text, params = []) {
  try {
    const { query: sqliteQuery, params: sqliteParams } = convertToSQLite(text, params);
    
    // Convert objects/arrays to JSON strings for SQLite
    const processedParams = sqliteParams.map(param => {
      if (param === null || param === undefined) return null;
      if (typeof param === 'object') return JSON.stringify(param);
      if (typeof param === 'boolean') return param ? 1 : 0;
      return param;
    });
    
    const isSelect = /^\s*SELECT/i.test(sqliteQuery);
    const isInsert = /^\s*INSERT/i.test(sqliteQuery);
    const isUpdate = /^\s*UPDATE/i.test(sqliteQuery);
    const isDelete = /^\s*DELETE/i.test(sqliteQuery);
    
    if (isSelect) {
      const stmt = sqliteDb.prepare(sqliteQuery);
      const rows = stmt.all(...processedParams);
      
      // Convert SQLite integer booleans (0/1) to JavaScript booleans
      const convertedRows = rows.map(row => {
        const converted = {};
        for (const [key, value] of Object.entries(row)) {
          // Check if column name suggests it's a boolean
          if (key.endsWith('_enabled') || key.startsWith('is_') || 
              key === 'detected' || key === 'from_me' || key === 'is_deleted' ||
              key === 'public_mode' || key === 'is_active' || key === 'is_closed' ||
              key === 'is_banned' || key === 'auto_online' || key === 'auto_typing' ||
              key === 'auto_recording' || key === 'auto_status_view' || key === 'auto_status_like') {
            converted[key] = value === 1 ? true : value === 0 ? false : value;
          } else {
            converted[key] = value;
          }
        }
        return converted;
      });
      
      return { rows: convertedRows, rowCount: convertedRows.length };
    } else if (isInsert || isUpdate || isDelete) {
      const stmt = sqliteDb.prepare(sqliteQuery);
      const info = stmt.run(...processedParams);
      
      if (isInsert && /RETURNING/i.test(text)) {
        const tableName = text.match(/INSERT INTO\s+(\w+)/i)?.[1];
        if (tableName) {
          const lastRow = sqliteDb.prepare(`SELECT * FROM ${tableName} WHERE rowid = last_insert_rowid()`).get();
          return { rows: lastRow ? [lastRow] : [], rowCount: info.changes };
        }
      }
      
      return { rows: [], rowCount: info.changes };
    } else {
      sqliteDb.exec(sqliteQuery);
      return { rows: [], rowCount: 0 };
    }
  } catch (error) {
    logger.error("SQLite query error:", error.message);
    throw error;
  }
}

/**
 * Execute query on PostgreSQL
 */
async function executePostgreSQL(text, params = []) {
  if (!checkCircuitBreaker()) {
    const error = new Error('Circuit breaker is OPEN - database unavailable');
    error.code = 'CIRCUIT_OPEN';
    throw error;
  }

  const start = Date.now();
  let lastError;
  
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await pgPool.query(text, params);
      const duration = Date.now() - start;
      
      resetCircuitBreaker();
      
      if (duration > 1000) {
        logger.warn(`Slow query: ${duration}ms`);
      }
      
      return result;
    } catch (error) {
      lastError = error;
      
      const isConnectionError = error.code === 'ECONNREFUSED' || 
                                error.code === 'ECONNRESET' || 
                                error.code === 'ETIMEDOUT' ||
                                error.message?.includes('timeout');
      
      if (attempt === 1 && isConnectionError) {
        circuitBreaker.failureCount++;
        await sleep(100);
        continue;
      }
      break;
    }
  }
  
  circuitBreaker.failureCount++;
  throw lastError;
}

/**
 * Unified pool.query() - works for both PostgreSQL and SQLite
 */
const pool = {
  query: async (text, params = []) => {
    if (USE_SQLITE) {
      return executeSQLite(text, params);
    } else {
      return executePostgreSQL(text, params);
    }
  },
  
  connect: async () => {
    if (USE_SQLITE) {
      return {
        query: (text, params) => executeSQLite(text, params),
        release: () => {},
      };
    } else {
      return await pgPool.connect();
    }
  },
  
  end: async () => {
    if (USE_SQLITE) {
      sqliteDb?.close();
      logger.info("SQLite database closed");
    } else {
      await pgPool?.end();
      logger.info("PostgreSQL pool closed");
    }
  },
  
  get totalCount() { return USE_SQLITE ? 1 : pgPool?.totalCount || 0; },
  get idleCount() { return USE_SQLITE ? 1 : pgPool?.idleCount || 0; },
  get waitingCount() { return USE_SQLITE ? 0 : pgPool?.waitingCount || 0; },
};

// ==================== Utility Functions ====================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function checkCircuitBreaker() {
  if (USE_SQLITE) return true;
  
  if (circuitBreaker.state === 'OPEN') {
    if (Date.now() >= circuitBreaker.nextAttempt) {
      circuitBreaker.state = 'HALF_OPEN';
      circuitBreaker.failureCount = 0;
      logger.info('Circuit breaker entering HALF_OPEN state');
      return true;
    }
    return false;
  }
  return true;
}

function resetCircuitBreaker() {
  if (USE_SQLITE) return;
  
  if (circuitBreaker.state === 'HALF_OPEN') {
    circuitBreaker.failureCount--;
    if (circuitBreaker.failureCount <= -circuitBreaker.successThreshold) {
      circuitBreaker.state = 'CLOSED';
      circuitBreaker.failureCount = 0;
      logger.info('Circuit breaker CLOSED - connection restored');
    }
  } else if (circuitBreaker.state === 'CLOSED') {
    circuitBreaker.failureCount = Math.max(0, circuitBreaker.failureCount - 1);
  }
}

async function testConnection() {
  try {
    if (USE_SQLITE) {
      const result = sqliteDb.prepare("SELECT datetime('now') as current_time, sqlite_version() as version").get();
      logger.info("SQLite connection test successful", {
        timestamp: result.current_time,
        version: `SQLite ${result.version}`
      });
      return true;
    } else {
      const client = await pgPool.connect();
      const result = await client.query('SELECT NOW() as current_time, version() as version');
      client.release();
      
      logger.info("PostgreSQL connection test successful", {
        timestamp: result.rows[0].current_time,
        version: result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1]
      });
      
      resetCircuitBreaker();
      return true;
    }
  } catch (error) {
    logger.error("Database connection test failed:", error.message);
    return false;
  }
}

async function testConnectionOnce() {
  try {
    if (USE_SQLITE) {
      sqliteDb.prepare('SELECT 1').get();
      return true;
    } else {
      const client = await pgPool.connect();
      await client.query('SELECT 1');
      client.release();
      resetCircuitBreaker();
      return true;
    }
  } catch (error) {
    return false;
  }
}

function getPoolStats() {
  if (USE_SQLITE) {
    return {
      mode: 'SQLite',
      path: SQLITE_PATH,
      inMemory: sqliteDb?.memory || false,
      open: sqliteDb?.open || false
    };
  }
  
  return {
    mode: 'PostgreSQL',
    totalCount: pgPool.totalCount,
    idleCount: pgPool.idleCount,
    waitingCount: pgPool.waitingCount,
    circuitBreaker: {
      state: circuitBreaker.state,
      failureCount: circuitBreaker.failureCount,
    }
  };
}

async function closePool() {
  if (USE_SQLITE) {
    sqliteDb?.close();
    logger.info("SQLite database closed");
  } else {
    await pgPool?.end();
    logger.info("PostgreSQL pool closed");
  }
}

async function transaction(callback) {
  if (USE_SQLITE) {
    try {
      sqliteDb.exec('BEGIN');
      const result = await callback({ query: executeSQLite });
      sqliteDb.exec('COMMIT');
      return result;
    } catch (error) {
      sqliteDb.exec('ROLLBACK');
      throw error;
    }
  } else {
    if (!checkCircuitBreaker()) {
      throw new Error('Circuit breaker is OPEN');
    }

    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      resetCircuitBreaker();
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      circuitBreaker.failureCount++;
      throw error;
    } finally {
      client.release();
    }
  }
}

async function healthCheck() {
  try {
    const isHealthy = await testConnectionOnce();
    const stats = getPoolStats();
    
    return {
      healthy: isHealthy,
      mode: USE_SQLITE ? 'SQLite' : 'PostgreSQL',
      stats,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

export { 
  pool,
  testConnection,
  testConnectionOnce,
  getPoolStats,
  closePool,
  transaction,
  healthCheck,
  checkCircuitBreaker,
  circuitBreaker,
  USE_SQLITE
};

export default pool;