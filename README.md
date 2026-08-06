# SVASTHA WABIZ

Your own AI-powered WhatsApp Business platform — a self-hosted replacement for BotBiz. Built on the official Meta WhatsApp Cloud API with a MERN + TypeScript stack.

## What it does

- **Live inbox** — WhatsApp-style chat UI with real-time updates (Socket.IO), delivery/read ticks, and unread badges.
- **AI auto-reply** — every incoming message is answered automatically by Claude or OpenAI (switchable in Settings). Per-chat AI ON/OFF toggle plus a global switch.
- **Human takeover** — flip AI off on any chat and reply yourself; an "AI draft" button asks the AI to suggest a reply you can edit before sending. Customers saying "talk to human" (configurable keywords) automatically pause the AI.
- **Knowledge base** — paste your products, prices, policies, FAQs; the AI uses them to answer accurately.
- **Contacts** — tags, search, CSV import, opt-out flag.
- **Broadcasts** — send Meta-approved templates to tag-based segments, immediately or scheduled, with sent/delivered/read/failed stats.
- **Templates** — sync approved templates from Meta or submit new ones for approval.
- **Dashboard** — contacts, open chats, message volume, AI automation rate.
- **Business hours** — optional off-hours auto-message.

## Architecture

```
client/   React 18 + Vite + Tailwind + TypeScript  (the dashboard)
server/   Express + Mongoose + Socket.IO + TypeScript  (API + webhook + AI)
Dockerfile  builds both; Express serves the built React app on one port
```

---

## 1. MongoDB Atlas (free)

1. Create a free cluster at https://cloud.mongodb.com
2. Database Access → add a user with password.
3. Network Access → allow `0.0.0.0/0` (Railway IPs vary).
4. Copy the connection string, e.g.
   `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/svastha-wabiz`

## 2. Meta WhatsApp Cloud API

1. Go to https://developers.facebook.com → **Create App** → type "Business".
2. Add the **WhatsApp** product to the app.
3. Note the **Phone Number ID** and **WhatsApp Business Account ID** (WABA ID) from *WhatsApp → API Setup*.
4. Create a **permanent token**: Business Settings → System Users → create system user → assign the app + WABA with full control → Generate token with `whatsapp_business_messaging` and `whatsapp_business_management` permissions. (The token shown on the API Setup page expires in 24h — don't use that one long-term.)
5. Choose any string as your **verify token** (e.g. `svastha-verify-2026`).
6. You'll configure the webhook URL **after** deploying (step 4 below).

> Note: to message customers who haven't written to you in the last 24 hours, Meta requires approved **templates** — that's what the Broadcasts page uses. Free-form replies are allowed within the 24-hour customer service window.

## 3. Deploy on Railway

1. Push this folder to a GitHub repo (private is fine).
2. On https://railway.app → **New Project → Deploy from GitHub repo**. Railway detects the `Dockerfile` automatically.
3. Add these variables (Service → Variables), using `.env.example` as the checklist:
   - `MONGODB_URI` — from step 1
   - `JWT_SECRET` — any long random string
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` — your dashboard login (created on first boot)
   - `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_VERIFY_TOKEN` — from step 2
   - `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`
   - optional: `WHATSAPP_APP_SECRET` (Meta app secret, enables webhook signature checks)
4. Settings → Networking → **Generate Domain**. Your app is now at `https://your-app.up.railway.app`.

## 4. Connect the webhook

1. In the Meta app: *WhatsApp → Configuration → Webhook* → **Edit**:
   - Callback URL: `https://your-app.up.railway.app/api/webhook`
   - Verify token: the same `WHATSAPP_VERIFY_TOKEN` you set.
2. Click **Verify and save**, then **Manage** → subscribe to the **messages** field.
3. Send a WhatsApp message to your business number — it should appear in the Inbox and get an AI reply within seconds.

## 5. First login & setup

1. Open your Railway URL, sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. **Settings** → pick AI provider/model, tune the system prompt.
3. **AI Knowledge** → add your business info (products, prices, policies, FAQs, hours). This is what makes the AI genuinely useful.
4. **Templates** → *Sync from Meta* to pull your approved templates.
5. Test a **Broadcast** on a tag containing just your own number first.

---

## Local development

```bash
npm run install:all          # installs server + client deps
cp .env.example server/.env  # fill values (server reads process env; use a tool like dotenv-cli or set them in your shell)
npm run dev:server           # API on :8080
npm run dev:client           # UI on :5173 (proxies /api to :8080)
```

For webhook testing locally, tunnel with `ngrok http 8080` and point the Meta webhook at the ngrok URL + `/api/webhook`.

## Costs

- Railway: ~$5/mo hobby plan
- MongoDB Atlas: free tier is plenty
- WhatsApp: service (customer-initiated) conversations are free; marketing template messages are billed per message by Meta
- AI: pay-per-use to Anthropic/OpenAI — with `max_tokens` 500 a typical reply costs a fraction of a cent

## Security notes

- The dashboard is behind JWT auth; the only public endpoints are `/api/health` and `/api/webhook`.
- Set `WHATSAPP_APP_SECRET` to enable webhook signature validation (recommended).
- Never commit `.env`.
