import { describe, it, expect } from "vitest";
import {
  mintToken,
  hashToken,
  tokensMatch,
  deepLink,
  isAuthenticWebhook,
  toE164,
  parseUpdate,
  isAnonymousNumber,
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

describe("parseUpdate - private chats only", () => {
  // A group's id is negative and shared by every member, so the person who
  // typed the token and the person sharing a contact can be different people
  // in the same chat.
  const owner = { id: 111 };
  const bystander = { id: 222 };
  const group = { id: -100987654321, type: "supergroup" };

  it("IGNORES a /start typed into a group, so a token is never bound to one", () => {
    // Step one of the attack: attach somebody's token to a shared chat.
    const r = parseUpdate({ message: { from: owner, chat: group, text: "/start abc123" } });
    expect(r).toEqual({ kind: "ignored" });
  });

  it("IGNORES a member's OWN contact shared in a group", () => {
    // Step two. It really is the bystander's own contact, so the ownership
    // check passes honestly. Only the chat check stands between this and the
    // token owner's account being verified with the bystander's number.
    const r = parseUpdate({
      message: {
        from: bystander,
        chat: group,
        contact: { phone_number: "963991234567", user_id: 222 },
      },
    });
    expect(r).toEqual({ kind: "ignored" });
  });

  it.each([["group"], ["supergroup"], ["channel"]])("ignores a %s chat on its type alone", (type) => {
    // The id deliberately equals the sender's, so only the type can refuse it.
    const r = parseUpdate({
      message: {
        from: owner,
        chat: { id: 111, type },
        contact: { phone_number: "963991234567", user_id: 111 },
      },
    });
    expect(r).toEqual({ kind: "ignored" });
  });

  it("ignores a chat that is not the sender's, even with no type at all", () => {
    // A hand-built update without `type` must not slip past on the missing field.
    const r = parseUpdate({
      message: {
        from: bystander,
        chat: { id: -100987654321 },
        contact: { phone_number: "963991234567", user_id: 222 },
      },
    });
    expect(r).toEqual({ kind: "ignored" });
  });

  it("still verifies in a private chat that states its type", () => {
    const r = parseUpdate({
      message: {
        from: owner,
        chat: { id: 111, type: "private" },
        contact: { phone_number: "963991234567", user_id: 111 },
      },
    });
    expect(r).toMatchObject({ kind: "verified", phone: "+963991234567" });
  });
});

describe("anonymous numbers", () => {
  const chat = { id: 555, type: "private" };
  const from = { id: 555 };

  it("REFUSES a Telegram +888 number, which has no SIM behind it", () => {
    const r = parseUpdate({
      message: { from, chat, contact: { phone_number: "88801234567", user_id: 555 } },
    });
    expect(r).toEqual({ kind: "rejected", reason: "anonymous_number", chatId: "555" });
  });

  it("matches the country prefix only, not 888 anywhere in the number", () => {
    // +1 888 is a real North American toll-free range, not an anonymous number.
    const r = parseUpdate({
      message: { from, chat, contact: { phone_number: "18885551234", user_id: 555 } },
    });
    expect(r).toMatchObject({ kind: "verified", phone: "+18885551234" });
  });

  it("checks ownership first, so a forwarded +888 card is not_own_contact", () => {
    const r = parseUpdate({
      message: { from, chat, contact: { phone_number: "88801234567", user_id: 999 } },
    });
    expect(r).toEqual({ kind: "rejected", reason: "not_own_contact", chatId: "555" });
  });

  it("isAnonymousNumber reads E.164", () => {
    expect(isAnonymousNumber("+88801234567")).toBe(true);
    expect(isAnonymousNumber("+963991234567")).toBe(false);
    expect(isAnonymousNumber("+18885551234")).toBe(false);
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
