/**
 * Where a mail opens in Gmail on the web, from the message id the sync kept. With the connected
 * address it opens in that mailbox, not whichever Google account the browser lists first.
 */
export const gmailUrl = (messageId: string, email?: string | null) =>
  `https://mail.google.com/mail/${email ? `u/${encodeURIComponent(email).replace(/%40/g, "@")}/` : ""}#all/${encodeURIComponent(messageId)}`;
