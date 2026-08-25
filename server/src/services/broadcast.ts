import {
  Broadcast,
  BroadcastRecipient,
  Contact,
  Template,
  WabaNumber,
  getSettings,
} from "../models";
import * as wa from "./whatsapp";
import {
  canSendTemplate,
  recordMarketingSend,
  recordNumberSend,
} from "./compliance";
import { emit } from "../realtime";

/** Throughput by messaging tier — stays well under Meta's limits to protect quality. */
function delayForTier(tier: string): number {
  switch (tier) {
    case "TIER_UNLIMITED":
    case "UNLIMITED":
      return 60;
    case "TIER_100K":
      return 100;
    case "TIER_10K":
      return 200;
    default:
      return 400; // TIER_1K and unknown
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runBroadcast(broadcastId: string): Promise<void> {
  const b = await Broadcast.findById(broadcastId);
  if (!b || b.status === "running" || b.status === "completed") return;

  const number = b.number
    ? await WabaNumber.findById(b.number)
    : await WabaNumber.findOne({ enabled: true });
  if (!number) {
    await Broadcast.updateOne({ _id: b._id }, { $set: { status: "failed" } });
    return;
  }

  const settings = await getSettings();
  const tpl = await Template.findOne({ name: b.templateName }).lean();
  const category =
    (tpl?.category || "MARKETING").toUpperCase() === "MARKETING"
      ? "marketing"
      : "utility";

  const query: Record<string, unknown> = { optedOut: false };
  if (b.audienceTags.length) query.tags = { $in: b.audienceTags };
  const contacts = await Contact.find(query);

  b.status = "running";
  b.stats.total = contacts.length;
  await b.save();
  emit("broadcast:update", b.toObject());

  const delay = delayForTier(number.messagingLimit);

  for (const c of contacts) {
    const current = await Broadcast.findById(b._id).select("status").lean();
    if (current?.status === "cancelled") return;

    const gate = canSendTemplate(
      c,
      number,
      settings,
      category as "marketing" | "utility",
    );
    if (!gate.allowed) {
      await BroadcastRecipient.create({
        broadcast: b._id,
        contact: c._id,
        status: "skipped",
        error: gate.reason,
      });
      await Broadcast.updateOne(
        { _id: b._id },
        { $inc: { "stats.skipped": 1 } },
      );
      continue;
    }

    const params = b.bodyParams.map((p) =>
      p.replace(/\{\{name\}\}/gi, c.name || "there"),
    );
    const result = await wa.sendTemplate(
      number,
      c.waId,
      b.templateName,
      b.templateLanguage,
      params,
      [],
      undefined,
      tpl?.category,
    );
    await BroadcastRecipient.create({
      broadcast: b._id,
      contact: c._id,
      waMessageId: result.waMessageId,
      status: result.error ? "failed" : "sent",
      error: result.error,
    });
    await Broadcast.updateOne(
      { _id: b._id },
      { $inc: result.error ? { "stats.failed": 1 } : { "stats.sent": 1 } },
    );
    if (!result.error) {
      await recordNumberSend(number);
      if (category === "marketing") await recordMarketingSend(c);
    }
    await sleep(delay);
  }

  const done = await Broadcast.findByIdAndUpdate(
    b._id,
    { $set: { status: "completed" } },
    { new: true },
  );
  if (done) emit("broadcast:update", done.toObject());
}

export function startScheduler(): void {
  setInterval(async () => {
    try {
      const due = await Broadcast.find({
        status: "scheduled",
        scheduledAt: { $lte: new Date() },
      });
      for (const b of due) {
        b.status = "draft";
        await b.save();
        runBroadcast(String(b._id)).catch((e) =>
          console.error("[broadcast] run failed:", e.message),
        );
      }
    } catch (e: any) {
      console.error("[broadcast] scheduler error:", e.message);
    }
  }, 30000);
}
