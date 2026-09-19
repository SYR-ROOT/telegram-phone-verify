/**
 * Runnable example: Express + an in-memory store.
 *
 * Swap `store` for your real database. Everything else is the whole flow.
 *
 *   BOT_TOKEN=... BOT_USERNAME=... WEBHOOK_SECRET=... node examples/express.js
 */

import express from "express";
import {
  mintToken,
  hashToken,
  deepLink,
  isAuthenticWebhook,
  parseUpdate,
  requestContactKeyboard,
  removeKeyboard,
  sendMessage,
} from "telegram-phone-verify";

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!BOT_TOKEN || !BOT_USERNAME || !WEBHOOK_SECRET) {
  console.error("Set BOT_TOKEN, BOT_USERNAME and WEBHOOK_SECRET.");
  process.exit(1);
}

// Stand-in for your database. Two lookups are needed: by token hash (step 1)
// and by chat id (step 2), because the contact message carries no token.
const store = {
  byHash: new Map(), // hash -> { userId, expiresAt, chatId }
  verified: new Map(), // userId -> { phone, telegramUserId }
};

const app = express();
app.use(express.json());

/** Step 1a: the user asks to verify. Hand them a link. */
app.post("/start-verification", (req, res) => {
  const userId = String(req.body.userId);
  const { raw, hash } = mintToken();
  // Store the HASH. The raw token exists only inside the link the user opens.
  store.byHash.set(hash, { userId, expiresAt: Date.now() + 15 * 60_000 });
  res.json({ url: deepLink(BOT_USERNAME, raw) });
});

/** Steps 1b and 2: everything Telegram sends us. */
app.post("/telegram/webhook", async (req, res) => {
  // Always reply 200, even when refusing: Telegram retries a non-2xx for hours,
  // and a silent 200 tells a prober nothing about what exists here.
  const authentic = isAuthenticWebhook(
    req.get("x-telegram-bot-api-secret-token"),
    WEBHOOK_SECRET,
  );
  if (!authentic) return res.send("ok");

  const event = parseUpdate(req.body);

  if (event.kind === "start") {
    if (!event.token) {
      await sendMessage(BOT_TOKEN, event.chatId,
        "Open the verification link from your account settings to begin.");
      return res.send("ok");
    }
    const row = store.byHash.get(hashToken(event.token));
    if (!row || row.expiresAt < Date.now()) {
      await sendMessage(BOT_TOKEN, event.chatId,
        "This verification link has expired. Generate a new one.");
      return res.send("ok");
    }
    // Remember which chat is completing this token: the contact message that
    // follows carries no token of its own.
    row.chatId = event.chatId;
    await sendMessage(BOT_TOKEN, event.chatId,
      "Tap the button below and Telegram will send us the number it already " +
      "verified for your account.",
      requestContactKeyboard("Share my phone number"));
    return res.send("ok");
  }

  if (event.kind === "verified") {
    const entry = [...store.byHash.values()].find((r) => r.chatId === event.chatId);
    if (!entry) {
      await sendMessage(BOT_TOKEN, event.chatId, "No active verification request.");
      return res.send("ok");
    }
    // Enforce one Telegram account per user here, e.g. a unique index on
    // telegramUserId. Without it, one person can verify many accounts.
    store.verified.set(entry.userId, {
      phone: event.phone,
      telegramUserId: event.telegramUserId,
    });
    console.log(`verified ${entry.userId}: ${event.phone}`);
    await sendMessage(BOT_TOKEN, event.chatId, "Your number is verified.",
      removeKeyboard());
    return res.send("ok");
  }

  if (event.kind === "rejected") {
    const msg =
      event.reason === "not_own_contact"
        ? "That is someone else's contact card. Use the button so Telegram " +
          "sends your own number."
        : event.reason === "anonymous_number"
          ? "Anonymous +888 numbers cannot be verified. Please use a Telegram " +
            "account registered to a real phone number."
          : "That number could not be read. Please try again.";
    await sendMessage(BOT_TOKEN, event.chatId, msg);
    return res.send("ok");
  }

  res.send("ok");
});

app.listen(3000, () => console.log("listening on :3000"));
