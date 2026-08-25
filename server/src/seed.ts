/**
 * First-run examples so the Actions page isn't an empty box.
 *
 * These are created disabled with placeholder webhook URLs — edit the URL and
 * the confirmation wording, then switch them on. They're only ever created
 * once; deleting them will not bring them back.
 */
import { AiAction } from "./models";

export async function seedExampleActions(): Promise<void> {
  if ((await AiAction.countDocuments()) > 0) return;

  await AiAction.create([
    {
      name: "book_sales_call",
      displayName: "Book a sales call",
      description:
        "Use when someone who is not yet a customer shows interest in one of our programmes — for example the Ultimate 21 Day Weight Loss Challenge — and wants to know more, join, see pricing, or speak to someone. Qualify them by finding out which programme they're interested in, their main health goal, and when they're free for a call. Then book the call.",
      triggerExamples: [
        "I want to know more about Ultimate 21 day weight loss challenge",
        "How do I join the 21 day challenge?",
        "Tell me about your weight loss programme",
        "What is the price of the challenge?",
        "Can someone call me about the programme?"
      ],
      audience: "lead",
      enabled: false,
      fields: [
        {
          key: "programme",
          label: "Programme",
          description:
            "Which programme the person is interested in, e.g. 'Ultimate 21 Day Weight Loss Challenge'. Infer it from the conversation if they've already said it.",
          type: "string",
          required: true
        },
        {
          key: "full_name",
          label: "Full name",
          description: "The person's full name. Ask politely if you don't already know it.",
          type: "string",
          required: true
        },
        {
          key: "goal",
          label: "Main goal",
          description:
            "What they want to achieve, in their own words, e.g. 'lose 8kg before my wedding' or 'manage PCOS'.",
          type: "string",
          required: true
        },
        {
          key: "preferred_day",
          label: "Preferred day",
          description: "Which day suits them for a 15-minute call, e.g. 'tomorrow' or 'Saturday'.",
          type: "string",
          required: true
        },
        {
          key: "preferred_time",
          label: "Preferred time",
          description: "What time of day suits them, e.g. 'after 6pm' or '11am'.",
          type: "string",
          required: true
        },
        {
          key: "city",
          label: "City",
          description: "Which city they're in — helps us assign the right coach. Optional.",
          type: "string",
          required: false
        }
      ],
      webhookUrl: "https://example.com/replace-me/sales-call",
      webhookMethod: "POST",
      confirmationMessage:
        "Perfect, {{full_name}} 🙏\n\nI've booked a 15-minute call about the {{programme}} for {{preferred_day}}, {{preferred_time}}. One of our coaches will call you on this number.\n\nIf that time stops working, just reply here and we'll move it.",
      addTags: ["lead", "sales-call"],
      addLabels: ["Lead", "Call-Booked"],
      createsLead: true,
      createsTicket: false,
      handoffAfter: false
    },
    {
      name: "raise_support_ticket",
      displayName: "Raise a support ticket",
      description:
        "Use when an EXISTING customer reports a problem you cannot resolve from the information available — app not working, payment or billing issue, plan not updating, refund request, or anything needing the team to investigate their account. Do not use this for questions you can already answer from the knowledge base or from their account details.",
      triggerExamples: [
        "My app is not opening",
        "I was charged twice",
        "My diet plan hasn't updated this week",
        "I want a refund",
        "I can't log in to the Svastha app"
      ],
      audience: "customer",
      enabled: false,
      fields: [
        {
          key: "subject",
          label: "Subject",
          description: "A short one-line summary of the problem, written by you.",
          type: "string",
          required: true
        },
        {
          key: "detail",
          label: "Detail",
          description:
            "What exactly is happening, in the customer's own words, plus anything useful you've established such as when it started or what they've already tried.",
          type: "string",
          required: true
        },
        {
          key: "category",
          label: "Category",
          description: "Which area the problem belongs to.",
          type: "enum",
          options: ["app", "billing", "plan", "delivery", "coach", "other"],
          required: true
        },
        {
          key: "priority",
          label: "Priority",
          description:
            "How urgent this is. Use 'urgent' only when the customer is blocked from using what they've paid for, or money is involved.",
          type: "enum",
          options: ["low", "normal", "high", "urgent"],
          required: true
        }
      ],
      webhookUrl: "https://example.com/replace-me/support-ticket",
      webhookMethod: "POST",
      confirmationMessage:
        "Thanks for letting us know 🙏\n\nI've raised ticket {{ticketReference}} with our support team about: {{subject}}\n\nThey'll look into it and reply here. You can also track it in the Support section of your Svastha app.",
      addTags: ["support"],
      addLabels: ["Support"],
      createsLead: false,
      createsTicket: true,
      handoffAfter: false
    }
  ]);

  console.log("[seed] created 2 example AI actions (disabled — edit the webhook URLs, then enable)");
}
