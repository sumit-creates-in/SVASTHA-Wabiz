import { Navigate, Route, Routes, NavLink, useNavigate } from "react-router-dom";
import {
  MessageSquare,
  Users,
  Megaphone,
  FileText,
  BookOpen,
  Settings as SettingsIcon,
  LayoutDashboard,
  LogOut,
  Phone,
  Webhook
} from "lucide-react";
import { getToken, clearToken } from "./lib/api";
import { resetSocket } from "./lib/socket";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Inbox from "./pages/Inbox";
import Contacts from "./pages/Contacts";
import Broadcasts from "./pages/Broadcasts";
import Templates from "./pages/Templates";
import Knowledge from "./pages/Knowledge";
import SettingsPage from "./pages/Settings";
import Numbers from "./pages/Numbers";
import WorkflowsPage from "./pages/Workflows";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/inbox", label: "Inbox", icon: MessageSquare },
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/numbers", label: "Numbers", icon: Phone },
  { to: "/workflows", label: "Workflows", icon: Webhook },
  { to: "/broadcasts", label: "Broadcasts", icon: Megaphone },
  { to: "/templates", label: "Templates", icon: FileText },
  { to: "/knowledge", label: "AI Knowledge", icon: BookOpen },
  { to: "/settings", label: "Settings", icon: SettingsIcon }
];

function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="flex h-full">
      <aside className="w-60 shrink-0 bg-brand-900 text-white flex flex-col">
        <div className="px-5 py-5 border-b border-white/10">
          <div className="text-lg font-bold tracking-tight">SVASTHA</div>
          <div className="text-xs text-brand-100/70 font-medium tracking-widest">WABIZ</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? "bg-brand-600 text-white" : "text-brand-100/80 hover:bg-white/10"
                }`
              }
            >
              <Icon size={17} /> {label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => {
            clearToken();
            resetSocket();
            navigate("/login");
          }}
          className="flex items-center gap-3 px-6 py-4 text-sm text-brand-100/70 hover:text-white border-t border-white/10"
        >
          <LogOut size={16} /> Sign out
        </button>
      </aside>
      <main className="flex-1 min-w-0 overflow-hidden">{children}</main>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/inbox" element={<Protected><Inbox /></Protected>} />
      <Route path="/contacts" element={<Protected><Contacts /></Protected>} />
      <Route path="/numbers" element={<Protected><Numbers /></Protected>} />
      <Route path="/workflows" element={<Protected><WorkflowsPage /></Protected>} />
      <Route path="/broadcasts" element={<Protected><Broadcasts /></Protected>} />
      <Route path="/templates" element={<Protected><Templates /></Protected>} />
      <Route path="/knowledge" element={<Protected><Knowledge /></Protected>} />
      <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
