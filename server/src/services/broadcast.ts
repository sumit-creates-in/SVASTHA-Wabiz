import { Broadcast, BroadcastRecipient, Contact, IBroadcast } from "../models";
import * as wa from "./whatsapp";
import { emit } from "../realtime";

const RATE_DELAY_MS = 250; // ~4 msgs/sec, safely under Meta pair-rate limits

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Execute a broadcast: resolve audience, send template to each contact. */
export async function runBroadcast(broadcastId: string): Promise<void> {
  const b = await Broadcast.findById(broadcastId);
  if (!b || b.status === "running" || b.status === "completed") return;

  const query: Record<string, unknown> = { optedOut: false };
  if (b.audienceTags.length) query.tags = { $in: b.audienceTags };
  const contacts = await Contact.find(query).lean();

  b.status = "running";
  b.stats.total = contacts.length;
  await b.save();
  emit("broadcast:update", b.toObject());

  for (const c of contacts) {
    const cancelled = await Broadcast.findById(b._id).select("status").lean();
    if (cancelled?.status === "cancelled") return;

    const params = b.bodyParams.map((p) => p.replace(/\{\{name\}\}/gi, c.name || "there"));
    const result = await wa.sendTemplate(c.waId, b.templateName, b.templateLanguage, params);
    await BroadcastRecipient.create({
      broadcast: b._id,
      contact: c._id,
      waMessageId: result.waMessageId,
      status: result.error ? "failed" : "sent",
      error: result.error
    });
    await Broadcast.updateOne(
      { _id: b._id },
      { $inc: result.error ? { "stats.failed": 1 } : { "stats.sent": 1 } }
    );
    await sleep(RATE_DELAY_MS);
  }

  const done = await Broadcast.findByIdAndUpdate(b._id, { $set: { status: "completed" } }, { new: true });
  if (done) emit("broadcast:update", done.toObject());
}

/** Poll for scheduled broadcasts whose time has come. Called every 30s. */
export function startScheduler(): void {
  setInterval(async () => {
    try {
      const due = await Broadcast.find({ status: "scheduled", scheduledAt: { $lte: new Date() } });
      for (const b of due) {
        b.status = "draft"; // runBroadcast guards on status
        await b.save();
        runBroadcast(String(b._id)).catch((e) => console.error("[broadcast] run failed:", e.message));
      }
    } catch (e: any) {
      console.error("[broadcast] scheduler error:", e.message);
    }
  }, 30000);
}

export type { IBroadcast };
