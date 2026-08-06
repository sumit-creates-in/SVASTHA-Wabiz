import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models";
import { env } from "../config/env";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: String(email || "").toLowerCase() });
  if (!user || !(await bcrypt.compare(String(password || ""), user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const token = jwt.sign({ sub: String(user._id), role: user.role }, env.jwtSecret, {
    expiresIn: "30d"
  });
  res.json({ token, user: { id: user._id, email: user.email, name: user.name, role: user.role } });
});

/** Create the first admin user if none exists (called on boot). */
export async function ensureAdmin(): Promise<void> {
  const count = await User.countDocuments();
  if (count === 0) {
    const passwordHash = await bcrypt.hash(env.adminPassword, 10);
    await User.create({ email: env.adminEmail, passwordHash, name: "Admin", role: "admin" });
    console.log(`[auth] created admin user ${env.adminEmail}`);
  }
}
