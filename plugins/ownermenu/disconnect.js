// ==================== disconnect.js ====================
import { createComponentLogger } from "../../utils/logger.js"
import { getSessionManager } from "../../whatsapp/sessions/index.js"

const logger = createComponentLogger("DISCONNECT_PLUGIN")

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
  name: "disconnect",
  aliases: ["unpair", "removesession"],
  category: "toolmenu",
  description: "Disconnect your WhatsApp session from the bot",
  usage: ".disconnect confirm [session_id]",
  cooldown: 10,

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
      const senderPhone = normalizePhoneNumber(phoneFromSession)
      const isOwner = senderPhone === mainOwnerPhone
      
      // Check if sender is the main owner from env file - prevent them from disconnecting
      if (mainOwnerPhone && senderPhone === mainOwnerPhone) {
        return sock.sendMessage(chatDestination, {
          text: `🔒 *Access Denied*\n\n` +
          `❌ The main owner (registered in .env) cannot disconnect through this plugin.\n\n` +
          `This is a security measure to prevent accidental lockout.\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖯`
        })
      }

      // Check if confirmation is provided
      if (!args || !args[0] || args[0].toLowerCase() !== "confirm") {
        return sock.sendMessage(chatDestination, {
          text: `⚠️ *Disconnect Confirmation Required*\n\n` +
          `This action will disconnect your session from the bot.\n\n` +
          `💬 *To confirm, use:*\n` +
          `.disconnect confirm${args && args.length > 0 && args[0] !== "confirm" ? ` ${args[0]}` : ""}\n\n` +
          `⚠️ *Warning:* This will disconnect your WhatsApp session.\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖯`
        })
      }

      // Determine which session to disconnect
      let targetSessionId = userSessionId
      
      if (args && args.length > 1) {
        // If non-owner tries to specify a session ID
        if (!isOwner) {
          return sock.sendMessage(chatDestination, {
            text: `⚠️ *Permission Denied*\n\n` +
            `❌ You can only disconnect your own session\n\n` +
            `Use .disconnect confirm (without session ID) to disconnect your account\n\n` +
            `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖯`
          })
        }
        
        // Owner can specify session ID
        targetSessionId = args[1]
        if (!targetSessionId.startsWith("session_")) {
          targetSessionId = `session_${targetSessionId}`
        }
      }

      // Check if session exists
      const session = sessionManager.activeSockets.get(targetSessionId)
      if (!session) {
        return sock.sendMessage(chatDestination, {
          text: `❌ No active session found!\n\n` +
          `📝 *Session ID:* ${targetSessionId}\n\n` +
          `Use .sessions to see active sessions\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖯`
        })
      }

      // Non-owner can only disconnect their own session
      if (!isOwner && targetSessionId !== userSessionId) {
        return sock.sendMessage(chatDestination, {
          text: `⚠️ *Permission Denied*\n\n` +
          `❌ You can only disconnect your own session\n` +
          `📝 *Your Session:* ${userSessionId}\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖯`
        })
      }

      // Show disconnect message
      const disconnectMsg = await sock.sendMessage(chatDestination, {
        text: `⏳ *Disconnecting session...*\n\n` +
        `📝 *Session ID:* ${targetSessionId}\n` +
        `⏳ *Status:* Disconnecting\n\n` +
        `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖯`
      })

      // Disconnect the session
      await sessionManager.disconnectSession(targetSessionId, "user-requested")

      // Get session metadata safely
      let phoneNumber = "Unknown"
      try {
        const sessionMetadata = await sessionManager.storage?.fileManager?.getSession(targetSessionId)
        phoneNumber = sessionMetadata?.phoneNumber || sessionMetadata?.phone || "Unknown"
      } catch (err) {
        logger.debug(`Could not retrieve phone number for ${targetSessionId}: ${err.message}`)
      }

      const successMessage = `✅ *Session Disconnected*\n\n`
        + `📝 *Session ID:* ${targetSessionId}\n`
        + `📱 *Phone:* ${phoneNumber !== "Unknown" ? `+${phoneNumber}` : phoneNumber}\n`
        + `✅ *Status:* Disconnected\n\n`
        + `The session has been safely disconnected from the bot.\n\n`
        + `${isOwner ? 'You can reconnect or pair a different account with .pair\n\n' : 'Use .pair to reconnect your account\n\n'}`
        + `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖯`

      return sock.sendMessage(chatDestination, { text: successMessage }, { quoted: disconnectMsg })
    } catch (error) {
      logger.error("Disconnect plugin error:", error)
      if (typeof m === 'object' && m?.chat) {
        try {
          sock.sendMessage(m.chat, {
            text: `❌ An error occurred while disconnecting!\n\n` +
            `Error: ${error.message}\n\n` +
            `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖯`
          })
        } catch (sendError) {
          logger.error("Failed to send error message:", sendError)
        }
      }
    }
  },
}
