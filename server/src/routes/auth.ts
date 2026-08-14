import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User, WabaNumber } from "../models";
import { env } from "../config/env";
import { syncNumberHealth } from "../services/whatsapp";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = await User.findOne({
    email: String(email || "").toLowerCase(),
    active: true,
  });
  if (
    !user ||
    !(await bcrypt.compare(String(password || ""), user.passwordHash))
  ) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const token = jwt.sign(
    { sub: String(user._id), role: user.role },
    env.jwtSecret,
    {
      expiresIn: "30d",
    },
  );
  res.json({
    token,
    user: { id: user._id, email: user.email, name: user.name, role: user.role },
  });
});

/** Create the first admin user if none exists. */
export async function ensureAdmin(): Promise<void> {
  const count = await User.countDocuments();
  if (count === 0) {
    const passwordHash = await bcrypt.hash(env.adminPassword, 10);
    await User.create({
      email: env.adminEmail,
      passwordHash,
      name: "Admin",
      role: "admin",
    });
    console.log(`[auth] created admin user ${env.adminEmail}`);
  }
}

/** If env has a phone number configured and no numbers exist yet, seed the first one. */
export async function seedNumberFromEnv(): Promise<void> {
  if (!env.whatsapp.phoneNumberId || !env.whatsapp.businessAccountId) return;
  const count = await WabaNumber.countDocuments();
  if (count > 0) return;
  const num = await WabaNumber.create({
    label: "Primary",
    businessAccountId: env.whatsapp.businessAccountId,
    phoneNumberId: env.whatsapp.phoneNumberId,
    purpose: "mixed",
  });
  console.log("[numbers] seeded primary number from environment");
  await syncNumberHealth(num).catch(() => {});
}
