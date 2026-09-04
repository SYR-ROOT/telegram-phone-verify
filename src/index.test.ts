import { describe, it, expect } from "vitest";
import {
  mintToken,
  hashToken,
  tokensMatch,
  deepLink,
  isAuthenticWebhook,
  toE164,
  parseUpdate,
} from "./index";

describe("toE164", () => {
  it("adds the missing + that Telegram omits", () => {
    // This is the common case: most Telegram clients send bare digits.
    expect(toE164("963991234567")).toBe("+963991234567");
  });

  it("strips spaces, dashes and an existing +", () => {
    expect(toE164("+963 99 123-4567")).toBe("+963991234567");
  });

  it.each([
    ["too short", "1234567"],
    ["too long", "1234567890123456"],
    ["empty", ""],
    ["letters only", "abcdefgh"],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s", (_label, input) => {
    expect(toE164(input as string)).toBeNull();
  });
});

describe("parseUpdate", () => {
  const chat = { id: 555 };
  const from = { id: 555 };

  it("accepts a contact the user shared about themselves", () => {
    const r = parseUpdate({
      message: { from, chat, contact: { phone_number: "963991234567", user_id: 555 } },
    });
    expect(r).toEqual({
      kind: "verified",
      phone: "+963991234567",
      chatId: "555",
      telegramUserId: "555",
    });
  });

  it("REFUSES a contact belonging to somebody else", () => {
    // The attack this library exists to stop: forwarding a friend's contact
    // card to verify a number you do not control.
    const r = parseUpdate({
      message: { from, chat, contact: { phone_number: "963991234567", user_id: 999 } },
    });
    expect(r).toEqual({ kind: "rejected", reason: "not_own_contact", chatId: "555" });
  });

  it("refuses a contact with no user_id at all", () => {
    const r = parseUpdate({
      message: { from, chat, contact: { phone_number: "963991234567" } },
    });
    expect(r).toEqual({ kind: "rejected", reason: "not_own_contact", chatId: "555" });
  });

  it("refuses an implausible number even when ownership is fine", () => {
    const r = parseUpdate({
      message: { from, chat, contact: { phone_number: "12", user_id: 555 } },
    });
    expect(r).toEqual({ kind: "rejected", reason: "malformed_number", chatId: "555" });
  });

  it("reads the token out of /start", () => {
    const r = parseUpdate({ message: { from, chat, text: "/start abc123" } });
    expect(r).toEqual({
      kind: "start",
      token: "abc123",
      chatId: "555",
      telegramUserId: "555",
    });
  });

  it("handles a bare /start with no token", () => {
    const r = parseUpdate({ message: { from, chat, text: "/start" } });
    expect(r).toMatchObject({ kind: "start", token: null });
  });

  it("ignores ordinary chatter", () => {
    // A user typing digits proves nothing; it must never be read as a number.
    expect(parseUpdate({ message: { from, chat, text: "0991234567" } }))
      .toEqual({ kind: "ignored" });
  });

  it("ignores malformed updates instead of throwing", () => {
    expect(parseUpdate({})).toEqual({ kind: "ignored" });
    expect(parseUpdate({ message: {} })).toEqual({ kind: "ignored" });
    expect(parseUpdate({ message: { from, chat: undefined } })).toEqual({ kind: "ignored" });
  });
});

describe("isAuthenticWebhook", () => {
  it("accepts the matching secret", () => {
    expect(isAuthenticWebhook("s3cret", "s3cret")).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(isAuthenticWebhook("wrong", "s3cret")).toBe(false);
  });

  it("FAILS CLOSED when no secret is configured", () => {
    // A half-finished deployment must not become an open door.
    expect(isAuthenticWebhook("anything", undefined)).toBe(false);
    expect(isAuthenticWebhook("anything", "")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(isAuthenticWebhook(null, "s3cret")).toBe(false);
    expect(isAuthenticWebhook(undefined, "s3cret")).toBe(false);
  });

  it("rejects a prefix of the secret", () => {
    expect(isAuthenticWebhook("s3c", "s3cret")).toBe(false);
  });
});

describe("tokens", () => {
  it("mints a token whose hash matches", () => {
    const { raw, hash } = mintToken();
    expect(hash).toBe(hashToken(raw));
    expect(tokensMatch(hash, hashToken(raw))).toBe(true);
  });

  it("mints a distinct token every time", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintToken().raw));
    expect(seen.size).toBe(200);
  });

  it("stays inside Telegram's 64-character /start payload limit", () => {
    expect(mintToken().raw.length).toBeLessThanOrEqual(64);
  });

  it("rejects a mismatched or malformed hash", () => {
    const { raw } = mintToken();
    expect(tokensMatch(hashToken(raw), hashToken("other"))).toBe(false);
    expect(tokensMatch("", "")).toBe(false);
    expect(tokensMatch("zz", "zz")).toBe(false);
  });
});

describe("deepLink", () => {
  it("builds a t.me link and tolerates a leading @", () => {
    expect(deepLink("@MyBot", "tok")).toBe("https://t.me/MyBot?start=tok");
  });

  it("encodes the token", () => {
    expect(deepLink("MyBot", "a b")).toBe("https://t.me/MyBot?start=a%20b");
  });
});
