/**
 * Recommended prompts, knowledge base and actions for Svastha.
 *
 * Everything here installs ONCE, tracked by Settings.seedVersion. Edit anything
 * afterwards in the dashboard and it will never be overwritten. Bumping
 * SEED_VERSION ships a new revision to installs that haven't had it yet.
 */
import { AiAction, KnowledgeDoc, Settings, getSettings } from "./models";

const SEED_VERSION = 2;

// ── The Priya system prompt ─────────────────────────────
export const SVASTHA_SYSTEM_PROMPT = `Your name is Priya. You are part of Svastha's team on WhatsApp.

LANGUAGE & TONE
- Reply in the same language the customer uses — English, Hindi or Hinglish. Match their script.
- Keep replies SHORT: 1 to 4 sentences. Warm and human, like a caring team member — never like a brochure.
- At most one emoji per message, often none.
- Never send long lists or walls of text. Give the single most relevant thing, then ask if they want more.

HOW TO OPEN
- If someone just greets you ("Hi", "Hello", "Namaste") with nothing else, greet them back warmly and ask ONE open question. Do NOT describe the programme, do NOT mention price, do NOT pitch.
  Good: "Hi! Priya here from Svastha 🙏 How can I help you today?"
  Bad: launching into what the challenge includes.
- If they arrived from one of our ads, acknowledge what they were looking at instead of asking what they need.
- If they ask something specific, answer that first before guiding them anywhere.

WHO YOU ARE TALKING TO
- If their account details appear above, they are an EXISTING CUSTOMER — help them with their running programme.
- If no account details appear, they are a NEW LEAD — help them understand the programme and guide them toward a Free Consultation Call.

FOR NEW LEADS
- Answer their questions honestly from the knowledge base. Build genuine interest — talk about outcomes and how it works, not features.
- Guide them toward booking a "Free Consultation Call".
- Ask for their name if you don't have it.

QUALIFYING BEFORE YOU BOOK — do this every time
Before booking a consultation call you must have:
1. Their name.
2. What they want to achieve, in their own words.
3. Confirmation they are comfortable with a paid programme. Ask it plainly and warmly:
   "The challenge is Rs. 990 — is that something you're comfortable with?"
4. A day and a time that suits them.

- If they say YES to the fee, collect day and time, then book the call.
- If they say NO, or want only free guidance: do NOT book a call and do NOT say a call is booked. Be warm and straight with them — the programme is paid, you're glad to answer any questions, and they're welcome back anytime. Never tell anyone a call is booked when it is not.
- If they dodge the question, ask once more gently. If still unclear, don't book.

FOR EXISTING CUSTOMERS
- Answer using the knowledge base and their account details.
- If you cannot answer confidently, offer a support call-back and raise a ticket once they agree.
- NEVER ask a customer what time to call for support — our team schedules those themselves.

NO HUMAN IS WATCHING THIS CHAT
- Never say a person will reply here, never say "connecting you to an agent", never ask anyone to wait in this chat for a human.
- The only ways a human helps are a consultation call (leads) or a support call-back (customers). Phone calls, not chat.
- If someone asks to speak to a human, that IS a request for a call. Tell them warmly that the team will call.

HARD RULES
- NEVER give medical, dietary or health advice beyond what is in the knowledge base. For any health condition, medication, pain or medical question: show care, then offer a call with the team. This is mandatory, no exceptions.
- NEVER promise refunds, discounts, extensions or policy exceptions. Offer a call instead.
- NEVER invent facts about plans, prices, dates, batch timings or results. If it isn't in the knowledge base, say you'll confirm with the team.
- Never guarantee a specific weight loss result for an individual. Share what others have achieved, not what they will achieve.
- If someone is upset, stop selling. Acknowledge it, apologise once, and offer a call.
- Most messages need no action at all — just a good reply. Only book when the conditions above are genuinely met.`;

// ── Knowledge base ──────────────────────────────────────
const U21_KNOWLEDGE = `## What it is
A 21-day guided weight loss challenge, run for a limited group of 100 serious participants. Participants eat normal home-cooked Indian food — daal, rice, roti, sabji — rather than a restrictive diet.

## Price
Rs. 990 (regular price Rs. 2900). All inclusive — no hidden charges. If asked about price, say it starts at Rs. 990.

## What's included
- Live interactive sessions with Sumit Sharma every Sunday (recordings provided)
- 21-day diet plan, updated weekly, built around simple home-cooked meals
- Intermittent fasting plan with daily guidance
- Daily live yoga classes, Monday to Friday (recordings provided)
- Daily motivation and reminders on WhatsApp
- Weight Loss Champ contest and a live leaderboard
- Access to a group of highly motivated participants

## Yoga class timings (IST, Monday to Friday)
Morning: 5:30, 6:30, 7:30, 8:30, 9:30 am
Evening: 4:30, 5:30, 6:30 pm
Recordings are provided if they can't attend live.

## How it works
1. Register and secure a spot
2. Attend the live session on the batch start date
3. Follow the plan from the next day, with daily WhatsApp reminders
4. Track progress on the live leaderboard

## What participants learn
- How to start burning fat for energy
- 5 Golden Habits for lasting results
- The right way to do intermittent fasting
- How to cook and eat food properly
- How to manage cravings and food addiction

## Who it's for
People who have tried and failed to lose weight, regained lost weight, struggle with sugar and carb cravings, have gut issues, hormonal imbalance or chronic conditions. Suitable for working professionals, homemakers and parents.

## Conditions people ask about
The programme covers lifestyle guidance relevant to type 2 diabetes, PCOS, hypothyroidism, hypertension, fatty liver and high uric acid. This is general lifestyle education, NOT medical treatment. Never advise on medication, dosage, or any medical decision — offer a call with the team instead.

## Who runs it
Sumit Sharma — certified dietitian, yoga teacher, lifestyle coach and intermittent fasting expert, founder of Svastha. Over 10 years' experience, 130K+ followers on Instagram (@sumit_sharma_coach).
Instagram: https://www.instagram.com/sumit_sharma_coach/

Supporting mentors: Venika Agarwal (dietitian), Muskan Lalwani (dietitian), Anisha Ghosh (dietitian), Ankit Sharma (fitness trainer).
Yoga teachers: Tanvi Panvar, Karishma Kaintura, Saumya Gangwar.

## Results others have had
Participants have reported losses such as 6.5 kg in 6 days, 6.5 kg in 9 days, and 12-25 kg over longer periods. Some have reported improvements in fatty liver and hypertension.
IMPORTANT: share these as what others achieved. Never promise a specific result to the person you are talking to. Results vary.

## Things we do NOT do
- No medical advice, no medication guidance
- No guaranteed weight loss figures for an individual
- No refunds, discounts or exceptions promised over chat`;

// ── Actions ─────────────────────────────────────────────
const BOOK_SALES_CALL = {
  name: "book_sales_call",
  displayName: "Free Consultation Call",
  description: `Use when a NEW LEAD is interested in the Ultimate 21 Day Weight Loss Challenge and has agreed to a Free Consultation Call. Only call this once you have their name, their goal, explicit confirmation that they are comfortable with the paid programme starting at Rs. 990, and both a day and a time that suits them. If any of these are missing, ask for it in your reply instead of calling this action. Never call this action if the person has said the fee is a problem or that they only want free guidance.`,
  triggerExamples: [
    "I want to know more about Ultimate 21 day weight loss challenge",
    "How do I join the 21 day challenge?",
    "Yes Rs 990 is fine, please book my call",
    "Tomorrow evening works for me",
    "Kal sham ko call kar lijiye",
    "Yes I'm interested, when can we talk?",
    "Haan mujhe join karna hai"
  ],
  audience: "lead" as const,
  enabled: false,
  fields: [
    {
      key: "full_name",
      label: "Full name",
      description: "The person's full name. Ask politely if you don't already know it.",
      type: "string" as const,
      required: true
    },
    {
      key: "goal",
      label: "Main goal",
      description:
        "What they want to achieve, in their own words, e.g. 'lose 8kg before my wedding' or 'manage PCOS'.",
      type: "string" as const,
      required: true
    },
    {
      key: "fee_confirmed",
      label: "Fee confirmed",
      description:
        "Set to 'yes' ONLY if the person has explicitly confirmed they are comfortable paying Rs. 990 for the programme. Never set this without a clear yes from them. If they have not confirmed, do not call this action at all — ask them about the fee first.",
      type: "enum" as const,
      options: ["yes"],
      required: true
    },
    {
      key: "preferred_date",
      label: "Preferred date",
      description:
        "The exact calendar date for the call in YYYY-MM-DD format, worked out from what they said and today's date given above.",
      type: "string" as const,
      required: true
    },
    {
      key: "preferred_time_24",
      label: "Preferred time",
      description:
        "The call time in 24-hour HH:MM format, between 10:00 and 19:00 IST.",
      type: "string" as const,
      required: true
    },
    {
      key: "preferred_time_raw",
      label: "Their words about timing",
      description: "Exactly what they said about timing, e.g. 'kal shaam ko' or 'Saturday after 6'.",
      type: "string" as const,
      required: false
    },
    {
      key: "city",
      label: "City",
      description: "Which city they're in — helps assign the right coach. Optional.",
      type: "string" as const,
      required: false
    }
  ],
  webhookUrl: "https://example.com/replace-me/sales-call",
  webhookMethod: "POST" as const,
  confirmationMessage: `Perfect, {{full_name}} 🙏

Your Free Consultation Call is booked for {{preferred_date}} at {{preferred_time_24}}. Our coach will call you on this number.

If that time stops working, just reply here and we'll move it.`,
  addTags: ["lead", "consultation-call"],
  addLabels: ["Lead", "Call-Booked"],
  createsLead: true,
  createsTicket: false,
  handoffAfter: false
};

const RAISE_SUPPORT_TICKET = {
  name: "raise_support_ticket",
  displayName: "Support call-back",
  description: `Use ONLY for existing customers who have a real problem you could not resolve from the knowledge base or their account details, AND who have agreed to a call-back — or who directly asked to speak to someone. Always try to answer yourself first. If you cannot, offer the call-back in your reply and wait for them to say yes before calling this action. Never use this for greetings, thanks, acknowledgements, small talk, or anything you already answered. Never ask them what time to call — our team schedules support calls themselves.`,
  triggerExamples: [
    "My app is not opening",
    "I was charged twice",
    "My diet plan hasn't updated this week",
    "I want a refund",
    "I can't log in to the Svastha app",
    "Yes please have someone call me"
  ],
  audience: "customer" as const,
  enabled: false,
  fields: [
    {
      key: "subject",
      label: "Subject",
      description: "A short one-line summary of the problem, written by you.",
      type: "string" as const,
      required: true
    },
    {
      key: "detail",
      label: "Detail",
      description:
        "What exactly is happening, in the customer's own words, plus anything useful you've established such as when it started or what they've already tried.",
      type: "string" as const,
      required: true
    },
    {
      key: "category",
      label: "Category",
      description: "Which area the problem belongs to.",
      type: "enum" as const,
      options: ["app", "billing", "plan", "delivery", "coach", "health", "other"],
      required: true
    },
    {
      key: "priority",
      label: "Priority",
      description:
        "How urgent this is. Use 'urgent' only when the customer is blocked from using what they've paid for, or money is involved.",
      type: "enum" as const,
      options: ["low", "normal", "high", "urgent"],
      required: true
    }
  ],
  webhookUrl: "https://example.com/replace-me/support-ticket",
  webhookMethod: "POST" as const,
  confirmationMessage: `Thanks for letting us know 🙏

I've raised ticket {{ticketReference}} with our support team about: {{subject}}

They'll call you back within 24 hours, between 10am and 7pm. You can also track it in the Support section of your Svastha app.`,
  addTags: ["support"],
  addLabels: ["Support"],
  createsLead: false,
  createsTicket: true,
  handoffAfter: false
};

/** Install the recommended setup once. Safe to call on every boot. */
export async function seedRecommendedSetup(): Promise<void> {
  const settings = await getSettings();
  if ((settings.seedVersion || 0) >= SEED_VERSION) return;

  // 1. System prompt — only if it's still the stock default or empty.
  const stillDefault =
    !settings.systemPrompt?.trim() ||
    settings.systemPrompt.startsWith("You are a helpful, warm customer support assistant");
  if (stillDefault) {
    settings.systemPrompt = SVASTHA_SYSTEM_PROMPT;
    console.log("[seed] installed the Svastha (Priya) system prompt");
  } else {
    console.log("[seed] system prompt has been customised — left it alone");
  }

  // Short replies suit WhatsApp; the prompt asks for 1-4 sentences.
  if (settings.maxReplyChars >= 900) settings.maxReplyChars = 450;

  settings.seedVersion = SEED_VERSION;
  await settings.save();

  // 2. Knowledge base
  const kbTitle = "Ultimate 21 Day Weight Loss Challenge";
  if (!(await KnowledgeDoc.findOne({ title: kbTitle }))) {
    await KnowledgeDoc.create({ title: kbTitle, content: U21_KNOWLEDGE, enabled: true });
    console.log("[seed] added the U21DWLC knowledge base document");
  }

  // 3. Actions — create if missing, and refresh the wording on ones that
  //    still point at the placeholder webhook (i.e. never configured).
  for (const spec of [BOOK_SALES_CALL, RAISE_SUPPORT_TICKET]) {
    const existing = await AiAction.findOne({ name: spec.name });
    if (!existing) {
      await AiAction.create(spec);
      console.log(`[seed] created action "${spec.displayName}"`);
      continue;
    }
    if (existing.webhookUrl.includes("example.com/replace-me")) {
      Object.assign(existing, {
        displayName: spec.displayName,
        description: spec.description,
        triggerExamples: spec.triggerExamples,
        audience: spec.audience,
        fields: spec.fields,
        confirmationMessage: spec.confirmationMessage,
        addTags: spec.addTags,
        addLabels: spec.addLabels,
        createsLead: spec.createsLead,
        createsTicket: spec.createsTicket
      });
      await existing.save();
      console.log(`[seed] refreshed unconfigured action "${spec.displayName}"`);
    }
  }
}

/** Kept for backwards compatibility with the previous boot sequence. */
export const seedExampleActions = seedRecommendedSetup;

export { Settings };
