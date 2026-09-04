# telegram-phone-verify

Verify a phone number through **Telegram** instead of SMS.
Zero dependencies. No database. Works with any framework.

[العربية](#بالعربية) · MIT

---

## Why

International SMS is unreliable or unavailable across large parts of the world.
Carriers refuse some destinations outright, gateways price others out of reach,
and delivery fails silently for hours. If your users are in one of those places,
"just send an SMS code" is not something you can build on.

Telegram already solved the hard part: it verifies a number by SMS when the
account is created, and it will hand that number to a bot **on the user's
explicit consent**. So rather than verifying a number yourself, you accept
Telegram's verification of it — for free, in a second, with no gateway.

### What it proves

> The person operating this chat controls a Telegram account registered to this
> number.

### What it does not prove

> That they still hold the SIM today, or anything about their legal identity.

Show it to users as *verified via Telegram*. Never call it an identity check.

---

## The check that matters

A Telegram contact card can be **forwarded from anyone in your address book**.
Only a contact the user shares about *themselves* carries a `user_id` equal to
the sender's own id:

```ts
contact.user_id === message.from.id
```

Without that single comparison, anyone can "verify" a number they do not
control by forwarding a friend's contact. Most short examples of this flow leave
it out. That check, and getting the rest of the handshake right around it, is
the entire reason this exists as a library rather than a snippet.

---

## Install

```bash
npm i telegram-phone-verify
```

Node 18+ (uses the built-in `fetch` and `node:crypto`).

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather), keep the token.
2. Generate a random webhook secret, e.g. `openssl rand -hex 32`.
3. Point Telegram at your endpoint:

```ts
import { setWebhook } from "telegram-phone-verify";

await setWebhook(BOT_TOKEN, "https://example.com/telegram/webhook", WEBHOOK_SECRET);
```

## Use

The flow is two steps. You own all storage; the library only validates.

```ts
import {
  mintToken, deepLink, isAuthenticWebhook, parseUpdate,
  requestContactKeyboard, removeKeyboard, sendMessage,
} from "telegram-phone-verify";

// 1. When the user asks to verify, mint a token and send them to Telegram.
//    Store the HASH with the user id and a short expiry. Never store `raw`.
const { raw, hash } = mintToken();
await db.saveToken({ userId, hash, expiresAt: Date.now() + 15 * 60_000 });
const url = deepLink("MyBot", raw);   // open this for the user

// 2. Your webhook.
export async function POST(req: Request) {
  if (!isAuthenticWebhook(
        req.headers.get("x-telegram-bot-api-secret-token"), WEBHOOK_SECRET)) {
    return new Response("ok");            // answer 200, reveal nothing
  }

  const event = parseUpdate(await req.json());

  if (event.kind === "start" && event.token) {
    const row = await db.findLiveToken(hashToken(event.token));
    if (!row) {
      await sendMessage(BOT_TOKEN, event.chatId, "This link expired.");
      return new Response("ok");
    }
    await db.attachChat(row.id, event.chatId);
    await sendMessage(BOT_TOKEN, event.chatId, "Tap below to confirm your number.",
      requestContactKeyboard("Share my phone number"));
  }

  if (event.kind === "verified") {
    await db.markVerified(event.chatId, event.phone, event.telegramUserId);
    await sendMessage(BOT_TOKEN, event.chatId, "Verified.", removeKeyboard());
  }

  if (event.kind === "rejected" && event.reason === "not_own_contact") {
    await sendMessage(BOT_TOKEN, event.chatId,
      "That is somebody else's contact. Use the button to share your own.");
  }

  return new Response("ok");   // always 200: Telegram retries failures for hours
}
```

See [`examples/`](./examples) for runnable code, and **[SETUP.md](./SETUP.md)**
for a step-by-step guide from creating the bot to your first successful
verification.

---

## API

| Function | Purpose |
|---|---|
| `mintToken()` | `{ raw, hash }` — single-use start token. Store the hash only. |
| `hashToken(raw)` | SHA-256 hex digest. |
| `tokensMatch(a, b)` | Constant-time hex comparison. |
| `deepLink(bot, raw)` | The `t.me` URL that starts your bot with the token. |
| `isAuthenticWebhook(header, secret)` | Verify the request really came from Telegram. **Fails closed.** |
| `parseUpdate(update)` | `start` \| `verified` \| `rejected` \| `ignored`. |
| `toE164(raw)` | Normalise to `+<digits>`, or `null` if implausible. |
| `requestContactKeyboard(text)` | Keyboard with `request_contact`. |
| `removeKeyboard()` | Clear it once done. |
| `sendMessage(token, chat, text, markup?)` | Optional helper. Never throws. |
| `setWebhook(token, url, secret)` | Register the webhook with its secret. |

---

## Things to get right

**Store the token hashed.** The raw value is a bearer credential that completes
verification for one account. A leaked database or log must contain nothing
replayable.

**Keep the token short-lived.** Fifteen minutes is plenty; the user is meant to
tap the link immediately.

**Answer the webhook with 200, always.** Telegram retries a non-2xx reply for
hours, so a malformed update you cannot process would be redelivered forever.

**One Telegram account, one of your accounts.** Enforce it with a unique index
on the stored `telegramUserId`, or one person can verify many accounts.

**Never accept a typed number.** Only `contact` messages carry Telegram's own
record. A user typing digits into the chat proves nothing.

**This is not a fallback for people without Telegram.** Keep another route open,
or you will lock those users out entirely.

---

## Development

```bash
npm install
npm test        # vitest
npm run build   # tsc
```

## Contributing

Issues and pull requests are welcome, particularly around correctness of the
verification logic. If you find a security problem, please open an issue
describing the impact.

## License

MIT — use it, fork it, ship it.

---

<a name="بالعربية"></a>

# بالعربية

**توثيق رقم الهاتف عبر تيليجرام بدل الرسائل القصيرة.**
بلا أي اعتمادية، بلا قاعدة بيانات، ومع أي إطار عمل.

## لماذا

الرسائل القصيرة الدولية غير موثوقة أو غير متاحة في مناطق واسعة من العالم:
مشغّلون يرفضون وجهات بعينها، وبوّابات بأسعار لا تُحتمل، وتسليم يفشل بصمت
لساعات. إن كان مستخدموك هناك، فإن «أرسل رمزاً برسالة قصيرة» ليس أساساً يُبنى
عليه.

وتيليجرام حلّ الجزء الصعب أصلاً: هو يتحقّق من الرقم برسالة قصيرة عند إنشاء
الحساب، ثم يسلّم هذا الرقم إلى البوت **بموافقة صريحة من المستخدم**. فبدل أن
تتحقّق أنت من الرقم، تقبل تحقّق تيليجرام منه؛ مجاناً، خلال ثانية، وبلا بوّابة.

### ما الذي يُثبته

> أن مَن يشغّل هذه المحادثة يملك حساب تيليجرام مسجّلاً بهذا الرقم.

### وما لا يُثبته

> أنه ما يزال يحمل الشريحة اليوم، ولا أي شيء عن هويته القانونية.

اعرضه للمستخدمين بوصفه **«موثّق عبر تيليجرام»**، ولا تسمّه تحقّق هوية أبداً.

## الفحص الحاسم

بطاقة جهة الاتصال في تيليجرام **يمكن تمريرها من أي شخص في دفتر عناوينك**. وحدها
البطاقة التي يشاركها المستخدم عن **نفسه** تحمل `user_id` مساوياً لمعرّف المُرسِل:

```ts
contact.user_id === message.from.id
```

بدون هذه المقارنة الواحدة، يستطيع أي شخص «توثيق» رقم لا يملكه بتمرير بطاقة
صديق. ومعظم الأمثلة المختصرة لهذا المسار تُغفلها. هذا الفحص، وضبط بقية
المصافحة حوله، هو سبب وجود هذه المكتبة كمكتبة لا كقصاصة كود.

## نقاط يجب ضبطها

**خزّن الرمز مُجزّأً.** القيمة الخام اعتماد لحاملها يُكمل التوثيق لحساب بعينه،
فلا يجوز أن تحوي قاعدة بيانات مسرَّبة أو سجل شيئاً قابلاً لإعادة الاستخدام.

**اجعل الرمز قصير العمر.** خمس عشرة دقيقة تكفي، فالمقصود أن يفتح المستخدم
الرابط فوراً.

**أجب دائماً بـ200.** تيليجرام يعيد المحاولة لساعات على أي رد غير ناجح.

**حساب تيليجرام واحد لحساب واحد عندك.** افرضه بفهرس فريد، وإلا وثّق شخص واحد
عدة حسابات.

**لا تقبل رقماً مكتوباً أبداً.** رسائل `contact` وحدها تحمل سجل تيليجرام.

**هذه ليست بديلاً لمن لا يملك تيليجرام.** أبقِ طريقاً آخر مفتوحاً، وإلا أقفلت
الباب في وجههم.

## الإعداد

دليل خطوة بخطوة من إنشاء البوت حتى أول توثيق ناجح: **[SETUP.md](./SETUP.md)**

## الرخصة

MIT — استخدمها، عدّلها، انشرها.
