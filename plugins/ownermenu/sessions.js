
// ==================== sessions.js ====================
import { createComponentLogger } from "../../utils/logger.js"
import { getSessionManager } from "../../whatsapp/sessions/index.js"

const logger = createComponentLogger("SESSIONS_PLUGIN")
const MAX_SESSIONS = 5

// Utility function to normalize phone numbers
function normalizePhoneNumber(phone) {
  if (!phone) return ""
  return phone.replace(/\D/g, '').trim() // Remove all non-digits and trim
}

// Check if user is the main owner
function isMainOwner(userJid) {
  if (!userJid || typeof userJid !== 'string') return false
  
  const ownerPhone = normalizePhoneNumber(process.env.WHATSAPP_PHONE_NUMBER)
  if (!ownerPhone) return false
  
  const userPhone = normalizePhoneNumber(userJid.split("@")[0])
  return userPhone === ownerPhone
}

export default {
  name: "sessions",
  aliases: ["mysessions", "activesessions", "liststatus"],
  category: "toolmenu",
  description: "View all your active WhatsApp sessions",
  usage: ".sessions",
  cooldown: 5,

  async execute(sock, m, { args } = {}) {
    try {
      // Handle case where m is just a session ID string
      let userSessionId = null
      let chatDestination = null
      
      if (typeof m === 'string' && m.startsWith('session_')) {
        // m is the session ID string
        userSessionId = m
        chatDestination = `${m.replace('session_', '')}@s.whatsapp.net`
      } else if (m && typeof m === 'object' && m.sender && m.chat) {
        // m is a proper message object
        userSessionId = `session_${m.sender.split("@")[0]}`
        chatDestination = m.chat
      } else {
        logger.error("Invalid message format:", { type: typeof m, value: m })
        return
      }

      const sessionManager = getSessionManager()
      if (!sessionManager) {
        logger.error("Session manager not initialized")
        if (chatDestination) {
          await sock.sendMessage(chatDestination, {
            text: `❌ System error: Session manager not ready\n\n` +
            `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          })
        }
        return
      }

      // Extract phone from session ID
      const phoneFromSession = userSessionId.replace('session_', '')
      const mainOwnerPhone = normalizePhoneNumber(process.env.WHATSAPP_PHONE_NUMBER)
      const isOwner = phoneFromSession === mainOwnerPhone

      const userSession = sessionManager.activeSockets.get(userSessionId)

      // OWNER VIEW: Show all sessions
      if (isOwner) {
        let message = `👑 *Bot Sessions Overview*\n\n`
        message += `📊 *Total Active:* ${sessionManager.activeSockets.size}/${MAX_SESSIONS}\n\n`
        
        if (sessionManager.activeSockets.size === 0) {
          message += `No active sessions found.\n\n`
          message += `Use .pair <phone_number> to connect accounts\n\n`
        } else {
          message += `📋 *All Connected Sessions:*\n\n`
          let count = 0
          
          for (const [sessionId, session] of sessionManager.activeSockets.entries()) {
            count++
            const isConnected = session?.user ? "✅" : "⏳"
            const phoneNumber = session?.user?.phoneNumber || "Initializing"
            const platform = session?.user?.platform || "Unknown"
            const thisSessionPhone = normalizePhoneNumber(sessionId.replace("session_", ""))
            const role = thisSessionPhone === mainOwnerPhone ? "👑 Owner" : "👤 User"
            
            message += `${count}. ${isConnected} *${role}*\n`
            message += `   📝 ID: ${sessionId}\n`
            message += `   📱 Phone: +${phoneNumber}\n`
            message += `   🔗 Platform: ${platform}\n`
            message += `   📊 Status: ${isConnected ? "Connected" : "Connecting"}\n\n`
          }
          
          message += `📝 *Owner Commands:*\n`
          message += `  .disconnect confirm <session_id> - Disconnect any session\n`
          message += `  .pair <phone> - Add new account\n\n`
        }
        
        message += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        return sock.sendMessage(chatDestination, { text: message })
      }

      // SUB-USER VIEW: Show only their own session
      if (!userSession) {
        return sock.sendMessage(chatDestination, {
          text: `❌ *No Active Session*\n\n` +
          `You don't have an active session with the bot.\n\n` +
          `Use .pair <phone_number> to connect your account\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        })
      }

      // Show detailed info for user's session
      const isConnected = userSession?.user ? true : false
      const phoneNumber = userSession?.user?.phoneNumber || "Initializing"
      const platform = userSession?.user?.platform || "Unknown"
      const jid = userSession?.user?.id || "Not available"

      let message = `📋 *Your Session Info*\n\n`
      message += `📝 *Session ID:* ${userSessionId}\n`
      message += `📱 *Phone Number:* +${phoneNumber}\n`
      message += `${isConnected ? "✅" : "⏳"} *Status:* ${isConnected ? "Connected" : "Connecting"}\n`
      message += `🔗 *Platform:* ${platform}\n`
      message += `🆔 *JID:* ${jid}\n\n`

      if (isConnected) {
        message += `🎉 Your account is fully connected and ready to use!\n\n`
        message += `📝 *Available Commands:*\n`
        message += `  .disconnect confirm - Disconnect your session\n`
        message += `  .pair - Reconnect or update session\n\n`
      } else {
        message += `⏳ Session is still initializing...\n`
        message += `Please wait for the pairing code to appear.\n\n`
      }

      message += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      return sock.sendMessage(chatDestination, { text: message })
    } catch (error) {
      logger.error("Sessions plugin error:", error)
    }
  },
}