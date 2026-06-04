import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import apiClient from './apiClient';

export default function TenantManagement() {
  const [tenants, setTenants] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedTenantDetails, setSelectedTenantDetails] = useState(null);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingTenantData, setEditingTenantData] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const dropdownAnchorRef = useRef(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

  const dropdownMenuRef = useRef(null);

  useEffect(() => {
    loadTenants();
  }, []);

  async function loadTenants() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.get('/admin/tenants');
      const tenantsData = data?.tenants || data;
      setTenants(Array.isArray(tenantsData) ? tenantsData : []);
    } catch (err) {
      console.error('Failed to load tenants:', err);
      setError(err.message || '無法載入租戶列表');
      setTenants([]);
    } finally {
      setIsLoading(false);
    }
  }

  // 檢查租戶是否為付費用戶 (需後端 API 支援返回相關付費狀態欄位)
  const hasPaidStatus = (tenant) => {
    return Number(tenant.totalPaid) > 0;
  };

  const filteredTenants = tenants.filter((tenant) => {
    const matchesSearch = !searchKeyword || 
      (tenant.companyName && tenant.companyName.toLowerCase().includes(searchKeyword.toLowerCase())) ||
      (tenant.contactPerson && tenant.contactPerson.toLowerCase().includes(searchKeyword.toLowerCase())) ||
      (tenant.loginEmail && tenant.loginEmail.toLowerCase().includes(searchKeyword.toLowerCase())) ||
      (tenant.tenantNumber && tenant.tenantNumber.toLowerCase().includes(searchKeyword.toLowerCase()));
    
    let matchesStatus = true;
    if (statusFilter === 'active') {
      matchesStatus = tenant.status === 'active';
    } else if (statusFilter === 'inactive') {
      matchesStatus = tenant.status === 'inactive' || tenant.status === 'disabled';
    } else if (statusFilter === 'paid') {
      matchesStatus = hasPaidStatus(tenant);
    } else if (statusFilter === 'unpaid') {
      matchesStatus = !hasPaidStatus(tenant);
    }
    
    return matchesSearch && matchesStatus;
  });

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      active: { label: '啟用中', className: 'status-active' },
      disabled: { label: '已停用', className: 'status-inactive' },
      inactive: { label: '已停用', className: 'status-inactive' },
      pending: { label: '待審核', className: 'status-pending' },
      expiring: { label: '即將到期', className: 'status-expiring' },
      expired: { label: '已過期', className: 'status-expired' },
    };
    const statusInfo = statusMap[status] || { label: status || '未知', className: '' };
    return <span className={`status-badge ${statusInfo.className}`}>{statusInfo.label}</span>;
  };

  const stats = useMemo(() => {
    let active = 0;
    let expiring = 0;
    let inactive = 0;
    let totalPaid = 0;
    let currency = 'USD';

    tenants.forEach((t) => {
      if (t.status === 'active') active++;
      else if (t.status === 'expiring') expiring++;
      else if (t.status === 'disabled' || t.status === 'inactive' || t.status === 'expired') inactive++;

      // 從後端真實數據累計支付總金額
      totalPaid += Number(t.totalPaid) || 0;
      if (t.currency) currency = t.currency;
    });

    return { total: tenants.length, active, expiring, inactive, totalPaid, currency };
  }, [tenants]);

  // Pagination & Sorting logic
  const pageSizeOptions = [10, 20, 50, '全部'];
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const sortedFilteredTenants = useMemo(() => {
    let sortableItems = [...filteredTenants];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        const aVal = String(a[sortConfig.key] || '').toLowerCase();
        const bVal = String(b[sortConfig.key] || '').toLowerCase();
        const result = aVal.localeCompare(bVal, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
        return sortConfig.direction === 'asc' ? result : -result;
      });
    }
    return sortableItems;
  }, [filteredTenants, sortConfig]);

  const effectivePageSize = pageSize === '全部' ? sortedFilteredTenants.length || 1 : pageSize;
  const totalPages = Math.max(1, Math.ceil(sortedFilteredTenants.length / effectivePageSize));
  const paginatedTenants = sortedFilteredTenants.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);

  useEffect(() => {
    setCurrentPage(1); // Reset page when filters, search, or page size change
  }, [searchKeyword, statusFilter, sortConfig, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages, currentPage]);

  function handleSort(key) {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  function getSortIcon(key) {
    if (sortConfig.key !== key) return <span style={{ color: '#cbd5e1', marginLeft: '4px', fontSize: '10px' }}>↕</span>;
    return <span style={{ color: '#3b82f6', marginLeft: '4px', fontSize: '10px' }}>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
  }

  // Dropdown position logic
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.dropdown-container') && !e.target.closest('.dropdown-menu-portal')) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!openDropdownId || !dropdownAnchorRef.current) return;
    const updatePosition = () => {
      const rect = dropdownAnchorRef.current.getBoundingClientRect();
      const menuWidth = 140; // 下拉菜单估计宽度
      const viewportPadding = 12;
      let left = rect.right - menuWidth;
      if (left < viewportPadding) left = viewportPadding; // 防止超出左侧

      let top = rect.bottom + 4;
      const menuElement = dropdownMenuRef.current;
      const menuHeight = menuElement ? menuElement.offsetHeight : 140;
      if (top + menuHeight > window.innerHeight - viewportPadding) {
        top = rect.top - 4 - menuHeight; // 防止超出底部，向上展开
      }

      setDropdownPosition({ top, left });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true); // true 用于捕获表格内部滚动
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [openDropdownId]);

  const handleDetails = async (tenant) => {
    setDetailsModalOpen(true);
    setIsDetailsLoading(true);
    setSelectedTenantDetails(null);
    setOpenDropdownId(null);
    try {
      const data = await apiClient.get(`/admin/tenants/${tenant.id}`);
      setSelectedTenantDetails(data.tenant);
    } catch (err) {
      console.error(err);
      alert(err.message || '無法載入租戶詳情');
      setDetailsModalOpen(false);
    } finally {
      setIsDetailsLoading(false);
    }
  };

  const handleEdit = async (tenant) => {
    setOpenDropdownId(null);
    setEditModalOpen(true);
    setIsDetailsLoading(true);
    setEditingTenantData(null);
    try {
      const data = await apiClient.get(`/admin/tenants/${tenant.id}`);
      setEditingTenantData(data.tenant);
    } catch (err) {
      console.error(err);
      alert(err.message || '無法載入租戶詳情');
      setEditModalOpen(false);
    } finally {
      setIsDetailsLoading(false);
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingTenantData?.companyName?.trim()) {
      alert('請輸入公司名稱。');
      return;
    }
    setIsSaving(true);
    try {
      await apiClient.put(`/admin/tenants/${editingTenantData.id}`, {
        ...editingTenantData
      });
      setEditModalOpen(false);
      loadTenants(); // 更新列表顯示的最新資料
    } catch (err) {
      console.error(err);
      alert(err.message || '儲存失敗');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (tenant, e) => {
    e.stopPropagation();
    const newStatus = tenant.status === 'active' ? 'disabled' : 'active';
    const actionText = newStatus === 'active' ? '啟用' : '停用';
    
    if (!window.confirm(`確定要${actionText}租戶「${tenant.companyName || tenant.tenantNumber}」嗎？`)) {
      return;
    }

    try {
      await apiClient.put(`/admin/tenants/${tenant.id}/status`, { status: newStatus });
      setTenants((current) => current.map((t) => t.id === tenant.id ? { ...t, status: newStatus } : t));
    } catch (err) {
      console.error('Failed to update tenant status:', err);
      alert(err.message || `無法${actionText}租戶`);
    }
  };

  const handleDelete = async (tenant, e) => {
    e.stopPropagation();

    if (tenant.status !== 'disabled') {
      alert('只有處於「已停用」狀態的租戶才可以執行刪除操作。');
      return;
    }

    if (Number(tenant.totalPaid) > 0) {
      alert('該租戶已有支付紀錄，為保障財務數據完整性，無法刪除。');
      return;
    }

    if (window.confirm(`【警告：此操作不可恢復！】\n\n確定要徹底刪除租戶「${tenant.companyName || tenant.tenantNumber}」及其所有的關聯資料嗎？`)) {
      try {
        await apiClient.delete(`/admin/tenants/${tenant.id}`);
        setTenants((current) => current.filter((t) => t.id !== tenant.id));
        setOpenDropdownId(null);
      } catch (err) {
        console.error('Failed to delete tenant:', err);
        alert(err.message || '刪除租戶失敗');
      }
    }
  };

  return (
    <>
      <style>{`
        .dropdown-menu-portal {
          position: fixed;
          background-color: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          z-index: 10050;
          min-width: 140px;
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
        .dropdown-menu-portal .dropdown-item:hover {
          background-color: #f1f5f9;
        }
        .dropdown-menu-portal .dropdown-item.dropdown-item-danger {
          color: #ef4444;
        }
        .dropdown-menu-portal .dropdown-item.dropdown-item-danger:hover {
          background-color: #fef2f2;
        }
          /* ========================================================
             复刻设备管理页面顶部命令按钮的视觉风格
             ======================================================== */
          .page-heading > button.primary-btn {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 6px !important;
            height: 44px !important;
            min-height: 44px !important;
            padding: 0 18px !important;
            border-radius: 8px !important;
            font-size: 12px !important;
            font-weight: 500 !important;
            white-space: nowrap !important;
            background: linear-gradient(90deg, #2563eb 0%, #06b6d4 100%) !important;
            color: #fff !important;
            border: 0 !important;
            box-shadow: 0 6px 14px rgba(37, 99, 235, 0.22) !important;
          }
          .page-heading > button.primary-btn::before {
            content: '+';
            font-size: 16px;
            font-weight: 500;
            line-height: 1;
            margin-bottom: 2px;
          }
          /* --- Add styles matching DeviceManagement --- */
          #tenant-management .tenant-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 22px 24px;
            margin-bottom: 24px;
            background: rgba(255, 255, 255, 0.96);
            border: 1px solid #e6eef8;
            border-radius: 14px;
            box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
          }
          #tenant-management .tenant-filter-left {
            display: flex;
            align-items: center;
            gap: 10px;
            flex: 0 1 auto;
            min-width: 0;
            white-space: nowrap;
          }
          #tenant-management .tenant-search {
            position: relative;
            width: clamp(280px, 30vw, 360px);
            flex: 0 1 360px;
            max-width: 100%;
          }
          #tenant-management .tenant-search svg {
            position: absolute;
            left: 16px;
            top: 50%;
            transform: translateY(-50%);
            color: #94a3b8;
            pointer-events: none;
          }
          #tenant-management .tenant-search input {
            width: 100%;
            height: 46px;
            padding: 0 16px 0 44px;
            border-radius: 9px;
            border: 1px solid #d8e2ef;
            background: #fff;
            color: #334155;
            font-size: 12px;
            outline: none;
            box-sizing: border-box;
          }
          #tenant-management .tenant-search input::placeholder { color: #94a3b8; }
          #tenant-management .tenant-search input:focus {
            border-color: #2563eb;
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
          }
          #tenant-management .tenant-status-select {
            height: 46px;
            min-width: 112px;
            width: 120px;
            padding: 0 12px;
            border-radius: 9px;
            border: 1px solid #d8e2ef;
            background: #fff;
            color: #334155;
            font-size: 12px;
            outline: none;
            cursor: pointer;
          }
          #tenant-management .tenant-stats {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            flex: 0 0 auto;
            flex-wrap: nowrap;
            white-space: nowrap;
          }
          #tenant-management .tenant-stat-pill {
            height: 34px;
            padding: 0 12px;
            border-radius: 999px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #475569;
            font-size: 12px;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            flex: 0 0 auto;
            white-space: nowrap;
          }
          #tenant-management .tenant-stat-pill strong {
            color: #0f172a;
            font-size: 13px;
            font-weight: 700;
          }
          #tenant-management .tenant-table-card {
            display: flex;
            flex-direction: column;
            flex: 1;
            min-height: 0;
            background: rgba(255, 255, 255, 0.96);
            border: 1px solid #e6eef8;
            border-radius: 14px;
            box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
            overflow: hidden;
          }
          #tenant-management .tenant-table-wrapper {
            width: 100%;
            flex: 1;
            min-height: 0;
            overflow-x: auto;
            overflow-y: auto;
          }
          #tenant-management .tenant-table {
            width: 100%;
            min-width: 1080px;
            border-collapse: collapse;
            table-layout: fixed;
            font-size: 12px;
          }
          #tenant-management .tenant-table thead { background: #f8fafc; }
          #tenant-management .tenant-table th {
            height: 56px;
            padding: 0 22px;
            text-align: left;
            color: #475569;
            font-weight: 600;
            border-bottom: 1px solid #e2e8f0;
            white-space: nowrap;
          }
          #tenant-management .tenant-table td {
            height: 64px;
            padding: 0 22px;
            color: #334155;
            border-bottom: 1px solid #e2e8f0;
            white-space: nowrap;
          }
          #tenant-management .tenant-empty {
            height: 380px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            border-bottom: 1px solid #e2e8f0;
            color: #64748b;
          }
          #tenant-management .tenant-table-footer {
            min-height: 74px;
            padding: 0 30px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #fff;
          }
          #tenant-management .tenant-total {
            color: #64748b;
            font-size: 12px;
          }
          #tenant-management .tenant-pagination {
            display: flex;
            align-items: center;
            gap: 12px;
          }
          #tenant-management .tenant-page-size {
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
          #tenant-management .tenant-page-btn,
          #tenant-management .tenant-page-current {
            width: 38px;
            height: 38px;
            border-radius: 8px;
            border: 1px solid #d8e2ef;
            background: #fff;
            color: #475569;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
          }
          #tenant-management .tenant-page-current {
            border-color: #2563eb;
            color: #2563eb;
            background: #eff6ff;
            font-weight: 600;
          }
          #tenant-management .tenant-page-btn {
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
          }
          #tenant-management .tenant-page-btn:disabled {
            color: #cbd5e1;
            cursor: not-allowed;
            background: #f8fafc;
          }
          #tenant-management .tenant-page-jump {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #64748b;
            font-size: 11px;
          }
          #tenant-management .tenant-page-input {
            width: 56px;
            height: 36px;
            border-radius: 8px;
            border: 1px solid #d8e2ef;
            text-align: center;
            outline: none;
            color: #334155;
            font-size: 11px;
          }
          @media (max-width: 1100px) {
            #tenant-management .tenant-toolbar {
              overflow-x: auto;
              scrollbar-width: none;
            }
            #tenant-management .tenant-toolbar::-webkit-scrollbar { height: 0; }
            #tenant-management .tenant-filter-left { flex-wrap: nowrap; }
            #tenant-management .tenant-stats { justify-content: flex-end; }
          }
          @media (max-width: 720px) {
            #tenant-management .tenant-toolbar { padding: 18px; }
            #tenant-management .tenant-table-footer { padding: 14px 20px; flex-wrap: wrap; }
            #tenant-management .tenant-pagination { flex-wrap: wrap; }
          }

          /* === Dark theme overrides === */
          #tenant-management .tenant-content { background: #111827; }
          #tenant-management .tenant-toolbar { background: #111827; border-color: #1f2937; box-shadow: none; }
          #tenant-management .tenant-search input { background: #1a2332; border-color: #374151; color: #e5e7eb; }
          #tenant-management .tenant-search input::placeholder { color: #6b7280; }
          #tenant-management .tenant-search input:focus { border-color: #3b82f6; }
          #tenant-management .tenant-status-select { background: #1a2332; border-color: #374151; color: #e5e7eb; }
          #tenant-management .tenant-stat-pill { background: #1a2332; border-color: #374151; color: #9ca3af; }
          #tenant-management .tenant-stat-pill strong { color: #ffffff; }
          #tenant-management .tenant-table-card { background: #111827; border-color: #1f2937; box-shadow: none; border-radius: 14px; min-height: 300px; }
          #tenant-management .tenant-table thead { background: #1a2332; }
          #tenant-management .tenant-table th { color: #e5e7eb; border-bottom-color: #1f2937; }
          #tenant-management .tenant-table td { color: #e5e7eb; border-bottom-color: #1f2937; }
          #tenant-management .tenant-table tbody tr { background: #111827; }
          #tenant-management .tenant-table tbody tr:hover { background: #1e293b; }
          #tenant-management .tenant-table td a,
          #tenant-management .tenant-table td span { color: inherit; }
          #tenant-management .tenant-table .status-active { background: #0d2818; color: #4ade80; }
          #tenant-management .tenant-table .status-inactive { background: #1f2937; color: #9ca3af; }
          #tenant-management .tenant-table .status-pending { background: #1e3a5f; color: #93c5fd; }
          #tenant-management .tenant-table .status-expiring { background: #3b2508; color: #fbbf24; }
          #tenant-management .tenant-table .status-expired { background: #3b1111; color: #fca5a5; }
          #tenant-management .tenant-table-footer { background: #111827; border-top-color: #1f2937; }
          #tenant-management .tenant-pagination-info { color: #9ca3af; }
          #tenant-management .tenant-pagination-info b { color: #f3f4f6; }
          #tenant-management .tenant-pagination button { background: #1f2937; border-color: #4b5563; color: #9ca3af; }
          #tenant-management .tenant-pagination button:hover:not(:disabled) { background: #374151; color: #f3f4f6; }
          #tenant-management .tenant-pagination button:disabled { opacity: 0.4; }
          #tenant-management .tenant-page-current { background: #1e3a5f; border-color: #3b82f6; color: #60a5fa; }
          #tenant-management .tenant-page-input { background: #1a2332; border-color: #374151; color: #e5e7eb; }
          #tenant-management .tenant-page-size { background: #1a2332; border-color: #374151; color: #e5e7eb; }
          #tenant-management .tenant-page-size:focus { border-color: #3b82f6; }
          #tenant-management .tenant-table-wrapper { scrollbar-width: none; }
          #tenant-management .tenant-table-wrapper::-webkit-scrollbar { display: none; }
          #tenant-management .dropdown-menu-portal { background: #1e293b; border-color: #374151; }
          #tenant-management .dropdown-menu-portal button { color: #d1d5db; }
          #tenant-management .dropdown-menu-portal button:hover { background: #374151; }
      `}</style>
      <section className="view active" id="tenant-management" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#111827' }}>
        <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '0', paddingBottom: '0', background: '#111827' }}>
          
          <div className="tenant-toolbar">
            <div className="tenant-filter-left">
              <label className="tenant-search">
                <Search size={18} />
                <input
                  type="search"
                  placeholder="搜尋公司名稱、聯絡人、信箱"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                />
              </label>
              <select
                className="tenant-status-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">全部租戶</option>
                <option value="active">啟用中</option>
                <option value="inactive">已停用</option>
                <option value="paid">付費用戶</option>
                <option value="unpaid">未付費用戶</option>
              </select>
            </div>
            <div className="tenant-stats">
              <span className="tenant-stat-pill">全部租戶<strong>{stats.total}</strong></span>
              <span className="tenant-stat-pill">啟用中<strong style={{ color: '#16a34a' }}>{stats.active}</strong></span>
              <span className="tenant-stat-pill">即將到期<strong style={{ color: '#d97706' }}>{stats.expiring}</strong></span>
              <span className="tenant-stat-pill">停用/過期<strong style={{ color: '#ef4444' }}>{stats.inactive}</strong></span>
              <span className="tenant-stat-pill">付費合計<strong>{stats.totalPaid > 0 ? `${stats.currency} ${stats.totalPaid.toFixed(2)}` : '-'}</strong></span>
            </div>
          </div>

          <div className="tenant-table-card">
            {isLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#9ca3af', fontSize: '14px' }}>載入租戶列表中...</div>
            ) : paginatedTenants.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#9ca3af', fontSize: '14px' }}>
                {searchKeyword || statusFilter !== 'all' ? '沒有符合條件的租戶' : '目前尚無租戶資料'}
              </div>
            ) : (
            <>
            <div className="tenant-table-wrapper">
              <table className="tenant-table">
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#1a2332' }}>
                  <tr>
                    {[
                      ['tenantNumber', '租戶編號', '150px'],
                      ['companyName', '公司名稱', '200px'],
                      ['createdAt', '註冊日期', '150px'],
                      ['userLimit', '訂閱數量', '100px'],
                      ['totalPaid', '累計支付', '100px'],
                      ['status', '狀態', '100px']
                    ].map(([key, label, width]) => (
                      <th key={key} style={{ width, background: '#1a2332' }}>
                        <button type="button" onClick={() => handleSort(key)} style={{ border: 0, background: 'transparent', color: 'inherit', padding: 0, cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap' }}>
                          {label}{getSortIcon(key)}
                        </button>
                      </th>
                    ))}
                    <th style={{ position: 'sticky', right: 0, backgroundColor: '#1a2332', zIndex: 3, boxShadow: '-1px 0 0 #1f2937', width: '140px', textAlign: 'center' }}>操作</th>
                  </tr>
                </thead>
                {isLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '200px', color: '#9ca3af', fontSize: '14px' }}>載入租戶列表中...</div>
                ) : paginatedTenants.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '200px', color: '#9ca3af', fontSize: '14px' }}>
                    {searchKeyword || statusFilter !== 'all' ? '沒有符合條件的租戶' : '目前尚無租戶資料'}
                  </div>
                ) : (
                <tbody>
                  {paginatedTenants.map((tenant) => (
                    <tr key={tenant.id || tenant.tenantNumber}>
                      <td style={{ color: '#f3f4f6', fontWeight: 500 }}>{tenant.tenantNumber || tenant.id || '-'}</td>
                      <td>{tenant.companyName || '-'}</td>
                      <td>{formatDate(tenant.createdAt)}</td>
                      <td>{tenant.userLimit || tenant.subscriptionQuantity || tenant.accountQuantity || tenant.seats || 0}</td>
                      <td>{tenant.totalPaid !== undefined ? tenant.totalPaid : '-'}</td>
                      <td style={{ position: 'sticky', right: 0, backgroundColor: '#111827', zIndex: 1, boxShadow: '-1px 0 0 #1f2937', width: '140px', textAlign: 'center', padding: '0 12px' }}>
                        <div className="row-actions dropdown-container" style={{ display: 'flex', gap: '8px', justifyContent: 'center', whiteSpace: 'nowrap' }}>
                          <button 
                            className="ghost-btn" 
                            type="button" 
                            style={{ fontSize: '12px', padding: '4px 8px' }}
                            onClick={() => handleDetails(tenant)}
                          >
                            詳情
                          </button>
                          <button 
                            className="ghost-btn" 
                            type="button" 
                            style={{ fontSize: '12px', padding: '4px 8px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              const button = e.currentTarget;
                              dropdownAnchorRef.current = button;
                              setOpenDropdownId((current) => (current === tenant.id ? null : tenant.id));
                            }}
                          >
                            更多
                          </button>
                          {openDropdownId === tenant.id ? createPortal(
                            <div
                              ref={dropdownMenuRef}
                              className="dropdown-menu-portal"
                              style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
                            >
                              <button type="button" className="dropdown-item" onClick={() => { handleDetails(tenant); setOpenDropdownId(null); }}>詳情</button>
                              <button type="button" className="dropdown-item" onClick={() => { handleEdit(tenant); setOpenDropdownId(null); }}>編輯</button>
                              <button type="button" className="dropdown-item" onClick={(e) => { handleToggleStatus(tenant, e); setOpenDropdownId(null); }}>
                                {tenant.status === 'active' ? '停用' : '啟用'}
                              </button>
                              <button type="button" className="dropdown-item dropdown-item-danger" onClick={(e) => { handleDelete(tenant, e); setOpenDropdownId(null); }}>刪除</button>
                            </div>,
                            document.body
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="tenant-table-footer">
              <div className="tenant-total">共 {filteredTenants.length} 筆資料</div>
              <div className="tenant-pagination">
                <select className="tenant-page-size" value={pageSize} onChange={(e) => { const v = e.target.value; setPageSize(v === '全部' ? '全部' : Number(v)); setCurrentPage(1); }}>
                  {pageSizeOptions.map(opt => <option key={opt} value={opt}>{opt === '全部' ? '全部' : `${opt} 條/頁`}</option>)}
                </select>
                <button className="tenant-page-btn" type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>‹</button>
                <span className="tenant-page-current">{currentPage}</span>
                <button className="tenant-page-btn" type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>›</button>
                <span className="tenant-page-jump">前往<input className="tenant-page-input" value={currentPage} readOnly />頁</span>
              </div>
            </div>
          </>
          )}
          </div>
      </div>

      {detailsModalOpen && createPortal(
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => setDetailsModalOpen(false)}>
          <div className="modal-content" style={{ backgroundColor: '#111827', borderRadius: '12px', width: '500px', maxWidth: '90%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)' }} onClick={e => e.stopPropagation()}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6', fontWeight: '600' }}>租戶詳細資訊</h3>
              <button className="ghost-btn" onClick={() => setDetailsModalOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '24px', lineHeight: 1, color: '#9ca3af', padding: '0 4px' }}>&times;</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', minHeight: 0 }}>
            {isDetailsLoading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>載入中...</div>
            ) : selectedTenantDetails ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>租戶編號:</span>
                  <span style={{ color: '#f3f4f6', fontSize: '14px', fontWeight: 500 }}>{selectedTenantDetails.tenantNumber || '-'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>公司名稱:</span>
                  <span style={{ color: '#f3f4f6', fontSize: '14px', fontWeight: 500 }}>{selectedTenantDetails.companyName || '-'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>SIP 網域:</span>
                  <span style={{ color: '#f3f4f6', fontSize: '14px' }}>{selectedTenantDetails.sipDomain || '-'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>企業信箱:</span>
                  <span style={{ color: '#f3f4f6', fontSize: '14px' }}>{selectedTenantDetails.enterpriseEmail || '-'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>聯絡人:</span>
                  <span style={{ color: '#f3f4f6', fontSize: '14px' }}>{selectedTenantDetails.contactPerson || '-'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>聯絡電話:</span>
                  <span style={{ color: '#f3f4f6', fontSize: '14px' }}>{selectedTenantDetails.contactPhone || '-'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>帳單地址:</span>
                  <span style={{ color: '#f3f4f6', fontSize: '14px' }}>{selectedTenantDetails.billingAddress || '-'}</span>
                </div>
                <div style={{ borderTop: '1px solid #f1f5f9', margin: '4px 0' }}></div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>管理員信箱:</span>
                  <span style={{ color: '#f3f4f6', fontSize: '14px' }}>{selectedTenantDetails.loginEmail || '-'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>管理員電話:</span>
                  <span style={{ color: '#f3f4f6', fontSize: '14px' }}>{selectedTenantDetails.adminPhone || '-'}</span>
                </div>
                <div style={{ borderTop: '1px solid #f1f5f9', margin: '4px 0' }}></div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>訂閱數量:</span>
                  <span style={{ color: '#f3f4f6', fontSize: '14px' }}>{selectedTenantDetails.userLimit || 0}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>累計支付:</span>
                  <span style={{ color: '#f3f4f6', fontSize: '14px' }}>{selectedTenantDetails.totalPaid ? `$ ${selectedTenantDetails.totalPaid.toFixed(2)}` : '0'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>註冊時間:</span>
                  <span style={{ color: '#f3f4f6', fontSize: '14px' }}>{formatDate(selectedTenantDetails.createdAt)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: '#9ca3af', fontSize: '14px' }}>目前狀態:</span>
                  <div style={{ display: 'flex' }}>{getStatusBadge(selectedTenantDetails.status)}</div>
                </div>
              </div>
            ) : null}
            </div>
            <div style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid #1f2937', backgroundColor: '#111827', textAlign: 'right' }}>
              <button onClick={() => setDetailsModalOpen(false)} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#374151', color: '#d1d5db', border: '1px solid #4b5563', cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}>關閉</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {editModalOpen && createPortal(
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => setEditModalOpen(false)}>
          <div className="modal-content" style={{ backgroundColor: '#111827', borderRadius: '12px', width: '600px', maxWidth: '90%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)' }} onClick={e => e.stopPropagation()}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6', fontWeight: '600' }}>編輯租戶資訊</h3>
              <button className="ghost-btn" onClick={() => setEditModalOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '24px', lineHeight: 1, color: '#9ca3af', padding: '0 4px' }}>&times;</button>
            </div>
            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px', minHeight: 0 }}>
                {isDetailsLoading ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>載入中...</div>
                ) : editingTenantData ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>租戶編號</span>
                      <input value={editingTenantData.tenantNumber || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', color: '#9ca3af', outline: 'none' }} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>公司名稱 <span style={{ color: '#ef4444' }}>*</span></span>
                      <input required value={editingTenantData.companyName || ''} onChange={e => setEditingTenantData({...editingTenantData, companyName: e.target.value})} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#cbd5e1'} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>企業信箱</span>
                      <input type="email" value={editingTenantData.enterpriseEmail || ''} onChange={e => setEditingTenantData({...editingTenantData, enterpriseEmail: e.target.value})} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#cbd5e1'} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>企業聯絡人</span>
                      <input value={editingTenantData.contactPerson || ''} onChange={e => setEditingTenantData({...editingTenantData, contactPerson: e.target.value})} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#cbd5e1'} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>聯絡電話</span>
                      <input type="tel" value={editingTenantData.contactPhone || ''} onChange={e => setEditingTenantData({...editingTenantData, contactPhone: e.target.value})} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#cbd5e1'} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>郵遞區號</span>
                      <input value={editingTenantData.postalCode || ''} onChange={e => setEditingTenantData({...editingTenantData, postalCode: e.target.value})} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#cbd5e1'} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>帳單郵寄地址</span>
                      <textarea rows="3" value={editingTenantData.billingAddress || ''} onChange={e => setEditingTenantData({...editingTenantData, billingAddress: e.target.value})} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', resize: 'vertical', outline: 'none', fontFamily: 'inherit' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#cbd5e1'} />
                    </label>
                  </div>
                ) : null}
              </div>
              <div style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid #1f2937', backgroundColor: '#111827', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" onClick={() => setEditModalOpen(false)} disabled={isSaving} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#374151', color: '#d1d5db', border: '1px solid #4b5563', cursor: isSaving ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 500, opacity: isSaving ? 0.7 : 1 }}>取消</button>
                <button type="submit" disabled={isSaving || isDetailsLoading} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', cursor: (isSaving || isDetailsLoading) ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 500, opacity: (isSaving || isDetailsLoading) ? 0.7 : 1 }}>{isSaving ? '儲存中...' : '儲存修改'}</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </section>
    </>
  );
}