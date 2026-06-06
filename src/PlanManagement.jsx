import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import apiClient from './apiClient';

export default function PlanManagement({ onNavigate }) {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [stats, setStats] = useState({ total: 0, reviewed: 0, pendingReview: 0, active: 0, paid: 0, unpaid: 0, expired: 0, expiringSoon: 0 });
  const [pageHeadingNode, setPageHeadingNode] = useState(null);

  // 輔助函數：根據 URL 補全後端服務地址
  function getFullImageUrl(url) {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return url;
    // 優先读取环境变量中的 API_URL
    const apiUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || '';
    if (apiUrl && apiUrl.startsWith('http')) {
      return apiUrl.replace(/\/api\/?$/, '') + (url.startsWith('/') ? url : `/${url}`);
    }
    // 本地开发环境的兜底地址，默认后端端口为 3001
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      if (window.location.port === '5173' || window.location.port === '3000') {
        return `http://127.0.0.1:3001${url.startsWith('/') ? url : `/${url}`}`;
      }
    }
    return url;
  }
  const [detailOrder, setDetailOrder] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [showCostDetails, setShowCostDetails] = useState(false);
  const [reviewOrder, setReviewOrder] = useState(null);
  const [reviewStep, setReviewStep] = useState(1);
  const [isLoadingReview, setIsLoadingReview] = useState(false);
  const [reviewData, setReviewData] = useState({ status: 'review_approved', comments: '' });
  const [unassignedSipAccounts, setUnassignedSipAccounts] = useState([]);
  const [selectedSipAccountIds, setSelectedSipAccountIds] = useState([]);
  const [isLoadingSipAccounts, setIsLoadingSipAccounts] = useState(false);
  const [unassignedWebAccounts, setUnassignedWebAccounts] = useState([]);
  const [isLoadingWebAccounts, setIsLoadingWebAccounts] = useState(false);

  const isRenewalOrder = (order) => (order?.order_type || order?.orderType) === 'renewal';
  const orderRequiresWebAccounts = (order) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    if (items.some((item) => (item.itemType || item.item_type) === 'addon')) return true;
    return Boolean(order?.addon_names || order?.addonNames);
  };

  const openDetailModal = async (order) => {
    setDetailOrder(order);
    setShowCostDetails(false);
    setIsLoadingDetail(true);
    try {
      const res = await apiClient.get(`/admin/billing-orders/${order.id}`);
      if (res && res.order) setDetailOrder(prev => ({ ...prev, ...res.order }));
    } catch (err) {
      console.error('Failed to fetch detailed order:', err);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const openReviewModal = async (order) => {
    const initialStatus = (order.order_status || order.orderStatus) === 'review_rejected' ? 'review_rejected' : 'review_approved';
    const initialComments = order.review_note || order.reviewNote || '';
    setReviewOrder(order);
    setReviewStep(1);
    setReviewData({ status: initialStatus, comments: initialComments });
    setSelectedSipAccountIds([]);
    setUnassignedSipAccounts([]);
    setUnassignedWebAccounts([]);
    setIsLoadingReview(true);
    setIsLoadingSipAccounts(true);
    setIsLoadingWebAccounts(true);
    try {
      const [res, sipData, webData] = await Promise.all([
        apiClient.get(`/admin/billing-orders/${order.id}`),
        apiClient.get('/admin/sip-accounts'),
        apiClient.get('/admin/web-accounts')
      ]);
      if (res && res.order) {
        const nextOrder = { ...order, ...res.order };
        const nextStatus = (nextOrder.order_status || nextOrder.orderStatus) === 'review_rejected' ? 'review_rejected' : 'review_approved';
        setReviewOrder(prev => ({ ...prev, ...res.order }));
        setReviewData({
          status: nextStatus,
          comments: nextOrder.review_note || nextOrder.reviewNote || ''
        });
      }
      const accounts = Array.isArray(sipData?.accounts) ? sipData.accounts : [];
      setUnassignedSipAccounts(accounts.filter(account => !account.tenantName));
      const webAccounts = Array.isArray(webData?.accounts) ? webData.accounts : [];
      setUnassignedWebAccounts(webAccounts.filter(account => !account.tenantName && account.status === 'active'));
    } catch (err) {
      console.error('Failed to fetch detailed order:', err);
    } finally {
      setIsLoadingReview(false);
      setIsLoadingSipAccounts(false);
      setIsLoadingWebAccounts(false);
    }
  };

  const submitReview = async () => {
    if (reviewData.status === 'review_rejected' && !reviewData.comments.trim()) {
      alert('請輸入審核不通過的意見原因');
      return;
    }
    const requiredAccountCount = Number(reviewOrder?.account_quantity || reviewOrder?.accountQuantity || 0);
    const isRenewalReview = isRenewalOrder(reviewOrder);
    if (reviewData.status === 'review_approved' && !isRenewalReview && selectedSipAccountIds.length !== requiredAccountCount) {
      alert(`當前已選擇 ${selectedSipAccountIds.length} 個帳號，需要選擇 ${requiredAccountCount} 個帳號後才能提交審核。`);
      return;
    }

    let webAccountIds = [];
    if (reviewData.status === 'review_approved' && orderRequiresWebAccounts(reviewOrder)) {
      let missingWebCount = 0;
      if (isRenewalReview) {
        const retainedAccounts = Array.isArray(reviewOrder?.retainedAccounts) ? reviewOrder.retainedAccounts : [];
        const replacementCount = Math.max(0, requiredAccountCount - retainedAccounts.length);
        const retainedWithoutWebCount = retainedAccounts.filter(acc => !(acc.webAccountId || acc.hasWebAccount || acc.webAccountUsername)).length;
        missingWebCount = replacementCount + retainedWithoutWebCount;
      } else {
        missingWebCount = requiredAccountCount;
      }

      if (unassignedWebAccounts.length < missingWebCount) {
        alert(`當前可用 Web 帳號不足，帳號不足不能完成分配工作。\n\n需要分配 Web 帳號：${missingWebCount} 個\n目前未分配帳號：${unassignedWebAccounts.length} 個`);
        return;
      }
      webAccountIds = unassignedWebAccounts.slice(0, missingWebCount).map(a => a.id);
    }

    const resultText = reviewData.status === 'review_approved' ? '審核通過' : '審核不通過';
    const orderNo = reviewOrder?.order_no || reviewOrder?.orderNo || reviewOrder?.id || '';
    const confirmed = window.confirm(`確定要提交訂單 ${orderNo} 的審核結果為「${resultText}」嗎？`);
    if (!confirmed) return;

    setIsLoadingReview(true);
    try {
      await apiClient.post(`/admin/billing-orders/${reviewOrder.id}/review`, {
        status: reviewData.status,
        comments: reviewData.comments,
        sipAccountIds: reviewData.status === 'review_approved' && !isRenewalReview ? selectedSipAccountIds : [],
        webAccountIds
      });
      alert('審核結果已提交成功。');
      setReviewOrder(null);
      setStatusFilter('all');
      setCurrentPage(1);
      await loadOrders();
    } catch (err) {
      alert(err.message || '審核提交失敗，请稍後重試。');
    } finally {
      setIsLoadingReview(false);
    }
  };

  const goToAccountAssignmentStep = () => {
    const requiredCount = Number(reviewOrder?.account_quantity || reviewOrder?.accountQuantity || 0);
    if (isRenewalOrder(reviewOrder)) {
      setSelectedSipAccountIds([]);
      setReviewStep(3);
      return;
    }
    const availableCount = unassignedSipAccounts.length;
    if (availableCount < requiredCount) {
      const confirmed = window.confirm(`未分配帳號數量不足。當前未分配帳號 ${availableCount} 個，需要分配 ${requiredCount} 個。\n\n点击確定后将前往帳號登记頁面，请添加足够帳號以完成帳號分配操作。`);
      if (confirmed) {
        setReviewOrder(null);
        onNavigate?.('sip-account-registration');
      }
      return;
    }
    setSelectedSipAccountIds(unassignedSipAccounts.slice(0, requiredCount).map(account => account.id));
    setReviewStep(3);
  };

  const goToWebAccountAssignmentStep = () => {
    const requiredCount = Number(reviewOrder?.account_quantity || reviewOrder?.accountQuantity || 0);
    if (!isRenewalOrder(reviewOrder) && selectedSipAccountIds.length !== requiredCount) {
      alert(`當前已選擇 ${selectedSipAccountIds.length} 個 SIP 帳號，需要選擇 ${requiredCount} 個帳號後才能进入 Web 帳號分配。`);
      return;
    }

    let missingWebCount = 0;
    if (isRenewalOrder(reviewOrder)) {
      const retainedAccounts = Array.isArray(reviewOrder?.retainedAccounts) ? reviewOrder.retainedAccounts : [];
      const replacementCount = Math.max(0, requiredCount - retainedAccounts.length);
      // 检查保留的 SIP 帳號中，有多少個尚未分配 Web 帳號
      const retainedWithoutWebCount = retainedAccounts.filter(acc => !(acc.webAccountId || acc.hasWebAccount || acc.webAccountUsername)).length;
      missingWebCount = replacementCount + retainedWithoutWebCount;
    } else {
      missingWebCount = requiredCount;
    }

    const availableCount = unassignedWebAccounts.length;
    if (availableCount < missingWebCount) {
      alert(`當前可用 Web 帳號不足，帳號不足不能完成分配工作。\n\n需要分配 Web 帳號：${missingWebCount} 個\n目前未分配帳號：${availableCount} 個`);
      return;
    }
    setReviewStep(4);
  };

  const itemFormula = (item) => {
    return `${item.currency} ${Number(item.unitPrice).toFixed(2)} x ${item.quantity} x ${item.months}`;
  };

  const formatMoney = (amount, currency = 'USD') => {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  };

  const pageSizeOptions = [10, 20, 50, "全部"];
  const [pageSize, setPageSize] = useState(10);
  const effectivePageSize = pageSize === "全部" ? (totalItems || 1) : pageSize;

  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const dropdownAnchorRef = useRef(null);
  const dropdownMenuRef = useRef(null);

  useEffect(() => {
    loadOrders();
  }, [currentPage, statusFilter]);

  useEffect(() => {
    setPageHeadingNode(document.querySelector('.page-heading'));
  }, []);

  const loadOrders = async (optionalKeyword) => {
    const kw = typeof optionalKeyword === 'string' ? optionalKeyword : searchKeyword;
    setIsLoading(true);
    setSelectedIds([]);
    try {
      const data = await apiClient.get(`/admin/billing-orders?page=${currentPage}&pageSize=${effectivePageSize}&status=${statusFilter}&q=${encodeURIComponent(kw)}`);
      setOrders(data.orders || []);
      setTotalItems(data.pagination?.total || 0);
      if (data.stats) setStats(data.stats);
    } catch (err) {
      console.error('Failed to load billing orders:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (optionalKeyword) => {
    if (currentPage === 1) {
      loadOrders(optionalKeyword);
    } else {
      setCurrentPage(1);
    }
  };

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.dropdown-container') && !e.target.closest('.dropdown-menu-portal')) {
        setOpenDropdownId(null);
      }
    };
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!openDropdownId || !dropdownAnchorRef.current) return;
    const updatePosition = () => {
      const rect = dropdownAnchorRef.current.getBoundingClientRect();
      const menuWidth = 140;
      const viewportPadding = 12;
      let left = rect.right - menuWidth;
      if (left < viewportPadding) left = viewportPadding;

      let top = rect.bottom + 4;
      const menuElement = dropdownMenuRef.current;
      const menuHeight = menuElement ? menuElement.offsetHeight : 140;
      if (top + menuHeight > window.innerHeight - viewportPadding) {
        top = rect.top - 4 - menuHeight;
      }

      setDropdownPosition({ top, left });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [openDropdownId]);

  const getReviewStatus = (orderStatus) => {
    if (orderStatus === 'review_approved') return { label: '通過', className: 'status-active' };
    if (orderStatus === 'review_rejected') return { label: '未通過', className: 'status-inactive' };
    if (orderStatus === 'pending_review') return { label: '待審核', className: 'status-pending' };
    return { label: '-', className: 'status-inactive' };
  };

  const getBusinessOrderStatus = (orderStatus) => {
    if (orderStatus === 'review_approved') return { label: '已生效', className: 'status-active' };
    if (orderStatus === 'review_rejected') return { label: '未生效', className: 'status-inactive' };
    if (orderStatus === 'pending_review' || orderStatus === 'payment_submitted') return { label: '已提交', className: 'status-pending' };
    return { label: '未提交', className: 'status-pending' };
  };

  const getStatusBadge = (statusInfo) => {
    return <span className={`status-badge ${statusInfo.className}`} style={{ fontSize: '11px', padding: '2px 8px', lineHeight: 1.4 }}>{statusInfo.label}</span>;
  };

  const getSipStatusBadge = (status) => {
    const statusMap = {
      active: { label: '启用中', className: 'status-active' },
      disabled: { label: '已停用', className: 'status-inactive' },
      inactive: { label: '已停用', className: 'status-inactive' },
      pending: { label: '待審核', className: 'status-pending' },
    };
    const statusInfo = statusMap[status] || { label: status || '未知', className: '' };
    return <span className={`status-badge ${statusInfo.className}`}>{statusInfo.label}</span>;
  };

  const paymentMethodLabel = (order) => {
    if (order.payment_method === 'offline') return '线下支付';
    if (order.payment_method === 'online') return order.payment_channel ? `线上支付 / ${order.payment_channel}` : '线上支付';
    return '-';
  };

  const termLabel = (months) => {
    return months ? `${months}` : '-';
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    if (typeof dateString === 'string' && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) return dateString;
    return new Date(dateString).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  };

  const getAccountEffectiveRange = (order) => {
    const existingStart = order?.effective_at || order?.effectiveAt;
    const existingEnd = order?.expires_at || order?.expiresAt;
    if (existingStart && existingEnd) return `${formatDate(existingStart)} - ${formatDate(existingEnd)}`;

    const months = Math.max(1, Number(order?.months || 1));
    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);
    end.setDate(end.getDate() - 1);
    return `${formatDate(start)} - ${formatDate(end)}`;
  };

  const getReviewSipPreviewAccounts = () => {
    const requiredCount = Number(reviewOrder?.account_quantity || reviewOrder?.accountQuantity || 0);
    if (isRenewalOrder(reviewOrder)) {
      const retainedAccounts = Array.isArray(reviewOrder?.retainedAccounts) ? reviewOrder.retainedAccounts : [];
      const retained = retainedAccounts.map((account) => ({
        id: `retained-${account.sipUserId}`,
        sipUserId: account.sipUserId,
        username: account.username || '',
        domain: account.sipDomain || '',
        displayName: account.displayName || account.username || '',
        kind: '保留',
        reuseWeb: Boolean(account.webAccountId || account.hasWebAccount || account.webAccountUsername)
      }));
      const replacementCount = Math.max(0, requiredCount - retained.length);
      const replacements = Array.from({ length: replacementCount }, (_, index) => ({
        id: `replacement-${index + 1}`,
        username: `系统随机补分配 ${index + 1}`,
        domain: '',
        displayName: '待补分配 SIP',
        kind: '补充',
        reuseWeb: false
      }));
      return [...retained, ...replacements];
    }
    const accountById = new Map(unassignedSipAccounts.map((account) => [Number(account.id), account]));
    return selectedSipAccountIds.map((id) => {
      const account = accountById.get(Number(id));
      return {
        id: account?.id || id,
        sipUserId: account?.id || id,
        username: account?.username || '',
        domain: account?.domain || '',
        displayName: account?.displayName || account?.username || '',
        kind: '新分配',
        reuseWeb: false
      };
    });
  };

  const getRequiredNewWebAccountCount = () => {
    return getReviewSipPreviewAccounts().filter((account) => !account.reuseWeb).length;
  };

  const cellText = (value) => {
    const text = value == null || value === '' ? '-' : String(value);
    return { text, title: text === '-' ? undefined : text };
  };

  const totalPages = Math.max(1, Math.ceil(totalItems / effectivePageSize));
  const requiresWebAccountReview = reviewData.status === 'review_approved' && orderRequiresWebAccounts(reviewOrder);
  const reviewSteps = [
    '確認訂單詳情',
    '審核意見',
    '分配SIP帳號',
    ...(requiresWebAccountReview ? ['分配Web帳號'] : [])
  ];

  return (
    <>
      <style>{`
        .dropdown-menu-portal {
          position: fixed;
          background-color: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          z-index: 2147483647;
          min-width: 120px;
          display: flex;
          flex-direction: column;
          padding: 4px 0;
        }
        .dropdown-menu-portal .dropdown-item {
          padding: 8px 16px;
          font-size: 13px;
          color: #334155;
          background: transparent;
          border: none;
          text-align: left;
          width: 100%;
          cursor: pointer;
          font-weight: 400;
        }
        .dropdown-menu-portal .dropdown-item:hover:not(:disabled) {
          background-color: #f1f5f9;
        }
        .dropdown-menu-portal .dropdown-item:disabled {
          color: #94a3b8;
          cursor: not-allowed;
        }
        .plan-management-heading-stats {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          flex: 0 0 auto;
          flex-wrap: nowrap;
          white-space: nowrap;
          min-width: max-content;
        }
        .plan-management-stat-pill {
          height: 30px;
          border: 1px solid #e2e8f0;
          border-radius: 999px;
          background: #f8fafc;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 0 8px;
          color: #475569;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          flex: 0 0 auto;
        }
        .plan-management-stat-pill strong {
          color: #0f172a;
          font-size: 12px;
          font-weight: 700;
        }
        .plan-management-stat-pill:not(.selected) {
          opacity: 0.86;
        }
        .plan-management-stat-pill.selected {
          border-color: #bfdbfe;
          background: #eff6ff;
        }
        .plan-management-stat-pill .is-success { color: #16a34a; }
        .plan-management-stat-pill .is-danger { color: #ef4444; }
        .plan-management-stat-pill .is-warning { color: #f59e0b; }
        .plan-management-stat-pill .is-primary { color: #3b82f6; }
        .plan-management-stat-pill .is-muted { color: #64748b; }
        #plan-management .plan-management-content {
          padding-top: 0 !important;
          padding-bottom: 0 !important;
        }
        #plan-management .plan-toolbar {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          flex-wrap: nowrap !important;
          gap: 10px !important;
          padding: 18px 20px !important;
          margin-bottom: 24px !important;
          background: rgba(255, 255, 255, 0.96) !important;
          border: 1px solid #e6eef8 !important;
          border-radius: 14px !important;
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08) !important;
          overflow-x: auto !important;
          scrollbar-width: none;
        }
        #plan-management .plan-toolbar::-webkit-scrollbar { height: 0; }
        #plan-management .plan-filter-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 0 0 auto;
          min-width: 0;
          white-space: nowrap;
        }
        #plan-management .plan-search {
          position: relative;
          width: 240px !important;
          flex: 0 0 240px !important;
          max-width: 240px !important;
        }
        #plan-management .plan-search svg {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
          pointer-events: none;
        }
        #plan-management .plan-search input {
          width: 100% !important;
          height: 46px !important;
          padding: 0 16px 0 44px !important;
          border-radius: 9px !important;
          border: 1px solid #d8e2ef !important;
          background: #fff !important;
          color: #334155 !important;
          font-size: 12px !important;
          outline: none !important;
          box-sizing: border-box !important;
        }
        #plan-management .plan-search input::placeholder { color: #94a3b8; }
        #plan-management .plan-search input:focus {
          border-color: #2563eb !important;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12) !important;
        }
        #plan-management .plan-status-select {
          height: 46px !important;
          min-width: 100px !important;
          width: 104px !important;
          flex: 0 0 104px !important;
          padding: 0 12px !important;
          border-radius: 9px !important;
          border: 1px solid #d8e2ef !important;
          background: #fff !important;
          color: #334155 !important;
          font-size: 12px !important;
          outline: none !important;
          cursor: pointer;
        }
        #plan-management .plan-table-card {
          display: flex !important;
          flex-direction: column !important;
          flex: 1 !important;
          min-height: 0 !important;
          background: rgba(255, 255, 255, 0.96) !important;
          border: 1px solid #e6eef8 !important;
          border-radius: 14px !important;
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08) !important;
          overflow: hidden !important;
        }
        #plan-management .plan-table-wrapper {
          width: 100%;
          flex: 1;
          min-height: 0;
          overflow-x: auto;
          overflow-y: auto;
        }
        #plan-management .plan-table {
          width: 100% !important;
          min-width: 1880px;
          border-collapse: collapse !important;
          table-layout: fixed;
          font-size: 12px;
        }
        #plan-management .plan-table thead {
          background: #f8fafc !important;
        }
        #plan-management .plan-table th {
          height: 56px !important;
          padding: 0 22px !important;
          color: #475569 !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          border-bottom: 1px solid #e2e8f0 !important;
          white-space: nowrap !important;
        }
        #plan-management .plan-table td {
          height: 64px !important;
          padding: 0 22px !important;
          color: #334155 !important;
          font-size: 12px !important;
          border-bottom: 1px solid #e2e8f0 !important;
          white-space: nowrap !important;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #plan-management .plan-table th:nth-child(2),
        #plan-management .plan-table td:nth-child(2) {
          width: 170px;
        }
        #plan-management .plan-table th:nth-child(3),
        #plan-management .plan-table td:nth-child(3) {
          width: 220px;
        }
        #plan-management .plan-table th:nth-child(4),
        #plan-management .plan-table td:nth-child(4) {
          width: 180px;
        }
        #plan-management .plan-table th:nth-child(5),
        #plan-management .plan-table td:nth-child(5),
        #plan-management .plan-table th:nth-child(6),
        #plan-management .plan-table td:nth-child(6) {
          width: 140px;
        }
        #plan-management .plan-table th:nth-child(7),
        #plan-management .plan-table td:nth-child(7),
        #plan-management .plan-table th:nth-child(8),
        #plan-management .plan-table td:nth-child(8),
        #plan-management .plan-table th:nth-child(9),
        #plan-management .plan-table td:nth-child(9) {
          width: 120px;
        }
        #plan-management .plan-table th:nth-child(10),
        #plan-management .plan-table td:nth-child(10),
        #plan-management .plan-table th:nth-child(11),
        #plan-management .plan-table td:nth-child(11),
        #plan-management .plan-table th:nth-child(12),
        #plan-management .plan-table td:nth-child(12) {
          width: 140px;
        }
        #plan-management .plan-table td span {
          display: inline-block;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          vertical-align: middle;
        }
        #plan-management .plan-table .plan-select-cell {
          width: 50px !important;
          padding: 0 !important;
          text-align: center !important;
        }
        #plan-management .plan-table .plan-action-head,
        #plan-management .plan-table .plan-action-cell {
          width: 140px !important;
          min-width: 140px !important;
          text-align: center !important;
          padding: 0 12px !important;
          position: sticky !important;
          right: 0 !important;
          box-shadow: -1px 0 0 #e2e8f0 !important;
        }
        #plan-management .plan-table .plan-action-head {
          background: #f8fafc !important;
          z-index: 3 !important;
        }
        #plan-management .plan-table .plan-action-cell {
          background: #fff !important;
          z-index: 1 !important;
        }
        #plan-management .plan-empty {
          height: 380px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #64748b;
        }
        #plan-management .plan-empty-title {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: #1f2937;
        }
        #plan-management .plan-table-footer {
          min-height: 74px !important;
          padding: 0 30px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          background: #fff !important;
          margin-top: 0 !important;
        }
        #plan-management .plan-total {
          color: #64748b;
          font-size: 12px;
        }
        #plan-management .plan-pagination {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        #plan-management .plan-page-size,
        #plan-management .plan-page-current {
          height: 38px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid #d8e2ef;
          background: #fff;
          color: #475569;
          font-size: 11px;
          display: inline-flex;
          align-items: center;
        }
        #plan-management .plan-page-btn {
          width: 38px;
          height: 38px;
          border-radius: 8px;
          border: 1px solid #d8e2ef;
          background: #fff;
          color: #475569;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
        }
        #plan-management .plan-page-current {
          border-color: #2563eb;
          color: #2563eb;
          background: #eff6ff;
          font-weight: 600;
        }
        #plan-management .plan-page-btn:disabled {
          color: #cbd5e1;
          cursor: not-allowed;
          background: #f8fafc;
        }
        @media (max-width: 1100px) {
          #plan-management .plan-toolbar {
            overflow-x: auto;
            scrollbar-width: none;
          }
          #plan-management .plan-toolbar::-webkit-scrollbar { height: 0; }
          #plan-management .plan-filter-left { flex-wrap: nowrap; }
          #plan-management .plan-management-heading-stats { justify-content: flex-end; }
        }
        @media (max-width: 720px) {
          #plan-management .plan-toolbar { padding: 18px !important; }
          #plan-management .plan-table-footer { padding: 14px 20px !important; flex-wrap: wrap; }
          #plan-management .plan-pagination { flex-wrap: wrap; }
          #plan-management .plan-management-heading-stats { justify-content: flex-start; }
        }

        /* === Dark theme overrides === */
        #plan-management .plan-toolbar { background: #111827 !important; border: 1px solid #1f2937 !important; box-shadow: none !important; }
        #plan-management .plan-search input { background: #1a2332 !important; border: 1px solid #374151 !important; color: #e5e7eb !important; }
        #plan-management .plan-search input::placeholder { color: #6b7280; }
        #plan-management .plan-search input:focus { border-color: #3b82f6 !important; }
        #plan-management .plan-filter-right select { background: #1a2332 !important; border: 1px solid #374151 !important; color: #e5e7eb !important; }
        #plan-management .plan-status-select { background: #1a2332 !important; border: 1px solid #374151 !important; color: #e5e7eb !important; }
        #plan-management .plan-management-stat-pill { background: #1a2332 !important; border: 1px solid #374151 !important; color: #9ca3af !important; border-radius: 14px; }
        #plan-management .plan-management-stat-pill strong { color: #ffffff !important; }
        #plan-management .plan-management-stat-pill.selected { background: #1e3a5f !important; border-color: #3b82f6 !important; color: #93c5fd !important; }
        #plan-management .plan-table-card { background: #1a2332; border: 1px solid #1f2937; box-shadow: none; border-radius: 14px; overflow: hidden; }
        #plan-management .plan-table thead { background: #1a2332 !important; }
        #plan-management .plan-table th { color: #e5e7eb !important; border-bottom: 1px solid #1f2937 !important; background: #1a2332 !important; }
        #plan-management .plan-table td { color: #e5e7eb !important; border-bottom: 1px solid #1f2937 !important; }
        #plan-management .plan-table tbody tr { background: #111827 !important; }
        #plan-management .plan-table tbody tr:hover { background: #1e293b !important; }
        #plan-management .plan-table td:last-child { background: #111827 !important; }
        #plan-management .plan-table th:last-child { background: #1a2332 !important; box-shadow: -1px 0 0 #1f2937 !important; }
        #plan-management .plan-table-footer { background: #111827 !important; border-top: 1px solid #1f2937 !important; }
        #plan-management .plan-total { color: #9ca3af !important; }
        #plan-management .plan-page-size { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; cursor: pointer; }
        #plan-management .plan-page-btn { background: #1f2937; border: 1px solid #4b5563; color: #9ca3af; }
        #plan-management .plan-page-btn:hover:not(:disabled) { background: #374151; color: #f3f4f6; }
        #plan-management .plan-page-btn:disabled { opacity: 0.5; background: #1a2332 !important; color: #4b5563 !important; }
        #plan-management .plan-page-current { background: #1e3a5f; border: 1px solid #3b82f6; color: #60a5fa; }
        #plan-management .plan-page-input { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; }
        #plan-management .plan-page-jump { color: #9ca3af; }
        #plan-management .plan-table { min-width: 0 !important; }
        #plan-management .plan-table-wrapper { scrollbar-width: none; }
        #plan-management .plan-table-wrapper::-webkit-scrollbar { display: none; }
        #plan-management .ghost-btn { background: #374151; color: #d1d5db; border: 1px solid #4b5563; border-radius: 8px; }
        #plan-management .ghost-btn:hover { background: #4b5563; color: #f3f4f6; }
        #plan-management .form-message { color: #d1d5db; }
        #plan-management .form-message.error { background: #3b1111; color: #ef4444; }
        #plan-management .form-message.success { background: #0d2818; color: #22c55e; }
        #plan-management .empty-state { background: #111827; color: #9ca3af; }
        #plan-management .empty-state-title { color: #9ca3af; }
        .plan-dropdown-menu { background: #1e293b; border-color: #374151; }
        .plan-dropdown-menu .dropdown-item { color: #d1d5db; }
        .plan-dropdown-menu .dropdown-item:hover { background: #374151; color: #f3f4f6; }
        .plan-dropdown-menu .dropdown-item.dropdown-item-danger:hover { background: #3b1111; }
      `}</style>
      {!reviewOrder ? (
      <section className="view active" id="plan-management" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#111827' }}>
      <div className="tenant-content plan-management-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px', background: '#111827' }}>
        
        <div className="toolbar plan-toolbar" style={{ flexShrink: 0, display: 'flex', gap: '12px', flexWrap: 'nowrap', alignItems: 'center', marginBottom: '12px', width: '100%', boxSizing: 'border-box' }}>
          <div className="plan-filter-left">
            <label className="plan-search">
              <Search size={18} />
              <input
                type="search"
                placeholder="搜尋訂單編號、租戶名稱"
                value={searchKeyword}
                onChange={(e) => {
                  const val = e.target.value;
                  setSearchKeyword(val);
                  if (val === '') {
                    handleSearch('');
                  }
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #374151', borderRadius: '6px', fontSize: '14px', backgroundColor: '#1a2332', color: '#e5e7eb' }}
              />
            </label>
            <select
              className="plan-status-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              style={{ padding: '8px 12px', border: '1px solid #374151', borderRadius: '6px', fontSize: '14px', backgroundColor: '#1a2332', color: '#e5e7eb' }}
            >
              <option value="all">全部訂單</option>
              <option value="paid">已支付</option>
              <option value="unpaid">未支付</option>
              <option value="reviewed">已審核</option>
              <option value="pending_review">待審核</option>
              <option value="active_effective">已生效</option>
              <option value="expiring_soon">即將過期</option>
              <option value="inactive_expired">已過期</option>
            </select>
          </div>
          <div className="plan-management-heading-stats">
            {[
              ['all', '全部', stats.total, ''],
              ['paid', '已支付', stats.paid, 'is-success'],
              ['unpaid', '未支付', stats.unpaid, 'is-danger'],
              ['reviewed', '已審核', stats.reviewed, 'is-success'],
              ['pending_review', '待審核', stats.pendingReview, 'is-warning'],
              ['active_effective', '已生效', stats.active, 'is-primary'],
              ['expiring_soon', '即將過期', stats.expiringSoon || 0, 'is-warning'],
              ['inactive_expired', '已過期', stats.expired || 0, 'is-muted'],
            ].map(([key, label, value, valueClass]) => (
              <button
                key={key}
                type="button"
                className={`plan-management-stat-pill ${statusFilter === key ? 'selected' : ''}`}
                onClick={() => { setStatusFilter(key); setCurrentPage(1); }}
              >
                <span>{label}</span>
                <strong className={valueClass}>{value}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="table-wrap plan-table-card" style={{ flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', margin: 0, overflowY: 'auto', overflowX: 'auto', backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #1f2937' }}>
          <div className="plan-table-wrapper">
          <table className="plan-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#1a2332' }}>
              <tr>
                <th className="plan-select-cell" style={{ width: '40px', padding: '12px 16px', borderBottom: '1px solid #1f2937', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={orders.length > 0 && orders.every(order => selectedIds.includes(order.id))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        const newIds = new Set(selectedIds);
                        orders.forEach(order => newIds.add(order.id));
                        setSelectedIds(Array.from(newIds));
                      } else {
                        const newIds = new Set(selectedIds);
                        orders.forEach(order => newIds.delete(order.id));
                        setSelectedIds(Array.from(newIds));
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
	                <th style={{ whiteSpace: 'nowrap', minWidth: '180px', fontSize: '14px', fontWeight: 500, color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>租戶名稱</th>
	                <th style={{ whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 500, color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>訂單編號</th>
	                <th style={{ whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 500, color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>套餐名稱</th>
	                <th style={{ whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 500, color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>訂單狀態</th>
	                <th style={{ whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 500, color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>審核狀態</th>
	                <th style={{ whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 500, color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>帳號數量</th>
	                <th style={{ whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 500, color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>租期（月）</th>
	                <th style={{ whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 500, color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>金額</th>
	                <th style={{ whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 500, color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>支付方式</th>
	                <th style={{ whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 500, color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>生效日期</th>
	                <th style={{ whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 500, color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>結束日期</th>
	                <th className="plan-action-head" style={{ whiteSpace: 'nowrap', position: 'sticky', right: 0, backgroundColor: '#1a2332', zIndex: 3, boxShadow: '-1px 0 0 #1f2937', fontSize: '14px', fontWeight: 500, color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937', width: '120px', minWidth: '120px', textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan="13" style={{ padding: 0, textAlign: 'center' }}><div className="plan-empty"><p className="plan-empty-title">載入中...</p></div></td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan="13" style={{ padding: 0, textAlign: 'center' }}><div className="plan-empty"><p className="plan-empty-title">暫無套餐訂單資料</p></div></td></tr>
              ) : (
                orders.map((order) => {
                  const tenantName = cellText(order.tenant_name);
                  const orderNo = cellText(order.order_no);
                  const planName = cellText(order.plan_name);
                  const paymentLabel = cellText(paymentMethodLabel(order));
                  return (
                  <tr key={order.id}>
                    <td className="plan-select-cell" style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(order.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIds(prev => [...prev, order.id]);
                          } else {
                            setSelectedIds(prev => prev.filter(id => id !== order.id));
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td title={tenantName.title} style={{ fontSize: '14px', color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937' }}><span style={{ fontWeight: 500, color: '#e5e7eb' }}>{tenantName.text}</span></td>
                    <td title={orderNo.title} style={{ fontSize: '14px', color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937' }}><span style={{ color: '#e5e7eb' }}>{orderNo.text}</span></td>
                    <td title={planName.title} style={{ fontSize: '14px', color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937' }}><span style={{ fontWeight: 500, color: '#e5e7eb' }}>{planName.text}</span></td>
                    <td style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937' }}>{getStatusBadge(getBusinessOrderStatus(order.order_status || order.orderStatus))}</td>
                    <td style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937' }}>{getStatusBadge(getReviewStatus(order.order_status || order.orderStatus))}</td>
                    <td style={{ fontSize: '14px', color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937' }}>{order.accountQuantity || order.account_quantity || '-'}</td>
                    <td style={{ fontSize: '14px', color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937' }}>{termLabel(order.months)}</td>
                    <td style={{ fontSize: '14px', color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937' }}>{Number(order.payable_amount || 0).toFixed(2)}</td>
                    <td title={paymentLabel.title} style={{ fontSize: '14px', color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937' }}>{paymentLabel.text}</td>
                    <td style={{ fontSize: '14px', color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937' }}>{formatDate(order.effective_at || order.effectiveAt)}</td>
                    <td style={{ fontSize: '14px', color: '#e5e7eb', padding: '12px 16px', borderBottom: '1px solid #1f2937' }}>{formatDate(order.expires_at || order.expiresAt)}</td>
                    <td className="plan-action-cell" style={{ position: 'sticky', right: 0, backgroundColor: '#111827', zIndex: 1, boxShadow: '-1px 0 0 #e2e8f0', width: '120px', minWidth: '120px', padding: '12px 16px', borderBottom: '1px solid #1f2937' }}>
                      <div className="row-actions dropdown-container" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button className="ghost-btn" type="button" style={{ fontSize: '13px', padding: '4px 8px' }} onClick={() => openDetailModal(order)}>詳情</button>
                        <button className="ghost-btn" type="button" style={{ fontSize: '13px', padding: '4px 8px' }} onClick={(e) => {
                          e.stopPropagation();
                          const button = e.currentTarget;
                          dropdownAnchorRef.current = button;
                          const rect = button.getBoundingClientRect();
                          setDropdownPosition({
                            top: rect.bottom + 4,
                            left: Math.max(12, rect.right - 120),
                          });
                          setOpenDropdownId(current => current === order.id ? null : order.id);
                        }}>更多</button>
                        {openDropdownId === order.id && createPortal(
                          <div ref={dropdownMenuRef} className="dropdown-menu-portal" style={{ top: dropdownPosition.top, left: dropdownPosition.left, zIndex: 2147483647 }}>
                            <button type="button" className="dropdown-item" onClick={() => { openDetailModal(order); setOpenDropdownId(null); }}>詳情</button>
                            <button type="button" className="dropdown-item" disabled={(order.order_status || order.orderStatus) === 'review_approved' || getBusinessOrderStatus(order.order_status || order.orderStatus).label === '未提交'} onClick={() => { openReviewModal(order); setOpenDropdownId(null); }}>審核</button>
                          </div>, document.body
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
          <div className="billing-pagination plan-table-footer" style={{ flexShrink: 0, width: '100%', boxSizing: 'border-box', marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="plan-total">共 {totalItems} 笔記錄</span>
            <div className="plan-pagination">
              <select className="plan-page-size" value={pageSize} onChange={(e) => { const v = e.target.value; setPageSize(v === "全部" ? "全部" : Number(v)); setCurrentPage(1); }} style={{ height: "38px", padding: "0 14px", borderRadius: "8px", border: "1px solid #4b5563", backgroundColor: "#1a2332", color: "#9ca3af", fontSize: "11px", cursor: "pointer" }}>{pageSizeOptions.map(opt => <option key={opt} value={opt}>{opt === "全部" ? "全部" : opt + " 條/頁"}</option>)}</select>
              <button className="plan-page-btn" type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>‹</button>
              <span className="plan-page-current">{currentPage}</span>
              <button className="plan-page-btn" type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>›</button>
            </div>
          </div>
        </div>
        
      </div>
      </section>
      ) : (
        <section className="view active settings-form-page" id="plan-management-review" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
            <div className="panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #1f2937', overflow: 'hidden', margin: 0 }}>
              <div style={{ flexShrink: 0, padding: reviewStep >= 3 ? '12px 24px' : '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: reviewStep >= 3 ? '17px' : '18px', color: '#e5e7eb', fontWeight: '600' }}>訂單審核</h3>
                <button className="ghost-btn" type="button" onClick={() => setReviewOrder(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: reviewStep >= 3 ? '5px 10px' : '6px 12px' }}>返回列表</button>
              </div>

              <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}>
                {reviewSteps.map((stepName, index) => {
                  const stepIndex = index + 1;
                  const isActive = reviewStep === stepIndex;
                  return (
                    <div key={stepName} style={{ flex: 1, padding: reviewStep >= 3 ? '10px 16px' : '16px', textAlign: 'center', fontSize: reviewStep >= 3 ? '14px' : '15px', fontWeight: isActive ? '600' : '400', color: isActive ? '#3b82f6' : '#64748b', borderBottom: isActive ? '2px solid #3b82f6' : 'none' }}>
                      {stepIndex}. {stepName}
                    </div>
                  );
                })}
              </div>

              <div style={{ flex: 1, overflowY: reviewStep >= 3 ? 'hidden' : 'auto', padding: reviewStep >= 3 ? '16px 24px' : '32px', display: 'flex', flexDirection: 'column', gap: reviewStep >= 3 ? '12px' : '24px', minHeight: 0 }}>
                {isLoadingReview && reviewStep === 1 ? (
                  <p style={{ color: '#64748b', fontSize: '14px', textAlign: 'center' }}>載入訂單詳情中...</p>
                ) : (
                  <>
                    {reviewStep === 1 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div className="detail-section">
                          <h4 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: '600', color: '#e5e7eb', borderLeft: '3px solid #3b82f6', paddingLeft: '8px' }}>基本信息</h4>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
	                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>訂單編號</span><span style={{ fontSize: '15px', color: '#e5e7eb' }}>{reviewOrder.order_no || reviewOrder.orderNo}</span></div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>创建时间</span><span style={{ fontSize: '15px', color: '#e5e7eb' }}>{formatDate(reviewOrder.created_at)}</span></div>
	                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>租戶名稱</span><span style={{ fontSize: '15px', color: '#e5e7eb' }}>{reviewOrder.tenant_name}</span></div>
	                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>套餐名稱</span><span style={{ fontSize: '15px', color: '#e5e7eb', fontWeight: '500' }}>{reviewOrder.plan_name || reviewOrder.planName}</span></div>
	                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>帳號數量</span><span style={{ fontSize: '15px', color: '#e5e7eb' }}>{reviewOrder.account_quantity || reviewOrder.accountQuantity || '-'}</span></div>
	                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>租期（月）</span><span style={{ fontSize: '15px', color: '#e5e7eb' }}>{termLabel(reviewOrder.months)}</span></div>
                          </div>
                        </div>

                        {isRenewalOrder(reviewOrder) && (
                          <div className="detail-section">
                            <h4 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: '600', color: '#e5e7eb', borderLeft: '3px solid #3b82f6', paddingLeft: '8px' }}>续订保留帳號</h4>
                            {(() => {
                              const retainedAccounts = Array.isArray(reviewOrder.retainedAccounts) ? reviewOrder.retainedAccounts : [];
                              const requiredCount = Number(reviewOrder.account_quantity || reviewOrder.accountQuantity || 0);
                              const replacementCount = Math.max(0, requiredCount - retainedAccounts.length);
                              return (
                                <>
                                  <div style={{ marginBottom: '10px', padding: '10px 12px', borderRadius: '8px', backgroundColor: '#1a2332', color: '#9ca3af', fontSize: '13px' }}>
                                    已保留 {retainedAccounts.length} 個帳號，審核通過时将自动随机补分配 {replacementCount} 個帳號。
                                  </div>
                                  {retainedAccounts.length > 0 && (
                                    <div style={{ maxHeight: '180px', overflow: 'auto', border: '1px solid #1f2937', borderRadius: '8px' }}>
                                      {retainedAccounts.map((account) => (
                                        <div key={account.sipUserId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) 110px', gap: '12px', padding: '10px 12px', borderBottom: '1px solid #1f2937', fontSize: '13px', color: '#e5e7eb' }}>
                                          <strong style={{ color: '#e5e7eb' }}>{account.displayName || account.username}</strong>
                                          <span>{account.username}{account.sipDomain ? ` | ${account.sipDomain}` : ''}</span>
                                          <span>{account.sourceServiceExpiresAt || '-'}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}

                        <div style={{ borderTop: '1px solid #1f2937', margin: '8px 0' }}></div>


                        <div className="detail-section">
                          <h4 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: '600', color: '#e5e7eb', borderLeft: '3px solid #3b82f6', paddingLeft: '8px' }}>狀態与金額</h4>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
	                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>支付方式</span><span style={{ fontSize: '15px', color: '#e5e7eb' }}>{paymentMethodLabel(reviewOrder)}</span></div>
	                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>支付日期</span><span style={{ fontSize: '15px', color: '#e5e7eb' }}>{formatDate(reviewOrder.paymentDate || reviewOrder.payment_proof_uploaded_at || reviewOrder.paid_at)}</span></div>
	                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>訂單金額</span><span style={{ fontSize: '18px', color: '#ef4444', fontWeight: '600' }}>{Number(reviewOrder.payable_amount || reviewOrder.payableAmount || 0).toFixed(2)} {reviewOrder.currency}</span></div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
	                              <span style={{ fontSize: '13px', color: '#64748b' }}>支付金額 / 凭证</span>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                <span style={{ fontSize: '18px', color: '#10b981', fontWeight: '600' }}>{Number(reviewOrder.paid_amount || reviewOrder.paidAmount || (reviewOrder.payment_status === 'paid' ? reviewOrder.payable_amount : 0)).toFixed(2)} {reviewOrder.currency}</span>
                                {reviewOrder.payment_proof_file_url && (
	                                  <a href={getFullImageUrl(reviewOrder.payment_proof_file_url)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '14px', color: '#3b82f6', textDecoration: 'none' }}>查看凭证</a>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {reviewStep === 2 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <span style={{ fontSize: '15px', fontWeight: 500, color: '#9ca3af' }}>審核結果</span>
                          <select 
                            value={reviewData.status} 
                            onChange={(e) => {
                              const nextStatus = e.target.value;
                              setReviewData(prev => ({
                                status: nextStatus,
                                comments: prev.status === nextStatus ? prev.comments : ''
                              }));
                            }}
                            style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none' }}
                          >
                            <option value="review_approved">審核通過</option>
                            <option value="review_rejected">審核不通過</option>
                          </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <span style={{ fontSize: '15px', fontWeight: 500, color: '#9ca3af' }}>審核意見</span>
                          <textarea 
                            rows="6"
                            value={reviewData.comments}
                            onChange={(e) => setReviewData(prev => ({ ...prev, comments: e.target.value }))}
                            placeholder={reviewData.status === 'review_rejected' ? "請輸入審核不通過的意見原因（必填）..." : "請輸入審核意見..."}
                            style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', resize: 'vertical', outline: 'none' }}
                          />
                        </label>
                      </div>
                    )}

                    {reviewStep === 3 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0, flex: 1 }}>
                        {(() => {
                          const requiredCount = Number(reviewOrder.account_quantity || reviewOrder.accountQuantity || 0);
                          if (isRenewalOrder(reviewOrder)) {
                            const retainedAccounts = Array.isArray(reviewOrder.retainedAccounts) ? reviewOrder.retainedAccounts : [];
                            const replacementCount = Math.max(0, requiredCount - retainedAccounts.length);
                            return (
                              <div style={{ display: 'grid', gap: '14px' }}>
                                <div style={{ padding: '14px 16px', borderRadius: '8px', border: '1px solid #dbeafe', backgroundColor: '#eff6ff', color: '#1e3a8a', fontSize: '14px', lineHeight: 1.6 }}>
                                  本次续订需要帳號 <strong>{requiredCount}</strong> 個，已保留原帳號 <strong>{retainedAccounts.length}</strong> 個，審核通過后系统将自动随机补分配 <strong>{replacementCount}</strong> 個未分配帳號。
                                </div>
                                {retainedAccounts.length > 0 && (
                                  <div style={{ maxHeight: '320px', overflow: 'auto', border: '1px solid #1f2937', borderRadius: '8px', backgroundColor: '#111827' }}>
                                    {retainedAccounts.map((account) => (
                                      <div key={account.sipUserId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) 120px', gap: '12px', padding: '12px 14px', borderBottom: '1px solid #1f2937', fontSize: '13px', color: '#e5e7eb' }}>
                                        <strong style={{ color: '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.displayName || account.username}</strong>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.username}{account.sipDomain ? ` | ${account.sipDomain}` : ''}</span>
                                        <span>{account.sourceServiceExpiresAt || '-'}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          }
                          const selectedCount = selectedSipAccountIds.length;
                          const isSelectionFull = selectedCount >= requiredCount;
                          const isSelectionComplete = selectedCount === requiredCount;
                          return (
                            <>
                        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '6px 10px', borderRadius: '6px', border: `1px solid ${isSelectionComplete ? '#bbf7d0' : '#fed7aa'}`, backgroundColor: isSelectionComplete ? '#f0fdf4' : '#fff7ed', color: isSelectionComplete ? '#166534' : '#9a3412', fontSize: '13px' }}>
                            <span>已選擇 <strong>{selectedCount}</strong> / 需分配 <strong>{requiredCount}</strong> 個帳號</span>
                            {!isSelectionComplete && <span>{selectedCount < requiredCount ? `还需選擇 ${requiredCount - selectedCount} 個` : `已超出 ${selectedCount - requiredCount} 個`}</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', color: '#9ca3af', fontSize: '13px' }}>
	                            <span>帳號有效期</span>
                            <strong style={{ color: '#e5e7eb', fontSize: '14px', fontWeight: 600 }}>{getAccountEffectiveRange(reviewOrder)}</strong>
                          </div>
                        </div>
                        <div className="table-wrap" style={{ flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', margin: 0, overflowY: 'auto', overflowX: 'auto', backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #1f2937' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ position: 'sticky', top: 0, zIndex: 2, backgroundColor: '#1a2332' }}>
                              <tr>
                                <th style={{ width: '36px', padding: '7px 10px', borderBottom: '1px solid #1f2937', textAlign: 'center' }}>
                                  <input
                                    type="checkbox"
                                    checked={requiredCount > 0 && selectedCount === requiredCount}
                                    onChange={(e) => {
                                      setSelectedSipAccountIds(e.target.checked ? unassignedSipAccounts.slice(0, requiredCount).map(account => account.id) : []);
                                    }}
                                    disabled={requiredCount <= 0 || unassignedSipAccounts.length === 0}
                                    style={{ cursor: 'pointer' }}
                                  />
                                </th>
	                                <th style={{ fontSize: '12px', fontWeight: 500, color: '#e5e7eb', padding: '7px 10px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>帳號</th>
	                                <th style={{ fontSize: '12px', fontWeight: 500, color: '#e5e7eb', padding: '7px 10px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>狀態</th>
	                                <th style={{ fontSize: '12px', fontWeight: 500, color: '#e5e7eb', padding: '7px 10px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>添加人</th>
	                                <th style={{ fontSize: '12px', fontWeight: 500, color: '#e5e7eb', padding: '7px 10px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>添加时间</th>
	                                <th style={{ fontSize: '12px', fontWeight: 500, color: '#e5e7eb', padding: '7px 10px', borderBottom: '1px solid #1f2937', textAlign: 'left' }}>域名</th>
                              </tr>
                            </thead>
                            <tbody>
                              {unassignedSipAccounts.length === 0 ? (
                                <tr>
                                  <td colSpan="6" style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>
                                    {isLoadingSipAccounts ? '載入中...' : '暫無未分配SIP帳號'}
                                  </td>
                                </tr>
                              ) : (
                                unassignedSipAccounts.map((account) => (
                                  <tr key={account.id}>
                                    <td style={{ padding: '6px 10px', borderBottom: '1px solid #1f2937', textAlign: 'center' }}>
                                      <input
                                        type="checkbox"
                                        checked={selectedSipAccountIds.includes(account.id)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setSelectedSipAccountIds(prev => (
                                              prev.includes(account.id) || prev.length >= requiredCount ? prev : [...prev, account.id]
                                            ));
                                          } else {
                                            setSelectedSipAccountIds(prev => prev.filter(id => id !== account.id));
                                          }
                                        }}
                                        disabled={!selectedSipAccountIds.includes(account.id) && isSelectionFull}
                                        style={{ cursor: (!selectedSipAccountIds.includes(account.id) && isSelectionFull) ? 'not-allowed' : 'pointer' }}
                                      />
                                    </td>
                                    <td style={{ fontSize: '12px', color: '#e5e7eb', padding: '6px 10px', borderBottom: '1px solid #1f2937' }}>{account.username}</td>
                                    <td style={{ padding: '6px 10px', borderBottom: '1px solid #1f2937' }}>{getSipStatusBadge(account.status)}</td>
                                    <td style={{ fontSize: '12px', color: '#e5e7eb', padding: '6px 10px', borderBottom: '1px solid #1f2937' }}>{account.creatorName || '-'}</td>
                                    <td style={{ fontSize: '12px', color: '#e5e7eb', padding: '6px 10px', borderBottom: '1px solid #1f2937' }}>{account.createdAt || '-'}</td>
                                    <td style={{ fontSize: '12px', color: '#e5e7eb', padding: '6px 10px', borderBottom: '1px solid #1f2937' }}>{account.domain || '-'}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {reviewStep === 4 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0, flex: 1 }}>
                        {(() => {
                          const sipPreviewAccounts = getReviewSipPreviewAccounts();
                          const requiredCount = Number(reviewOrder.account_quantity || reviewOrder.accountQuantity || 0);
                          const requiredNewWebCount = sipPreviewAccounts.filter((account) => !account.reuseWeb).length;
                          const isWebReady = unassignedWebAccounts.length >= requiredNewWebCount;
                          return (
                            <>
                              <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                <div style={{ padding: '8px 12px', borderRadius: '6px', border: `1px solid ${isWebReady ? '#bbf7d0' : '#fecaca'}`, backgroundColor: isWebReady ? '#f0fdf4' : '#fef2f2', color: isWebReady ? '#166534' : '#991b1b', fontSize: '13px' }}>
                                  共需绑定 <strong>{requiredCount}</strong> 個 WebRTC 帳號，本次需新增 <strong>{requiredNewWebCount}</strong> 個，當前可用 <strong>{unassignedWebAccounts.length}</strong> 個。
                                </div>
                                <div style={{ color: '#9ca3af', fontSize: '13px' }}>
                                  帳號有效期 <strong style={{ color: '#e5e7eb' }}>{getAccountEffectiveRange(reviewOrder)}</strong>
                                </div>
                              </div>
                              <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', alignContent: 'start', gap: '12px', paddingRight: '4px' }}>
                                {sipPreviewAccounts.map((sipAccount, index) => {
                                  const webAccountIndex = sipPreviewAccounts.slice(0, index).filter((account) => !account.reuseWeb).length;
                                  const webAccount = sipAccount.reuseWeb ? null : unassignedWebAccounts[webAccountIndex];
                                  return (
                                    <div key={sipAccount.id} style={{ border: '1px solid #1f2937', borderRadius: '8px', backgroundColor: '#111827', padding: '12px', display: 'grid', gap: '10px', minWidth: 0 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                                        <span style={{ fontSize: '12px', color: '#64748b' }}>SIP帳號</span>
                                        <span style={{ fontSize: '12px', color: sipAccount.kind === '补充' ? '#f97316' : '#2563eb', backgroundColor: sipAccount.kind === '补充' ? '#fff7ed' : '#eff6ff', borderRadius: '999px', padding: '2px 8px' }}>{sipAccount.kind}</span>
                                      </div>
                                      <div title={`${sipAccount.username}${sipAccount.domain ? ` | ${sipAccount.domain}` : ''}`} style={{ minWidth: 0 }}>
                                        <div style={{ color: '#e5e7eb', fontSize: '14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sipAccount.displayName || sipAccount.username}</div>
                                        <div style={{ color: '#64748b', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sipAccount.username}{sipAccount.domain ? ` | ${sipAccount.domain}` : ''}</div>
                                      </div>
                                      <div style={{ height: '1px', backgroundColor: '#f1f5f9' }} />
                                      <div>
                                        <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>WebRTC帳號</div>
                                        {sipAccount.reuseWeb ? (
                                          <div style={{ color: '#166534', fontSize: '13px', lineHeight: 1.5 }}>沿用原 WebRTC 帳號，提交審核时同步更新有效期。</div>
                                        ) : webAccount ? (
                                          <div title={`${webAccount.username}${webAccount.domain ? ` | ${webAccount.domain}` : ''}`} style={{ minWidth: 0 }}>
                                            <div style={{ color: '#e5e7eb', fontSize: '14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{webAccount.displayName || webAccount.username}</div>
                                            <div style={{ color: '#64748b', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{webAccount.username}{webAccount.domain ? ` | ${webAccount.domain}` : ''}</div>
                                          </div>
                                        ) : (
                                          <div style={{ color: '#dc2626', fontSize: '13px' }}>可用 WebRTC 帳號不足</div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                                {isLoadingWebAccounts && (
                                  <div style={{ color: '#64748b', fontSize: '14px' }}>載入 WebRTC 帳號中...</div>
                                )}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
	                    </>
                )}
              </div>

              <div style={{ flexShrink: 0, padding: reviewStep >= 3 ? '10px 24px' : '16px 24px', borderTop: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
	                <button onClick={() => setReviewOrder(null)} disabled={isLoadingReview} style={{ padding: reviewStep >= 3 ? '7px 20px' : '10px 24px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#111827', color: '#9ca3af', cursor: 'pointer', fontSize: reviewStep >= 3 ? '13px' : '14px', fontWeight: '500' }}>取消</button>
                
                {reviewStep > 1 && (
	                  <button onClick={() => setReviewStep(p => p - 1)} disabled={isLoadingReview} style={{ padding: reviewStep >= 3 ? '7px 20px' : '10px 24px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#111827', color: '#9ca3af', cursor: 'pointer', fontSize: reviewStep >= 3 ? '13px' : '14px', fontWeight: '500' }}>上一步</button>
                )}
                
                {reviewStep === 1 && (
	                  <button onClick={() => setReviewStep(2)} disabled={isLoadingReview} style={{ padding: '10px 24px', borderRadius: '6px', border: 'none', backgroundColor: '#3b82f6', color: '#fff', cursor: isLoadingReview ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500', opacity: isLoadingReview ? 0.7 : 1 }}>下一步</button>
                )}
                
                {reviewStep === 2 && (
                  reviewData.status === 'review_approved' ? 
	                    <button onClick={goToAccountAssignmentStep} disabled={isLoadingReview || isLoadingSipAccounts} style={{ padding: '10px 24px', borderRadius: '6px', border: 'none', backgroundColor: '#3b82f6', color: '#fff', cursor: (isLoadingReview || isLoadingSipAccounts) ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500', opacity: (isLoadingReview || isLoadingSipAccounts) ? 0.7 : 1 }}>下一步</button> :
                    <button onClick={submitReview} disabled={isLoadingReview} style={{ padding: '10px 24px', borderRadius: '6px', border: 'none', backgroundColor: '#10b981', color: '#fff', cursor: isLoadingReview ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500' }}>{isLoadingReview ? '提交中...' : '提交審核'}</button>
                )}
                
                {reviewStep === 3 && (
                  requiresWebAccountReview ?
                    <button onClick={goToWebAccountAssignmentStep} disabled={isLoadingReview || isLoadingWebAccounts || (!isRenewalOrder(reviewOrder) && selectedSipAccountIds.length !== Number(reviewOrder?.account_quantity || reviewOrder?.accountQuantity || 0))} style={{ padding: '7px 20px', borderRadius: '6px', border: 'none', backgroundColor: '#3b82f6', color: '#fff', cursor: (isLoadingReview || isLoadingWebAccounts || (!isRenewalOrder(reviewOrder) && selectedSipAccountIds.length !== Number(reviewOrder?.account_quantity || reviewOrder?.accountQuantity || 0))) ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: '500', opacity: (isLoadingReview || isLoadingWebAccounts || (!isRenewalOrder(reviewOrder) && selectedSipAccountIds.length !== Number(reviewOrder?.account_quantity || reviewOrder?.accountQuantity || 0))) ? 0.7 : 1 }}>下一步</button> :
                    <button onClick={submitReview} disabled={isLoadingReview || (!isRenewalOrder(reviewOrder) && selectedSipAccountIds.length !== Number(reviewOrder?.account_quantity || reviewOrder?.accountQuantity || 0))} style={{ padding: '7px 20px', borderRadius: '6px', border: 'none', backgroundColor: '#10b981', color: '#fff', cursor: (isLoadingReview || (!isRenewalOrder(reviewOrder) && selectedSipAccountIds.length !== Number(reviewOrder?.account_quantity || reviewOrder?.accountQuantity || 0))) ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: '500', opacity: (isLoadingReview || (!isRenewalOrder(reviewOrder) && selectedSipAccountIds.length !== Number(reviewOrder?.account_quantity || reviewOrder?.accountQuantity || 0))) ? 0.7 : 1 }}>{isLoadingReview ? '提交中...' : '提交審核'}</button>
                )}

                {reviewStep === 4 && (
                  <button onClick={submitReview} disabled={isLoadingReview} style={{ padding: '7px 20px', borderRadius: '6px', border: 'none', backgroundColor: '#10b981', color: '#fff', cursor: isLoadingReview ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: '500', opacity: isLoadingReview ? 0.7 : 1 }}>{isLoadingReview ? '提交中...' : '提交審核'}</button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {detailOrder && createPortal(
        <div className="modal-overlay" onClick={() => { setDetailOrder(null); setShowCostDetails(false); }} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '640px', backgroundColor: '#111827', borderRadius: '12px', display: 'flex', flexDirection: 'column', maxHeight: '85vh', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #1f2937' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#e5e7eb' }}>訂單詳情</h3>
              <button onClick={() => { setDetailOrder(null); setShowCostDetails(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '20px' }}>&times;</button>
            </div>
            
            <div className="modal-body" style={{ position: 'relative', padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div className="detail-section">
                <h4 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: '600', color: '#e5e7eb', borderLeft: '3px solid #3b82f6', paddingLeft: '8px' }}>基本信息</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>訂單編號</span><span style={{ fontSize: '14px', color: '#e5e7eb' }}>{detailOrder.order_no || detailOrder.orderNo}</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>创建时间</span><span style={{ fontSize: '14px', color: '#e5e7eb' }}>{formatDate(detailOrder.created_at)}</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>租戶名稱</span><span style={{ fontSize: '14px', color: '#e5e7eb' }}>{detailOrder.tenant_name}</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>租戶編號</span><span style={{ fontSize: '14px', color: '#e5e7eb' }}>{detailOrder.tenant_number}</span></div>
                </div>
              </div>
              
              <div className="detail-section">
	                <h4 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: '600', color: '#e5e7eb', borderLeft: '3px solid #3b82f6', paddingLeft: '8px' }}>套餐与服务</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>套餐名稱</span><span style={{ fontSize: '14px', color: '#e5e7eb', fontWeight: '500' }}>{detailOrder.plan_name || detailOrder.planName}</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>帳號數量</span><span style={{ fontSize: '14px', color: '#e5e7eb' }}>{detailOrder.account_quantity || detailOrder.accountQuantity || '-'}</span></div>
	                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>租期（月）</span><span style={{ fontSize: '14px', color: '#e5e7eb' }}>{termLabel(detailOrder.months)}</span></div>
	                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>增值服务</span><span style={{ fontSize: '14px', color: '#e5e7eb' }}>{detailOrder.addon_names || detailOrder.addonNames || '-'}</span></div>
                </div>
              </div>
              
              <div className="detail-section">
                <h4 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: '600', color: '#e5e7eb', borderLeft: '3px solid #3b82f6', paddingLeft: '8px' }}>狀態与金額</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>訂單狀態</span><div>{getStatusBadge(getBusinessOrderStatus(detailOrder.order_status || detailOrder.orderStatus))}</div></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>審核狀態</span><div>{getStatusBadge(getReviewStatus(detailOrder.order_status || detailOrder.orderStatus))}</div></div>
                  {['review_approved', 'review_rejected'].includes(detailOrder.order_status || detailOrder.orderStatus) && (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>審核人</span><span style={{ fontSize: '14px', color: '#e5e7eb' }}>{detailOrder.reviewer_name || detailOrder.reviewed_by_platform_admin_id || '-'}</span></div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>審核时间</span><span style={{ fontSize: '14px', color: '#e5e7eb' }}>{detailOrder.reviewed_at ? new Date(detailOrder.reviewed_at).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-') : '-'}</span></div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: '1 / -1' }}><span style={{ fontSize: '13px', color: '#64748b' }}>審核意見</span><span style={{ fontSize: '14px', color: '#e5e7eb', whiteSpace: 'pre-wrap' }}>{detailOrder.review_note || detailOrder.reviewNote || '-'}</span></div>
                    </>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>生效日期</span><span style={{ fontSize: '14px', color: '#e5e7eb' }}>{formatDate(detailOrder.effective_at || detailOrder.effectiveAt)}</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>結束日期</span><span style={{ fontSize: '14px', color: '#e5e7eb' }}>{formatDate(detailOrder.expires_at || detailOrder.expiresAt)}</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>支付方式</span><span style={{ fontSize: '14px', color: '#e5e7eb' }}>{paymentMethodLabel(detailOrder)}</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>支付日期</span><span style={{ fontSize: '14px', color: '#e5e7eb' }}>{formatDate(detailOrder.paymentDate || detailOrder.payment_proof_uploaded_at || detailOrder.paid_at)}</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>訂單金額</span>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                      <span style={{ fontSize: '18px', color: '#ef4444', fontWeight: '600' }}>{Number(detailOrder.payable_amount || detailOrder.payableAmount || 0).toFixed(2)} {detailOrder.currency}</span>
                      <button type="button" onClick={() => setShowCostDetails(!showCostDetails)} style={{ fontSize: '13px', color: '#3b82f6', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'none' }}>{showCostDetails ? '收起明细' : '查看明细'}</button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>支付金額</span>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                      <span style={{ fontSize: '18px', color: '#10b981', fontWeight: '600' }}>{Number(detailOrder.paid_amount || detailOrder.paidAmount || (detailOrder.payment_status === 'paid' ? detailOrder.payable_amount : 0)).toFixed(2)} {detailOrder.currency}</span>
                      {detailOrder.payment_proof_file_url && (
                        <a href={getFullImageUrl(detailOrder.payment_proof_file_url)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: '#3b82f6', textDecoration: 'none' }}>查看凭证</a>
                      )}
                    </div>
                  </div>
                  {showCostDetails && (
                    <div style={{ gridColumn: '1 / -1', marginTop: '4px', padding: '16px', backgroundColor: '#1a2332', borderRadius: '8px', border: '1px solid #1f2937', minWidth: 0, overflowX: 'auto' }}>
                      {isLoadingDetail ? (
                        <p style={{ color: '#64748b', fontSize: '13px', textAlign: 'center', margin: 0 }}>載入明细中...</p>
                      ) : detailOrder.items && detailOrder.items.length > 0 ? (
                        <table style={{ width: '100%', minWidth: '400px', tableLayout: 'fixed', wordBreak: 'break-all', borderCollapse: 'collapse', fontSize: '13px', color: '#e5e7eb' }}>
                          <thead>
                            <tr>
                              <th style={{ width: '40px', textAlign: 'left', padding: '8px', borderBottom: '1px solid #cbd5e1', color: '#64748b', fontWeight: 500 }}>序号</th>
                              <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #cbd5e1', color: '#64748b', fontWeight: 500 }}>项目</th>
                              <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #cbd5e1', color: '#64748b', fontWeight: 500 }}>计算方式</th>
                              <th style={{ width: '100px', textAlign: 'right', padding: '8px', borderBottom: '1px solid #cbd5e1', color: '#64748b', fontWeight: 500 }}>金額</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailOrder.items.map((item, index) => (
                              <tr key={index}>
                                <td style={{ padding: '8px', borderBottom: '1px solid #1f2937' }}>{index + 1}</td>
                                <td style={{ padding: '8px', borderBottom: '1px solid #1f2937', fontWeight: 500 }}>{item.itemName}</td>
                                <td style={{ padding: '8px', borderBottom: '1px solid #1f2937', color: '#64748b' }}>{itemFormula(item)}</td>
                                <td style={{ padding: '8px', borderBottom: '1px solid #1f2937', textAlign: 'right', fontWeight: 600 }}>{formatMoney(item.lineAmount, item.currency)}</td>
                              </tr>
                            ))}
                            {Number(detailOrder.discountAmount || 0) > 0 && (
                              <tr>
                                <td style={{ padding: '8px', borderBottom: '1px solid #1f2937' }}>-</td>
                                <td style={{ padding: '8px', borderBottom: '1px solid #1f2937', fontWeight: 500 }}>优惠折扣</td>
                                <td style={{ padding: '8px', borderBottom: '1px solid #1f2937', color: '#64748b' }}>{detailOrder.coupon?.couponCode || '折扣'}</td>
                                <td style={{ padding: '8px', borderBottom: '1px solid #1f2937', textAlign: 'right', fontWeight: 600, color: '#ef4444' }}>- {formatMoney(detailOrder.discountAmount, detailOrder.currency)}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      ) : (
                        <p style={{ color: '#64748b', fontSize: '13px', textAlign: 'center', margin: 0 }}>暫無费用明细資料</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="detail-section">
	                <h4 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: '600', color: '#e5e7eb', borderLeft: '3px solid #3b82f6', paddingLeft: '8px' }}>已分配帳號</h4>
                <div style={{ padding: '32px 20px', textAlign: 'center', color: '#64748b', fontSize: '13px', border: '1px dashed #cbd5e1', borderRadius: '8px', backgroundColor: '#1a2332' }}>
                  功能开发中，将在此处展示已分配至该訂單的 SIP 帳號列表...
                </div>
              </div>
            </div>
            
            <div className="modal-footer" style={{ padding: '16px 24px', borderTop: '1px solid #1f2937', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => { setDetailOrder(null); setShowCostDetails(false); }} className="secondary-btn">关闭</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
