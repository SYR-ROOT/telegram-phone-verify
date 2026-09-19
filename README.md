# telegram-phone-verify

> **وَقفٌ تقنيّ، صدقةً جاريةً عن أرواح شهداء سوريا.**
>
> **A technical _waqf_ — a perpetual open-source endowment, given as an
> ongoing charity for the souls of the martyrs of Syria.**
>
> *إلى أرواح شهداء سوريا. / To the souls of the martyrs of Syria.*
> See [`DEDICATION.md`](DEDICATION.md).

> Verify a phone number through **Telegram** instead of SMS. Where
> international SMS is unreliable or refused outright, Telegram has already
> verified the number — so accept its verification rather than repeating it.

![license](https://img.shields.io/badge/license-MIT-blue.svg)
![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![tests](https://img.shields.io/badge/tests-38%20passing-brightgreen)
![waqf](https://img.shields.io/badge/%D9%88%D9%82%D9%81%20%D8%AA%D9%82%D9%86%D9%8A-technical%20waqf-brightgreen)

Zero dependencies. No database. Works with any framework.

[العربية](#بالعربية)

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

## The checks that matter

**1. The contact must be the sender's own.** A Telegram contact card can be
**forwarded from anyone in your address book**. Only a contact the user shares
about *themselves* carries a `user_id` equal to the sender's own id:

```ts
contact.user_id === message.from.id
```

Without that single comparison, anyone can "verify" a number they do not
control by forwarding a friend's contact.

**2. The chat must be private.** The flow ties a pending verification to the
chat it happens in. In a private chat the chat *is* the user; in a group every
member shares one chat id. Typed into a group, `/start <token>` would bind the
token to the group, and any member who then shared their *own* contact there
would pass check 1 honestly — and verify the token owner's account with
someone else's number. `parseUpdate` ignores every update from a group or
channel, and also requires `chat.id === from.id`, so an update with no `type`
cannot slip through.

**3. A phone must stand behind the number.** Telegram's anonymous `+888`
numbers are bought on Fragment and sign in with no SIM and no SMS, so Telegram
never verified them by SMS at all. They are rejected as `anonymous_number`.

Most short examples of this flow leave all three out. Getting them right, and
the handshake around them, is the entire reason this exists as a library rather
than a snippet.

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

  if (event.kind === "rejected" && event.reason === "anonymous_number") {
    await sendMessage(BOT_TOKEN, event.chatId,
      "Anonymous +888 numbers cannot be verified. Use an account with a real number.");
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
| `parseUpdate(update)` | `start` \| `verified` \| `rejected` \| `ignored`. Private chats only. |
| `isAnonymousNumber(e164)` | `true` for a Telegram `+888` number. `parseUpdate` already rejects them. |
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

**Keep the bot out of groups.** `parseUpdate` already ignores them, but there is
no reason to let the bot join one at all: send `/setjoingroups` to BotFather and
choose **Disable**.

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

MIT — use it, fork it, ship it. No attribution required, no strings.

This is a **technical waqf**: released permanently, for anyone, with no
expectation of return. See [`DEDICATION.md`](DEDICATION.md).

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

## الفحوص الحاسمة

**1. أن تكون البطاقة بطاقة المُرسِل نفسه.** بطاقة جهة الاتصال في تيليجرام **يمكن
تمريرها من أي شخص في دفتر عناوينك**. وحدها البطاقة التي يشاركها المستخدم عن
**نفسه** تحمل `user_id` مساوياً لمعرّف المُرسِل:

```ts
contact.user_id === message.from.id
```

بدون هذه المقارنة، يستطيع أي شخص «توثيق» رقم لا يملكه بتمرير بطاقة صديق.

**2. أن تكون المحادثة خاصة.** المسار يربط طلب التوثيق المعلّق بالمحادثة التي جرى
فيها. في المحادثة الخاصة المحادثةُ هي المستخدم نفسه، أما في المجموعة فيتشارك جميع
الأعضاء معرّفاً واحداً. لو كُتب `/start <token>` داخل مجموعة لارتبط الرمز
بالمجموعة، ولو شارك أي عضو فيها بطاقته **هو** لاجتاز الفحص الأول بصدق، ولوُثّق
حساب صاحب الرمز برقم شخص آخر. لذلك يتجاهل `parseUpdate` كل ما يرد من مجموعة أو
قناة، ويشترط أيضاً `chat.id === from.id` كي لا يمرّ تحديث خالٍ من `type`.

**3. أن يكون وراء الرقم هاتف.** أرقام تيليجرام المجهولة `+888` تُشترى من Fragment
وتسجّل الدخول بلا شريحة ولا رسالة نصية، فتيليجرام لم يتحقق منها برسالة قط.
تُرفض بالسبب `anonymous_number`.

ومعظم الأمثلة المختصرة لهذا المسار تُغفل الفحوص الثلاثة. ضبطها، وضبط بقية
المصافحة حولها، هو سبب وجود هذه المكتبة كمكتبة لا كقصاصة كود.

## نقاط يجب ضبطها

**خزّن الرمز مُجزّأً.** القيمة الخام اعتماد لحاملها يُكمل التوثيق لحساب بعينه،
فلا يجوز أن تحوي قاعدة بيانات مسرَّبة أو سجل شيئاً قابلاً لإعادة الاستخدام.

**اجعل الرمز قصير العمر.** خمس عشرة دقيقة تكفي، فالمقصود أن يفتح المستخدم
الرابط فوراً.

**أجب دائماً بـ200.** تيليجرام يعيد المحاولة لساعات على أي رد غير ناجح.

**حساب تيليجرام واحد لحساب واحد عندك.** افرضه بفهرس فريد، وإلا وثّق شخص واحد
عدة حسابات.

**لا تقبل رقماً مكتوباً أبداً.** رسائل `contact` وحدها تحمل سجل تيليجرام.

**أبقِ البوت خارج المجموعات.** `parseUpdate` يتجاهلها أصلاً، لكن لا داعي لأن
يدخل البوت مجموعة من الأساس: أرسل `/setjoingroups` إلى BotFather واختر
**Disable**.

**هذه ليست بديلاً لمن لا يملك تيليجرام.** أبقِ طريقاً آخر مفتوحاً، وإلا أقفلت
الباب في وجههم.

## الإعداد

دليل خطوة بخطوة من إنشاء البوت حتى أول توثيق ناجح: **[SETUP.md](./SETUP.md)**

## الرخصة

MIT — استخدمها، عدّلها، انشرها. بلا شرط إسناد، وبلا مقابل.

هذا **وقف تقنيّ**: مُخرَج للناس إخراجاً دائماً، صدقةً جاريةً عن أرواح شهداء
سوريا. انظر [`DEDICATION.md`](DEDICATION.md).
