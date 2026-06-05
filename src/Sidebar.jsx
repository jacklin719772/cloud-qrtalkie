import React, { useState } from 'react';
import {
  Building,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Database,
  Gauge,
  LogOut,
  RadioTower,
  Settings,
  Shield,
  TicketPercent,
  UserCheck,
  Package,
  Users,
  Book,
  IdCard,
  Headset,
  Key,
  Monitor,
} from 'lucide-react';

const navItems = [
  { id: 'dashboard', label: '平台概覽', icon: Gauge },
  { id: 'users', label: '租戶概覽', icon: RadioTower },
  { id: 'registrations', label: '我的帳號', icon: UserCheck },
  { id: 'domain', label: '我的套餐', icon: CreditCard },
  { id: 'tenant-account-management', label: '帳號管理', icon: Users },
  { id: 'contact-books', label: '通訊錄管理', icon: Book },
  { id: 'ecard-styles-management', label: '電子名片管理', icon: IdCard },
  { id: 'call-center', label: '呼叫中心設定', icon: Headset },
  { id: 'access-control', label: '門禁系統配置', icon: Key },
  { id: 'tenant', label: '租戶設定', icon: Settings },
];

const baseDataItems = [
  { id: 'plans', label: '套餐資料' },
  { id: 'addons', label: '增值服務' },
  { id: 'discount-data', label: '折扣資料' },
  { id: 'payment-methods', label: '在線支付' },
  { id: 'offline-account', label: '收款帳戶' },
  { id: 'e-business-card', label: '電子名片' },
  { id: 'terms-of-service', label: '服務條款' },
  { id: 'privacy-policy', label: '隱私政策' },
];

export default function Sidebar({ currentView, isCollapsed, onViewChange, onLogout, isAdminPlatform, userType, isSuperAdmin }) {
  const [isBaseDataOpen, setIsBaseDataOpen] = useState(false);
  const [isSipAccountOpen, setIsSipAccountOpen] = useState(false);

  const isSipUser = userType === 'sip';
  const tenantOnlyItems = ['domain', 'tenant-account-management', 'contact-books', 'ecard-styles-management', 'call-center', 'access-control', 'tenant'];
  const visibleNavItems = navItems.filter(item => {
    if (isSipUser) return item.id === 'registrations';
    if (item.id === 'registrations') return false;
    if (item.id === 'dashboard') return isAdminPlatform;
    if (item.id === 'users') return !isAdminPlatform;
    if (isAdminPlatform && tenantOnlyItems.includes(item.id)) return false;
    return true;
  });

  const toggleBaseData = () => {
    setIsBaseDataOpen((value) => !value);
  };

  const toggleSipAccount = () => {
    setIsSipAccountOpen((value) => !value);
  };

  return (
    <aside className="sidebar" aria-label="主選單">
      <style>{`
        .sidebar .nav {
          overflow-y: auto;
          scrollbar-width: none; /* Firefox */
          -ms-overflow-style: none; /* IE 10+ */
        }
        .sidebar .nav::-webkit-scrollbar {
          display: none; /* Chrome, Safari, Edge */
        }
      `}</style>
      <nav className="nav">
        {visibleNavItems.map((item) => {
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

        {isAdminPlatform && !isSipUser && (
          <>
            <button
              className={`nav-item ${currentView === 'plan-management' ? 'active' : ''}`}
              type="button"
              title={isCollapsed ? '訂閱審核' : undefined}
              aria-label="訂閱審核"
              onClick={() => onViewChange('plan-management')}
            >
              <Package className="nav-icon" size={20} aria-hidden="true" />
              {!isCollapsed && <span>訂閱審核</span>}
            </button>

            <button
              className={`nav-item ${currentView === 'tenant-management' ? 'active' : ''}`}
              type="button"
              title={isCollapsed ? '租戶管理' : undefined}
              aria-label="租戶管理"
              onClick={() => onViewChange('tenant-management')}
            >
              <Building className="nav-icon" size={20} aria-hidden="true" />
              {!isCollapsed && <span>租戶管理</span>}
            </button>

            <button
              className={`nav-item ${currentView === 'tenant-coupon-management' ? 'active' : ''}`}
              type="button"
              title={isCollapsed ? '優惠碼管理' : undefined}
              aria-label="優惠碼管理"
              onClick={() => onViewChange('tenant-coupon-management')}
            >
              <TicketPercent className="nav-icon" size={20} aria-hidden="true" />
              {!isCollapsed && <span>優惠碼管理</span>}
            </button>

            <button
              className={`nav-item nav-parent ${isSipAccountOpen ? 'open' : ''}`}
              type="button"
              title={isCollapsed ? '帳號設置' : undefined}
              aria-label="帳號設置"
              aria-expanded={isSipAccountOpen}
              onClick={toggleSipAccount}
            >
              <Users className="nav-icon" size={20} aria-hidden="true" />
              {!isCollapsed && (
                <>
                  <span>帳號設置</span>
                  {isSipAccountOpen ? <ChevronDown className="nav-caret" size={16} /> : <ChevronRight className="nav-caret" size={16} />}
                </>
              )}
            </button>

            {isSipAccountOpen && !isCollapsed && (
              <div className="sub-nav" aria-label="帳號設置子選單">
                <button
                  className={`sub-nav-item ${currentView === 'sip-account-registration' ? 'active' : ''}`}
                  type="button"
                  title="SIP帳號管理"
                  onClick={() => onViewChange('sip-account-registration')}
                >
                  SIP帳號管理
                </button>
                <button
                  className={`sub-nav-item ${currentView === 'sip-account-allocation' ? 'active' : ''}`}
                  type="button"
                  title="Web帳號管理"
                  onClick={() => onViewChange('sip-account-allocation')}
                >
                  Web帳號管理
                </button>
              </div>
            )}

            <button
              className={`nav-item ${currentView === 'device-management' ? 'active' : ''}`}
              type="button"
              title={isCollapsed ? '設備管理' : undefined}
              aria-label="設備管理"
              onClick={() => onViewChange('device-management')}
            >
              <Monitor className="nav-icon" size={20} aria-hidden="true" />
              {!isCollapsed && <span>設備管理</span>}
            </button>

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
                  title={['plans', 'offline-account', 'payment-methods', 'discount-data', 'addons', 'e-business-card', 'terms-of-service', 'privacy-policy'].includes(item.id) ? item.label : `${item.label}（暫未實作）`}
                    onClick={() => {
                    if (['plans', 'offline-account', 'payment-methods', 'discount-data', 'addons', 'e-business-card', 'terms-of-service', 'privacy-policy'].includes(item.id)) onViewChange(item.id);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {isSuperAdmin && (
          <button
            className={`nav-item ${currentView === 'platform-admin-management' ? 'active' : ''}`}
            type="button"
            title={isCollapsed ? '管理員設置' : undefined}
            onClick={() => onViewChange('platform-admin-management')}
          >
            <Shield className="nav-icon" size={20} aria-hidden="true" />
            {!isCollapsed && <span>管理員設置</span>}
          </button>
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
