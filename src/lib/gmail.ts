/** Where a mail opens in Gmail on the web, from the message id the sync kept. */
export const gmailUrl = (messageId: string) => `https://mail.google.com/mail/#all/${encodeURIComponent(messageId)}`;
