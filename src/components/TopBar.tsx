import { Bell, Sparkles, User2, Search, Sun, Moon } from "lucide-react";
import { Link } from "react-router-dom";
import { branches } from "../data/mock";
import { useTheme } from "../ui/Theme";
import { useLiveData } from "../ui/LiveData";

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
  const { isLive } = useLiveData();
  const ThemeIcon = theme === "dark" ? Sun : Moon;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo cgm-logo" aria-label="Capgemini">
          <img src="/capgemini.jpg" alt="Capgemini" />
        </span>
        <span>
          Connected Factory
          <small>Cloud operations</small>
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
        <Link to="/ask-ai">
          <button className="primary">
            <Sparkles size={14} />
            Ask AI
          </button>
        </Link>
        <button className="icon-btn" title="Account">
          <User2 size={16} />
        </button>
      </div>
    </header>
  );
}
