# SVASTHA WABIZ

Your own AI-powered WhatsApp Business platform — a self-hosted replacement for BotBiz. Built on the official Meta WhatsApp Cloud API with a MERN + TypeScript stack.

## What it does

**Multiple numbers**

- Connect as many WhatsApp Business numbers as you like, across one or several Business Accounts.
- Each number has its own purpose (marketing / support / OTP / mixed), its own AI toggle and optional system-prompt override, and can use its own access token if it sits under a different Meta app.
- One webhook URL serves every number — inbound messages are routed by `phone_number_id`.

**Number health monitoring**

- Live from Meta: quality rating (High / Medium / Low), messaging limit tier, connection status, display-name approval status, throughput level.
- Auto-refreshes on boot and every 30 minutes; manual refresh any time.
- Per-number chat counts, unread counts and messages sent today.

**AI that plays by WhatsApp's rules**

The AI is wrapped in a compliance layer that exists to keep your numbers on a **High** quality rating:

| Rule | How it's enforced |
| --- | --- |
| 24-hour customer service window | Free-form replies (AI or human) are blocked outside 24h of the customer's last message. The UI shows the countdown and offers to send an approved template instead. |
| Opt-out is absolute | STOP / UNSUBSCRIBE (configurable, multi-language) instantly opts the contact out, pauses AI and bots, labels the chat, and confirms. START resumes. |
| No spam loops | Max AI replies per chat per hour; identical consecutive messages are suppressed. |
| Marketing frequency cap | Max marketing template messages per contact per day. |
| Quality circuit breaker | When a number drops to RED, marketing sends pause automatically. |
| Human takeover | When an agent replies, the AI holds back for a configurable window so it can't talk over them. |
| Reply hygiene | Length cap, markdown converted to WhatsApp formatting, no headings/tables. |
| Conduct rules in the prompt | No unsolicited promotion, no repeat messaging, no promises on price/refunds/outcomes, no requests for OTPs or card numbers, stop when the customer is annoyed. |
| Tier-aware throttling | Broadcast pacing adapts to the number's messaging limit tier. |
| **Pre-send review** | Every AI reply is inspected before it leaves. Promotional language in an unsolicited context, extra links, requests for OTP/card details, shouting and emoji spam are blocked or stripped. Blocked replies land in the chat as an internal note and flag the conversation for a human. |
| **Escalate, don't guess** | If the answer isn't in the knowledge base, the AI returns an escalation marker instead of improvising. The customer gets a short holding message and the chat is handed to a human. Invented answers are the main source of complaints. |
| **Frustration detection** | Anger, threats of complaints, "stop messaging", "not interested" — the AI stops immediately, apologises once, and labels the chat `at-risk`. A frustrated customer is one tap from blocking you. |
| **Caution mode on YELLOW** | When a number's rating slips, replies get shorter and strictly factual, and all promotional content is withheld until it recovers. |
| **Quality watchdog** | Every health sync records a snapshot. Any degradation raises a dashboard alert; a drop to RED cancels running broadcasts automatically. |
| **Error-code intelligence** | Meta's failure codes are decoded and counted. Code 131049 ("withheld to protect user experience") is Meta warning you before a downgrade — it raises an alert rather than being buried in a log. |

**Inbox & lead management**

- Real-time WhatsApp-style inbox with delivery/read ticks and unread badges.
- Right-hand Chat Actions rail: quick actions (pause bot, pause AI, AI analyse), customer snapshot, 24-hour messaging-window status, agent assignment, labels, internal notes.
- "AI draft" button generates a reply you can edit before sending; "Analyse" classifies intent + urgency and auto-labels the chat.
- Filters by number, status, label, assignment and unread; search by name or phone.
- Send approved templates directly into a chat when the window has closed.

**Webhook workflows**

Fire an approved template automatically when a customer does something in your app.

- Each workflow gets its own URL and secret: `POST /api/hooks/<key>` with header `x-svastha-secret`.
- Map any payload field to template variables with `{{field}}` (dot paths supported: `{{course.title}}`).
- Options: send-once-per-contact / once-per-day dedupe, delayed sending, auto-tag the contact, auto-label the chat.
- Live stats per workflow: targeted, sent, delivered, opened, failed, skipped — with the reason for every skip.
- Built-in test runner and event log; aggregate report across all workflows.

**AI Actions — the AI does things, not just says them**

An action is a task the AI can perform. Each one becomes a tool the model can call. When a customer's message matches, the AI collects the required details conversationally, posts them to your webhook, and confirms.

Two examples ship disabled, ready to edit:

| Action | Fires when | What happens |
| --- | --- | --- |
| `book_sales_call` | A non-customer asks about a programme — "I want to know more about Ultimate 21 Day Weight Loss Challenge" | AI qualifies (programme, name, goal, preferred day/time, city), POSTs to your webhook, creates a Lead with a score, labels the chat, confirms the booking |
| `raise_support_ticket` | An existing customer reports a problem | AI captures subject, detail, category and priority, POSTs to your webhook, creates a Ticket with a reference, confirms with that reference |

Key design decision: **the AI never writes the confirmation**. It's rendered from your template and only sent after the webhook returned 2xx. If the webhook fails, the customer is never told it worked — the chat is handed to a human and flagged `action-failed`. Failed runs can be retried from the Actions page.

Each action is configurable: which numbers it applies to, whether it targets leads or existing customers, the fields to collect, custom JSON payload, tags/labels to apply, and whether to hand off afterwards.

**Svastha app integration**

On every inbound message WABIZ can call your API to ask who the sender is. The result decides whether the AI sells or supports, and the customer's account details (plan, status, orders) are injected into the AI's context so it answers from real data instead of guessing. Configure the URL, headers and response paths in Settings, with a built-in tester.

**Team management**

Add team members with granular permissions across 27 keys grouped into Inbox, Contacts, Messaging, Automation and Admin. Restrict a member to specific WhatsApp numbers. Role presets (agent / manager / admin) give you a sensible starting point.

**Phone number masking** — per team member. With it on, they see only the last four digits everywhere, and phone numbers written inside message text are redacted too. This happens on the server: the full number is never sent to their browser, so it can't be recovered from developer tools or a copied API token.

**Also included**: contacts with tags + CSV import, broadcast campaigns with segments and scheduling, template sync/creation with Meta, AI knowledge base, leads pipeline, support tickets, analytics dashboard.

## Architecture

```
client/   React 18 + Vite + Tailwind + TypeScript  (dashboard)
server/   Express + Mongoose + Socket.IO + TypeScript  (API + webhooks + AI)
Dockerfile  builds both; Express serves the built React app on one port
```

Key server modules:

```
services/whatsapp.ts    Meta Graph API (send, templates, phone-number health)
services/compliance.ts  policy engine — window, opt-out, caps, sanitisation
services/ai.ts          Claude/OpenAI, knowledge base, classification
services/inbound.ts     incoming message pipeline
services/workflows.ts   webhook → template engine
services/broadcast.ts   campaign runner with tier-aware throttling
routes/hooks.ts         public workflow endpoints
```

---

## 1. MongoDB Atlas (free)

1. Create a free cluster at https://cloud.mongodb.com
2. Database Access → add a user with password.
3. Network Access → allow `0.0.0.0/0` (Railway IPs vary).
4. Copy the connection string: `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/svastha-wabiz`

## 2. Meta WhatsApp Cloud API

1. https://developers.facebook.com → **Create App** → "Business" → add the **WhatsApp** product.
2. From *WhatsApp → API Setup*, note each **Phone Number ID** and the **WhatsApp Business Account ID** (WABA ID).
3. Create a **permanent token**: Business Settings → System Users → create a system user → assign the app + WABA with full control → generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`. (The token on the API Setup page expires in 24h.)
4. Pick any string as your **verify token** (e.g. `svastha-verify-2026`).

> Both of your numbers can live under the same Meta app and token. If they're under different apps, add a per-number token override when you add the number in the dashboard.

## 3. Deploy on Railway

1. Push this folder to a GitHub repo.
2. Railway → **New Project → Deploy from GitHub repo** (the `Dockerfile` is detected automatically).
3. Add the variables from `.env.example`:
   - `MONGODB_URI`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`
   - `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, and optionally `WHATSAPP_APP_SECRET`
   - `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_BUSINESS_ACCOUNT_ID` — optional, only used to auto-seed your first number; you add the rest in the UI
   - `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`
4. Settings → Networking → **Generate Domain**.

## 4. Connect the webhook (once, for all numbers)

1. Meta app → *WhatsApp → Configuration → Webhook* → **Edit**:
   - Callback URL: `https://your-app.up.railway.app/api/webhook`
   - Verify token: your `WHATSAPP_VERIFY_TOKEN`
2. **Verify and save**, then **Manage** → subscribe to the **messages** field.

> **The step everyone misses.** Verifying the callback URL only tells Meta *where* to send this app's events. Your app must **also be subscribed to the WhatsApp Business Account** before Meta routes anything to it. Skip this and your webhook shows as verified while nothing ever arrives.
>
> WABIZ does this for you automatically when you add a number. If you added the number before this was in place, open **Numbers → Manage → Webhook delivery** and click **Subscribe**. The same panel lists every app currently receiving that account's webhooks — that's how you spot an old provider still sitting on the line.
>
> Manual equivalent, if you prefer the Graph API:
> ```
> POST https://graph.facebook.com/v21.0/<WABA_ID>/subscribed_apps
> GET  https://graph.facebook.com/v21.0/<WABA_ID>/subscribed_apps   # check who's listening
> ```

3. Repeat for the second WABA if your numbers are under different Business Accounts.
4. Switch the app from **Development** to **Live** at the top of the App Dashboard, or production messages won't be delivered.

## 5. Add your numbers

1. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. Go to **Numbers → Add number**, paste the WABA ID, click **Find numbers on this account**, and add each one.
3. Set each number's label and purpose via **Manage**. Health syncs immediately.

## 6. Set up the AI

1. **Settings** → choose provider/model, tune the system prompt, review the Quality & compliance limits.
2. **AI Knowledge** → add your products, prices, policies, FAQs, hours. This is what makes the AI accurate.
3. Message your number from your own phone and confirm the reply appears in the Inbox.

## 7. Set up a webhook workflow

Example: send a confirmation when someone registers for a course.

1. **Templates → Sync from Meta** so your approved templates are available.
2. **Workflows → Create**:
   - Name: `Course registration confirmation`
   - Number: your marketing number
   - Template: `reg_confirmed_group_plan`
   - Phone field: `phone` (or `customer.phone` if nested)
   - Body variables: `{{name}} | {{course.title}} | {{start_date}}`
   - Send only once: *Once per contact*
   - Label the chat: `Course-Reg`
3. Open the workflow, copy the URL and secret, and call it from your app:

```bash
curl -X POST 'https://your-app.up.railway.app/api/hooks/course-registration-a1b2c3' \
  -H 'Content-Type: application/json' \
  -H 'x-svastha-secret: YOUR_SECRET' \
  -d '{"phone":"919876543210","name":"Asha","course":{"title":"21-Day Reset"},"start_date":"18 Aug"}'
```

Use the built-in **Send test** button first — it fires a real message and marks the workflow verified. Delivered/opened counts update as Meta reports back.

Response codes: `200` sent, `202` skipped or failed (body explains why), `401` bad secret, `404` unknown workflow.

---

## Setting up an AI action

1. **AI Actions → New action** (or edit one of the two examples).
2. **Description** is the most important field — it's what the model reads to decide whether the action applies. Be specific about when it should and shouldn't fire.
3. **Example messages** sharpen the matching. Paste real phrasings customers use, including misspellings and Hinglish.
4. **Fields** are what the AI must collect before firing. The description of each field is the instruction the AI follows when asking for it.
5. **Webhook URL** receives this envelope:

```json
{
  "event": "book_sales_call",
  "action": "Book a sales call",
  "firedAt": "2026-08-25T09:12:44.000Z",
  "contact": { "name": "Asha", "phone": "919876543210", "email": null,
               "isCustomer": false, "externalId": null, "tags": ["lead"] },
  "channel": { "number": "+15557533653", "numberLabel": "SVASTHA Marketing",
               "conversationId": "66c1..." },
  "data": { "programme": "Ultimate 21 Day Weight Loss Challenge",
            "full_name": "Asha Rao", "goal": "lose 8kg before my wedding",
            "preferred_day": "Saturday", "preferred_time": "after 6pm",
            "city": "Bengaluru" }
}
```

Ticket actions also include `"ticketReference": "SVT-..."`. Set a secret and it arrives as `x-svastha-secret`. Need a different shape? Use the custom payload template with `{{field_key}}` placeholders.

6. **Confirmation message** is what the customer receives — only if your webhook returned 2xx. Use `{{field_key}}`, `{{name}}`, `{{ticketReference}}`.
7. Enable it, then message the number from your phone and watch **Recent runs**.

Return a JSON body containing `id`, `ticket_id` or `reference` and WABIZ stores it against the ticket as the external ID.

## Local development

```bash
npm run install:all
npm run dev:server   # API on :8080
npm run dev:client   # UI on :5173 (proxies /api)
```

Tunnel with `ngrok http 8080` for webhook testing.

## Costs

- Railway ~$5/mo · MongoDB Atlas free tier · WhatsApp: service conversations free, marketing templates billed by Meta · AI: pay-per-use (a typical reply is a fraction of a cent).

## Troubleshooting: webhook verified but no messages arriving

Work down this list — it's ordered by how often each one is the cause.

1. **App not subscribed to the WABA.** Numbers → Manage → Webhook delivery. If it says "NOT subscribed", click Subscribe. This is the #1 cause and it's invisible from the Meta webhook screen, which will happily show "verified".
2. **Another app is still subscribed.** The same panel lists them. An old provider (BotBiz, Wati, etc.) subscribed to the WABA keeps receiving your messages. Remove it in Business Settings → WhatsApp Accounts → your WABA → Apps.
3. **App in Development mode.** Top of the App Dashboard — flip to Live.
4. **Number not registered in WABIZ.** The Numbers page must list the exact Phone Number ID from the webhook. Unmatched traffic is dropped with a warning in the Railway logs.
5. **`messages` field not subscribed.** App Dashboard → WhatsApp → Configuration → Webhook fields.
6. **Number disabled in WABIZ.** A disabled number ignores inbound messages by design.

**Each WABA needs its own subscription.** Adding a second number under a different Business Account does not inherit the first one's subscription. Numbers → Manage → Subscribe on the new one.

## Troubleshooting: settings won't stick

Settings now live in a single document with a fixed ID, and duplicates left over from earlier versions are merged automatically on boot. If a change appears to revert:

- Check the **save bar at the bottom of the page**. Nothing is stored until you press Save — the bar turns amber and reads "Unsaved changes" whenever you have pending edits, and the browser warns you if you navigate away.
- Switching AI provider also needs the matching key on Railway (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`). The setting will save either way, but replies fail silently without the key — check the Railway logs for `generateReply failed`.

## Troubleshooting: messaging limit shows UNKNOWN

Meta omits `messaging_limit_tier` when the access token lacks `whatsapp_business_management`. WABIZ falls back to reading it from the Business Account listing, and if that also fails it says so in Numbers → Manage. Fix by regenerating the system-user token with **both** `whatsapp_business_messaging` and `whatsapp_business_management`, from a system user that has the app *and* the WABA assigned.

The **Last event received** timestamp in Numbers → Manage tells you which half of the chain is broken. If it's updating, Meta is delivering and the problem is downstream (in routing or the number record). If it says *never*, Meta isn't sending — it's one of items 1–3.

## Keeping quality high — practical notes

- Only message people who opted in. Buying lists is the fastest way to get a number flagged.
- Watch the Numbers page after each broadcast. A dip from High to Medium means recipients are blocking or reporting — pause marketing and review the message.
- Meta raises your messaging tier automatically as you send quality-rated traffic; the broadcast throttle adapts to the tier.
- Keep the OTP/transactional number separate from marketing (that's what the "purpose" setting is for) so a marketing complaint can't take down your OTP delivery.
