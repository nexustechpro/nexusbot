/**
 * Phone Number Input Utility
 * Handles phone number input from environment variables or command line
 * Supports multiple formats: +2348012345678, 234 801 234 5678, 0801-234-5678, etc.
 */

import readline from 'readline'
import fs from 'fs'
import path from 'path'
import { createComponentLogger } from './logger.js'
import dotenv from 'dotenv'
dotenv.config()
const logger = createComponentLogger('PHONE_INPUT')

/**
 * Save phone number to .env file
 * @param {string} phoneNumber - Phone number to save (with country code)
 */
export function savePhoneToEnv(phoneNumber) {
  try {
    const envPath = path.join(process.cwd(), '.env')
    let envContent = ''
    
    // Read existing .env file if it exists
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8')
    }
    
    // Check if WHATSAPP_PHONE_NUMBER already exists
    const phoneRegex = /^WHATSAPP_PHONE_NUMBER=.*$/m
    
    if (phoneRegex.test(envContent)) {
      // Replace existing value
      envContent = envContent.replace(phoneRegex, `WHATSAPP_PHONE_NUMBER=${phoneNumber}`)
    } else {
      // Add new line
      if (envContent && !envContent.endsWith('\n')) {
        envContent += '\n'
      }
      envContent += `WHATSAPP_PHONE_NUMBER=${phoneNumber}\n`
    }
    
    // Write back to .env
    fs.writeFileSync(envPath, envContent, 'utf-8')
    logger.info(`✅ Phone number saved to .env file`)
  } catch (error) {
    logger.warn(`⚠️  Could not save phone number to .env: ${error.message}`)
  }
}

/**
 * Get phone number from environment or prompt user
 * @returns {Promise<string>} Cleaned phone number (digits only, no +)
 */
export async function getPhoneNumber() {
  // Check if phone number is in environment
  const envPhone = process.env.WHATSAPP_PHONE_NUMBER
  
  if (envPhone) {
    logger.info(`📱 Phone number loaded from WHATSAPP_PHONE_NUMBER env variable`)
    return sanitizePhoneNumber(envPhone)
  }

  // Check for phone from command line argument
  const phoneArg = process.argv.find(arg => arg.startsWith('--phone='))
  if (phoneArg) {
    const phone = phoneArg.replace('--phone=', '')
    logger.info(`📱 Phone number provided via command line argument`)
    return sanitizePhoneNumber(phone)
  }

  // Prompt user if running in interactive mode
  if (process.stdin.isTTY) {
    return await promptPhoneNumber()
  }

  // If not interactive and no phone provided
  logger.warn('⚠️  No phone number provided. Set WHATSAPP_PHONE_NUMBER or use --phone=<number>')
  return null
}

/**
 * Prompt user for phone number in interactive mode
 * @returns {Promise<string>}
 */
export async function promptPhoneNumber() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    console.log('\n' + '='.repeat(70))
    console.log('📱 WhatsApp Session Initialization')
    console.log('='.repeat(70))
    
    console.log('\n✅ RECOMMENDED FORMAT (most common):')
    console.log('   2348012345678  (for Nigeria)')
    console.log('   2338123456789  (for Ghana)')
    
    console.log('\n✨ We also accept these formats:')
    console.log('   +2348012345678')
    console.log('   +234 801 234 5678')
    console.log('   234-801-234-5678')
    console.log('   (234) 801-234-5678')
    console.log('   234 801 234 5678')
    console.log('   08012345678     (with leading 0)')
    
    console.log('\n🌍 Common country codes:')
    console.log('   Nigeria: 234 | Ghana: 233 | Kenya: 254 | USA: 1 | UK: 44 | India: 91')
    
    rl.question(
      '\nEnter your WhatsApp phone number:\n> ',
      (phone) => {
        rl.close()
        const sanitized = sanitizePhoneNumber(phone)
        
        if (sanitized) {
          logger.info(`✅ Phone number accepted: +${sanitized}`)
          
          // Save to .env file
          savePhoneToEnv(sanitized)
          
          console.log(`\n✅ You will soon receive a pairing code via WhatsApp`)
          console.log(`   Watch your browser/terminal for the code prompt\n`)
          resolve(sanitized)
        } else {
          logger.error('❌ Invalid phone number format')
          console.log('\n❌ Phone number must be 10-15 digits\n')
          resolve(promptPhoneNumber()) // Recursively prompt again
        }
      }
    )
  })
}

/**
 * Sanitize and validate phone number
 * Supports multiple formats and converts to clean digits only
 * @param {string} phone - Raw phone number input (any format)
 * @returns {string|null} Cleaned phone number (digits only) or null if invalid
 */
export function sanitizePhoneNumber(phone) {
  if (!phone) return null

  // Convert to string and remove all non-digit characters except +
  let cleaned = phone.toString().replace(/[\s\-\(\)\.]/g, '')

  // Handle leading 0 (replace with country code if not already present)
  // First, check if it starts with 0
  if (cleaned.startsWith('0')) {
    // If it's just starting with 0 and not +0, assume it's local format
    // We'll keep it for now - user should provide country code
    cleaned = cleaned.substring(1) // Remove leading 0
  }

  // Remove + prefix if present
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1)
  }

  // Must be 10-15 digits and contain only numbers
  if (!/^\d{10,15}$/.test(cleaned)) {
    return null
  }

  return cleaned
}

/**
 * Validate phone number format
 * @param {string} phone - Phone number to validate (any format)
 * @returns {boolean}
 */
export function isValidPhoneNumber(phone) {
  return sanitizePhoneNumber(phone) !== null
}

/**
 * Format phone number for display
 * @param {string} phone - Phone number (any format)
 * @returns {string} Formatted phone number with +
 */
export function formatPhoneForDisplay(phone) {
  const clean = sanitizePhoneNumber(phone)
  return clean ? `+${clean}` : phone
}

/**
 * Get country code from phone number
 * @param {string} phone - Phone number
 * @returns {string|null} Country code or null
 */
export function getCountryCode(phone) {
  const clean = sanitizePhoneNumber(phone)
  if (!clean) return null

  // Map of common country codes and their phone number lengths
  const countryPatterns = {
    '234': 13, // Nigeria: 234 + 10 digits
    '233': 12, // Ghana: 233 + 9 digits
    '254': 12, // Kenya: 254 + 9 digits
    '27': 12,  // South Africa: 27 + 9 digits
    '1': 11,   // USA: 1 + 10 digits
    '44': 13,  // UK: 44 + 11 digits
    '91': 12,  // India: 91 + 10 digits
    '353': 13, // Ireland: 353 + 9 digits
    '33': 12,  // France: 33 + 9 digits
    '49': 13,  // Germany: 49 + 10 digits
  }

  for (const [code, length] of Object.entries(countryPatterns)) {
    if (clean.startsWith(code) && clean.length === length) {
      return code
    }
  }

  // Try to guess from length patterns
  if (clean.length === 13 && (clean.startsWith('234') || clean.startsWith('27') || clean.startsWith('44'))) {
    return clean.substring(0, 3)
  }
  if (clean.length === 12 && (clean.startsWith('233') || clean.startsWith('254') || clean.startsWith('91'))) {
    return clean.substring(0, 3)
  }

  // Default to first 1-3 characters as code
  return clean.substring(0, 3)
}
