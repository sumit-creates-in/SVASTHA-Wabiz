import { Server as HttpServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "./config/env";

let io: Server | null = null;

export function initRealtime(server: HttpServer): Server {
  io = new Server(server, { cors: { origin: true, credentials: true } });
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    try {
      jwt.verify(token, env.jwtSecret);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });
  io.on("connection", (socket) => {
    socket.join("inbox");
  });
  return io;
}

/** Emit an event to all connected dashboard clients. */
export function emit(event: string, payload: unknown): void {
  io?.to("inbox").emit(event, payload);
}
