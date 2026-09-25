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
  Webhook,
  Zap,
  Target,
  LifeBuoy,
  UsersRound,
  EyeOff,
  Clock
} from "lucide-react";
import { getToken, clearToken } from "./lib/api";
import { resetSocket } from "./lib/socket";
import { AuthProvider, useAuth } from "./lib/auth";
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
import Actions from "./pages/Actions";
import FollowUps from "./pages/FollowUps";
import Leads from "./pages/Leads";
import Team from "./pages/Team";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, perm: "analytics.view" },
  { to: "/inbox", label: "Inbox", icon: MessageSquare, perm: "inbox.view" },
  { to: "/leads", label: "Leads & Tickets", icon: Target, perm: "leads.view" },
  { to: "/contacts", label: "Contacts", icon: Users, perm: "contacts.view" },
  { to: "/actions", label: "AI Actions", icon: Zap, perm: "actions.view" },
  { to: "/followups", label: "Follow-ups", icon: Clock, perm: "actions.view" },
  { to: "/numbers", label: "Numbers", icon: Phone, perm: "numbers.view" },
  { to: "/workflows", label: "Workflows", icon: Webhook, perm: "workflows.view" },
  { to: "/broadcasts", label: "Broadcasts", icon: Megaphone, perm: "broadcasts.view" },
  { to: "/templates", label: "Templates", icon: FileText, perm: "templates.view" },
  { to: "/knowledge", label: "AI Knowledge", icon: BookOpen, perm: "knowledge.view" },
  { to: "/team", label: "Team", icon: UsersRound, perm: "team.manage" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, perm: "settings.manage" }
];

function Shell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { me, can } = useAuth();
  const visible = nav.filter((n) => can(n.perm));

  return (
    <div className="flex h-full">
      <aside className="w-60 shrink-0 bg-brand-900 text-white flex flex-col">
        <div className="px-5 py-5 border-b border-white/10">
          <div className="text-lg font-bold tracking-tight">SVASTHA</div>
          <div className="text-xs text-brand-100/70 font-medium tracking-widest">WABIZ</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visible.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? "bg-brand-600 text-white" : "text-brand-100/80 hover:bg-white/10"
                }`
              }
            >
              <Icon size={17} /> {label}
            </NavLink>
          ))}
        </nav>
        {me && (
          <div className="px-5 py-3 border-t border-white/10 text-xs">
            <div className="font-medium text-white truncate">{me.name}</div>
            <div className="text-brand-100/60 capitalize flex items-center gap-1.5">
              {me.role}
              {me.maskPhoneNumbers && (
                <span title="Phone numbers are masked for your account">
                  <EyeOff size={11} />
                </span>
              )}
            </div>
          </div>
        )}
        <button
          onClick={() => {
            clearToken();
            resetSocket();
            navigate("/login");
            window.location.reload();
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

/** Route guard: signed in, and holds the permission this page needs. */
function Protected({ children, perm }: { children: React.ReactNode; perm?: string }) {
  const { me, loading, can } = useAuth();
  if (!getToken()) return <Navigate to="/login" replace />;
  if (loading) return <div className="p-8 text-sm text-slate-400">Loading…</div>;
  if (perm && !can(perm)) {
    return (
      <Shell>
        <div className="p-8">
          <div className="card p-10 text-center max-w-md mx-auto mt-12">
            <LifeBuoy size={28} className="mx-auto text-slate-300 mb-3" />
            <h2 className="font-semibold mb-1">No access to this page</h2>
            <p className="text-sm text-slate-500">
              Your account doesn't have the <code className="bg-slate-100 px-1 rounded">{perm}</code>{" "}
              permission. Ask an admin if you need it.
            </p>
          </div>
        </div>
      </Shell>
    );
  }
  return <Shell>{children}</Shell>;
}

/** Send people to the first page they're actually allowed to see. */
function HomeRedirect() {
  const { can, loading } = useAuth();
  if (loading) return <div className="p-8 text-sm text-slate-400">Loading…</div>;
  if (can("analytics.view")) return <Protected perm="analytics.view"><Dashboard /></Protected>;
  const first = nav.find((n) => can(n.perm));
  return <Navigate to={first?.to || "/inbox"} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/inbox" element={<Protected perm="inbox.view"><Inbox /></Protected>} />
      <Route path="/leads" element={<Protected perm="leads.view"><Leads /></Protected>} />
      <Route path="/contacts" element={<Protected perm="contacts.view"><Contacts /></Protected>} />
      <Route path="/actions" element={<Protected perm="actions.view"><Actions /></Protected>} />
      <Route path="/followups" element={<Protected perm="actions.view"><FollowUps /></Protected>} />
      <Route path="/numbers" element={<Protected perm="numbers.view"><Numbers /></Protected>} />
      <Route path="/workflows" element={<Protected perm="workflows.view"><WorkflowsPage /></Protected>} />
      <Route path="/broadcasts" element={<Protected perm="broadcasts.view"><Broadcasts /></Protected>} />
      <Route path="/templates" element={<Protected perm="templates.view"><Templates /></Protected>} />
      <Route path="/knowledge" element={<Protected perm="knowledge.view"><Knowledge /></Protected>} />
      <Route path="/team" element={<Protected perm="team.manage"><Team /></Protected>} />
      <Route path="/settings" element={<Protected perm="settings.manage"><SettingsPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
