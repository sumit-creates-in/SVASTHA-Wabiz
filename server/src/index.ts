import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { env } from "./config/env";
import { connectDB } from "./config/db";
import { webhookRouter } from "./routes/webhook";
import { hooksRouter } from "./routes/hooks";
import { authRouter, ensureAdmin } from "./routes/auth";
import { apiRouter } from "./routes/api";
import { requireAuth } from "./middleware/auth";
import { initRealtime } from "./realtime";
import { startScheduler } from "./services/broadcast";
import { startWorkflowScheduler } from "./services/workflows";
import { startHealthSync } from "./services/whatsapp";
import { runMigrations } from "./models";
import { seedNumberFromEnv } from "./routes/auth";
import { seedRecommendedSetup } from "./seed";

async function main() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(cors());
  app.use(
    express.json({
      limit: "5mb",
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      }
    })
  );
  app.use(express.urlencoded({ extended: true }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, name: "SVASTHA WABIZ" }));
  app.use("/api/webhook", webhookRouter); // Meta → us
  app.use("/api/hooks", hooksRouter); // your apps → us (workflow triggers)
  app.use("/api/auth", authRouter);
  app.use("/api", requireAuth, apiRouter);

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
  await runMigrations();
  await ensureAdmin();
  await seedNumberFromEnv();
  await seedRecommendedSetup();
  startScheduler();
  startWorkflowScheduler();
  startHealthSync();

  server.listen(env.port, () => {
    console.log(`[server] SVASTHA WABIZ listening on :${env.port}`);
  });
}

main().catch((e) => {
  console.error("Fatal startup error:", e);
  process.exit(1);
});
