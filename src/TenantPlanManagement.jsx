import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown } from 'lucide-react';
import apiClient from './apiClient';

// 辅助函数：根据订单状态获取徽章样式和文本
function getStatusBadge(orderStatus, paymentStatus, effectiveStatus) {
  if (orderStatus === 'review_approved' && effectiveStatus === 'active') {
    return { label: '已生效', className: 'status-active' };
  }
  if (orderStatus === 'pending_review') {
    return { label: '待审核', className: 'status-pending' };
  }
  if (orderStatus === 'review_rejected') {
    return { label: '审核未通过', className: 'status-inactive' };
  }
  if (orderStatus === 'cancelled') {
    return { label: '已取消', className: 'status-inactive' };
  }
  if (effectiveStatus === 'expired') {
    return { label: '已过期', className: 'status-inactive' };
  }
  if (effectiveStatus === 'expiring') {
    return { label: '即将过期', className: 'status-expiring' };
  }
  if (paymentStatus !== 'paid' && orderStatus !== 'cancelled') {
    return { label: '待支付', className: 'status-pending' };
  }
  return { label: '未生效', className: 'status-inactive' };
}

// 辅助函数：格式化日期
const formatDate = (dateString) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
};

// 辅助函数：格式化金额
const formatMoney = (amount, currency = 'USD') => {
  return `${currency} ${Number(amount || 0).toFixed(2)}`;
};

export default function TenantPlanManagement() {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const dropdownAnchorRef = useRef(null);
  const dropdownMenuRef = useRef(null);

  useEffect(() => {
    loadOrders();
  }, []);

  async function loadOrders() {
    setIsLoading(true);
    try {
      const data = await apiClient.get('/admin/billing/orders'); // 假设这里有一个新的API接口
      console.log('【前端 DEBUG】接口返回的套餐订单数据:', data);
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (err) {
      console.error('Failed to load tenant plan orders:', err);
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  }

  // 统计数据
  const stats = useMemo(() => {
    let total = orders.length;
    let active = 0;
    let pendingReview = 0;
    let expired = 0;

    orders.forEach((order) => {
      const effectiveStatus = getStatusBadge(order.orderStatus, order.paymentStatus, order.effectiveAt, order.expiresAt);
      if (effectiveStatus.label === '已生效') active++;
      if (effectiveStatus.label === '待审核') pendingReview++;
      if (effectiveStatus.label === '已过期') expired++;
    });
    return { total, active, pendingReview, expired };
  }, [orders]);

  // 过滤和排序逻辑（简化版，可根据需要扩展）
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesSearch = !searchKeyword ||
        (order.tenantName && order.tenantName.toLowerCase().includes(searchKeyword.toLowerCase())) ||
        (order.orderNo && order.orderNo.toLowerCase().includes(searchKeyword.toLowerCase())) ||
        (order.planName && order.planName.toLowerCase().includes(searchKeyword.toLowerCase()));

      let matchesStatus = true;
      const effectiveStatus = getStatusBadge(order.orderStatus, order.paymentStatus, order.effectiveAt, order.expiresAt);
      if (statusFilter !== 'all') {
        if (statusFilter === 'active') matchesStatus = effectiveStatus.label === '已生效';
        else if (statusFilter === 'pendingReview') matchesStatus = effectiveStatus.label === '待审核';
        else if (statusFilter === 'inactive') matchesStatus = effectiveStatus.label === '未生效' || effectiveStatus.label === '已过期' || effectiveStatus.label === '审核未通过' || effectiveStatus.label === '已取消';
      }

      return matchesSearch && matchesStatus;
    });
  }, [orders, searchKeyword, statusFilter]);

  const sortedOrders = useMemo(() => {
    let sortableItems = [...filteredOrders];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];
        if (aVal === undefined || aVal === null) aVal = '';
        if (bVal === undefined || bVal === null) bVal = '';
        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [filteredOrders, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / pageSize));
  const paginatedOrders = sortedOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchKeyword, statusFilter, sortConfig]);

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) {
      return <span style={{ color: '#cbd5e1', marginLeft: '4px', fontSize: '12px' }}>↕</span>;
    }
    return sortConfig.direction === 'asc'
      ? <span style={{ color: '#3b82f6', marginLeft: '4px', fontSize: '12px' }}>↑</span>
      : <span style={{ color: '#3b82f6', marginLeft: '4px', fontSize: '12px' }}>↓</span>;
  };

  // 下拉選單點擊外部關閉
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.dropdown-container') && !e.target.closest('.dropdown-menu-portal')) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  // 下拉選單定位
  useEffect(() => {
    if (!openDropdownId || !dropdownAnchorRef.current) return;
    const updatePosition = () => {
      const rect = dropdownAnchorRef.current.getBoundingClientRect();
      const menuWidth = 140; // 假设菜单宽度
      const viewportPadding = 12;
      let left = rect.right - menuWidth;
      if (left < viewportPadding) left = viewportPadding;

      let top = rect.bottom + 4;
      const menuElement = dropdownMenuRef.current;
      const menuHeight = menuElement ? menuElement.offsetHeight : 140; // 假设菜单高度
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

  const handleAction = (action, order) => {
    setOpenDropdownId(null);
    alert(`触发操作: ${action} - 订单: ${order.orderNo}`);
    // 这里会根据 action 执行不同的操作，例如打开详情模态框、审核、编辑、删除等
  };

  return (
    <section className="view active" id="tenant-plan-management" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
        
        {/* 工具列与统计条 */}
        <div className="toolbar" style={{ flexShrink: 0, display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px', width: '100%', boxSizing: 'border-box' }}>
          <input
            type="search"
            placeholder="搜寻租户、订单号、套餐名称"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            style={{ width: '280px' }}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '14px' }}
          >
            <option value="all">全部状态</option>
            <option value="active">已生效</option>
            <option value="pendingReview">待审核</option>
            <option value="inactive">未生效/已过期</option>
          </select>
          <button className="ghost-btn" type="button" onClick={loadOrders}>查询</button>

          <div style={{ width: '1px', height: '20px', backgroundColor: '#cbd5e1', margin: '0 4px' }} className="stats-divider"></div>
          
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>全部套餐</span><strong style={{ fontSize: '14px', color: '#0f172a', fontWeight: '600' }}>{stats.total}</strong></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>已生效</span><strong style={{ fontSize: '14px', color: '#16a34a', fontWeight: '600' }}>{stats.active}</strong></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>待审核</span><strong style={{ fontSize: '14px', color: '#f59e0b', fontWeight: '600' }}>{stats.pendingReview}</strong></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ fontSize: '13px', color: '#64748b' }}>已过期</span><strong style={{ fontSize: '14px', color: '#ef4444', fontWeight: '600' }}>{stats.expired}</strong></div>
          </div>
        </div>

        {/* 表格区域 */}
        <div className="table-wrap" style={{ flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', margin: 0, overflowY: 'auto', overflowX: 'auto', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, backgroundColor: '#f8fafc' }}>
              <tr>
                <th onClick={() => handleSort('tenantName')} style={{ fontSize: '14px', fontWeight: 500, color: '#475569', padding: '12px 16px', borderBottom: '1px solid #e2e8f0', textAlign: 'left', cursor: 'pointer', userSelect: 'none' }}>租户 {getSortIcon('tenantName')}</th>
                <th onClick={() => handleSort('orderNo')} style={{ fontSize: '14px', fontWeight: 500, color: '#475569', padding: '12px 16px', borderBottom: '1px solid #e2e8f0', textAlign: 'left', cursor: 'pointer', userSelect: 'none' }}>订单号 {getSortIcon('orderNo')}</th>
                <th onClick={() => handleSort('planName')} style={{ fontSize: '14px', fontWeight: 500, color: '#475569', padding: '12px 16px', borderBottom: '1px solid #e2e8f0', textAlign: 'left', cursor: 'pointer', userSelect: 'none' }}>套餐名称 {getSortIcon('planName')}</th>
                <th onClick={() => handleSort('accountQuantity')} style={{ fontSize: '14px', fontWeight: 500, color: '#475569', padding: '12px 16px', borderBottom: '1px solid #e2e8f0', textAlign: 'left', cursor: 'pointer', userSelect: 'none' }}>账号数量 {getSortIcon('accountQuantity')}</th>
                <th onClick={() => handleSort('payableAmount')} style={{ fontSize: '14px', fontWeight: 500, color: '#475569', padding