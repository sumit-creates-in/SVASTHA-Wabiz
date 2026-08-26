import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User, WabaNumber } from "../models";
import { env } from "../config/env";
import { syncNumberHealth } from "../services/whatsapp";
import { effectivePermissions, ROLE_PRESETS } from "../permissions";

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

  user.lastLoginAt = new Date();
  await user.save();

  const token = jwt.sign(
    { sub: String(user._id), role: user.role },
    env.jwtSecret,
    {
      expiresIn: "30d",
    },
  );
  res.json({
    token,
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      maskPhoneNumbers: !!user.maskPhoneNumbers,
      permissions: effectivePermissions(user),
    },
  });
});

/**
 * Registration for the "Create account" tab on the login page.
 *
 * Deliberately NOT open to the public: this dashboard exposes every customer
 * conversation, so anyone who found the URL could otherwise sign up and read
 * them. Registration is allowed only when:
 *   - no users exist yet (first-run bootstrap), or
 *   - SIGNUP_CODE is set on the server and the request supplies it.
 * Otherwise, add teammates from Settings → Agents as an admin.
 */
authRouter.post("/register", async (req, res) => {
  const { email, password, name, code } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  if (String(password).length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  const userCount = await User.countDocuments();
  const isBootstrap = userCount === 0;
  if (!isBootstrap) {
    if (!env.signupCode) {
      res.status(403).json({
        error:
          "Public sign-up is disabled. Ask an admin to create your account.",
      });
      return;
    }
    if (String(code || "") !== env.signupCode) {
      res.status(403).json({ error: "Invalid sign-up code" });
      return;
    }
  }

  const normalised = String(email).toLowerCase().trim();
  if (await User.findOne({ email: normalised })) {
    res
      .status(409)
      .json({ error: "An account with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const user = await User.create({
    email: normalised,
    passwordHash,
    name: name || "User",
    role: isBootstrap ? "admin" : "agent",
    permissions: isBootstrap ? ROLE_PRESETS.admin : ROLE_PRESETS.agent,
  });

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

/** Who am I, and what am I allowed to do? Drives the UI. */
authRouter.get("/me", async (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub: string };
    const user = await User.findById(payload.sub)
      .select(
        "name email role active permissions allowedNumbers maskPhoneNumbers",
      )
      .lean();
    if (!user || !user.active) {
      res.status(401).json({ error: "Account is inactive" });
      return;
    }
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      maskPhoneNumbers: !!user.maskPhoneNumbers,
      allowedNumbers: (user.allowedNumbers || []).map(String),
      permissions: effectivePermissions(user as any),
    });
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
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
      permissions: ROLE_PRESETS.admin,
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
