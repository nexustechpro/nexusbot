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
  usage: ".disconnect [session_id]",
  cooldown: 10,

  async execute(sock, m, { args }) {
    try {
      const sessionManager = getSessionManager()
      if (!sessionManager) {
        logger.error("Session manager not initialized")
        return sock.sendMessage(m.chat, {
          text: `❌ System error: Session manager not ready\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        })
      }

      const isOwner = isMainOwner(m.sender)
      const userSessionId = `session_${m.sender.split("@")[0]}`
      
      // Determine which session to disconnect
      let targetSessionId = userSessionId
      
      if (args.length > 0) {
        // If non-owner tries to specify a session ID
        if (!isOwner) {
          return sock.sendMessage(m.chat, {
            text: `⚠️ *Permission Denied*\n\n` +
            `❌ You can only disconnect your own session\n\n` +
            `Use .disconnect (without arguments) to disconnect your account\n\n` +
            `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
          })
        }
        
        // Owner can specify session ID
        targetSessionId = args[0]
        if (!targetSessionId.startsWith("session_")) {
          targetSessionId = `session_${targetSessionId}`
        }
      }

      // Check if session exists
      const session = sessionManager.activeSockets.get(targetSessionId)
      if (!session) {
        return sock.sendMessage(m.chat, {
          text: `❌ No active session found!\n\n` +
          `📝 *Session ID:* ${targetSessionId}\n\n` +
          `Use .sessions to see active sessions\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        })
      }

      // Non-owner can only disconnect their own session
      if (!isOwner && targetSessionId !== userSessionId) {
        return sock.sendMessage(m.chat, {
          text: `⚠️ *Permission Denied*\n\n` +
          `❌ You can only disconnect your own session\n` +
          `📝 *Your Session:* ${userSessionId}\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        })
      }

      // Show disconnect message
      const disconnectMsg = await sock.sendMessage(m.chat, {
        text: `⏳ *Disconnecting session...*\n\n` +
        `📝 *Session ID:* ${targetSessionId}\n` +
        `⏳ *Status:* Disconnecting\n\n` +
        `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      })

      // Disconnect the session
      await sessionManager.disconnectSession(targetSessionId, "user-requested")

      // Confirmation message
      const phoneNumber = session?.user?.phoneNumber || "Unknown"
      const successMessage = `✅ *Session Disconnected*\n\n`
        + `📝 *Session ID:* ${targetSessionId}\n`
        + `📱 *Phone:* +${phoneNumber}\n`
        + `✅ *Status:* Disconnected\n\n`
        + `The session has been safely disconnected from the bot.\n\n`
        + `${isOwner ? 'You can reconnect or pair a different account with .pair\n\n' : 'Use .pair to reconnect your account\n\n'}`
        + `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      return sock.sendMessage(m.chat, { text: successMessage }, { quoted: disconnectMsg })
    } catch (error) {
      logger.error("Disconnect plugin error:", error)
      sock.sendMessage(m.chat, {
        text: `❌ An error occurred while disconnecting!\n\n` +
        `Error: ${error.message}\n\n` +
        `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      })
    }
  },
}