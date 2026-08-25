import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, getToken, clearToken } from "./api";
import type { Me } from "../types";

interface AuthState {
  me: Me | null;
  loading: boolean;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  me: null,
  loading: true,
  can: () => false,
  refresh: async () => {}
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api<Me>("/auth/me"));
    } catch {
      clearToken();
      setMe(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Permissions are enforced on the server too — this only shapes the UI.
  const can = (permission: string) => !!me?.permissions?.includes(permission);

  return <AuthContext.Provider value={{ me, loading, can, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
