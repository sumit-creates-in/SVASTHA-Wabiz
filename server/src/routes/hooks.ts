import { Router } from "express";
import { Workflow } from "../models";
import { fireWorkflow, queueWorkflow } from "../services/workflows";

/**
 * Public workflow endpoint — no dashboard auth, protected by the per-workflow secret.
 * POST /api/hooks/:key   header: x-svastha-secret  (or ?secret=)
 */
export const hooksRouter = Router();

hooksRouter.all("/:key", async (req, res) => {
  const workflow = await Workflow.findOne({ key: req.params.key });
  if (!workflow) {
    res.status(404).json({ error: "Unknown workflow" });
    return;
  }
  const provided =
    (req.headers["x-svastha-secret"] as string) ||
    (req.query.secret as string) ||
    "";
  if (provided !== workflow.secret) {
    res.status(401).json({ error: "Invalid secret" });
    return;
  }

  const payload = req.method === "GET" ? req.query : req.body || {};

  if (workflow.delayMinutes > 0) {
    await queueWorkflow(workflow, payload);
    res.json({ ok: true, queued: true, delayMinutes: workflow.delayMinutes });
    return;
  }

  const result = await fireWorkflow(workflow, payload);
  res.status(result.ok ? 200 : 202).json(result);
});
