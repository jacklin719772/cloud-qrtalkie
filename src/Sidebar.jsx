import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CreditCard,
  Database,
  Gauge,
  LogOut,
  RadioTower,
  Settings,
  UserCheck,
} from 'lucide-react';

const navItems = [
  { id: 'dashboard', label: '首頁', icon: Gauge },
  { id: 'users', label: 'SIP 使用者', icon: RadioTower },
  { id: 'registrations', label: '註冊狀態', icon: UserCheck },
  { id: 'domain', label: '套餐管理', icon: CreditCard },
  { id: 'tenant', label: '租戶設定', icon: Settings },
];

const baseDataItems = [
  { id: 'plans', label: '套餐資料' },
  { id: 'terms', label: '期限資料' },
  { id: 'addons', label: '增值服務' },
  { id: '折扣資料', label: '折扣資料' },
  { id: 'payment-methods', label: '付款方式' },
  { id: 'offline-account', label: '收款帳戶' },
];

export default function Sidebar({ currentView, isCollapsed, onViewChange, onLogout }) {
  const [isBaseDataOpen, setIsBaseDataOpen] = useState(false);

  const toggleBaseData = () => {
    setIsBaseDataOpen((value) => !value);
  };

  return (
    <aside className="sidebar" aria-label="主選單">
      <nav className="nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`nav-item ${currentView === item.id ? 'active' : ''}`}
              type="button"
              title={isCollapsed ? item.label : undefined}
              aria-label={item.label}
              onClick={() => onViewChange(item.id)}
            >
              <Icon className="nav-icon" size={20} aria-hidden="true" />
              {!isCollapsed && <span>{item.label}</span>}
            </button>
          );
        })}

        <button
          className={`nav-item nav-parent ${isBaseDataOpen ? 'open' : ''}`}
          type="button"
          title={isCollapsed ? '基礎數據' : undefined}
          aria-label="基礎數據"
          aria-expanded={isBaseDataOpen}
          onClick={toggleBaseData}
        >
          <Database className="nav-icon" size={20} aria-hidden="true" />
          {!isCollapsed && (
            <>
              <span>基礎數據</span>
              {isBaseDataOpen ? <ChevronDown className="nav-caret" size={16} /> : <ChevronRight className="nav-caret" size={16} />}
            </>
          )}
        </button>

        {isBaseDataOpen && !isCollapsed && (
          <div className="sub-nav" aria-label="基礎數據子選單">
            {baseDataItems.map((item) => (
              <button
                key={item.id}
                className={`sub-nav-item ${currentView === item.id ? 'active' : ''}`}
                type="button"
                title={['offline-account', 'payment-methods'].includes(item.id) ? item.label : `${item.label}（暫未實作）`}
                onClick={() => {
                  if (['offline-account', 'payment-methods'].includes(item.id)) onViewChange(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        <button
          className="nav-item logout-item"
          type="button"
          title={isCollapsed ? '退出系統' : undefined}
          aria-label="退出系統"
          onClick={onLogout}
        >
          <LogOut className="nav-icon" size={20} aria-hidden="true" />
          {!isCollapsed && <span>退出系統</span>}
        </button>
      </nav>

      <div className="sidebar-foot">
        <img className="sidebar-foot-logo" src="/assets/qrtalkie-logo.svg" alt="" />
        {!isCollapsed && (
          <div>
            <small>All Right Reserverd QRTalkie</small>
          </div>
        )}
      </div>
    </aside>
  );
}
