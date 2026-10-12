import { Bell, Sparkles, User2, Search, Sun, Moon } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { branches } from "../data/mock";
import { useTheme } from "../ui/Theme";
import { useLiveStatus } from "../ui/useLiveData";
import { useState } from "react";
import { Modal } from "../ui/Modal";

interface TopBarProps {
  branchId: string;
  onBranchChange: (id: string) => void;
  alertCount: number;
  onOpenCommand: () => void;
  onOpenNotifications: () => void;
}

export function TopBar({
  branchId,
  onBranchChange,
  alertCount,
  onOpenCommand,
  onOpenNotifications,
}: TopBarProps) {
  const isMac =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
  const { theme, toggle } = useTheme();
  const isLive = useLiveStatus();
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  const [accountOpen, setAccountOpen] = useState(false);
  const navigate = useNavigate();
  const branch = branches.find((item) => item.id === branchId);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo cgm-logo" aria-label="Capgemini">
          <img src="/capgemini.jpg" alt="Capgemini" />
        </span>
        <span>
          Small-Medium Enterprise (SME)
          <small>EDGE Operations</small>
        </span>
      </div>

      <button
        className="search-pill"
        onClick={onOpenCommand}
        title="Open command palette"
      >
        <Search size={14} />
        <span className="grow">Search branches, devices, actions…</span>
        <span className="kbd">{isMac ? "⌘" : "Ctrl"}</span>
        <span className="kbd">K</span>
      </button>

      <div className="tools">
        {isLive && (
          <span className="live-pill" title="Live data feed connected">
            <span className="live-pill-dot" />
            <span className="live-pill-label">LIVE</span>
          </span>
        )}
        <select
          value={branchId}
          onChange={(e) => onBranchChange(e.target.value)}
          aria-label="Branch"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} — {b.location}
            </option>
          ))}
        </select>
        <button
          className="icon-btn"
          title={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          onClick={toggle}
          aria-label="Toggle theme"
        >
          <ThemeIcon size={16} />
        </button>
        <button
          className="icon-btn"
          title="Notifications"
          aria-label={`Notifications, ${alertCount} unread`}
          onClick={onOpenNotifications}
        >
          <Bell size={16} />
          {alertCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: -3,
                right: -3,
                background: "var(--err)",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 999,
                padding: "2px 6px",
                lineHeight: 1,
                boxShadow: "0 0 0 2px var(--panel-solid)",
              }}
            >
              {alertCount}
            </span>
          )}
        </button>
          <button className="primary" onClick={() => navigate('/ask-ai')}>
            <Sparkles size={14} />
            Ask AI
          </button>
        <button className="icon-btn" title="Account" aria-label="Account information" onClick={() => setAccountOpen(true)}>
          <User2 size={16} />
        </button>
      </div>
      <Modal open={accountOpen} onClose={() => setAccountOpen(false)} title="Operator workspace"
        footer={<Link to="/settings" onClick={() => setAccountOpen(false)}>Open settings</Link>}>
        <p>Connected Enterprise operations console</p>
        <div className="kv"><span className="k">Current branch</span><span className="v">{branch?.name ?? branchId}</span></div>
        <div className="kv"><span className="k">Location</span><span className="v">{branch?.location ?? 'Unspecified'}</span></div>
        <div className="kv"><span className="k">Theme</span><span className="v">{theme}</span></div>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Identity and access are managed by the application deployment. No signed-in user identity is supplied by this console.</p>
      </Modal>
    </header>
  );
}
