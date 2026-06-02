import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Download, Upload, UserPlus, UserMinus, Trash2, ShoppingCart } from 'lucide-react';
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
        <button className="primary-btn" type="button" onClick={() => platformAdminRef.current?.openAdd()} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', height: '44px', padding: '0 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap', background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', border: '0', boxShadow: '0 6px 14px rgba(37, 99, 235, 0.22)', color: '#fff' }}>
          + 新增管理員
        </button>
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
    </div>
  );
}
