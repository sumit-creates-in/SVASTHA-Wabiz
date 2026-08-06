import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { env } from "./config/env";
import { connectDB } from "./config/db";
import { webhookRouter } from "./routes/webhook";
import { authRouter, ensureAdmin } from "./routes/auth";
import { apiRouter } from "./routes/api";
import { requireAuth } from "./middleware/auth";
import { initRealtime } from "./realtime";
import { startScheduler } from "./services/broadcast";

async function main() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(cors());
  app.use(
    express.json({
      limit: "5mb",
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf; // for webhook signature validation
      }
    })
  );

  app.get("/api/health", (_req, res) => res.json({ ok: true, name: "SVASTHA WABIZ" }));
  app.use("/api/webhook", webhookRouter);
  app.use("/api/auth", authRouter);
  app.use("/api", requireAuth, apiRouter);

  // Serve built React app (production)
  const publicDir = path.join(__dirname, "..", "public");
  app.use(express.static(publicDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"), (err) => {
      if (err) res.status(404).send("SVASTHA WABIZ API running. Frontend not built.");
    });
  });

  const server = http.createServer(app);
  initRealtime(server);

  await connectDB();
  await ensureAdmin();
  startScheduler();

  server.listen(env.port, () => {
    console.log(`[server] SVASTHA WABIZ listening on :${env.port}`);
  });
}

main().catch((e) => {
  console.error("Fatal startup error:", e);
  process.exit(1);
});
