import React from 'react';
import { Menu } from 'lucide-react';

function getInitials(name) {
  return String(name || 'U')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function Topbar({ workspaceName, userName, onToggleSidebar }) {
  return (
    <header className="console-topbar">
      <div className="console-topbar-left">
        <button
          className="topbar-menu-btn"
          type="button"
          aria-label="收起或展開左側選單"
          title="收起或展開左側選單"
          onClick={onToggleSidebar}
        >
          <Menu size={28} aria-hidden="true" />
        </button>
        <strong className="workspace-name">{workspaceName || 'QRTalkie'}</strong>
      </div>

      <div className="console-user">
        <span className="console-avatar" aria-hidden="true">{getInitials(userName)}</span>
        <span className="console-user-name">{userName || 'Admin'}</span>
      </div>
    </header>
  );
}
