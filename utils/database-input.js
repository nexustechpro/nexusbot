/**
 * Database URL Input Utility
 * Handles database URL input from environment variables or command line
 * Supports PostgreSQL connection strings
 */

import readline from 'readline'
import fs from 'fs'
import path from 'path'
import { createComponentLogger } from './logger.js'
import dotenv from 'dotenv'
dotenv.config()

const logger = createComponentLogger('DATABASE_INPUT')

/**
 * Save database URL to .env file
 * @param {string} databaseUrl - Database URL to save
 */
export function saveDatabaseToEnv(databaseUrl) {
  try {
    const envPath = path.join(process.cwd(), '.env')
    let envContent = ''
    
    // Read existing .env file if it exists
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8')
    }
    
    // Check if DATABASE_URL already exists
    const dbRegex = /^DATABASE_URL=.*$/m
    
    if (dbRegex.test(envContent)) {
      // Replace existing value
      envContent = envContent.replace(dbRegex, `DATABASE_URL=${databaseUrl}`)
    } else {
      // Add new line
      if (envContent && !envContent.endsWith('\n')) {
        envContent += '\n'
      }
      envContent += `DATABASE_URL=${databaseUrl}\n`
    }
    
    // Write back to .env
    fs.writeFileSync(envPath, envContent, 'utf-8')
    logger.info(`✅ Database URL saved to .env file`)
  } catch (error) {
    logger.warn(`⚠️  Could not save database URL to .env: ${error.message}`)
  }
}

/**
 * Get database URL from environment or prompt user
 * @returns {Promise<string|null>} Database URL or null if not needed
 */
export async function getDatabaseUrl() {
  // Check if database URL is in environment
  const envDatabase = process.env.DATABASE_URL
  
  if (envDatabase) {
    if (isValidDatabaseUrl(envDatabase)) {
      logger.info(`🗄️  Database URL loaded from DATABASE_URL env variable`)
      return envDatabase
    } else {
      logger.warn(`⚠️  Invalid DATABASE_URL in environment, will prompt for new one`)
    }
  }

  // Check for database from command line argument
  const dbArg = process.argv.find(arg => arg.startsWith('--database='))
  if (dbArg) {
    const dbUrl = dbArg.replace('--database=', '')
    if (isValidDatabaseUrl(dbUrl)) {
      logger.info(`🗄️  Database URL provided via command line argument`)
      return dbUrl
    } else {
      logger.warn(`⚠️  Invalid database URL provided via --database argument`)
    }
  }

  // Prompt user if running in interactive mode
  if (process.stdin.isTTY) {
    return await promptDatabaseUrl()
  }

  // If not interactive and no database provided
  logger.error('❌ No valid database URL provided.')
  logger.error('   Set DATABASE_URL environment variable or use --database=<url>')
  logger.error('   See: https://github.com/nexustechpro/nexusbot#database-setup')
  return null
}

/**
 * Prompt user for database URL in interactive mode
 * @returns {Promise<string|null>}
 */
export async function promptDatabaseUrl() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    console.log('\n' + '='.repeat(70))
    console.log('🗄️  Database Configuration')
    console.log('='.repeat(70))
    
    console.log('\n📝 Nexus Bot requires a PostgreSQL database to store session data.')
    console.log('   You can get a FREE database from Render.com\n')
    
    console.log('✅ How to get a FREE database:')
    console.log('   1. Go to https://render.com')
    console.log('   2. Sign up with Google')
    console.log('   3. Click "New +" → "PostgreSQL"')
    console.log('   4. Name: nexus-database')
    console.log('   5. Plan: Select "Free"')
    console.log('   6. Click "Create Database"')
    console.log('   7. Copy "External Database URL"\n')
    
    console.log('📋 Your database URL should look like this:')
    console.log('   postgresql://user:password@host.render.com/database\n')
    
    console.log('💡 Tip: You can also set DATABASE_URL in your .env file')
    console.log('   or use --database=<url> when starting the bot\n')
    
    rl.question(
      'Enter your PostgreSQL database URL (or press Enter to skip):\n> ',
      (dbUrl) => {
        rl.close()
        
        // Allow empty input to skip
        if (!dbUrl || dbUrl.trim() === '') {
          console.log('\n⚠️  Skipping database setup.')
          console.log('   Note: Bot may not persist session without a database.\n')
          resolve(null)
          return
        }
        
        const trimmed = dbUrl.trim()
        
        if (isValidDatabaseUrl(trimmed)) {
          logger.info(`✅ Database URL accepted`)
          
          // Save to .env file
          saveDatabaseToEnv(trimmed)
          
          console.log(`\n✅ Database URL saved to .env file`)
          console.log(`   Your session will be stored securely in PostgreSQL\n`)
          resolve(trimmed)
        } else {
          logger.error('❌ Invalid database URL format')
          console.log('\n❌ Database URL must start with "postgresql://"')
          console.log('   Example: postgresql://user:pass@host.render.com/db\n')
          
          // Ask if they want to try again
          const retry = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          })
          
          retry.question('Try again? (y/n): ', (answer) => {
            retry.close()
            if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
              resolve(promptDatabaseUrl()) // Recursively prompt again
            } else {
              console.log('\n⚠️  Continuing without database...\n')
              resolve(null)
            }
          })
        }
      }
    )
  })
}

/**
 * Validate database URL format
 * @param {string} url - Database URL to validate
 * @returns {boolean}
 */
export function isValidDatabaseUrl(url) {
  if (!url || typeof url !== 'string') return false
  
  // Must start with postgresql:// or postgres://
  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    return false
  }
  
  // Basic structure validation: protocol://user:pass@host/database
  const pattern = /^postgres(ql)?:\/\/[^:]+:[^@]+@[^/]+\/[^\s]+$/
  return pattern.test(url)
}

/**
 * Extract database info from URL for logging (hides password)
 * @param {string} url - Database URL
 * @returns {object} Database info
 */
export function getDatabaseInfo(url) {
  if (!isValidDatabaseUrl(url)) return null
  
  try {
    const parsed = new URL(url)
    return {
      protocol: parsed.protocol.replace(':', ''),
      username: parsed.username,
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: parsed.pathname.replace('/', ''),
      hasPassword: !!parsed.password
    }
  } catch (error) {
    return null
  }
}

/**
 * Format database URL for safe logging (hides password)
 * @param {string} url - Database URL
 * @returns {string} Safe URL for logging
 */
export function formatDatabaseForLogging(url) {
  if (!isValidDatabaseUrl(url)) return 'Invalid URL'
  
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.username}:****@${parsed.host}${parsed.pathname}`
  } catch (error) {
    return 'Error parsing URL'
  }
}