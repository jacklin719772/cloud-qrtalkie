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
  'plan-management': '套餐管理',
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
        <button className="primary-btn" type="button" onClick={() => paymentMethodsRef.current?.startAdd()} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
          <Plus size={14} /> 新增在線支付
        </button>
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
        <button className="primary-btn" type="button" onClick={() => discountDataRef.current?.startAdd()} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
          <Plus size={14} /> 新增折扣
        </button>
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
        <button className="primary-btn" type="button" onClick={() => addonServicesRef.current?.startAdd()} style={{ ...actionBaseStyle, background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)' }}>
          <Plus size={14} /> 新增服務
        </button>
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
            返回優惠碼管理首頁
          </button>
        );
      }
      return (
        <button
          className="primary-btn"
          type="button"
          onClick={() => tenantCouponManagementRef.current?.startAssign()} // The common styles are applied via TenantCouponManagement's internal CSS
        >
          <Plus size={14} /> {/* Icon size consistent with DeviceManagement */}
          分配優惠碼
        </button>
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
      return (
        <button className="primary-btn" type="button">
          新增租戶
        </button>
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
          {currentView === 'tenant-management' && <TenantManagement />}
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

      {showChangePassword && <ChangePasswordDialog onClose={() => setShowChangePassword(false)} identity={identity} />}

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
    </div>
  );
}
