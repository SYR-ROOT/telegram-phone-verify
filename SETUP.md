# Setup guide

From an empty Telegram account to a working verification flow.
Roughly ten minutes. [العربية](#دليل-الإعداد-بالعربية)

---

## 1. Create the bot

Open Telegram and message [@BotFather](https://t.me/BotFather) — the one with
the blue verified tick.

```
/newbot
```

He asks two things:

**Display name** — what users see at the top of the chat. Make it obviously
yours, because people are about to hand it a phone number:

```
Acme Verification
```

**Username** — must be unique and end in `bot`:

```
AcmeVerifyBot
```

He replies with a line like:

```
Use this token to access the HTTP API:
1234567890:REPLACE-WITH-YOUR-TOKEN-FROM-BOTFATHER
```

**That token is a password for your bot.** Anyone holding it can read every
message sent to it and send messages as it. Never commit it, never put it in
client-side code, never paste it into a public issue. If it leaks, send
`/revoke` to BotFather and you get a fresh one.

### Make the bot look trustworthy

You are asking strangers for a phone number, so a blank profile costs you
completions. Two commands, worth the minute:

```
/setdescription
```
Pick your bot, then send text shown before a user presses Start:

> Official verification bot. Confirms your phone number so we know your account
> is real. We cannot read your messages or your contacts.

```
/setuserpic
```
Upload your logo.

Optional but nice — the greeting inside an open chat:

```
/setabouttext
```

### Keep the bot out of groups

The bot only ever talks to one person at a time, in a private chat. The library
already ignores anything from a group, but there is no reason to let the bot
join one:

```
/setjoingroups
```
Pick your bot, then choose **Disable**.

---

## 2. Generate a webhook secret

Telegram will echo this back on every request so you can tell a real update from
a stranger posting to your URL. Generate 32 random bytes:

```bash
openssl rand -hex 32
```

Or without openssl:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep it with your bot token, in the same place your other secrets live.

---

## 3. Configure your app

```bash
# .env  — never commit this file
BOT_TOKEN=1234567890:REPLACE-WITH-YOUR-TOKEN-FROM-BOTFATHER
BOT_USERNAME=AcmeVerifyBot
WEBHOOK_SECRET=<the 64 hex characters from step 2>
```

Install the library:

```bash
npm i telegram-phone-verify
```

---

## 4. Expose an endpoint

Your webhook must be:

- **HTTPS.** Telegram refuses plain HTTP.
- **Publicly reachable.** No IP allowlist, no basic auth in front of it.
- **Port 443, 80, 88 or 8443.** Telegram will not call anything else.

A `POST` handler at, say, `https://example.com/telegram/webhook`. See
[`examples/express.js`](./examples/express.js) for a complete one.

### Testing locally

Telegram cannot reach `localhost`, so tunnel it:

```bash
npx localtunnel --port 3000
# or
ngrok http 3000
```

Use the HTTPS URL it prints as your webhook, and re-register whenever it
changes.

---

## 5. Register the webhook

Once, after the endpoint is live:

```bash
curl -F "url=https://example.com/telegram/webhook" \
     -F "secret_token=$WEBHOOK_SECRET" \
     -F "allowed_updates=[\"message\"]" \
     "https://api.telegram.org/bot$BOT_TOKEN/setWebhook"
```

Or from code:

```ts
import { setWebhook } from "telegram-phone-verify";
await setWebhook(BOT_TOKEN, "https://example.com/telegram/webhook", WEBHOOK_SECRET);
```

Expect:

```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

**`allowed_updates` matters.** Asking only for `message` means Telegram never
sends you anything else, which limits what a compromised endpoint could observe.

---

## 6. Verify the registration

```bash
curl "https://api.telegram.org/bot$BOT_TOKEN/getWebhookInfo"
```

Read three fields:

| Field | What you want |
|---|---|
| `url` | Exactly your endpoint |
| `pending_update_count` | `0` — anything else means you are not answering |
| `last_error_message` | absent |

Common errors and what they mean:

| Message | Cause |
|---|---|
| `SSL error` | Certificate invalid, expired, or missing its intermediate chain |
| `Connection timed out` | Endpoint unreachable, or behind a firewall |
| `Wrong response from the webhook: 404` | Path typo |
| `Wrong response from the webhook: 500` | Your handler threw — check your logs |

---

## 7. Walk through it yourself

1. Open `https://t.me/AcmeVerifyBot?start=SOME_TOKEN` (mint a real token first).
2. Press **Start**. You should get your prompt plus a **Share my phone number**
   button.
3. Press the button. Telegram warns you it will send your number — accept.
4. You should get your success message, and your database should hold the number
   in `+<digits>` form.

**Test the refusal too.** Attach a different contact from your address book
using the paperclip instead of the button. You must be refused with
`not_own_contact`. If you are not, the ownership check is not wired up and
anyone can verify a number they do not own.

---

## Going to production

**Rate-limit the mint endpoint.** Each token is a bearer credential; without a
cap a script can churn them for an account it is sitting on.

**Expire tokens in about 15 minutes** and mark them used on success.

**Unique index on `telegramUserId`.** Otherwise one Telegram account verifies
many of your accounts.

**Answer 200 always,** including when refusing. Telegram retries any non-2xx for
hours.

**Log refusals.** A spike in `not_own_contact` is somebody probing you.

**Keep a second route open** for users without Telegram, or you lock them out
entirely.

---

## Troubleshooting

**The bot never replies.** `getWebhookInfo` first. If `pending_update_count` is
climbing, your endpoint is not returning 200.

**"Share my phone number" does nothing.** The button only appears in a private
chat with the bot, and only on mobile clients. Telegram Desktop will not send a
contact.

**The number arrives without a `+`.** Expected — most clients send bare digits.
`toE164()` normalises it.

**Everything is refused as `not_own_contact`.** The user is attaching a contact
card manually instead of pressing the button. Only the button sends their own
`user_id`.

**Works locally, not in production.** Almost always the secret: the value you
registered with `setWebhook` must match the one your handler compares against.
Re-run `setWebhook` after any change.

---

<a name="دليل-الإعداد-بالعربية"></a>

# دليل الإعداد بالعربية

من حساب تيليجرام فارغ إلى مسار توثيق يعمل. عشر دقائق تقريباً.

## 1. أنشئ البوت

افتح تيليجرام وراسل [@BotFather](https://t.me/BotFather)، صاحب علامة التوثيق
الزرقاء، وأرسل:

```
/newbot
```

يسألك عن **اسم البوت** الذي يراه الناس. اجعله واضحاً أنه لك، فالمستخدم على وشك
أن يسلّمه رقم هاتفه:

```
Acme Verification
```

ثم عن **اسم المستخدم**، ويجب أن يكون فريداً وينتهي بـ`bot`:

```
AcmeVerifyBot
```

فيرد بسطر يحوي التوكن.

**هذا التوكن كلمة سر البوت.** من يملكه يقرأ كل رسالة تصل البوت ويرسل باسمه. لا
تضعه في مستودع، ولا في كود يعمل على المتصفح، ولا في مشكلة عامة. وإن تسرّب،
أرسل `/revoke` لـBotFather واحصل على غيره.

### اجعل البوت يبدو موثوقاً

أنت تطلب من غرباء رقم هاتفهم، والملف الفارغ يكلّفك عمليات ناقصة:

```
/setdescription
```
واكتب نصاً يظهر قبل أن يضغط المستخدم Start:

> البوت الرسمي للتوثيق. يؤكّد رقم هاتفك لنعرف أن حسابك حقيقي. لا يمكننا
> الاطّلاع على رسائلك ولا جهات اتصالك.

```
/setuserpic
```
وارفع شعارك.

### أبقِ البوت خارج المجموعات

البوت لا يحادث إلا شخصاً واحداً في محادثة خاصة. المكتبة تتجاهل كل ما يرد من
المجموعات أصلاً، لكن لا داعي لأن يدخل البوت مجموعة من الأساس:

```
/setjoingroups
```
اختر البوت، ثم **Disable**.

## 2. ولّد المفتاح السري

سيعيده تيليجرام في ترويسة كل طلب، فتميّز التحديث الحقيقي عن غريب يرسل إلى
رابطك:

```bash
openssl rand -hex 32
```

## 3. اضبط تطبيقك

```bash
# .env — لا يُرفع أبداً
BOT_TOKEN=...
BOT_USERNAME=AcmeVerifyBot
WEBHOOK_SECRET=...
```

```bash
npm i telegram-phone-verify
```

## 4. جهّز نقطة الاستقبال

يجب أن تكون:

- **HTTPS**، فتيليجرام يرفض HTTP العادي
- **متاحة للعموم**، بلا قيد عناوين ولا مصادقة أمامها
- على منفذ **443 أو 80 أو 88 أو 8443** حصراً

وللتجربة محلياً، تيليجرام لا يصل `localhost`، فاستخدم نفقاً:

```bash
npx localtunnel --port 3000
```

## 5. سجّل نقطة الاستقبال

```bash
curl -F "url=https://example.com/telegram/webhook" \
     -F "secret_token=$WEBHOOK_SECRET" \
     -F "allowed_updates=[\"message\"]" \
     "https://api.telegram.org/bot$BOT_TOKEN/setWebhook"
```

المتوقّع: `{"ok":true,...,"description":"Webhook was set"}`

**تحديد `allowed_updates` مهم:** طلب `message` وحده يعني ألا يرسل تيليجرام
سواه، فيضيق ما يمكن لنقطة مخترقة أن تراه.

## 6. تحقّق من التسجيل

```bash
curl "https://api.telegram.org/bot$BOT_TOKEN/getWebhookInfo"
```

اقرأ ثلاثة حقول: `url` مطابق، و`pending_update_count` يساوي صفراً، و
`last_error_message` غير موجود.

| الرسالة | السبب |
|---|---|
| `SSL error` | شهادة غير صالحة أو منتهية أو ناقصة السلسلة |
| `Connection timed out` | النقطة غير قابلة للوصول أو خلف جدار ناري |
| `404` | خطأ في المسار |
| `500` | معالجك رمى استثناءً، راجع السجل |

## 7. جرّبه بنفسك

1. افتح `https://t.me/AcmeVerifyBot?start=رمز_حقيقي`
2. اضغط **Start**، فيظهر نصّك مع زر **مشاركة رقم هاتفي**
3. اضغط الزر، ويحذّرك تيليجرام أنه سيرسل رقمك، فاقبل
4. تصلك رسالة النجاح، ويُخزَّن الرقم بصيغة `+أرقام`

**وجرّب الرفض أيضاً.** أرفق جهة اتصال شخص آخر من دفترك عبر مشبك الورق بدل الزر.
يجب أن تُرفض بسبب `not_own_contact`. إن لم تُرفض، فالفحص غير مربوط، وأي شخص
يستطيع توثيق رقم لا يملكه.

## قبل الإطلاق

**حدّ معدّل على توليد الرموز**، فكل رمز اعتماد لحامله.

**صلاحية نحو 15 دقيقة**، مع تعليم الرمز مستخدَماً عند النجاح.

**فهرس فريد على `telegramUserId`**، وإلا وثّق حساب تيليجرام واحد عدة حسابات
عندك.

**أجب بـ200 دائماً** حتى عند الرفض، فتيليجرام يعيد المحاولة لساعات.

**سجّل حالات الرفض.** ارتفاع `not_own_contact` يعني أن أحدهم يجسّ نظامك.

**أبقِ طريقاً آخر** لمن لا يملك تيليجرام، وإلا أقفلت الباب في وجههم.

## مشكلات شائعة

**البوت لا يرد.** ابدأ بـ`getWebhookInfo`. إن كان `pending_update_count`
يتصاعد، فنقطتك لا ترجع 200.

**زر «مشاركة رقم هاتفي» لا يفعل شيئاً.** يظهر في المحادثة الخاصة فقط، وعلى
تطبيقات الهاتف فقط. نسخة سطح المكتب لا ترسل جهة اتصال.

**الرقم يصل بلا `+`.** متوقّع، ومعظم التطبيقات ترسل أرقاماً مجرّدة، و`toE164()`
تعالجها.

**كل شيء يُرفض بـ`not_own_contact`.** المستخدم يرفق بطاقة يدوياً بدل الضغط على
الزر. الزر وحده يرسل `user_id` الخاص به.

**يعمل محلياً ولا يعمل في الإنتاج.** غالباً المفتاح السري: القيمة المسجَّلة عبر
`setWebhook` يجب أن تطابق التي يقارن بها معالجك. أعد التسجيل بعد أي تغيير.
