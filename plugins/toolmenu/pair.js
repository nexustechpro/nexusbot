import { createComponentLogger } from "../../utils/logger.js"
import { getSessionManager } from "../../whatsapp/sessions/index.js"
import { sanitizePhoneNumber } from "../../utils/phone-input.js"

const logger = createComponentLogger("PAIR_PLUGIN")
const MAX_SESSIONS = 5

export default {
  name: "pair",
  aliases: ["pairaccount", "addaccount"],
  category: "toolmenu",
  description: "Pair your WhatsApp account with the bot",
  usage: ".pair <phone_number>",
  cooldown: 30,

  async execute(sock, m, { args, isCreator }) {
    if (!args.length) {
      return m.reply(
        `❌ Please provide a phone number!\n\n` +
        `📱 *Usage:* .pair <phone_number>\n\n` +
        `✨ *Examples:*\n` +
        `  .pair 2348012345678\n` +
        `  .pair +234 801 234 5678\n\n` +
        `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      )
    }

    const phoneInput = args.join(" ")
    const phoneNumber = sanitizePhoneNumber(phoneInput)

    if (!phoneNumber) {
      return m.reply(
        `❌ Invalid phone number format!\n\n` +
        `Phone number must be 10-15 digits\n\n` +
        `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      )
    }

    try {
      // Get session manager
      const sessionManager = getSessionManager()
      if (!sessionManager) {
        logger.error("Session manager not initialized")
        return m.reply(
          `❌ System error: Session manager not ready\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        )
      }

      // Check total active sessions
      const totalActiveSessions = sessionManager.activeSockets.size
      logger.info(`Current active sessions: ${totalActiveSessions}/${MAX_SESSIONS}`)

      if (totalActiveSessions >= MAX_SESSIONS) {
        return m.reply(
          `⚠️ *Maximum Session Limit Reached!*\n\n` +
          `📊 *Active Sessions:* ${totalActiveSessions}/${MAX_SESSIONS}\n` +
          `❌ Cannot pair new accounts\n\n` +
          `The bot has reached its maximum capacity of ${MAX_SESSIONS} paired accounts.\n\n` +
          `Please try again later or contact the bot administrator.\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        )
      }

      // Create unique session ID based on sender
      const sessionId = `session_${m.sender.split("@")[0]}`
      const userId = m.sender.split("@")[0]

      // Check if user already has an active session
      const existingSession = sessionManager.activeSockets.get(sessionId)
      if (existingSession?.user) {
        return m.reply(
          `⚠️ You already have an active session!\n\n` +
          `📱 *Phone:* +${phoneNumber}\n` +
          `✅ *Status:* Connected\n\n` +
          `Use .disconnect to disconnect this session first\n\n` +
          `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
        )
      }

      // Show initial message
      let pairingMessage = `⏳ *Starting pairing process...*\n\n`
      pairingMessage += `📱 *Phone:* +${phoneNumber}\n`
      pairingMessage += `📊 *Sessions:* ${totalActiveSessions + 1}/${MAX_SESSIONS}\n`
      pairingMessage += `⏳ *Status:* Initializing session\n\n`
      pairingMessage += `Waiting for pairing code...\n\n`
      pairingMessage += `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

      const statusMsg = await m.reply(pairingMessage)

      let pairingCode = null
      let successMessageSent = false

      // Create session with callbacks
      const sessionPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Pairing timeout - no response from WhatsApp"))
        }, 300000) // 5 minute timeout

        sessionManager
          .createSession(
            userId,
            phoneNumber,
            {
              onPairingCode: async (code) => {
                pairingCode = code
                logger.info(`Pairing code generated for ${sessionId}: ${code}`)

                // First message - Basic pairing code
                const codeMessage = `✅ *Pairing Code Ready!*\n\n`
                  + `📱 *Phone:* +${phoneNumber}\n`
                  + `🔐 *Pairing Code:*\n\`\`\`\n${code}\n\`\`\`\n\n`
                  + `📖 *Instructions:*\n`
                  + `1. Open WhatsApp on your phone\n`
                  + `2. Go to Settings → Linked Devices\n`
                  + `3. Tap "Link a Device"\n`
                  + `4. Select "Link with Phone Number"\n`
                  + `5. Enter your phone number and scan the QR code OR\n`
                  + `6. Enter the pairing code shown above\n\n`
                  + `⏳ Waiting for connection...\n\n`
                  + `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

                await sock.sendMessage(m.chat, { text: codeMessage }, { quoted: statusMsg })

                // Second message - Interactive with copy button
                const interactiveMessage = `✅ *Quick Copy Pairing Code*\n\n`
                  + `📱 *Phone:* +${phoneNumber}\n`
                  + `🔐 *Code:* ${code}\n\n`
                  + `Tap the button below to copy the code instantly!\n\n`
                  + `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

                await sock.sendMessage(m.chat, {
                  text: interactiveMessage,
                  interactiveButtons: [
                    {
                      name: "cta_copy",
                      buttonParamsJson: JSON.stringify({
                        display_text: "📋 Copy Pairing Code",
                        id: `pairing_${sessionId}`,
                        copy_code: code
                      })
                    }
                  ]
                }, { quoted: statusMsg })
              },

              onConnected: (connectedSock) => {
                logger.info(`✅ [PAIR_PLUGIN] Connection confirmed for ${sessionId}`)
                
                if (!successMessageSent) {
                  successMessageSent = true
                  clearTimeout(timeout)

                  const currentSessions = sessionManager.activeSockets.size

                  // Final confirmation message
                  const successMessage = `✅ *Account Paired Successfully!*\n\n`
                    + `📱 *Phone:* +${phoneNumber}\n`
                    + `✅ *Status:* Connected & Ready\n`
                    + `🔐 *Session ID:* ${sessionId}\n`
                    + `📊 *Active Sessions:* ${currentSessions}/${MAX_SESSIONS}\n\n`
                    + `🎉 Your WhatsApp account is now paired with the bot!\n`
                    + `You can now use all bot features.\n\n`
                    + `📝 *Useful Commands:*\n`
                    + `  .disconnect - Disconnect this session\n`
                    + `  .sessions - Show all active sessions\n\n`
                    + `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

                  sock.sendMessage(m.chat, { text: successMessage }, { quoted: statusMsg })
                  resolve({ success: true, sessionId, phoneNumber })
                }
              },

              onError: (error) => {
                logger.error(`Pairing error for ${sessionId}:`, error.message)
                clearTimeout(timeout)
                reject(error)
              },

              onDisconnected: () => {
                logger.warn(`Session ${sessionId} disconnected during pairing`)
                clearTimeout(timeout)
                reject(new Error("Connection lost during pairing"))
              },
            },
            false, // isReconnect
            "pairing" // source
          )
          .catch((error) => {
            clearTimeout(timeout)
            logger.error(`Session creation failed: ${error.message}`)
            reject(error)
          })
      })

      // Wait for session to be fully paired
      try {
        await sessionPromise
      } catch (error) {
        logger.error(`Pairing failed for ${sessionId}:`, error.message)

        const errorMessage = `❌ *Pairing Failed*\n\n`
          + `📱 *Phone:* +${phoneNumber}\n`
          + `❌ *Error:* ${error.message}\n\n`
          + `Please try again with a valid phone number.\n\n`
          + `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`

        return sock.sendMessage(m.chat, { text: errorMessage }, { quoted: statusMsg })
      }
    } catch (error) {
      logger.error("Pairing plugin error:", error)
      m.reply(
        `❌ An unexpected error occurred!\n\n` +
        `Error: ${error.message}\n\n` +
        `> © 𝕹𝖊𝖝𝖚𝖘 𝕭𝖔𝖙`
      )
    }
  },
}