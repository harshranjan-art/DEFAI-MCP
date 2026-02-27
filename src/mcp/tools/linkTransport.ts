export function executeLinkTelegram(userId: string): string {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  const botLine = botUsername
    ? `1. Open https://t.me/${botUsername} in Telegram`
    : `1. Open the DeFAI bot in Telegram (ask the server admin for the bot username)`;

  return [
    `To link your Telegram account:`,
    ``,
    botLine,
    `2. Send this command: /link ${userId}`,
    `3. The bot will confirm the link`,
    ``,
    `Note: The Telegram bot must be running on the server for this to work.`,
    `Once linked, you'll receive alerts via Telegram and can use all bot commands.`,
  ].join('\n');
}
