import { Router, Request, Response } from "express";
import crypto from "crypto";
import { env } from "../config/env";
import { handleInboundMessage, handleStatusUpdate } from "../services/inbound";

export const webhookRouter = Router();

// Meta webhook verification (GET)
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
  if (!env.whatsapp.appSecret) return true; // optional
  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  if (!sig) return false;
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!raw) return true;
  const expected =
    "sha256=" + crypto.createHmac("sha256", env.whatsapp.appSecret).update(raw).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Incoming events (POST)
webhookRouter.post("/", (req: Request, res: Response) => {
  // Always ACK fast; process async. Meta retries if we are slow.
  res.sendStatus(200);
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
        for (const msg of value.messages || []) {
          const profile = (value.contacts || []).find((c: any) => c.wa_id === msg.from);
          await handleInboundMessage(msg, profile);
        }
        for (const status of value.statuses || []) {
          await handleStatusUpdate(status);
        }
      }
    }
  })().catch((e) => console.error("[webhook] processing error:", e.message));
});
