import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { User } from "../models";
import { effectivePermissions, Viewer } from "../permissions";

export interface AuthedRequest extends Request {
  userId?: string;
  viewer?: Viewer;
}

/** Verify the JWT and load the user's permissions, number scope and masking. */
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  let payload: { sub: string };
  try {
    payload = jwt.verify(token, env.jwtSecret) as { sub: string };
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await User.findById(payload.sub).lean();
  if (!user || !user.active) {
    res.status(401).json({ error: "Account is inactive" });
    return;
  }

  req.userId = String(user._id);
  req.viewer = {
    id: String(user._id),
    role: user.role,
    permissions: effectivePermissions(user),
    maskPhoneNumbers: !!user.maskPhoneNumbers,
    allowedNumbers: (user.allowedNumbers || []).map(String)
  };
  next();
}

/** Gate a route on a permission key. */
export function requirePermission(key: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.viewer) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!req.viewer.permissions.includes(key)) {
      res.status(403).json({ error: `You don't have permission to do this (${key})` });
      return;
    }
    next();
  };
}
