import { io, Socket } from "socket.io-client";
import { getToken } from "./api";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ auth: { token: getToken() } });
  }
  return socket;
}

export function resetSocket(): void {
  socket?.disconnect();
  socket = null;
}
