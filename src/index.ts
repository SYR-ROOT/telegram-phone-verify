/**
 * telegram-phone-verify
 *
 * Verify a phone number through Telegram instead of SMS.
 *
 * WHY THIS EXISTS
 * ---------------
 * International SMS is unreliable or unavailable in large parts of the world:
 * carriers refuse some destinations outright, gateways price others out of
 * reach, and delivery can silently fail for hours. For a product serving those
 * regions, "send an SMS code" is not an option you can build on.
 *
 * Telegram already solved the hard part. It verifies a phone number by SMS when
 * the account is created, and it will hand that number to a bot on the user's
 * explicit consent. So instead of verifying a number yourself, you accept
 * Telegram's verification of it.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT
 * ------------------------------------
 * Proves: the person operating this chat controls a Telegram account that is
 * registered to this number.
 * Does NOT prove: that they still hold the SIM today, or their legal identity.
 * Present it to users as "verified via Telegram", never as an identity check.
 *
 * DESIGN
 * ------
 * Zero dependencies, zero storage, zero framework. Every function is pure
 * except the optional `sendMessage` helper. You own the database; this library
 * only turns a raw Telegram update into a validated fact, or refuses to.
 *
 * MIT licensed.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The subset of a Telegram update this library reads. */
export type TelegramUpdate = {
  message?: {
    text?: string;
    from?: { id?: number };
    chat?: { id?: number };
    contact?: {
      phone_number?: string;
      user_id?: number;
      first_name?: string;
    };
  };
};

export type ParsedUpdate =
  /** User opened the deep link. Look the token up; if it is live and unused,
   *  remember `chatId` against it and reply with `requestContactKeyboard()`. */
  | { kind: "start"; token: string | null; chatId: string; telegramUserId: string }
  /** User shared their OWN contact and it passed every check. Safe to store. */
  | { kind: "verified"; phone: string; chatId: string; telegramUserId: string }
  /** A contact arrived but must be REFUSED. `reason` says why. */
  | { kind: "rejected"; reason: RejectReason; chatId: string }
  /** Anything else (plain text, a sticker, a channel post). Ignore it. */
  | { kind: "ignored" };

export type RejectReason =
  /** The contact belongs to somebody else in the sender's address book. This
   *  is the attack this library exists to stop. */
  | "not_own_contact"
  /** The number is not a plausible international number. */
  | "malformed_number";

// ---------------------------------------------------------------------------
// Start tokens
// ---------------------------------------------------------------------------

/**
 * Mint a single-use start token.
 *
 * Store `hash`, never `raw`. The raw value travels only inside the deep link
 * the user themselves opens: it is a bearer credential that completes
 * verification for one specific account, so a leaked database or log must not
 * contain anything replayable.
 *
 * 24 bytes of base64url is 32 characters, comfortably inside Telegram's 64
 * character limit for a `/start` payload.
 */
export function mintToken(): { raw: string; hash: string } {
  const raw = randomBytes(24).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Constant-time comparison of two hex digests.
 *
 * Use this rather than `===` when checking a token a user supplied, so the
 * comparison cannot be timed to recover the stored value byte by byte.
 */
export function tokensMatch(aHex: string, bHex: string): boolean {
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(aHex, "hex");
    b = Buffer.from(bHex, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** The `t.me` link that starts your bot with this token. */
export function deepLink(botUsername: string, rawToken: string): string {
  const bot = botUsername.trim().replace(/^@/, "");
  return `https://t.me/${bot}?start=${encodeURIComponent(rawToken)}`;
}

// ---------------------------------------------------------------------------
// Webhook authentication
// ---------------------------------------------------------------------------

/**
 * Check the secret Telegram echoes back in `X-Telegram-Bot-Api-Secret-Token`.
 *
 * Your webhook is a public URL, so this is the only thing standing between a
 * stranger and a forged "contact" that marks any account verified. Register the
 * same secret with `setWebhook`.
 *
 * FAILS CLOSED: with no secret configured, nothing is accepted. A half-finished
 * deployment must never be an open door.
 */
export function isAuthenticWebhook(
  headerValue: string | null | undefined,
  expectedSecret: string | null | undefined,
): boolean {
  if (!expectedSecret) return false;
  if (!headerValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expectedSecret);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Phone normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a Telegram-supplied number to E.164 (`+` followed by digits).
 *
 * Telegram sends the number WITHOUT a leading `+` in most clients, sometimes
 * with one, occasionally with spaces or dashes. Normalise once, here, so the
 * rest of your system only ever sees one shape.
 *
 * Returns null for anything implausible, so a malformed payload can never be
 * written as though it were verified. ITU E.164 caps a number at 15 digits; the
 * lower bound of 8 is the shortest country code plus subscriber number seen in
 * practice.
 */
export function toE164(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

// ---------------------------------------------------------------------------
// The handshake
// ---------------------------------------------------------------------------

/**
 * Turn a raw Telegram update into a validated result.
 *
 * THE CHECK THAT MATTERS
 * ----------------------
 * A Telegram contact card can be forwarded from anyone in the sender's address
 * book. Only a contact the user shared about THEMSELVES carries a `user_id`
 * equal to the sender's own id.
 *
 * Without that comparison, anyone could "verify" a number belonging to someone
 * else simply by forwarding their contact — which defeats the entire purpose.
 * Most naive implementations of this flow omit it. It is the single reason this
 * library exists as a library rather than a snippet.
 */
export function parseUpdate(update: TelegramUpdate): ParsedUpdate {
  const msg = update?.message;
  if (!msg?.from?.id || !msg.chat?.id) return { kind: "ignored" };

  const chatId = String(msg.chat.id);
  const telegramUserId = String(msg.from.id);

  const contact = msg.contact;
  if (contact) {
    if (String(contact.user_id ?? "") !== telegramUserId) {
      return { kind: "rejected", reason: "not_own_contact", chatId };
    }
    const phone = toE164(contact.phone_number);
    if (!phone) {
      return { kind: "rejected", reason: "malformed_number", chatId };
    }
    return { kind: "verified", phone, chatId, telegramUserId };
  }

  const start = /^\/start(?:\s+(\S+))?/.exec(msg.text ?? "");
  if (start) {
    return { kind: "start", token: start[1] ?? null, chatId, telegramUserId };
  }

  return { kind: "ignored" };
}

/**
 * The keyboard that asks the user to share their own contact card.
 *
 * `request_contact` is what makes Telegram send the number from its records.
 * A user typing digits into a chat proves nothing, so never accept a plain
 * text message as a phone number.
 */
export function requestContactKeyboard(buttonText: string) {
  return {
    keyboard: [[{ text: buttonText, request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

/** Clears the custom keyboard once verification is done. */
export function removeKeyboard() {
  return { remove_keyboard: true };
}

// ---------------------------------------------------------------------------
// Optional transport
// ---------------------------------------------------------------------------

/**
 * Minimal `sendMessage`. Provided for convenience; use your own HTTP client if
 * you prefer.
 *
 * Never throws: a Telegram outage must not break the webhook that called it,
 * and Telegram retries any non-2xx reply for hours.
 */
export async function sendMessage(
  botToken: string,
  chatId: string | number,
  text: string,
  replyMarkup?: unknown,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Register your webhook with Telegram, including the shared secret. */
export async function setWebhook(
  botToken: string,
  url: string,
  secretToken: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          secret_token: secretToken,
          // Only messages are needed; asking for less limits what a compromised
          // webhook could ever observe.
          allowed_updates: ["message"],
        }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
