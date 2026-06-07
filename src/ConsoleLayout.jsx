import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Download, Upload, UserPlus, UserMinus, Trash2, ShoppingCart, RefreshCw, HelpCircle } from 'lucide-react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import Dashboard from './Dashboard';
import Users from './Users';
import Registrations from './Registrations';
import Domain from './Domain';
import Tenant from './Tenant';
import PurchasePlan from './PurchasePlan';
import OfflinePaymentAccount from './OfflinePaymentAccount';
import Plans from './Plans';
import PaymentMethods from './PaymentMethods';
import DiscountData from './DiscountData';
import AddonServices from './AddonServices';
import TenantManagement from './TenantManagement';
import TenantCouponManagement from './TenantCouponManagement';
import PaymentProofDialog from './PaymentProofDialog';
import CreateUserDialog from './CreateUserDialog';
import LoginEmailDialog from './LoginEmailDialog';
import BillingAddressSyncDialog from './BillingAddressSyncDialog';
import ChangePasswordDialog from './ChangePasswordDialog';
import apiClient from './apiClient';
import SipAccountRegistration from './SipAccountRegistration';
import WebAccountRegistration from './WebAccountRegistration';
import DeviceManagement from './DeviceManagement';
import PlanManagement from './PlanManagement';
import TenantAccountManagement from './TenantAccountManagement';
import ContactBooks from './ContactBooks';
import PrivacyPolicy from './PrivacyPolicy';
import TermsOfService from './TermsOfService';
import EcardStyles from './EcardStyles';
import EcardGeneration from './EcardGeneration';
import CallCenterConfiguration from './CallCenterConfiguration';
import CallCenterAdd from './CallCenterAdd';
import CallCenterVisitorInquiries from './CallCenterVisitorInquiries';
import AccessControl from './AccessControl';
import OrderDetail from './OrderDetail';
import MyAccount from './MyAccount';
import PlatformAdminManagement from './PlatformAdminManagement';
import PlatformDashboard from './PlatformDashboard';
import TenantDashboard from './TenantDashboard';
const viewTitles = {
  dashboard: '控制台首頁',
  users: 'SIP 使用者',
  registrations: '我的帳號',
  domain: '我的套餐',
  'tenant-account-management': '帳號管理',
  'contact-books': '通訊錄管理',
  'sip-account-registration': 'SIP帳號管理',
  'sip-account-allocation': 'Web帳號管理',
  tenant: '租戶設定',
  'plan-management': '訂閱審核',
  'e-business-card': '電子名片',
  'ecard-styles-management': '電子名片管理',
  'tenant-management': '租戶管理',
  'tenant-coupon-management': '優惠碼管理',
  'device-management': '設備管理',
  'offline-account': '收款帳戶',
  plans: '套餐資料',
  'plans-add': '新增套餐',
  'payment-methods': '在線支付',
  'discount-data': '折扣資料',
  addons: '增值服務',
  'terms-of-service': '服務條款',
  'privacy-policy': '隱私政策',
  'purchase-plan': '購買套餐',
  'call-center': '呼叫中心設置',
  'call-center-add': '新增呼叫中心',
  'call-center-inquiries': '訪客諮詢記錄',
  'access-control': '門禁系統配置',
  'order-detail': '訂單詳情',
  'platform-admin-management': '管理員設置',
  'dashboard-platform': 'QRTalkie Cloud 平台概覽',
};

function getNameFromEmail(email) {
  return String(email || '').split('@')[0] || 'Admin';
}

export default function ConsoleLayout({ onLogout }) {
  const [currentView, setCurrentView] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [userType, setUserType] = useState(null);
  const [loginEmailInitialValue, setLoginEmailInitialValue] = useState('');
  const [tenantCouponMode, setTenantCouponMode] = useState('list');
  const [sipAccountMode, setSipAccountMode] = useState('list');
  const [webAccountMode, setWebAccountMode] = useState('list');
  const [deviceManagementMode, setDeviceManagementMode] = useState('list');
  const [ecardGenerationMode, setEcardGenerationMode] = useState('list');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showAdminHelp, setShowAdminHelp] = useState(false);
  const [showLegalHelp, setShowLegalHelp] = useState(false);
  const [legalHelpTitle, setLegalHelpTitle] = useState('');
  const [legalHelpType, setLegalHelpType] = useState('');
  const [showOfflineAccountHelp, setShowOfflineAccountHelp] = useState(false);
  const [showPaymentMethodsHelp, setShowPaymentMethodsHelp] = useState(false);
  const [showDiscountDataHelp, setShowDiscountDataHelp] = useState(false);
  const [showPlansHelp, setShowPlansHelp] = useState(false);
  const [showTenantMgmtHelp, setShowTenantMgmtHelp] = useState(false);
  const [showCouponMgmtHelp, setShowCouponMgmtHelp] = useState(false);
  const [showDeviceMgmtHelp, setShowDeviceMgmtHelp] = useState(false);
  const [showSipMgmtHelp, setShowSipMgmtHelp] = useState(false);
  const [showWebAccountHelp, setShowWebAccountHelp] = useState(false);
  const [showAddonServicesHelp, setShowAddonServicesHelp] = useState(false);
  const [showPlanMgmtHelp, setShowPlanMgmtHelp] = useState(false);
  const [messages, setMessages] = useState([]);
  const [tenantAccountMode, setTenantAccountMode] = useState('list');
  const [purchaseContext, setPurchaseContext] = useState({ mode: 'create', orderId: null });
  const [domainReloadToken, setDomainReloadToken] = useState(0);
  const [callCenterContext, setCallCenterContext] = useState({ mode: 'add', id: null });
  const [orderDetailId, setOrderDetailId] = useState(null);

  const paymentProofDialogRef = useRef(null);
  const createUserDialogRef = useRef(null);
  const loginEmailDialogRef = useRef(null);
  const billingAddressSyncDialogRef = useRef(null);
  const accessControlRef = useRef(null);
  const paymentMethodsRef = useRef(null);
  const plansRef = useRef(null);
  const discountDataRef = useRef(null);
  const addonServicesRef = useRef(null);
  const tenantManagementRef = useRef(null);
  const tenantCouponManagementRef = useRef(null);
  const sipAccountRegistrationRef = useRef(null);
  const webAccountRegistrationRef = useRef(null);
  const deviceManagementRef = useRef(null);
  const ecardGenerationRef = useRef(null);
  const callCenterConfigurationRef = useRef(null);
  const callCenterVisitorInquiriesRef = useRef(null);
  const contactBooksRef = useRef(null);
  const tenantAccountManagementRef = useRef(null);
  const domainRef = useRef(null);
  const platformAdminRef = useRef(null);
  const platformDashboardRef = useRef(null);

  const openCreateUserDialog = () => createUserDialogRef.current?.showModal();
  const openLoginEmailDialog = (email = '') => {
    setLoginEmailInitialValue(email);
    loginEmailDialogRef.current?.showModal();
  };

  useEffect(() => {
    let isMounted = true;
    apiClient.get('/me')
      .then((data) => {
        if (isMounted) {
          setIdentity(data);
          const ut = data.userType || (data.admin?.accountType === 'sip_user' ? 'sip' : 'admin');
          setUserType(ut);
          if (ut === 'sip') setCurrentView('registrations');
          else if (data.admin?.accountType === 'tenant') setCurrentView('users');
        }
      })
      .catch((error) => {
        console.warn('Failed to load console identity:', error.message);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Notification fetching + polling
  const fetchNotifications = useCallback(async () => {
    if (!identity) return;
    try {
      const res = await apiClient.get('/notifications');
      setMessages(Array.isArray(res.notifications) ? res.notifications : []);
    } catch { /* ignore */ }
  }, [identity]);

  useEffect(() => {
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 30000);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

  const handleMessageClick = useCallback((msg) => {
    if (msg.targetView) setCurrentView(msg.targetView);
  }, []);

  const handleMessageDismiss = useCallback(async (msg) => {
    try { await apiClient.post(`/notifications/${msg.id}/dismiss`); } catch {}
    setMessages(prev => prev.filter(m => m.id !== msg.id));
  }, []);

  const handleMessageDelete = useCallback(async (msg) => {
    try { await apiClient.delete(`/notifications/${msg.id}`); } catch {}
    setMessages(prev => prev.filter(m => m.id !== msg.id));
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    try { await apiClient.post('/notifications/read-all'); } catch {}
    setMessages([]);
  }, []);

  const workspaceName = useMemo(() => {
    if (userType === 'sip') return identity?.tenant?.companyName || identity?.admin?.username || 'QRTalkie';
    if (identity?.admin?.accountType === 'platform') return 'QRTalkie';
    return identity?.tenant?.companyName || 'QRTalkie';
  }, [identity, userType]);

  const userName = useMemo(() => {
    if (userType === 'sip') return identity?.admin?.displayName || identity?.admin?.username || '';
    const admin = identity?.admin || {};
    return admin.nickname || admin.displayName || getNameFromEmail(admin.loginEmail);
  }, [identity, userType]);

  const renderPageAction = () => {
    if (currentView === 'dashboard') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#7b8794', fontSize: '12px' }}>
          最后更新：{new Date().toLocaleString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).replace(/\//g, '-')}
          <RefreshCw size={14} style={{ cursor: 'pointer', color: '#7b8794' }} onClick={() => platformDashboardRef.current?.refresh()} />
        </div>
      );
    }
    if (currentView === 'payment-methods') {
      const actionBaseStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        height: '44px',
        minHeight: '44px',
        padding: '0 18px',
        borderRadius: '8px',
        fontSize: '12px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      };
      return (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="primary-btn" type="button" onClick={() => paymentMethodsRef.current?.startAdd()} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
            <Plus size={14} /> 新增在線支付
          </button>
          <button type="button" onClick={() => setShowPaymentMethodsHelp(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '8px', border: '1px solid #4b5563', background: '#1f2937', cursor: 'pointer', color: '#9ca3af' }} title="操作說明"><HelpCircle size={18} /></button>
        </div>
      );
    }
    if (currentView === 'discount-data') {
      const actionBaseStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        height: '44px',
        minHeight: '44px',
        padding: '0 18px',
        borderRadius: '8px',
        fontSize: '12px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      };
      return (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="primary-btn" type="button" onClick={() => discountDataRef.current?.startAdd()} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
            <Plus size={14} /> 新增折扣
          </button>
          <button type="button" onClick={() => setShowDiscountDataHelp(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '8px', border: '1px solid #4b5563', background: '#1f2937', cursor: 'pointer', color: '#9ca3af' }} title="操作說明"><HelpCircle size={18} /></button>
        </div>
      );
    }
    if (currentView === 'call-center') {
      const actionBaseStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        height: '44px',
        minHeight: '44px',
        padding: '0 18px',
        borderRadius: '8px',
        fontSize: '12px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      };
      return (
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="primary-btn" type="button" onClick={() => { setCallCenterContext({ mode: 'add', id: null }); setCurrentView('call-center-add'); }} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
            <Plus size={14} /> 新增呼叫中心
          </button>
          <button className="primary-btn" type="button" onClick={() => callCenterConfigurationRef.current?.handleBatchDelete()} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', border: '0', boxShadow: '0 6px 14px rgba(79, 70, 229, 0.22)' }}>
            <Trash2 size={14} /> 批量刪除
          </button>
        </div>
      );
    }
    if (currentView === 'addons') {
      const actionBaseStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        height: '44px',
        minHeight: '44px',
        padding: '0 18px',
        borderRadius: '8px',
        fontSize: '12px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      };
      return (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="primary-btn" type="button" onClick={() => addonServicesRef.current?.startAdd()} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
            <Plus size={14} /> 新增服務
          </button>
          <button type="button" onClick={() => setShowAddonServicesHelp(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '8px', border: '1px solid #4b5563', background: '#1f2937', cursor: 'pointer', color: '#9ca3af' }} title="操作說明"><HelpCircle size={18} /></button>
        </div>
      );
    }
    if (currentView === 'tenant-coupon-management') {
      if (tenantCouponMode === 'assign') {
        return (
          <button
            className="ghost-btn"
            type="button"
            onClick={() => tenantCouponManagementRef.current?.returnToList()}
          >
            返回首頁
          </button>
        );
      }
      return (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            className="primary-btn"
            type="button"
            onClick={() => tenantCouponManagementRef.current?.startAssign()}
          >
            <Plus size={14} />
            分配優惠碼
          </button>
          <button type="button" onClick={() => setShowCouponMgmtHelp(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '8px', border: '1px solid #4b5563', background: '#1f2937', cursor: 'pointer', color: '#9ca3af' }} title="操作說明"><HelpCircle size={18} /></button>
        </div>
      );
    }
    if (currentView === 'sip-account-registration') {
      if (sipAccountMode === 'list') {
        const sipActionBase = {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          height: '44px',
          minHeight: '44px',
          padding: '0 18px',
          borderRadius: '999px',
          fontSize: '12px',
          fontWeight: 500,
          whiteSpace: 'nowrap',
        };
        return (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="ghost-btn" type="button" onClick={() => sipAccountRegistrationRef.current?.handleExportCsv()} style={{ ...sipActionBase, background: '#fff', color: '#1e3a8a', border: '1px solid #dbeafe', boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)' }}>
              <Download size={14} /> 導出 CSV
            </button>
            <button className="ghost-btn" type="button" onClick={() => sipAccountRegistrationRef.current?.startImport()} style={{ ...sipActionBase, background: '#fff', color: '#1e3a8a', border: '1px solid #dbeafe', boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)' }}>
              <Upload size={14} /> 導入 CSV
            </button>
            <button className="primary-btn" type="button" onClick={() => sipAccountRegistrationRef.current?.startAdd()} style={{ ...sipActionBase, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
              <Plus size={14} /> 新增帳號
            </button>
            <button className="primary-btn" type="button" onClick={() => sipAccountRegistrationRef.current?.startBatchAdd()} style={{ ...sipActionBase, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
              <UserPlus size={14} /> 批量新增
            </button>
            <button className="primary-btn" type="button" onClick={() => sipAccountRegistrationRef.current?.handleBatchUnassign()} style={{ ...sipActionBase, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', color: '#fff', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
              <UserMinus size={14} /> 批量取消分配
            </button>
            <button className="primary-btn" type="button" onClick={() => sipAccountRegistrationRef.current?.handleBatchDelete()} style={{ ...sipActionBase, background: 'linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', border: '0', boxShadow: '0 6px 14px rgba(79, 70, 229, 0.22)' }}>
              <Trash2 size={14} /> 批量刪除
            </button>
            <button type="button" onClick={() => setShowSipMgmtHelp(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '8px', border: '1px solid #4b5563', background: '#1f2937', cursor: 'pointer', color: '#9ca3af' }} title="操作說明"><HelpCircle size={18} /></button>
          </div>
        );
      }
      if (['add', 'import'].includes(sipAccountMode)) {
        return (
          <button
            className="ghost-btn"
            type="button"
              style={{ borderRadius: '999px' }}
            onClick={() => sipAccountRegistrationRef.current?.returnToList()}
          >
            返回帳號登記首頁
          </button>
        );
      }
      return null;
    }
    if (currentView === 'sip-account-allocation') {
      if (webAccountMode === 'list') {
        return (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="ghost-btn" type="button" onClick={() => webAccountRegistrationRef.current?.handleExportCsv()} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px', borderRadius: '999px' }}>
              <Download size={14} /> 導出 CSV
            </button>
              <button className="ghost-btn" type="button" onClick={() => webAccountRegistrationRef.current?.startImport()} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px', borderRadius: '999px' }}>
              <Upload size={14} /> 導入 CSV
            </button>
              <button className="primary-btn" type="button" onClick={() => webAccountRegistrationRef.current?.startAdd()} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px', borderRadius: '999px' }}>
              <Plus size={14} /> 新增帳號
            </button>
              <button className="primary-btn" type="button" onClick={() => webAccountRegistrationRef.current?.startBatchAdd()} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px', borderRadius: '999px' }}>
              <UserPlus size={14} /> 批量新增
            </button>
              <button className="primary-btn" type="button" onClick={() => webAccountRegistrationRef.current?.handleBatchUnassign()} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px', backgroundColor: '#f59e0b', color: '#fff', border: 'none', borderRadius: '999px' }}>
              <UserMinus size={14} /> 批量取消分配
            </button>
              <button className="primary-btn" type="button" onClick={() => webAccountRegistrationRef.current?.handleBatchDelete()} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '999px' }}>
              <Trash2 size={14} /> 批量刪除
            </button>
            <button type="button" onClick={() => setShowWebAccountHelp(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '8px', border: '1px solid #4b5563', background: '#1f2937', cursor: 'pointer', color: '#9ca3af' }} title="操作說明"><HelpCircle size={18} /></button>
          </div>
        );
      }
      if (['add', 'import'].includes(webAccountMode)) {
        return (
          <button
            className="ghost-btn"
            type="button"
              style={{ borderRadius: '999px' }}
            onClick={() => webAccountRegistrationRef.current?.returnToList()}
          >
            返回帳號登記首頁
          </button>
        );
      }
      return null;
    }
    if (currentView === 'ecard-styles-management') {
      if (ecardGenerationMode === 'list') {
        const actionBaseStyle = {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          height: '44px',
          minHeight: '44px',
          padding: '0 18px',
          borderRadius: '8px',
          fontSize: '12px',
          fontWeight: 500,
          whiteSpace: 'nowrap',
        };
        return (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="primary-btn" type="button" onClick={() => ecardGenerationRef.current?.handleBatchEnable()} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
              批量啟用
            </button>
            <button className="primary-btn" type="button" onClick={() => ecardGenerationRef.current?.handleBatchDisable()} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
              批量停用
            </button>
            <button className="primary-btn" type="button" onClick={() => ecardGenerationRef.current?.handleBatchDownload()} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
              批量下載
            </button>
          </div>
        );
      }
      return null;
    }

    if (currentView === 'device-management') {
      if (deviceManagementMode === 'list') {
        const deviceActionBase = {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          height: '44px',
          minHeight: '44px',
          padding: '0 18px',
          borderRadius: '8px',
          fontSize: '12px',
          fontWeight: 500,
          whiteSpace: 'nowrap',
        };
        return (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="ghost-btn" type="button" onClick={() => deviceManagementRef.current?.handleExportCsv()} style={{ ...deviceActionBase, background: '#fff', color: '#1e3a8a', border: '1px solid #dbeafe', boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)' }}>
              <Download size={14} /> 導出 CSV
            </button>
            <button className="primary-btn" type="button" onClick={() => deviceManagementRef.current?.startAdd()} style={{ ...deviceActionBase, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
              <Plus size={14} /> 新增設備
            </button>
            <button className="primary-btn" type="button" onClick={() => deviceManagementRef.current?.startBatchAdd()} style={{ ...deviceActionBase, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
              <UserPlus size={14} /> 批量新增
            </button>
            <button className="primary-btn" type="button" onClick={() => deviceManagementRef.current?.handleBatchAssign()} style={{ ...deviceActionBase, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', color: '#fff', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
              <UserPlus size={14} /> 批量分配
            </button>
            <button className="primary-btn" type="button" onClick={() => deviceManagementRef.current?.handleBatchUnassign()} style={{ ...deviceActionBase, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', color: '#fff', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
              <UserMinus size={14} /> 批量取消分配
            </button>
            <button className="primary-btn" type="button" onClick={() => deviceManagementRef.current?.handleBatchDelete()} style={{ ...deviceActionBase, background: 'linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', border: '0', boxShadow: '0 6px 14px rgba(79, 70, 229, 0.22)' }}>
              <Trash2 size={14} /> 批量刪除
            </button>
            <button type="button" onClick={() => setShowDeviceMgmtHelp(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '8px', border: '1px solid #4b5563', background: '#1f2937', cursor: 'pointer', color: '#9ca3af' }} title="操作說明"><HelpCircle size={18} /></button>
          </div>
        );
      }
      if (['add', 'edit'].includes(deviceManagementMode)) {
        return (
          <button
            className="ghost-btn"
            type="button"
            onClick={() => deviceManagementRef.current?.returnToList()}
          >
            返回設備管理首页
          </button>
        );
      }
      return null;
    }
    if (currentView === 'plans') {
      const actionBaseStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        height: '44px',
        minHeight: '44px',
        padding: '0 18px',
        borderRadius: '8px',
        fontSize: '12px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      };
      return (
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="primary-btn"
            type="button"
            onClick={() => setCurrentView('plans-add')}
            style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}
          >
            <Plus size={14} /> 新增套餐
          </button>
          <button
            className="primary-btn"
            type="button"
            onClick={() => plansRef.current?.handleBatchDisable()}
            style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}
          >
            批量停用
          </button>
          <button
            className="primary-btn"
            type="button"
            onClick={() => plansRef.current?.handleBatchEnable()}
            style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}
          >
            批量啟用
          </button>
          <button type="button" onClick={() => setShowPlansHelp(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '8px', border: '1px solid #4b5563', background: '#1f2937', cursor: 'pointer', color: '#9ca3af' }} title="操作說明"><HelpCircle size={18} /></button>
        </div>
      );
    }
    if (currentView === 'plans-add') {
      return (
        <button className="ghost-btn" type="button" onClick={() => setCurrentView('plans')}>
          返回套餐列表
        </button>
      );
    }
    if (currentView === 'purchase-plan') {
      return (
        <button className="ghost-btn" type="button" onClick={() => setCurrentView('domain')}>
          返回我的套餐
        </button>
      );
    }
    if (currentView === 'order-detail') {
      return (
        <button className="ghost-btn" type="button" onClick={() => setCurrentView('domain')}>
          返回我的套餐
        </button>
      );
    }
    if (currentView === 'tenant-management') {
      const mode = tenantManagementRef.current?.viewMode;
      if (mode === 'add' || mode === 'edit') return null;
      return (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="primary-btn" type="button" onClick={() => tenantManagementRef.current?.startAdd()}>
            新增租戶
          </button>
          <button type="button" onClick={() => setShowTenantMgmtHelp(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '8px', border: '1px solid #4b5563', background: '#1f2937', cursor: 'pointer', color: '#9ca3af' }} title="操作說明"><HelpCircle size={18} /></button>
        </div>
      );
    }
    if (currentView === 'call-center-inquiries') {
      const actionBaseStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        height: '44px',
        minHeight: '44px',
        padding: '0 18px',
        borderRadius: '8px',
        fontSize: '12px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      };
      return (
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="primary-btn" type="button" onClick={() => callCenterVisitorInquiriesRef.current?.handleBatchDelete()} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', border: '0', boxShadow: '0 6px 14px rgba(79, 70, 229, 0.22)' }}>
            <Trash2 size={14} /> 批量刪除
          </button>
          <button className="primary-btn" type="button" onClick={() => setCurrentView('call-center')} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', border: '0', boxShadow: '0 6px 14px rgba(79, 70, 229, 0.22)' }}>
            返回列表
          </button>
        </div>
      );
    }
    if (currentView === 'domain') {
      const actionBaseStyle = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', height: '44px', minHeight: '44px', padding: '0 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap' };
      return (
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="primary-btn" type="button" onClick={() => { setPurchaseContext({ mode: 'create', orderId: null }); setCurrentView('purchase-plan'); }} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}><ShoppingCart size={14} /> 購買套餐</button>
          <button className="primary-btn" type="button" onClick={() => domainRef.current?.showPayments()} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>💳 付款記錄</button>
        </div>
      );
    }
    if (currentView === 'platform-admin-management') {
      return (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="primary-btn" type="button" onClick={() => platformAdminRef.current?.openAdd()} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', height: '44px', padding: '0 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap', background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)', color: '#fff' }}>
            + 新增管理員
          </button>
          <button type="button" onClick={() => setShowAdminHelp(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '8px', border: '1px solid #d8e2ef', background: '#fff', cursor: 'pointer', color: '#64748b' }} title="帮助">
            <HelpCircle size={18} />
          </button>
        </div>
      );
    }
    if (currentView === 'access-control') {
      const actionBaseStyle = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', height: '44px', minHeight: '44px', padding: '0 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap' };
      return (<button className="primary-btn" type="button" onClick={() => accessControlRef.current?.showAddCommunityDialog()} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}><Plus size={14} /> 新增社區</button>);
    }
    if (currentView === 'tenant-account-management' && tenantAccountMode === 'list') {
      const actionBaseStyle = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', height: '44px', minHeight: '44px', padding: '0 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap' };
      return (
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '8px', padding: '6px 14px', background: '#fef2f2' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            建議為每一個使用中的帳號設定顯示名稱和正確的電子郵箱，並更改預設密碼！
          </span>
          <button className="primary-btn" type="button" onClick={() => tenantAccountManagementRef.current?.handleBatchResetPassword()} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
            重置密碼
          </button>
        </div>
      );
    }
    if (currentView === 'contact-books') {
      const cbStyle = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', height: '44px', minHeight: '44px', padding: '0 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap' };
      return (<button className="primary-btn" type="button" onClick={() => contactBooksRef.current?.handleCreate()} style={{ ...cbStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}><Plus size={14} /> 新增通訊錄</button>);
    }
    if (currentView === 'offline-account') {
      return (<div style={{ display: 'flex', gap: '8px' }}><button type="button" onClick={() => setShowOfflineAccountHelp(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '8px', border: '1px solid #4b5563', background: '#1f2937', cursor: 'pointer', color: '#9ca3af' }} title="帮助"><HelpCircle size={18} /></button></div>);
    }
    if (currentView === 'terms-of-service') {
      return (<div style={{ display: 'flex', gap: '8px' }}><button type="button" onClick={() => { setLegalHelpTitle('服務條款'); setLegalHelpType('terms'); setShowLegalHelp(true); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '8px', border: '1px solid #d8e2ef', background: '#fff', cursor: 'pointer', color: '#64748b' }} title="帮助"><HelpCircle size={18} /></button></div>);
    }
    if (currentView === 'privacy-policy') {
      return (<div style={{ display: 'flex', gap: '8px' }}><button type="button" onClick={() => { setLegalHelpTitle('隱私政策'); setLegalHelpType('privacy'); setShowLegalHelp(true); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '8px', border: '1px solid #d8e2ef', background: '#fff', cursor: 'pointer', color: '#64748b' }} title="帮助"><HelpCircle size={18} /></button></div>);
    }
    if (currentView === 'plan-management') {
      return (<div style={{ display: 'flex', gap: '8px' }}><button type="button" onClick={() => setShowPlanMgmtHelp(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '44px', width: '44px', borderRadius: '8px', border: '1px solid #4b5563', background: '#1f2937', cursor: 'pointer', color: '#9ca3af' }} title="操作說明"><HelpCircle size={18} /></button></div>);
    }
    return null;
  };

  return (
    <div className={`app-shell ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`} id="console">
      <Topbar
        workspaceName={workspaceName}
        userName={userName}
        messages={messages}
        onMessageClick={handleMessageClick}
        onMessageDismiss={handleMessageDismiss}
        onMessageDelete={handleMessageDelete}
        onMarkAllRead={handleMarkAllRead}
        onToggleSidebar={() => setIsSidebarCollapsed((value) => !value)}
        onLogout={onLogout}
        onChangePassword={() => setShowChangePassword(true)}
        isAdmin={identity?.admin?.accountType === 'platform'}
        isTenantAdmin={identity?.admin?.accountType === 'tenant'}
        onNavigate={(view) => setCurrentView(view)}
      />

      <Sidebar
        currentView={currentView}
        isCollapsed={isSidebarCollapsed}
        onViewChange={(view) => { if (userType === 'sip' && view !== 'registrations') return; setCurrentView(view); }}
        onLogout={onLogout}
        isAdminPlatform={identity?.admin?.accountType === 'platform'}
        isSuperAdmin={identity?.admin?.platformRole === 'super_admin'}
        userType={userType}
      />

      <main className={`main ${['tenant', 'offline-account', 'plans', 'plans-add', 'plan-management', 'payment-methods', 'discount-data', 'addons', 'tenant-coupon-management'].includes(currentView) ? 'tenant-mode' : ''} ${currentView === 'payment-methods' ? 'payment-methods-mode' : ''} ${['discount-data', 'addons', 'plans', 'plans-add', 'plan-management', 'tenant', 'e-business-card'].includes(currentView) ? 'discount-data-mode' : ''} ${currentView === 'addons' ? 'addon-data-mode' : ''} ${currentView === 'tenant-coupon-management' ? 'tenant-coupon-mode' : ''} ${['device-management', 'tenant-account-management', 'contact-books', 'ecard-styles-management', 'call-center', 'call-center-add', 'call-center-inquiries', 'access-control'].includes(currentView) ? 'device-management-mode' : ''} ${['domain', 'order-detail', 'purchase-plan', 'registrations', 'platform-admin-management', 'dashboard', 'users'].includes(currentView) ? 'domain-home-mode' : ''}`}>
        <header className="page-heading" style={{ display: ['e-business-card', 'call-center-add'].includes(currentView) || (currentView === 'ecard-styles-management' && ecardGenerationMode === 'add') ? 'none' : 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', boxSizing: 'border-box', ...(currentView === 'plans' ? { marginTop: '-12px' } : {}) }}>
          <h1 id="page-title">{
            currentView === 'dashboard' && identity?.admin?.accountType === 'platform' ? 'QRTalkie Cloud 平台概覽' :
            currentView === 'purchase-plan'
              ? (purchaseContext?.mode === 'edit' ? '訂單修改' : purchaseContext?.mode === 'renewal' ? '訂單續訂' : purchaseContext?.mode === 'repurchase' ? '重新購買' : '購買套餐')
              : (viewTitles[currentView] || '控制台')
          }</h1>
          {renderPageAction()}
        </header>

        <div className="main-scroll">
          {currentView === 'dashboard' && <PlatformDashboard />}
          {currentView === 'users' && <TenantDashboard onNavigate={setCurrentView} />}
          {currentView === 'registrations' && (
          userType === 'sip' ? <MyAccount identity={identity} /> : <Registrations />
        )}
          {currentView === 'domain' && (
            <Domain
              ref={domainRef}
              reloadToken={domainReloadToken}
              paymentProofDialogRef={paymentProofDialogRef}
              onOpenPurchase={(context) => {
                setPurchaseContext(context || { mode: 'create', orderId: null });
                setCurrentView('purchase-plan');
              }}
              onOpenDetail={(id) => {
                setOrderDetailId(id);
                setCurrentView('order-detail');
              }}
            />
          )}
          {currentView === 'tenant-account-management' && (
            <TenantAccountManagement ref={tenantAccountManagementRef} onNavigate={(view) => setCurrentView(view)} onModeChange={setTenantAccountMode} />
          )}
          {currentView === 'contact-books' && <ContactBooks ref={contactBooksRef} />}
          {currentView === 'e-business-card' && (
            <EcardStyles />
          )}
          {currentView === 'ecard-styles-management' && (
            <EcardGeneration ref={ecardGenerationRef} onModeChange={setEcardGenerationMode} />
          )}
          {currentView === 'terms-of-service' && <TermsOfService />}
          {currentView === 'privacy-policy' && <PrivacyPolicy />}
          {currentView === 'call-center' && (
            <CallCenterConfiguration 
              ref={callCenterConfigurationRef} 
              onEdit={(id) => {
                setCallCenterContext({ mode: 'edit', id });
                setCurrentView('call-center-add');
              }}
              onViewInquiries={(id) => {
                setCallCenterContext({ mode: 'inquiries', id });
                setCurrentView('call-center-inquiries');
              }}
            />
          )}
          {currentView === 'call-center-add' && (
            <CallCenterAdd onReturn={() => setCurrentView('call-center')} tenant={identity?.tenant} context={callCenterContext} />
          )}
          {currentView === 'call-center-inquiries' && (
            <CallCenterVisitorInquiries ref={callCenterVisitorInquiriesRef} onReturn={() => setCurrentView('call-center')} context={callCenterContext} />
          )}
          {currentView === 'access-control' && <AccessControl ref={accessControlRef} />}
          {currentView === 'platform-admin-management' && <PlatformAdminManagement ref={platformAdminRef} />}
          {currentView === 'tenant' && <Tenant onOpenLoginEmail={openLoginEmailDialog} />}
          {currentView === 'tenant-management' && <TenantManagement ref={tenantManagementRef} />}
          {currentView === 'offline-account' && <OfflinePaymentAccount />}
          {['plans', 'plans-add'].includes(currentView) && (
            <Plans ref={plansRef} view={currentView} onReturnToList={() => setCurrentView('plans')} />
          )}
          {currentView === 'plan-management' && (
            <PlanManagement onNavigate={setCurrentView} />
          )}
          {currentView === 'sip-account-registration' && (
            <SipAccountRegistration ref={sipAccountRegistrationRef} onModeChange={setSipAccountMode} />
          )}
          {currentView === 'sip-account-allocation' && (
            <WebAccountRegistration ref={webAccountRegistrationRef} onModeChange={setWebAccountMode} />
          )}
          {currentView === 'device-management' && (
            <DeviceManagement ref={deviceManagementRef} onModeChange={setDeviceManagementMode} />
          )}
          {currentView === 'tenant-coupon-management' && (
            <TenantCouponManagement ref={tenantCouponManagementRef} onModeChange={setTenantCouponMode} />
          )}
          {currentView === 'payment-methods' && <PaymentMethods ref={paymentMethodsRef} />}
          {currentView === 'discount-data' && <DiscountData ref={discountDataRef} />}
          {currentView === 'addons' && <AddonServices ref={addonServicesRef} />}
          {currentView === 'purchase-plan' && (
            <PurchasePlan
              tenant={identity?.tenant}
              paymentProofDialogRef={paymentProofDialogRef}
              purchaseContext={purchaseContext}
              onBack={() => setCurrentView('domain')}
            />
          )}
          {currentView === 'order-detail' && (
            <OrderDetail
              orderId={orderDetailId}
              onBack={() => setCurrentView('domain')}
            />
          )}
        </div>
      </main>

      <PaymentProofDialog ref={paymentProofDialogRef} onSuccess={() => { setDomainReloadToken((value) => value + 1); setCurrentView('domain'); }} />
      <CreateUserDialog ref={createUserDialogRef} />
      <LoginEmailDialog ref={loginEmailDialogRef} initialEmail={loginEmailInitialValue} />
      <BillingAddressSyncDialog ref={billingAddressSyncDialogRef} />

      {showChangePassword && <ChangePasswordDialog onClose={() => setShowChangePassword(false)} />}

      {showAdminHelp && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2147483647, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'flex-end' }} onClick={() => setShowAdminHelp(false)}>
          <div style={{ width: 'min(420px, 90vw)', height: '100%', background: '#111827', borderLeft: '1px solid #1f2937', overflow: 'auto', padding: '28px 24px', scrollbarWidth: 'none' }} onClick={e => e.stopPropagation()}>
            <style>{`.help-drawer::-webkit-scrollbar { display: none; }`}</style>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>操作指南</h2>
              <button onClick={() => setShowAdminHelp(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '20px' }}>&#10005;</button>
            </div>

            <div style={{ color: '#e5e7eb', fontSize: '13px', lineHeight: 1.8 }}>
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ color: '#60a5fa', fontSize: '14px', marginBottom: '8px' }}>&#128100; 新增管理员</h3>
                <p style={{ color: '#9ca3af', margin: 0 }}>点击"新增管理員"按钮，填写邮箱、密码、显示名称、电话和角色。平台管理员可以登录系统进行订单审核、租户管理等后台操作。</p>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ color: '#60a5fa', fontSize: '14px', marginBottom: '8px' }}>&#9998; 编辑管理员</h3>
                <p style={{ color: '#9ca3af', margin: 0 }}>点击操作列的"编辑"按钮，可修改管理员的邮箱、显示名称、电话和角色。密码留空则不修改。</p>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ color: '#60a5fa', fontSize: '14px', marginBottom: '8px' }}>&#128273; 重置密码</h3>
                <p style={{ color: '#9ca3af', margin: 0 }}>点击操作列的"重置密码"按钮，输入新密码和确认密码。密码至少需要 6 个字符，两次输入需一致。</p>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ color: '#60a5fa', fontSize: '14px', marginBottom: '8px' }}>&#9888; 啟用 / 停用</h3>
                <p style={{ color: '#9ca3af', margin: 0 }}>点击操作列的"啟用"或"停用"按钮，控制管理员的登录权限。停用后该管理员无法登录系统。超级管理员不可停用。</p>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ color: '#60a5fa', fontSize: '14px', marginBottom: '8px' }}>&#10060; 删除管理员</h3>
                <p style={{ color: '#9ca3af', margin: 0 }}>点击操作列的"删除"按钮可永久删除管理员账号。此操作不可恢复。超级管理员不可删除。</p>
              </div>

              <div>
                <h3 style={{ color: '#60a5fa', fontSize: '14px', marginBottom: '8px' }}>&#128274; 角色说明</h3>
                <div style={{ color: '#9ca3af', fontSize: '12px' }}>
                  <div style={{ padding: '4px 0' }}><span style={{ color: '#f3f4f6' }}>超级管理员</span> — 系统预设，拥有全部权限，不可删除或停用</div>
                  <div style={{ padding: '4px 0' }}><span style={{ color: '#f3f4f6' }}>管理员</span> — 可管理租户、订单审核、系统配置</div>
                  <div style={{ padding: '4px 0' }}><span style={{ color: '#f3f4f6' }}>运营</span> — 负责日常运营操作和用户服务</div>
                  <div style={{ padding: '4px 0' }}><span style={{ color: '#f3f4f6' }}>财务</span> — 负责订单收款审核和财务管理</div>
                  <div style={{ padding: '4px 0' }}><span style={{ color: '#f3f4f6' }}>客服</span> — 负责用户咨询和故障处理</div>
                  <div style={{ padding: '4px 0' }}><span style={{ color: '#f3f4f6' }}>审计</span> — 负责安全审计和合规检查</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLegalHelp && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "flex-end" }} onClick={() => setShowLegalHelp(false)}>
          <div style={{ width: "min(440px, 90vw)", height: "100%", background: "#111827", borderLeft: "1px solid #1f2937", overflow: "auto", padding: "28px 24px", scrollbarWidth: "none" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#f3f4f6" }}>{legalHelpTitle} 使用說明</h2>
              <button onClick={() => setShowLegalHelp(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "20px" }}>&#10005;</button>
            </div>
            <div style={{ color: "#e5e7eb", fontSize: "13px", lineHeight: 1.8 }}>
              {legalHelpType === "terms" ? (<>
                <div style={{ marginBottom: "24px" }}>
                  <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128196; 服務條款的作用</h3>
                  <p style={{ color: "#9ca3af", margin: 0 }}>服務條款是用戶使用 QRTalkie 服務前必須同意的基本規則和約定。它定義了平台與用戶之間的權利義務關係。</p>
                </div>
                <div style={{ marginBottom: "24px" }}>
                  <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128269; 用戶註冊時的展示方式</h3>
                  <p style={{ color: "#9ca3af", margin: 0 }}>用戶在註冊頁面（Landing Page）點擊「註冊」時，必須勾選「我已閱讀並同意服務條款」複選框。點擊服務條款連結後，會彈出視窗顯示此處編輯的完整內容。用戶必須同意服務條款才能完成註冊。</p>
                </div>
                <div style={{ marginBottom: "24px" }}>
                  <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#9998; 編輯建議</h3>
                  <p style={{ color: "#9ca3af", margin: 0 }}>使用 Markdown 格式編輯。點擊「導入模板」載入預設模板後修改。主要章節包括：服務說明、帳號規則、用戶行為規範、通信服務、知識產權、免責聲明等。</p>
                </div>
                <div>
                  <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128279; 前端接入位置</h3>
                  <p style={{ color: "#9ca3af", margin: 0 }}>註冊頁面（Landing.jsx）中的「服務條款」連結調用 <code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/public/settings/terms-of-service</code></p>
                </div>
              </>) : (<>
                <div style={{ marginBottom: "24px" }}>
                  <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128274; 隱私政策的作用</h3>
                  <p style={{ color: "#9ca3af", margin: 0 }}>隱私政策說明 QRTalkie 如何收集、使用、存儲和保護用戶的個人資訊，是法律合規的必要文件。</p>
                </div>
                <div style={{ marginBottom: "24px" }}>
                  <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128269; 用戶註冊時的展示方式</h3>
                  <p style={{ color: "#9ca3af", margin: 0 }}>用戶在註冊頁面（Landing Page）點擊「註冊」時，必須勾選「我已閱讀並同意隱私政策」複選框。點擊隱私政策連結後，會彈出視窗顯示此處編輯的完整內容。</p>
                </div>
                <div style={{ marginBottom: "24px" }}>
                  <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#9998; 編輯建議</h3>
                  <p style={{ color: "#9ca3af", margin: 0 }}>使用 Markdown 格式編輯。點擊「導入模板」載入預設模板後修改。主要章節：適用範圍、資訊收集、使用方式、共享、權限說明、用戶權利等。</p>
                </div>
                <div>
                  <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128279; 前端接入位置</h3>
                  <p style={{ color: "#9ca3af", margin: 0 }}>註冊頁面（Landing.jsx）中的「隱私政策」連結調用 <code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/public/settings/privacy-policy</code></p>
                </div>
              </>)}
            </div>
          </div>
        </div>
      )}

      {showOfflineAccountHelp && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "flex-end" }} onClick={() => setShowOfflineAccountHelp(false)}>
          <div style={{ width: "min(440px, 90vw)", height: "100%", background: "#111827", borderLeft: "1px solid #1f2937", overflow: "auto", padding: "28px 24px", scrollbarWidth: "none" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#f3f4f6" }}>收款帳戶 使用說明</h2>
              <button onClick={() => setShowOfflineAccountHelp(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "20px" }}>&#10005;</button>
            </div>
            <div style={{ color: "#e5e7eb", fontSize: "13px", lineHeight: 1.8 }}>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#127974; 收款帳戶的作用</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>收款帳戶是平台提供給租戶的線下付款銀行帳戶資訊。當租戶選擇線下匯款方式支付時，系統會顯示此處設定的銀行帳戶資料。</p>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128269; 租戶端的展示方式</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>租戶在購買套餐或續訂時，選擇「線下付款」方式後，系統會在付款頁面顯示此收款帳戶的所有資訊，包括銀行名稱、帳號、SWIFT 代碼等。租戶需按照顯示的帳戶資訊完成匯款。</p>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#9998; 欄位說明</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>帳戶代碼</strong> — 系統內部使用的唯一識別碼，預設為 default-usd-bank。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>帳戶名稱</strong> — 收款帳戶的顯示名稱，例如「公司主要帳戶」。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>收款單位</strong> — 收款方的公司或個人名稱。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>開戶銀行</strong> — 銀行名稱，例如「HSBC Taiwan」。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>銀行帳號</strong> — 完整的銀行帳戶號碼。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>銀行分行</strong> — 開戶分行的名稱或代碼。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>SWIFT</strong> — 國際匯款用的 SWIFT/BIC 代碼。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>幣別</strong> — 3 位 ISO 貨幣代碼，例如 USD、TWD。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>聯絡人</strong> — 收款相關事宜的聯絡人姓名。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>聯絡電話</strong> — 聯絡人電話號碼。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>聯絡信箱</strong> — 聯絡人電子郵件地址。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>付款提示</strong> — 附加的付款注意事項或說明，會顯示給租戶參考。</li>
                </ul>
              </div>
              <div>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128279; 前端接入位置</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>租戶購買頁面調用 <code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/billing/offline-payment-account</code> 取得收款帳戶資訊，保存時調用 <code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>PUT /api/billing/offline-payment-account</code>。</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPaymentMethodsHelp && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "flex-end" }} onClick={() => setShowPaymentMethodsHelp(false)}>
          <div style={{ width: "min(440px, 90vw)", height: "100%", background: "#111827", borderLeft: "1px solid #1f2937", overflow: "auto", padding: "28px 24px", scrollbarWidth: "none" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#f3f4f6" }}>在線支付 操作說明</h2>
              <button onClick={() => setShowPaymentMethodsHelp(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "20px" }}>&#10005;</button>
            </div>
            <div style={{ color: "#e5e7eb", fontSize: "13px", lineHeight: 1.8 }}>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128179; 在線支付的作用</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>在線支付管理讓平台管理員設定租戶可選擇的付款方式。每種付款方式可設定名稱、類型（線上/線下）、圖示和啟用狀態。租戶購買套餐時可從已啟用的付款方式中選擇。</p>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128295; 主要功能</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>新增付款方式</strong> — 點擊「新增在線支付」按鈕，填寫代碼、名稱、類型等資訊，並上傳付款方式圖示。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>編輯付款方式</strong> — 點擊卡片上的「編輯」按鈕修改現有付款方式的設定。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>啟用/停用切換</strong> — 使用開關按鈕快速啟用或停用某個付款方式，無需進入編輯頁面。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>刪除付款方式</strong> — 移除不再使用的付款方式。</li>
                </ul>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128203; 欄位說明</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>方式代碼</strong> — 唯一識別碼，用於系統內部識別。留空將自動由顯示名稱生成。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>顯示名稱</strong> — 租戶端顯示的付款方式名稱，例如「信用卡」、「銀行轉帳」。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>付款類型</strong> — 線上付款（即時處理）或線下付款（人工確認）。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>啟用狀態</strong> — 設為啟用後，租戶才能在付款頁面看到此付款方式。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>Logo 樣式</strong> — CSS class 名稱，用於顯示預設的付款品牌圖示，例如 paypal、visa、mastercard。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>排序</strong> — 數字越小越靠前，控制付款方式在選擇列表中的顯示順序。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>付款方式圖示</strong> — 上傳自訂圖示圖片。建議尺寸 160x64px，支援 PNG/JPG/WebP/SVG。</li>
                </ul>
              </div>
              <div>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128279; API 端點</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>取得/更新付款方式：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET/PUT /api/billing/payment-method-settings</code><br/>刪除單一付款方式：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>DELETE /api/billing/payment-method-settings/:id</code></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDiscountDataHelp && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "flex-end" }} onClick={() => setShowDiscountDataHelp(false)}>
          <div style={{ width: "min(440px, 90vw)", height: "100%", background: "#111827", borderLeft: "1px solid #1f2937", overflow: "auto", padding: "28px 24px", scrollbarWidth: "none" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#f3f4f6" }}>折扣資料 操作說明</h2>
              <button onClick={() => setShowDiscountDataHelp(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "20px" }}>&#10005;</button>
            </div>
            <div style={{ color: "#e5e7eb", fontSize: "13px", lineHeight: 1.8 }}>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#127991; 折扣資料的功能</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>折扣資料（優惠碼）管理讓平台管理員建立和管理折扣規則。租戶在購買套餐時可輸入折扣碼享受優惠。支援百分比折扣和固定金額減免兩種模式，並可設定有效期限和使用次數上限。</p>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128260; 頁面佈局說明</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>頁面分為左右兩欄：<strong style={{ color: "#e5e7eb" }}>左側</strong>為折扣列表，顯示所有已建立的折扣碼，可搜尋和篩選；<strong style={{ color: "#e5e7eb" }}>右側</strong>為折扣詳情編輯面板，點擊左側任一折扣即可查看和編輯其規則。</p>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128295; 操作流程</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>1. 新增折扣</strong> — 點擊右上角「新增折扣」按鈕，在右側面板填寫折扣規則。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>2. 設定折扣代碼</strong> — 輸入唯一的大寫英文代碼（如 SAVE20），租戶結帳時輸入此代碼。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>3. 選擇折扣類型</strong> — 百分比折扣（如 20%）或固定金額減免（如 TWD 500）。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>4. 設定有效期限</strong> — 可選設定生效日期和到期日期，到期後自動標記為過期。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>5. 設定使用上限</strong> — 限制折扣碼可被使用的總次數，留空表示不限。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>6. 儲存並啟用</strong> — 點擊「建立折扣」儲存，狀態設為「啟用」後租戶即可使用。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>7. 管理現有折扣</strong> — 在左側列表點擊折扣進行編輯；使用開關快速啟用/停用；點擊「刪除」移除。</li>
                </ul>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128203; 欄位說明</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>折扣代碼</strong> — 租戶結帳時輸入的代碼，必須是英文大寫字母和數字，不可重複。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>顯示名稱</strong> — 管理後台顯示的名稱，用於識別折扣。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>折扣類型</strong> — 百分比折扣（按訂單金額比例折扣）或固定金額減免（直接扣除指定金額）。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>折扣值</strong> — 百分比模式輸入 1-100 數字，固定金額模式輸入金額。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>幣種</strong> — 僅固定金額模式需要，選擇折扣適用的貨幣。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>狀態</strong> — 啟用（可使用）、停用（暫停使用）、過期（已超過到期日）。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>生效日期</strong> — 可為空，表示不限制起始日期。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>到期日期</strong> — 折扣的有效截止日期。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>使用上限</strong> — 限制折扣碼的總使用次數，留空表示不限次數。</li>
                </ul>
              </div>
              <div>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128279; API 端點</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>取得/更新折扣設定：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET/PUT /api/billing/coupon-settings</code><br/>刪除單一折扣：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>DELETE /api/billing/coupon-settings/:id</code></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPlansHelp && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "flex-end" }} onClick={() => setShowPlansHelp(false)}>
          <div style={{ width: "min(440px, 90vw)", height: "100%", background: "#111827", borderLeft: "1px solid #1f2937", overflow: "auto", padding: "28px 24px", scrollbarWidth: "none" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#f3f4f6" }}>套餐資料 操作說明</h2>
              <button onClick={() => setShowPlansHelp(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "20px" }}>&#10005;</button>
            </div>
            <div style={{ color: "#e5e7eb", fontSize: "13px", lineHeight: 1.8 }}>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128230; 套餐資料的功能</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>套餐資料是平台的核心定價設定，定義租戶可購買的各種套餐方案。每個套餐包含帳戶數量、價格階梯、功能摘要等資訊。租戶在購買頁面（Domain 頁）選擇套餐進行訂購，系統依據此處的設定計算費用。</p>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128295; 主要功能</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>新增套餐</strong> — 點擊「新增套餐」按鈕進入新增頁面，填寫套餐代碼、名稱、帳戶數量、價格和功能摘要等資訊。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>編輯套餐</strong> — 點擊表格行中的下拉選單選擇「編輯」，在彈出視窗中修改套餐設定。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>查看詳情</strong> — 選擇「詳情」以唯讀模式查看套餐的所有設定。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>批量操作</strong> — 勾選多個套餐後，使用「批量停用」或「批量啟用」按鈕一次性修改多個套餐的狀態。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>快速切換狀態</strong> — 在下拉選單中選擇「啟用/停用」可快速切換單個套餐的狀態。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>搜尋與篩選</strong> — 使用頂部搜尋欄搜尋套餐 ID、代碼或名稱；使用下拉選單按狀態篩選。</li>
                </ul>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128203; 欄位說明</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>套餐代碼</strong> — 唯一識別碼，用於系統內部和 API 調用。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>套餐名稱</strong> — 租戶端顯示的套餐名稱。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>帳戶數量</strong> — 套餐包含的 SIP/Web 帳戶數量上限。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>狀態</strong> — 啟用（租戶可購買）/ 停用（隱藏）。（必填）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>排序</strong> — 數字越小越靠前，控制套餐在購買頁面的顯示順序。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>增值服務列表</strong> — 此套餐可選配的增值服務代碼，用逗號分隔。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>描述</strong> — 套餐的文字說明。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>功能摘要</strong> — 套餐功能的簡短摘要，顯示在購買頁面。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>價格階梯</strong> — 設定不同帳戶數量對應的單價和幣種，支援多個階梯。第一個階梯為基礎價格。</li>
                </ul>
              </div>
              <div>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128279; API 端點</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>套餐列表：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/billing/plans</code><br/>建立/更新套餐：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>POST/PUT /api/billing/plans</code><br/>批量操作：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>PUT /api/billing/plans/batch</code></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showTenantMgmtHelp && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "flex-end" }} onClick={() => setShowTenantMgmtHelp(false)}>
          <div style={{ width: "min(440px, 90vw)", height: "100%", background: "#111827", borderLeft: "1px solid #1f2937", overflow: "auto", padding: "28px 24px", scrollbarWidth: "none" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#f3f4f6" }}>租戶管理 操作說明</h2>
              <button onClick={() => setShowTenantMgmtHelp(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "20px" }}>&#10005;</button>
            </div>
            <div style={{ color: "#e5e7eb", fontSize: "13px", lineHeight: 1.8 }}>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#127970; 租戶管理的功能</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>租戶管理讓平台管理員查看和管理所有註冊租戶。可查看租戶基本資訊、訂閱狀態、累計支付金額，並執行編輯、啟用/停用、刪除等操作。</p>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128295; 主要功能</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>新增租戶</strong> — 點擊「新增租戶」按鈕，填寫企業資訊和管理員帳號，建立新租戶。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>編輯租戶</strong> — 點擊「更多 &gt; 編輯」，進入編輯頁面修改企業資訊，管理員信箱不可更改。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>查看詳情</strong> — 點擊「詳情」或「更多 &gt; 詳情」，彈窗顯示租戶完整資訊。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>啟用/停用</strong> — 在「更多」選單中切換租戶狀態。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>刪除租戶</strong> — 在「更多」選單中選擇刪除（僅停用狀態的租戶可刪除）。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>搜尋與篩選</strong> — 支援按公司名稱、聯絡人、信箱搜尋；按狀態篩選（全部/啟用中/已停用）。</li>
                </ul>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128203; 列表欄位說明</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>租戶編號</strong> — 系統自動生成的唯一編號，格式 TENANT-XXXXXX。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>公司名稱</strong> — 租戶註冊時填寫的公司名稱。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>註冊日期</strong> — 租戶的註冊時間。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>訂閱數量</strong> — 租戶購買的帳戶數量上限。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>累計支付</strong> — 該租戶歷史支付總金額。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>狀態</strong> — 啟用中 / 已停用 / 待審核 / 即將到期 / 已過期。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>操作</strong> — 詳情按鈕和更多選單（編輯、啟用/停用、刪除）。</li>
                </ul>
              </div>
              <div>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128279; API 端點</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>租戶列表：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/admin/tenants</code><br/>租戶詳情：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/admin/tenants/:id</code><br/>建立/更新：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>PUT /api/admin/tenants/:id</code><br/>刪除：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>DELETE /api/admin/tenants/:id</code></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCouponMgmtHelp && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "flex-end" }} onClick={() => setShowCouponMgmtHelp(false)}>
          <div style={{ width: "min(440px, 90vw)", height: "100%", background: "#111827", borderLeft: "1px solid #1f2937", overflow: "auto", padding: "28px 24px", scrollbarWidth: "none" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#f3f4f6" }}>優惠碼管理 操作說明</h2>
              <button onClick={() => setShowCouponMgmtHelp(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "20px" }}>&#10005;</button>
            </div>
            <div style={{ color: "#e5e7eb", fontSize: "13px", lineHeight: 1.8 }}>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#127991; 優惠碼管理的功能</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>優惠碼管理讓平台管理員為租戶分配折扣優惠碼。每個優惠碼可分配給不同租戶，租戶購買套餐時輸入優惠碼即可享受折扣。</p>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128161; 重要前提</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#fbbf24" }}>&#9888; 優惠碼來源</strong> — 分配優惠碼前，必須先在「基礎數據 &gt; 折扣資料」中建立優惠碼。若優惠碼列表為空，請先前往折扣資料頁面新增。</li>
                  <li><strong style={{ color: "#fbbf24" }}>&#9888; 已使用不可撤銷</strong> — 租戶已在下單時使用的優惠碼將標記為「已使用」，無法撤銷。撤銷操作僅對「未使用」狀態的分配記錄有效。</li>
                </ul>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128295; 主要功能</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>分配優惠碼</strong> — 點擊「分配優惠碼」按鈕，選擇啟用中的租戶和生效中的優惠碼，確認分配。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>查看詳情</strong> — 點擊「詳情」按鈕查看分配記錄的完整資訊。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>撤銷分配</strong> — 對未使用的分配記錄點擊「撤銷」，可取消該優惠碼分配。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>重新啟用</strong> — 對已撤銷的記錄點擊「啟用」，可恢復該優惠碼分配。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>刪除記錄</strong> — 對已撤銷的記錄點擊「刪除」，永久移除分配記錄。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>搜尋與篩選</strong> — 支援按關鍵字搜尋，按使用狀態篩選。</li>
                </ul>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128203; 使用狀態說明</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>未使用</strong> — 已分配但租戶尚未在訂單中使用。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>已使用</strong> — 租戶已在下單時使用此優惠碼，無法撤銷。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>已撤銷</strong> — 平台管理員已手動撤銷，租戶無法再使用。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>已過期</strong> — 優惠碼已超過有效期限。</li>
                </ul>
              </div>
              <div>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128279; API 端點</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>分配列表：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/admin/tenant-coupons</code><br/>分配優惠碼：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>POST /api/admin/tenant-coupons</code><br/>撤銷/啟用/刪除：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>POST/DELETE /api/admin/tenant-coupons/:id</code></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDeviceMgmtHelp && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "flex-end" }} onClick={() => setShowDeviceMgmtHelp(false)}>
          <div style={{ width: "min(440px, 90vw)", height: "100%", background: "#111827", borderLeft: "1px solid #1f2937", overflow: "auto", padding: "28px 24px", scrollbarWidth: "none" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#f3f4f6" }}>設備管理 操作說明</h2>
              <button onClick={() => setShowDeviceMgmtHelp(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "20px" }}>&#10005;</button>
            </div>
            <div style={{ color: "#e5e7eb", fontSize: "13px", lineHeight: 1.8 }}>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#127976; 設備管理的功能</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>設備管理用於為租戶門禁系統提供入口開關遠端控制。每個設備對應一個實體繼電器控制單元，通過 MQTT 主題發布控制指令來遠端開啟/關閉門禁。</p>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128295; 主要功能</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>新增設備</strong> — 手動新增單個設備，設定 UUID、繼電器 ID、MQTT 主題等參數。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>批量新增</strong> — 一次性批次新增多個設備，自動生成 UUID。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>分配設備</strong> — 將設備分配給指定租戶，分配後租戶可通過門禁系統控制該設備。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>取消分配</strong> — 取消設備與租戶的綁定關係。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>編輯設備</strong> — 修改設備的設定參數。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>刪除設備</strong> — 移除不再使用的設備。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>導出 CSV</strong> — 將設備列表匯出為 CSV 檔案。</li>
                </ul>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128203; 欄位說明</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>UUID</strong> — 設備唯一識別碼，系統自動生成，用於 MQTT 通訊中的設備標識。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>繼電器 ID</strong> — MQTT Relay ID，標識設備所屬的繼電器控制單元。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>發布主題（Publish Topic）</strong> — 發布控制命令的 MQTT 主題。其中的 <code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>SendID</code> 欄位為設備控制單元（繼電器）編號，用於指定要控制哪一個開關迴路。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>訂閱主題（Subscribe Topic）</strong> — 接收設備回傳反饋資訊的 MQTT 主題，格式為 <code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>繼電器ID/QRTALKIE/POST</code>。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>WiFi 名稱</strong> — 設備所在地的 WiFi 網路名稱，用於設備連網設定。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>WiFi 密碼</strong> — 對應 WiFi 網路的連接密碼。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>分配狀態</strong> — 已分配（已綁定租戶）/ 未分配（尚未綁定）/ 已停用。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>所屬租戶</strong> — 設備當前綁定的租戶名稱。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>截止日期</strong> — 設備的使用截止日期。</li>
                </ul>
              </div>
              <div>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128279; API 端點</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>設備列表：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/admin/gate-devices</code><br/>新增/編輯設備：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>POST/PUT /api/admin/gate-devices</code><br/>批量操作：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>POST /api/admin/gate-devices/batch</code></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSipMgmtHelp && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "flex-end" }} onClick={() => setShowSipMgmtHelp(false)}>
          <div style={{ width: "min(440px, 90vw)", height: "100%", background: "#111827", borderLeft: "1px solid #1f2937", overflow: "auto", padding: "28px 24px", scrollbarWidth: "none" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#f3f4f6" }}>SIP 帳號管理 操作說明</h2>
              <button onClick={() => setShowSipMgmtHelp(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "20px" }}>&#10005;</button>
            </div>
            <div style={{ color: "#e5e7eb", fontSize: "13px", lineHeight: 1.8 }}>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128222; SIP 帳號管理的功能</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>SIP 帳號管理用於建立和維護 SIP 通訊帳號。每個 SIP 帳號對應一個 SIP 分機，可用於語音通話、視訊通話等通訊服務。管理員可在此批次建立、編輯、分配和刪除 SIP 帳號。所有帳號會同步至服務端。</p>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128295; 主要功能</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>新增帳號</strong> — 手動新增單個 SIP 帳號，設定用戶名、密碼、角色等。若用戶名曾被刪除保留，系統會彈窗詢問是否釋放後重新創建。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>批量新增</strong> — 一次性批次建立多個 SIP 帳號，自動遞增用戶名。如有「已刪除保留」的帳號，可點擊「釋放並重試」一次性釋放後重新創建。全部成功時彈窗自動關閉。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>導入 CSV</strong> — 從 CSV 檔案批量導入 SIP 帳號。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>導出 CSV</strong> — 將帳號列表匯出為 CSV 檔案。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>編輯帳號</strong> — 修改帳號的顯示名、郵箱、電話等設定。用戶名和域名不可修改。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>查看詳情</strong> — 查看帳號的完整資訊與服務端同步狀態。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>重設密碼</strong> — 快速重設帳號的密碼，同步更新至服務端。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>帳號校驗</strong> — 校驗本地數據與服務端數據是否一致，發現不一致時可手動同步。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>批量取消分配</strong> — 批次取消帳號與租戶的綁定。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>批量刪除</strong> — 批次刪除帳號，彈窗提供兩種模式選擇。（見下方刪除說明）</li>
                </ul>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#ef4444", fontSize: "14px", marginBottom: "8px" }}>&#9888;&#65039; 刪除操作重要說明（請務必閱讀）</h3>
                <div style={{ background: "#1e293b", borderRadius: "8px", padding: "16px", border: "1px solid #374151" }}>
                  <p style={{ color: "#fbbf24", margin: "0 0 12px", fontWeight: 600, fontSize: "14px" }}>刪除帳號將從服務端移除該 SIP 帳號，操作不可逆，請謹慎執行。</p>
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{ color: "#fbbf24", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>&#128994; 保留刪除（預設）</div>
                    <p style={{ color: "#9ca3af", margin: 0, fontSize: "12px" }}>從服務端刪除帳號，但<strong style={{ color: "#fbbf24" }}>保留該用戶名</strong>。該用戶名將無法再次註冊，防止被他人佔用。日後如需使用同一用戶名，需由超級管理員在資料庫中手動釋放，或透過「徹底刪除」操作釋放。</p>
                  </div>
                  <div>
                    <div style={{ color: "#ef4444", fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>&#128308; 徹底刪除</div>
                    <p style={{ color: "#9ca3af", margin: 0, fontSize: "12px" }}>從服務端刪除帳號，同時<strong style={{ color: "#ef4444" }}>永久釋放該用戶名</strong>，允許重新註冊。此操作將清除用戶名的刪除保留記錄，<strong style={{ color: "#ef4444" }}>一旦執行無法恢復</strong>。僅在確定需要重新使用該用戶名時才選擇此選項。</p>
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128203; 欄位說明</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>用戶名</strong> — SIP 帳號的登入名稱，用於 SIP 註冊。新增後不可修改。（必填，純數字）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>域名</strong> — SIP 服務域名，預設為 sip.qrtalkie.org。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>顯示名</strong> — 來電顯示的名稱，預設與用戶名相同。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>密碼</strong> — SIP 註冊密碼，至少 6 個字元。新增時必填，編輯時留空則不修改。（批量新增預設密碼為 12345678）</li>
                  <li><strong style={{ color: "#e5e7eb" }}>角色</strong> — User（一般用戶）或 Admin（管理員）。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>狀態</strong> — Active（啟用）或 Inactive（停用）。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>手機號碼</strong> — 聯絡電話，需符合國際格式（如 +886912345678），格式不符將不發送至服務端。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>郵箱</strong> — 聯絡電子郵件，預設為「用戶名@域名」。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>外部帳號</strong> — 勾選後可設定外部 SIP 中繼參數（用戶名、域名、密碼、Realm、Registrar、Outbound Proxy、通訊協定）。</li>
                </ul>
              </div>
              <div>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128279; API 端點</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>帳號列表：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/admin/sip-accounts</code><br/>新增/編輯：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>POST/PUT /api/admin/sip-accounts</code><br/>批量新增：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>POST /api/admin/sip-accounts/batch</code><br/>重設密碼：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>PUT /api/admin/sip-accounts/:id/reset-password</code><br/>帳號校驗：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/admin/sip-accounts/:id/verify</code><br/>釋放保留：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>POST /api/flexisip/accounts/tombstones/release</code></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showWebAccountHelp && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "flex-end" }} onClick={() => setShowWebAccountHelp(false)}>
          <div style={{ width: "min(440px, 90vw)", height: "100%", background: "#111827", borderLeft: "1px solid #1f2937", overflow: "auto", padding: "28px 24px", scrollbarWidth: "none" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#f3f4f6" }}>Web 帳號管理 操作說明</h2>
              <button onClick={() => setShowWebAccountHelp(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "20px" }}>&#10005;</button>
            </div>
            <div style={{ color: "#e5e7eb", fontSize: "13px", lineHeight: 1.8 }}>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#127760; Web 帳號管理的功能</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>Web 帳號用於用戶透過瀏覽器呼叫 SIP 帳號，實現網頁端語音和視訊通話。在分配 SIP 帳號時，系統將自動為每一個 SIP 帳號隨機配置一個 Web 帳號，因此 Web 帳號數量不應少於 SIP 帳號數量。</p>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#9888; 重要提示</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#fbbf24" }}>數量關係</strong> — 每個 SIP 帳號需要對應一個 Web 帳號，確保 Web 帳號數量 ≥ SIP 帳號數量，避免分配失敗。</li>
                  <li><strong style={{ color: "#fbbf24" }}>自動配對</strong> — 分配 SIP 帳號時，系統會自動配對未分配的 Web 帳號。如無可用 Web 帳號，SIP 分配將失敗。</li>
                </ul>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128295; 主要功能</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>新增帳號</strong> — 手動新增單個 Web 帳號，設定用戶名、密碼、角色、狀態等。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>批量新增</strong> — 一次性批次建立多個 Web 帳號，自動遞增用戶名。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>導入 CSV</strong> — 從 CSV 檔案批量導入 Web 帳號。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>導出 CSV</strong> — 將帳號列表匯出為 CSV 檔案。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>編輯帳號</strong> — 修改帳號的顯示名、密碼、角色等設定。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>查看詳情</strong> — 查看帳號的完整資訊。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>重設密碼</strong> — 快速重設帳號的登入密碼。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>啟用/停用</strong> — 在更多選單中切換帳號狀態。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>帳號分配/取消分配</strong> — 將帳號分配給租戶或取消分配。</li>
                </ul>
              </div>
              <div>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128279; API 端點</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>帳號列表：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/admin/web-accounts</code><br/>新增/編輯：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>POST/PUT /api/admin/web-accounts</code><br/>重設密碼：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>PUT /api/admin/web-accounts/:id/reset-password</code></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddonServicesHelp && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "flex-end" }} onClick={() => setShowAddonServicesHelp(false)}>
          <div style={{ width: "min(440px, 90vw)", height: "100%", background: "#111827", borderLeft: "1px solid #1f2937", overflow: "auto", padding: "28px 24px", scrollbarWidth: "none" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#f3f4f6" }}>增值服務 操作說明</h2>
              <button onClick={() => setShowAddonServicesHelp(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "20px" }}>&#10005;</button>
            </div>
            <div style={{ color: "#e5e7eb", fontSize: "13px", lineHeight: 1.8 }}>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128230; 增值服務的功能</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>增值服務是套餐的可選附加功能，租戶購買套餐時可同時選購。管理員在此設定增值服務的基本資訊和不同套餐下的定價。</p>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128260; 頁面結構說明</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>頂部統計欄</strong> — 顯示服務總數、啟用中數量、定價規則數量，快速了解增值服務概況。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>左側列表</strong> — 已建立的增值服務列表，支援搜尋和狀態篩選。每個項目顯示服務代碼、名稱和預設定價。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>右側詳情</strong> — 點擊左側任一增值服務後，右側顯示該服務的完整資訊和定價設定。</li>
                </ul>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128295; 操作流程</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>1. 新增服務</strong> — 點擊「新增服務」按鈕，在右側面板填寫服務代碼、名稱、說明、計費單位和預設定價。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>2. 設定套餐定價</strong> — 在「套餐定價」區域為每個套餐設定不同的單價和幣種，可勾選「隨套餐期限」讓價格自動跟隨套餐週期。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>3. 檢視服務</strong> — 點擊左側列表中的服務項目，右側顯示該服務的詳細資訊。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>4. 啟用/停用</strong> — 使用開關按鈕快速切換服務狀態，停用的服務不會在租戶端顯示。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>5. 刪除服務</strong> — 點擊服務項目右側的刪除圖標移除服務。</li>
                </ul>
              </div>
              <div>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128279; API 端點</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>服務列表：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/billing/addon-services</code><br/>建立/更新服務：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>PUT /api/billing/addon-services</code></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPlanMgmtHelp && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "flex-end" }} onClick={() => setShowPlanMgmtHelp(false)}>
          <div style={{ width: "min(440px, 90vw)", height: "100%", background: "#111827", borderLeft: "1px solid #1f2937", overflow: "auto", padding: "28px 24px", scrollbarWidth: "none" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600, color: "#f3f4f6" }}>訂閱審核 操作說明</h2>
              <button onClick={() => setShowPlanMgmtHelp(false)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "20px" }}>&#10005;</button>
            </div>
            <div style={{ color: "#e5e7eb", fontSize: "13px", lineHeight: 1.8 }}>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128220; 訂閱審核的功能</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>訂閱審核用於管理租戶的套餐訂單，包括新購和續訂。管理員在此查看訂單狀態、審核訂單、分配 SIP 和 Web 帳號，並確認付款憑證。</p>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128260; 頁面結構說明</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>頂部查詢統計欄</strong> — 搜尋訂單和狀態篩選，統計標籤可快速切換篩選條件（全部/已支付/未支付/已審核/待審核等）。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>訂單列表</strong> — 顯示訂單編號、租戶、帳號數量、狀態、金額等資訊，支援排序和複選。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>操作選單</strong> — 每筆訂單的「更多」下拉選單提供詳情、審核等功能。</li>
                </ul>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128295; 審核流程</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>1. 確認訂單詳情</strong> — 查看訂單的套餐內容、帳號數量、支付狀態和付款憑證。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>2. 填寫審核意見</strong> — 選擇審核通過或不通過，填寫審核備註。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>3. 分配帳號</strong> — 審核通過後，為訂單分配對應數量的 SIP 和 Web 帳號。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>4. 確認提交</strong> — 確認所有資訊無誤後提交審核結果。</li>
                </ul>
              </div>
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128203; 訂單狀態說明</h3>
                <ul style={{ color: "#9ca3af", margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li><strong style={{ color: "#e5e7eb" }}>未支付</strong> — 租戶已建立訂單但尚未付款。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>已支付</strong> — 租戶已完成付款，等待管理員審核。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>待審核</strong> — 付款憑證已提交，等待審核。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>已審核</strong> — 管理員已完成審核。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>已生效</strong> — 訂單已生效，帳號已分配。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>即將過期</strong> — 套餐即將到期。</li>
                  <li><strong style={{ color: "#e5e7eb" }}>已過期</strong> — 套餐已超過有效期限。</li>
                </ul>
              </div>
              <div>
                <h3 style={{ color: "#60a5fa", fontSize: "14px", marginBottom: "8px" }}>&#128279; API 端點</h3>
                <p style={{ color: "#9ca3af", margin: 0 }}>訂單列表：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/admin/billing-orders</code><br/>訂單詳情：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>GET /api/admin/billing-orders/:id</code><br/>提交審核：<code style={{ color: "#fbbf24", background: "#1f2937", padding: "2px 6px", borderRadius: "4px" }}>POST /api/admin/billing-orders/:id/review</code></p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
