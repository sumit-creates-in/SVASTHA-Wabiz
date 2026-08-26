import { Router, Request, Response } from "express";
import crypto from "crypto";
import { env } from "../config/env";
import {
  handleInboundMessage,
  handleStatusUpdate,
  resolveNumber,
} from "../services/inbound";
import { WabaNumber } from "../models";

export const webhookRouter = Router();

// Meta webhook verification (GET) — one URL serves every number.
webhookRouter.get("/", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === env.whatsapp.verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

function validSignature(req: Request): boolean {
  if (!env.whatsapp.appSecret) return true;
  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  if (!sig) return false;
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!raw) return true;
  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", env.whatsapp.appSecret)
      .update(raw)
      .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

webhookRouter.post("/", (req: Request, res: Response) => {
  res.sendStatus(200); // ACK fast, process async
  if (!validSignature(req)) {
    console.warn("[webhook] invalid signature, ignoring");
    return;
  }
  const body = req.body;
  if (body?.object !== "whatsapp_business_account") return;

  (async () => {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const phoneNumberId: string = value.metadata?.phone_number_id;

        // Record that Meta is actually delivering to us — surfaced in the Numbers page.
        const number = phoneNumberId
          ? await resolveNumber(phoneNumberId)
          : null;
        if (number) {
          await WabaNumber.updateOne(
            { _id: number._id },
            { $set: { lastWebhookAt: new Date() } },
          );
        } else if (phoneNumberId) {
          console.warn(
            `[webhook] ❌ event for phone_number_id ${phoneNumberId} which is NOT registered in WABIZ — ` +
              `add it under Numbers or this traffic will be dropped`,
          );
        } else {
          console.warn(`[webhook] event has no phone_number_id — cannot route`);
        }

        for (const status of value.statuses || []) {
          await handleStatusUpdate(status);
        }

        if (!(value.messages || []).length) continue;
        if (!number) continue;
        if (!number.enabled) {
          console.log(
            `[webhook] number ${number.displayPhoneNumber} is disabled — message ignored`,
          );
          continue;
        }

        for (const msg of value.messages) {
          const profile = (value.contacts || []).find(
            (c: any) => c.wa_id === msg.from,
          );
          await handleInboundMessage(msg, number, profile);
        }
      }
    }
  })().catch((e) => console.error("[webhook] processing error:", e.message));
});
