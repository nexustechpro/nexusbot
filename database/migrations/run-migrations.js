// database/migrations/run-migrations.js
// Migration runner with PostgreSQL and SQLite support
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pool, { USE_SQLITE } from "../../config/database.js";
import { createComponentLogger } from "../../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logger = createComponentLogger("MIGRATIONS");

/**
 * Run database migrations - execute SQL files based on database type
 */
async function runMigrations() {
  try {
    logger.info(`🔄 Running database migrations (${USE_SQLITE ? 'SQLite' : 'PostgreSQL'})...`);

    // Test database connection
    await pool.query('SELECT 1');
    logger.info("✅ Database connection verified");

    // Choose migration directory based on database type
    const migrationsDir = USE_SQLITE 
      ? path.join(__dirname, 'sqlite')
      : path.join(__dirname, 'postgresql');

    // Create SQLite migrations directory if it doesn't exist
    if (USE_SQLITE && !fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
      logger.info("📁 Created SQLite migrations directory");
      
      // Generate SQLite schema from PostgreSQL schema
      await generateSQLiteMigrations(migrationsDir);
    }

    // Get all SQL files
    const sqlFiles = fs.existsSync(migrationsDir)
      ? fs.readdirSync(migrationsDir)
          .filter((file) => file.endsWith(".sql"))
          .sort()
      : [];

    if (sqlFiles.length === 0) {
      logger.warn("⚠️  No SQL migration files found");
      
      // If using SQLite and no migrations exist, create basic schema
      if (USE_SQLITE) {
        await createBasicSQLiteSchema();
      }
      
      return true;
    }

    logger.info(`Found ${sqlFiles.length} SQL file(s)`);

    // Execute each SQL file
    for (const file of sqlFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, "utf8");
      
      logger.info(`⏳ Executing: ${file}`);
      
      try {
        await pool.query(sql);
        logger.info(`✅ Completed: ${file}`);
      } catch (error) {
        logger.error(`❌ Error in ${file}:`, error.message);
        throw error;
      }
    }

    logger.info("✅ All migrations completed successfully");
    return true;

  } catch (error) {
    logger.error("❌ Migration failed:", error.message);
    throw error;
  }
}

/**
 * Generate SQLite migrations from PostgreSQL schema
 */
async function generateSQLiteMigrations(sqliteDir) {
  logger.info("📝 Generating SQLite schema from PostgreSQL...");
  
  const pgDir = path.join(__dirname, 'postgresql');
  
  if (!fs.existsSync(pgDir)) {
    logger.warn("⚠️  PostgreSQL migrations not found, skipping generation");
    return;
  }

  const pgFiles = fs.readdirSync(pgDir).filter(f => f.endsWith('.sql')).sort();
  
  for (const file of pgFiles) {
    const pgPath = path.join(pgDir, file);
    const sqlitePath = path.join(sqliteDir, file);
    
    if (fs.existsSync(sqlitePath)) {
      logger.debug(`Skipping ${file} - already exists`);
      continue;
    }
    
    const pgSql = fs.readFileSync(pgPath, 'utf8');
    const sqliteSql = convertPostgreSQLToSQLite(pgSql);
    
    fs.writeFileSync(sqlitePath, sqliteSql, 'utf8');
    logger.info(`✅ Generated: ${file}`);
  }
}

/**
 * Convert PostgreSQL SQL to SQLite-compatible SQL
 */
function convertPostgreSQLToSQLite(sql) {
  let converted = sql;
  
  // Remove PostgreSQL extensions
  converted = converted.replace(/CREATE EXTENSION[^;]+;/gi, '');
  
  // CRITICAL: Handle SERIAL types FIRST before other replacements
  converted = converted.replace(/BIGSERIAL\s+PRIMARY\s+KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
  converted = converted.replace(/SERIAL\s+PRIMARY\s+KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
  converted = converted.replace(/BIGSERIAL/gi, 'INTEGER');
  converted = converted.replace(/SERIAL/gi, 'INTEGER');
  
  // Now handle other data types (use word boundaries \b to avoid partial matches)
  converted = converted.replace(/\bBIGINT\b/gi, 'INTEGER');
  converted = converted.replace(/\bVARCHAR\s*\(\s*\d+\s*\)/gi, 'TEXT');
  converted = converted.replace(/\bBOOLEAN\b/gi, 'INTEGER');
  converted = converted.replace(/\bJSONB\b/gi, 'TEXT');
  converted = converted.replace(/\bTEXT\s*\[\s*\]/gi, 'TEXT');
  
  // Handle timestamp/date/time TYPES only (not column names)
  // Match only when followed by space and constraint keywords or comma or newline
  converted = converted.replace(/\bTIMESTAMP\b(\s+(NOT\s+NULL|NULL|DEFAULT|,|\)|\n))/gi, 'TEXT$1');
  converted = converted.replace(/\bDATE\b(\s+(NOT\s+NULL|NULL|DEFAULT|,|\)|\n))/gi, 'TEXT$1');
  converted = converted.replace(/\bTIME\b(\s+(NOT\s+NULL|NULL|DEFAULT|,|\)|\n))/gi, 'TEXT$1');
  
  // Remove USING gin/gist indexes (SQLite doesn't support)
  converted = converted.replace(/CREATE\s+INDEX[^;]*USING\s+(gin|gist)[^;]*;/gi, '');
  
  // Timestamps and defaults
  converted = converted.replace(/CURRENT_TIMESTAMP/gi, "datetime('now')");
  converted = converted.replace(/NOW\s*\(\s*\)/gi, "datetime('now')");
  
  // Remove interval expressions
  converted = converted.replace(/INTERVAL\s+'[^']+'/gi, '');
  converted = converted.replace(/-\s+INTERVAL[^,\)]+/gi, '');
  
  // Fix DEFAULT with datetime
  converted = converted.replace(/DEFAULT\s+datetime\('now'\)/gi, "DEFAULT (datetime('now'))");
  
  // UNIQUE constraints - fix duplicate PRIMARY KEY
  converted = converted.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\s+UNIQUE/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
  
  // Remove RETURNING clauses (SQLite doesn't support in some contexts)
  converted = converted.replace(/RETURNING\s+\*/gi, '');
  
  // ON CONFLICT syntax
  converted = converted.replace(/ON\s+CONFLICT\s+\([^)]+\)\s+DO\s+UPDATE\s+SET/gi, 'ON CONFLICT DO UPDATE SET');
  
  // Cast operators
  converted = converted.replace(/::(text|int|integer|jsonb|bigint|varchar)/gi, '');
  
  // JSONB functions
  converted = converted.replace(/jsonb_build_object/gi, 'json_object');
  converted = converted.replace(/to_jsonb/gi, 'json');
  
  // Remove all PostgreSQL functions (triggers, procedures)
  converted = converted.replace(/CREATE\s+OR\s+REPLACE\s+FUNCTION[\s\S]*?END;\s*\$\$\s*LANGUAGE\s+plpgsql;/gi, '');
  
  // Remove all triggers
  converted = converted.replace(/DROP\s+TRIGGER\s+IF\s+EXISTS[^;]+;/gi, '');
  converted = converted.replace(/CREATE\s+TRIGGER[\s\S]*?EXECUTE\s+(FUNCTION|PROCEDURE)[^;]+;/gi, '');
  
  // Remove comments
  converted = converted.replace(/COMMENT\s+ON[^;]+;/gi, '');
  
  // Remove DO blocks
  converted = converted.replace(/DO\s+\$[\s\S]*?\$;/gi, '');
  
  // Clean up multiple blank lines
  converted = converted.replace(/\n{3,}/g, '\n\n');
  
  return converted;
}

/**
 * Create basic SQLite schema if no migrations exist
 */
async function createBasicSQLiteSchema() {
  logger.info("📝 Creating basic SQLite schema...");
  
  const basicSchema = `
-- Basic SQLite Schema
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    first_name TEXT,
    username TEXT,
    session_id TEXT,
    phone_number TEXT,
    is_connected INTEGER DEFAULT 0,
    connection_status TEXT DEFAULT 'disconnected',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS whatsapp_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    jid TEXT,
    phone TEXT,
    name TEXT,
    bot_mode TEXT DEFAULT 'public',
    custom_prefix TEXT DEFAULT '.',
    antiviewonce_enabled INTEGER DEFAULT 0,
    antideleted_enabled INTEGER DEFAULT 0,
    vip_level INTEGER DEFAULT 0,
    is_default_vip INTEGER DEFAULT 0,
    owned_by_telegram_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jid TEXT UNIQUE NOT NULL,
    name TEXT,
    description TEXT,
    grouponly_enabled INTEGER DEFAULT 0,
    public_mode INTEGER DEFAULT 1,
    antilink_enabled INTEGER DEFAULT 0,
    is_bot_admin INTEGER DEFAULT 0,
    scheduled_close_time TEXT,
    scheduled_open_time TEXT,
    auto_schedule_enabled INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    n_o INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL,
    from_jid TEXT NOT NULL,
    sender_jid TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    content TEXT,
    session_id TEXT,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(id, session_id)
);

CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_jid TEXT NOT NULL,
    group_jid TEXT NOT NULL,
    warning_type TEXT NOT NULL,
    warning_count INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_jid, group_jid, warning_type)
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_telegram_id ON whatsapp_users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_groups_jid ON groups(jid);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_warnings_user_group ON warnings(user_jid, group_jid);
`;

  try {
    await pool.query(basicSchema);
    logger.info("✅ Basic SQLite schema created");
  } catch (error) {
    logger.error("❌ Failed to create basic schema:", error.message);
    throw error;
  }
}

// Export the function
export { runMigrations };

// Run migrations if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      logger.info("✅ Migration process completed");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("❌ Migration process failed:", error);
      process.exit(1);
    });
}