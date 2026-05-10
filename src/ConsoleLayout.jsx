import React, { useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import Dashboard from './Dashboard';
import Users from './Users';
import Registrations from './Registrations';
import Domain from './Domain';
import Tenant from './Tenant';
import PurchasePlan from './PurchasePlan';
import OfflinePaymentAccount from './OfflinePaymentAccount';
import PaymentMethods from './PaymentMethods';
import PaymentProofDialog from './PaymentProofDialog';
import CreateUserDialog from './CreateUserDialog';
import LoginEmailDialog from './LoginEmailDialog';
import BillingAddressSyncDialog from './BillingAddressSyncDialog';
import apiClient from './apiClient';

const viewTitles = {
  dashboard: '控制台首頁',
  users: 'SIP 使用者',
  registrations: '註冊狀態',
  domain: '套餐管理',
  tenant: '租戶設定',
  'offline-account': '收款帳戶',
  'payment-methods': '付款方式',
  'purchase-plan': '購買套餐',
};

function getNameFromEmail(email) {
  return String(email || '').split('@')[0] || 'Admin';
}

export default function ConsoleLayout({ onLogout }) {
  const [currentView, setCurrentView] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [loginEmailInitialValue, setLoginEmailInitialValue] = useState('');

  const paymentProofDialogRef = useRef(null);
  const createUserDialogRef = useRef(null);
  const loginEmailDialogRef = useRef(null);
  const billingAddressSyncDialogRef = useRef(null);

  const openCreateUserDialog = () => createUserDialogRef.current?.showModal();
  const openLoginEmailDialog = (email = '') => {
    setLoginEmailInitialValue(email);
    loginEmailDialogRef.current?.showModal();
  };

  useEffect(() => {
    let isMounted = true;
    apiClient.get('/me')
      .then((data) => {
        if (isMounted) setIdentity(data);
      })
      .catch((error) => {
        console.warn('Failed to load console identity:', error.message);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const workspaceName = useMemo(() => {
    if (identity?.admin?.accountType === 'platform') return 'QRTalkie';
    return identity?.tenant?.companyName || 'QRTalkie';
  }, [identity]);

  const userName = useMemo(() => {
    const admin = identity?.admin || {};
    return admin.nickname || admin.displayName || getNameFromEmail(admin.loginEmail);
  }, [identity]);

  const renderPageAction = () => {
    if (currentView === 'purchase-plan') {
      return (
        <button className="ghost-btn" type="button" onClick={() => setCurrentView('domain')}>
          返回套餐管理
        </button>
      );
    }
    if (currentView === 'domain') {
      return (
        <button className="primary-btn" type="button" onClick={() => setCurrentView('purchase-plan')}>
          購買套餐
        </button>
      );
    }
    return null;
  };

  return (
    <div className={`app-shell ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`} id="console">
      <Topbar
        workspaceName={workspaceName}
        userName={userName}
        onToggleSidebar={() => setIsSidebarCollapsed((value) => !value)}
      />

      <Sidebar
        currentView={currentView}
        isCollapsed={isSidebarCollapsed}
        onViewChange={setCurrentView}
        onLogout={onLogout}
      />

      <main className={`main ${['tenant', 'offline-account', 'payment-methods'].includes(currentView) ? 'tenant-mode' : ''}`}>
        <header className="page-heading">
          <h1 id="page-title">{viewTitles[currentView] || '控制台'}</h1>
          {renderPageAction()}
        </header>

        <div className="main-scroll">
          {currentView === 'dashboard' && <Dashboard />}
          {currentView === 'users' && <Users onOpenCreateUser={openCreateUserDialog} />}
          {currentView === 'registrations' && <Registrations />}
          {currentView === 'domain' && <Domain />}
          {currentView === 'tenant' && <Tenant onOpenLoginEmail={openLoginEmailDialog} />}
          {currentView === 'offline-account' && <OfflinePaymentAccount />}
          {currentView === 'payment-methods' && <PaymentMethods />}
          {currentView === 'purchase-plan' && <PurchasePlan />}
        </div>
      </main>

      <PaymentProofDialog ref={paymentProofDialogRef} />
      <CreateUserDialog ref={createUserDialogRef} />
      <LoginEmailDialog ref={loginEmailDialogRef} initialEmail={loginEmailInitialValue} />
      <BillingAddressSyncDialog ref={billingAddressSyncDialogRef} />
    </div>
  );
}
