import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models";
import { env } from "../config/env";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: String(email || "").toLowerCase() });
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

authRouter.post("/register", async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  if (String(password).length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }
  const existing = await User.findOne({ email: String(email).toLowerCase() });
  if (existing) {
    res
      .status(409)
      .json({ error: "An account with this email already exists" });
    return;
  }
  const passwordHash = await bcrypt.hash(String(password), 10);
  // First registered user gets admin role, subsequent users get agent role
  const count = await User.countDocuments();
  const role = count === 0 ? "admin" : "agent";
  const user = await User.create({
    email: String(email).toLowerCase(),
    passwordHash,
    name: String(name || email.split("@")[0]),
    role,
  });
  const token = jwt.sign(
    { sub: String(user._id), role: user.role },
    env.jwtSecret,
    {
      expiresIn: "30d",
    },
  );
  res
    .status(201)
    .json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
});

/** Create the first admin user if none exists (called on boot). */
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
