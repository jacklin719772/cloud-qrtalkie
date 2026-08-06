import React, { useState, useRef, useEffect } from 'react';
import { Bell, Menu, User, Key, LogOut, ClipboardList } from 'lucide-react';
import AdminTodoList from './AdminTodoList';

function getInitials(name) {
  return String(name || 'U')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function Topbar({
  workspaceName,
  userName,
  messages = [],
  onMessageClick,
  onMessageDismiss,
  onMessageDelete,
  onToggleSidebar,
  onLogout,
  onChangePassword,
  onMarkAllRead,
  isAdmin = false,
  isTenantAdmin = false,
  onNavigate,
}) {
  const [isMessagesOpen, setIsMessagesOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isTodoOpen, setIsTodoOpen] = useState(false);
  const userMenuRef = useRef(null);
  const autoShowFired = useRef(false);
  const messageCount = messages.length;

  // 登录时自动显示待办清单
  useEffect(() => {
    if (!isAdmin && !isTenantAdmin) return;
    if (autoShowFired.current) return;
    const autoShow = localStorage.getItem('qrtalkie_todo_autoshow') !== 'false';
    if (autoShow) {
      autoShowFired.current = true;
      const timer = setTimeout(() => setIsTodoOpen(true), 600);
      return () => clearTimeout(timer);
    }
  }, [isAdmin, isTenantAdmin]);

  useEffect(() => {
    if (!isUserMenuOpen) return;
    const h = (e) => { if (!userMenuRef.current?.contains(e.target)) setIsUserMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [isUserMenuOpen]);

  return (
    <header className="console-topbar">
      <div className="console-topbar-left">
        <button
          className="topbar-menu-btn"
          type="button"
          aria-label="收起或展開左側導航"
          title="收起或展開左側導航"
          onClick={onToggleSidebar}
        >
          <Menu size={28} aria-hidden="true" />
        </button>
        <strong className="workspace-name">{workspaceName || 'QRTalkie'}</strong>
      </div>

      <div className="console-user" style={{ position: 'relative' }} ref={userMenuRef}>
        <div className="console-message-wrap">
          {(isAdmin || isTenantAdmin) && (
            <>
              <button
                className="console-message-btn"
                type="button"
                aria-label="待辦事項"
                title="待辦事項"
                onClick={() => setIsTodoOpen((v) => !v)}
                style={{ marginRight: '8px' }}
              >
                <ClipboardList size={20} aria-hidden="true" />
              </button>
              <AdminTodoList
                isOpen={isTodoOpen}
                onClose={() => setIsTodoOpen(false)}
                onNavigate={onNavigate}
                role={isAdmin ? 'platform' : 'tenant'}
              />
            </>
          )}
          <button
            className="console-message-btn"
            type="button"
            aria-label="待處理訊息"
            title="待處理訊息"
            onClick={() => setIsMessagesOpen((value) => !value)}
          >
            <Bell size={20} aria-hidden="true" />
            {messageCount > 0 && <span className="console-message-badge">{messageCount}</span>}
          </button>
          {isMessagesOpen && (
            <div className="console-message-popover" role="menu">
              <div className="console-message-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span>待處理訊息</span>{messageCount > 0 && <button type="button" onClick={() => onMarkAllRead?.()} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: "11px" }}>全部已讀</button>}</div>
              <div className="console-message-list">
              {messageCount === 0 ? (
                <p className="console-message-empty">暫無待處理訊息</p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`console-message-item ${message.isRead ? '' : 'unread'}`}
                    role="menuitem"
                  >
                    <button
                      className="console-message-main"
                      type="button"
                      onClick={() => {
                        setIsMessagesOpen(false);
                        onMessageClick?.(message);
                      }}
                    >
                      <strong>{message.title}</strong>
                      <span>{message.description}</span>
                    </button>
                    <div className="console-message-actions">
                      <button type="button" onClick={() => onMessageDismiss?.(message)}>忽略</button>
                      <button type="button" onClick={() => onMessageDelete?.(message)}>刪除</button>
                    </div>
                  </div>
                ))
              )}
            </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => setIsUserMenuOpen(v => !v)}>
          <span className="console-avatar" aria-hidden="true">{getInitials(userName)}</span>
          <span className="console-user-name">{userName || 'Admin'}</span>
        </div>
        {isUserMenuOpen && (
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: '6px',
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
            boxShadow: '0 10px 30px rgba(15,23,42,0.12)', padding: '4px', zIndex: 1000,
            minWidth: '140px'
          }}>
            <button
              type="button"
              onClick={() => { setIsUserMenuOpen(false); onChangePassword?.(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                padding: '10px 14px', border: 'none', background: 'none',
                cursor: 'pointer', fontSize: '13px', color: '#334155', borderRadius: '6px'
              }}
              onMouseEnter={e => e.target.style.background = '#f1f5f9'}
              onMouseLeave={e => e.target.style.background = 'none'}
            >
              <Key size={16} /> 修改密碼
            </button>
            <button
              type="button"
              onClick={() => { setIsUserMenuOpen(false); onLogout?.(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                padding: '10px 14px', border: 'none', background: 'none',
                cursor: 'pointer', fontSize: '13px', color: '#dc2626', borderRadius: '6px'
              }}
              onMouseEnter={e => e.target.style.background = '#fef2f2'}
              onMouseLeave={e => e.target.style.background = 'none'}
            >
              <LogOut size={16} /> 退出系統
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
