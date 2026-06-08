import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, Plus, X } from 'lucide-react';
import apiClient from './apiClient';

const currencyOptions = [
  { value: 'TWD', label: '新台幣 TWD' },
  { value: 'CNY', label: '人民幣 CNY' },
  { value: 'USD', label: '美元 USD' },
  { value: 'EUR', label: '歐元 EUR' },
];

const emptyPlan = {
  id: null,
  planCode: '',
  name: '',
  description: '',
  accountQuantity: 100,
  featureSummary: '',
  status: 'active',
  sortOrder: 10,
  addonServices: '',
  priceTiers: [{ accountQuantity: 100, currency: 'TWD', unitPrice: 0, status: 'active' }],
};

function statusText(status) {
  return status === 'disabled' ? '停用' : '啟用';
}

function getBasePriceText(plan) {
  if (!plan.priceTiers || plan.priceTiers.length === 0) return '-';
  const firstTier = plan.priceTiers[0];
  return `${firstTier.currency} $${Number(firstTier.unitPrice).toFixed(2)}`;
}

function RequiredMark() {
  return <span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>;
}

const Plans = forwardRef((props, ref) => {
  const { view = 'plans', onReturnToList } = props;
  const isAddPage = view === 'plans-add';

  const [plans, setPlans] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [query, setQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [editingPlan, setEditingPlan] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [modalMode, setModalMode] = useState('add');
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [availableAddons, setAvailableAddons] = useState([]);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, right: 0, bottom: 0, width: 0 });
  const dropdownAnchorRef = useRef(null);
  const messageTimerRef = useRef(null);
  const dropdownMenuRef = useRef(null);

  const [currentPage, setCurrentPage] = useState(1);
  const pageSizeOptions = [10, 20, 50, '全部'];
  const [pageSize, setPageSize] = useState(10);

  useImperativeHandle(ref, () => ({
    startAdd,
    handleBatchDisable,
    handleBatchEnable,
  }));

  const showMessage = useCallback((type, text) => {
    setMessage({ type, text });
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    if (text) {
      messageTimerRef.current = window.setTimeout(() => {
        setMessage({ type: '', text: '' });
        messageTimerRef.current = null;
      }, 5000);
    }
  }, []);

  const loadPlans = useCallback(async ({ silent = false } = {}) => {
    if (!isAddPage) setIsLoading(true);
    if (!silent) showMessage('', '');
    try {
      const data = await apiClient.get('/billing/plans');
      setPlans(data.plans || []);
    } catch (error) {
      showMessage('error', error.message || '無法讀取套餐資料。');
    } finally {
      if (!isAddPage) setIsLoading(false);
    }
  }, [isAddPage, showMessage]);

  useEffect(() => {
    loadPlans();
    return () => {
      if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    };
  }, [loadPlans]);

  useEffect(() => {
    if (isAddPage) {
      setEditingPlan({
        ...emptyPlan,
        planCode: `plan-${Math.random().toString(36).substring(2, 7)}`,
        sortOrder: (plans.length + 1) * 10,
      });
      setModalMode('add');
      setShowDetailModal(false);
    }
  }, [isAddPage]);

  useEffect(() => {
    apiClient.get('/billing/addon-services')
      .then(data => {
        setAvailableAddons(data?.addons || data || []);
      })
      .catch(err => console.warn('取得增值服務列表失敗:', err));
  }, []);

  const filteredPlans = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return plans.filter((plan) => {
      const matchesKeyword = !keyword
        || String(plan.id).toLowerCase().includes(keyword)
        || plan.planCode.toLowerCase().includes(keyword)
        || plan.name.toLowerCase().includes(keyword);
      const matchesStatus = filterStatus === 'all' || plan.status === filterStatus;
      return matchesKeyword && matchesStatus;
    });
  }, [plans, filterStatus, query]);


  const planStats = useMemo(() => ({
    total: plans.length,
    active: plans.filter((plan) => plan.status === 'active').length,
    disabled: plans.filter((plan) => plan.status === 'disabled').length,
  }), [plans]);

  const effectivePageSize = pageSize === '全部' ? (filteredPlans.length || 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(filteredPlans.length / effectivePageSize));
  const paginatedPlans = filteredPlans.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);

  // 搜寻或筛选改变时，重置回第一页
  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds([]);
  }, [query, filterStatus, pageSize]);

  // 当删除最后一笔导致当前页超出总页数时，自动回退到最新末页
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages, currentPage]);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (
        !e.target.closest('.dropdown-container') &&
        !e.target.closest('.dropdown-menu-portal')
      ) {
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
      const menuWidth = 160;
      const viewportPadding = 12;
      let left = rect.left;
      if (left + menuWidth > window.innerWidth - viewportPadding) {
        left = Math.max(viewportPadding, rect.right - menuWidth);
      }
      if (left < viewportPadding) {
        left = viewportPadding;
      }

      let top = rect.bottom + 6;
      const menuElement = dropdownMenuRef.current;
      const menuHeight = menuElement ? menuElement.offsetHeight : 192;
      if (top + menuHeight > window.innerHeight - viewportPadding) {
        top = rect.top - 6 - menuHeight;
      }

      setDropdownPosition({
        top,
        left,
        right: rect.right,
        bottom: rect.top,
        width: rect.width,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [openDropdownId]);

  const isCurrentPageSelected = paginatedPlans.length > 0 && paginatedPlans.every((plan) => selectedIds.includes(plan.id));

  function toggleCurrentPageSelection(checked) {
    if (checked) {
      const nextIds = new Set(selectedIds);
      paginatedPlans.forEach((plan) => nextIds.add(plan.id));
      setSelectedIds(Array.from(nextIds));
    } else {
      const pageIds = new Set(paginatedPlans.map((plan) => plan.id));
      setSelectedIds((ids) => ids.filter((id) => !pageIds.has(id)));
    }
  }

  function togglePlanSelection(planId, checked) {
    if (checked) {
      setSelectedIds((ids) => (ids.includes(planId) ? ids : [...ids, planId]));
    } else {
      setSelectedIds((ids) => ids.filter((id) => id !== planId));
    }
  }

  const handleBatchDisable = async () => {
    if (selectedIds.length === 0) {
      window.alert('请至少选择一条記錄进行操作。');
      return;
    }
    
    if (window.confirm(`确定要停用选中的 ${selectedIds.length} 個套餐吗？`)) {
      setIsSaving(true);
      showMessage('', '');
      try {
        const selectedPlans = plans.filter((plan) => selectedIds.includes(plan.id));
        await Promise.all(selectedPlans.map((plan) =>
          apiClient.put(`/billing/plans/${plan.id}`, { ...plan, status: 'disabled' })
        ));
        setSelectedIds([]);
        await loadPlans({ silent: true });
        showMessage('success', '批量停用成功。');
      } catch (error) {
        showMessage('error', `批量停用失败: ${error.message || '未知错误'}`);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleBatchEnable = async () => {
    if (selectedIds.length === 0) {
      window.alert('请至少选择一条記錄进行操作。');
      return;
    }
    
    if (window.confirm(`确定要启用选中的 ${selectedIds.length} 個套餐吗？`)) {
      setIsSaving(true);
      showMessage('', '');
      try {
        const selectedPlans = plans.filter((plan) => selectedIds.includes(plan.id));
        await Promise.all(selectedPlans.map((plan) =>
          apiClient.put(`/billing/plans/${plan.id}`, { ...plan, status: 'active' })
        ));
        setSelectedIds([]);
        await loadPlans({ silent: true });
        showMessage('success', '批量启用成功。');
      } catch (error) {
        showMessage('error', `批量启用失败: ${error.message || '未知错误'}`);
      } finally {
        setIsSaving(false);
      }
    }
  };

  function startAdd() {
    setEditingPlan({
      ...emptyPlan,
      planCode: `plan-${Math.random().toString(36).substring(2, 7)}`,
      sortOrder: (plans.length + 1) * 10,
    });
    setModalMode('add');
  }

  const handleDetails = (plan) => {
    setSelectedPlanId(plan.id);
    setEditingPlan({ ...plan });
    setModalMode('details');
    setShowDetailModal(true);
  };

  const handleEdit = (plan) => {
    setSelectedPlanId(plan.id);
    setEditingPlan({ ...plan });
    setModalMode('edit');
    setShowDetailModal(true);
  };
  
  const handleToggleStatus = async (plan, event) => {
    event.stopPropagation();
    const updatedPlan = { ...plan, status: plan.status === 'active' ? 'disabled' : 'active' };
    
    try {
      await apiClient.put(`/billing/plans/${updatedPlan.id}`, updatedPlan);
      setPlans(current => current.map(p => (p.id === updatedPlan.id ? updatedPlan : p)));
      showMessage('success', '套餐状态已更新。');
    } catch (error) {
      showMessage('error', `更新状态失败: ${error.message || '未知错误'}`);
    }
  };

  const handleDelete = async (plan, event) => {
    event.stopPropagation();
    if (window.confirm(`确定要删除套餐「${plan.name}」吗？`)) {
      try {
        await apiClient.delete(`/billing/plans/${plan.id}`);
        setPlans((current) => current.filter((p) => p.id !== plan.id));
        if (selectedPlanId === plan.id) {
          closeModal();
        }
        showMessage('success', '套餐已删除。');
      } catch (error) {
        showMessage('error', `删除失败: ${error.message || '未知错误'}`);
      }
    }
  };

  const savePlan = async (event) => {
    event.preventDefault();
    if (!editingPlan) return;

    if (!(editingPlan.planCode || '').trim()) {
      alert('请輸入套餐代碼');
      return;
    }
    if (!(editingPlan.name || '').trim()) {
      alert('请輸入套餐名稱');
      return;
    }

    const nextPlan = {
      ...editingPlan,
      planCode: (editingPlan.planCode || '').trim().toLowerCase(),
      name: (editingPlan.name || '').trim(),
      description: (editingPlan.description || '').trim(),
      featureSummary: (editingPlan.featureSummary || '').trim(),
      accountQuantity: Number(editingPlan.accountQuantity || 100),
      addonServices: (editingPlan.addonServices || '').split(',').map(s => s.trim()).filter(Boolean).join(', '),
    };

    setIsSaving(true);
    showMessage('', '');
    try {
      if (editingPlan.id === null) {
        await apiClient.post('/billing/plans', nextPlan);
        showMessage('success', '套餐已成功创建。');
      } else {
        await apiClient.put(`/billing/plans/${nextPlan.id}`, nextPlan);
        showMessage('success', '套餐已成功保存。');
      }
      if (isAddPage) {
        onReturnToList?.();
      } else {
        closeModal();
        loadPlans({ silent: true });
      }
    } catch (error) {
      showMessage('error', error.message || '保存失败，请稍后再试。');
    } finally {
      setIsSaving(false);
    }
  };

  const closeModal = () => {
    setShowDetailModal(false);
    setSelectedPlanId(null);
    setEditingPlan(null);
  };

  const isDetails = modalMode === 'details';

  return (
    <>
      <style>{`
        /* --- 全局字体与平滑 --- */
        #plans {
          -webkit-font-smoothing: antialiased;
          color: #334155;
        }
        
        /* --- 表格头部排版 --- */
        #plans .billing-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        #plans .billing-table thead tr {
          background-color: #f8fafc;
        }
        #plans .billing-table th {
          height: 56px !important;
          padding: 0 22px !important;
          color: #64748b !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }
        
        /* --- 表格内容排版 --- */
        #plans .billing-table td {
          height: 64px !important;
          padding: 0 22px !important;
          color: #334155 !important;
          font-size: 12px !important;
          border-bottom: 1px solid #e2e8f0 !important;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 200px;
        }
        #plans .billing-table tbody tr {
          transition: background-color 0.2s ease;
        }
        #plans .billing-table tbody tr:hover {
          background-color: #f8fafc;
        }
        
        /* 状态徽章排版 */
        #plans .billing-table .status-badge {
          font-size: 12px !important;
          font-weight: 600 !important;
          letter-spacing: 0.025em;
          padding: 4px 10px !important;
          border-radius: 9999px;
        }
        #plans .billing-table .status-active {
          background-color: #dcfce7 !important;
          color: #166534 !important;
        }
        #plans .billing-table .status-disabled {
          background-color: #f1f5f9 !important;
          color: #64748b !important;
        }
        
        /* --- 分页資訊排版 --- */
        #plans .pagination-info {
          font-size: 13px !important;
          font-weight: 500;
          color: #64748b !important;
        }
        #plans .pagination-info b {
          color: #0f172a;
          font-weight: 600;
        }
        #plans .pagination-actions button {
          font-size: 13px !important;
          font-weight: 500 !important;
        }
        
        #plans .dropdown-menu {
          position: absolute;
          right: 0;
          top: 100%;
          margin-top: 4px;
          background-color: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          z-index: 9999;
          min-width: 100px;
          display: flex;
          flex-direction: column;
          padding: 4px 0;
        }
        .dropdown-menu-portal {
          position: fixed;
          background-color: #fff;
          border: 1px solid #d1d5db;
          border-radius: 10px;
          box-shadow: 0 20px 32px rgba(15, 23, 42, 0.12);
          z-index: 2147483647;
          min-width: 160px;
          display: flex;
          flex-direction: column;
          padding: 8px 0;
          right: auto;
          margin-top: 0;
        }
        .dropdown-menu-portal .dropdown-item {
          padding: 10px 16px;
          font-size: 14px;
          color: #1f2937;
          background: transparent;
          border: none;
          text-align: left;
          width: 100%;
        }
        .dropdown-menu-portal .dropdown-item:hover {
          background-color: #f8fafc;
        }
        .dropdown-menu-portal .dropdown-item.dropdown-item-danger {
          color: #dc2626;
        }
        #plans .dropdown-item {
          padding: 8px 16px;
          text-align: left;
          background: none;
          border: none;
          font-size: 14px;
          color: #334155;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        #plans .dropdown-item:hover {
          background-color: #f1f5f9;
        }
        #plans .dropdown-item-danger {
          color: #ef4444;
        }
        #plans .dropdown-item-danger:hover {
          background-color: #fef2f2;
        }
        
        /* --- 模态窗(编辑新增)排版 --- */
        #plans .modal-content {
          border-radius: 12px;
          background-color: #ffffff;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
          padding: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          max-height: 90vh;
        }
        #plans .modal-header {
          padding: 20px 24px;
          border-bottom: 1px solid #e2e8f0;
          background-color: #f8fafc;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        #plans .modal-header h3 {
          font-size: 18px;
          font-weight: 600;
          color: #0f172a;
          margin: 0;
        }
        #plans .modal-close {
          background: none;
          border: none;
          font-size: 24px;
          line-height: 1;
          color: #64748b;
          cursor: pointer;
          padding: 0 4px;
        }
        #plans .modal-close:hover {
          color: #0f172a;
        }
        #plans .modal-body {
          padding: 24px;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
        }
        #plans .form-grid label {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        #plans .form-grid label span {
          font-size: 13px;
          font-weight: 600;
          color: #475569;
        }
        #plans .form-grid input,
        #plans .form-grid select {
          font-size: 14px;
          color: #0f172a;
          padding: 10px 12px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          background-color: #fff;
          transition: border-color 0.2s, box-shadow 0.2s;
          height: 40px;
          box-sizing: border-box;
        }
        #plans .form-grid input:focus,
        #plans .form-grid select:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
          outline: none;
        }
        
        #plans .form-grid input[readonly],
        #plans .form-grid select:disabled,
        #plans .form-grid input[type="checkbox"]:disabled {
          background-color: #f8fafc;
          color: #64748b;
          cursor: not-allowed;
          border-color: #e2e8f0;
        }
        #plans .form-grid input[readonly]:focus,
        #plans .form-grid select:disabled:focus {
          box-shadow: none;
          border-color: #e2e8f0;
        }
        
        /* 模态窗-定价规则区域排版 */
        #plans .modal-section {
          margin-top: 24px;
          padding-top: 24px;
          border-top: 1px solid #e2e8f0;
        }
        #plans .modal-section h4 {
          font-size: 15px;
          font-weight: 600;
          color: #1e293b;
          margin: 0 0 16px 0;
        }
        #plans .price-tier-item {
          padding: 12px 16px;
          background-color: #f8fafc;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        #plans .price-tier-item div {
          display: flex;
          width: 100%;
          justify-content: space-between;
          align-items: center;
        }
        #plans .price-tier-item strong {
          font-size: 14px;
          font-weight: 600;
          color: #0f172a;
        }
        #plans .price-tier-item span {
          font-size: 14px;
          font-weight: 600;
          color: #3b82f6;
          font-variant-numeric: tabular-nums;
        }
        #plans .modal-footer {
          padding: 16px 24px 24px;
          border-top: 1px solid #e2e8f0;
          background-color: #f8fafc;
          display: flex;
          justify-content: flex-end;
          gap: 12px;
        }

        /* === Dark theme overrides === */
        #plans .billing-table { background: #111827; border-color: #1f2937; }
        #plans .billing-table { color: #e5e7eb; }
        #plans .billing-table thead th { background: #1a2332; color: #e5e7eb; border-bottom-color: #1f2937; }
        #plans .billing-table tbody td { color: #e5e7eb !important; border-bottom-color: #1f2937; }
        #plans .billing-table tbody td strong,
        #plans .billing-table tbody td small,
        #plans .billing-table tbody td span { color: inherit; }
        #plans .billing-table-wrap { background: #111827; }
        #plans .billing-table td:last-child,
        #console #plans .billing-table td:last-child { background: #111827; box-shadow: -8px 0 14px rgba(0,0,0,0.3); }
        #plans .billing-table th:last-child,
        #console #plans .billing-table th:last-child { background: #1a2332; }
        #plans .billing-table tbody tr { background: #111827; }
        #plans .billing-table tbody tr:hover { background: #1e293b; }
        #plans .billing-table .status-active { background: #0d2818 !important; color: #4ade80 !important; }
        #plans .billing-table .status-disabled { background: #1f2937 !important; color: #9ca3af !important; }
        #plans .pagination-info { color: #9ca3af !important; }
        #plans .pagination-info b { color: #f3f4f6; }
        #plans .dropdown-menu { background: #1e293b; border-color: #374151; }
        #plans .dropdown-item { color: #d1d5db; }
        #plans .dropdown-item:hover { background: #374151; }
        #plans .dropdown-item-danger:hover { background: #3b1111; }
        .dropdown-menu-portal { background: #1e293b; border-color: #374151; }
        .dropdown-menu-portal .dropdown-item { color: #d1d5db; }
        .dropdown-menu-portal .dropdown-item:hover { background: #374151; }
        #plans .modal-content { background: #111827; }
        #plans .modal-header { background: #1a2332; border-bottom-color: #1f2937; }
        #plans .modal-header h3 { color: #f3f4f6; }
        #plans .modal-close { color: #9ca3af; }
        #plans .modal-close:hover { color: #f3f4f6; }
        #plans .modal-body { background: #111827; }
        #plans .modal-footer { background: #111827; border-top-color: #1f2937; }
        #plans .form-grid label span { color: #9ca3af; }
        #plans .price-tier-item { background: #1a2332; border-color: #374151; }
        #plans .price-tier-item strong { color: #f3f4f6; }
        #plans .price-tier-item span { color: #60a5fa; }
        #plans .settings-block { background: #111827; border-color: #1f2937; }
        #plans .settings-block-head h3 { color: #f3f4f6; }
        #plans .field-label { color: #d1d5db; }
        #plans input, #plans select, #plans textarea { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #console #plans .tenant-settings-form input,
        #console #plans .tenant-settings-form select,
        #console #plans .tenant-settings-form textarea { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #console #plans .form-grid input,
        #console #plans .form-grid select,
        #console #plans .form-grid textarea { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #plans input:focus, #plans select:focus, #plans textarea:focus { border-color: #3b82f6; }
        #console #plans .tenant-settings-form input:focus,
        #console #plans .tenant-settings-form select:focus,
        #console #plans .tenant-settings-form textarea:focus { border-color: #3b82f6; }
        #console #plans .form-grid input:focus,
        #console #plans .form-grid select:focus,
        #console #plans .form-grid textarea:focus { border-color: #3b82f6; }
        #plans input::placeholder { color: #6b7280; }
        #plans .tenant-fixed-actions { background: #111827; border-top-color: #1f2937; }
        #plans .ghost-btn { background: #374151; color: #d1d5db; border: 1px solid #4b5563; border-radius: 8px; }
        #plans .ghost-btn:hover { background: #4b5563; color: #f3f4f6; }
        #plans .form-message { color: #d1d5db; }
        #plans .form-message.error { background: #3b1111; color: #ef4444; }
        #plans .form-message.success { background: #0d2818; color: #22c55e; }
        #plans .billing-table-wrap,
        #plans .form-grid,
        #plans .modal-body { scrollbar-width: none; }
        #plans .billing-table-wrap::-webkit-scrollbar,
        #plans .form-grid::-webkit-scrollbar,
        #plans .modal-body::-webkit-scrollbar { display: none; }
      `}</style>
      <section className="view active settings-form-page" id="plans" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="tenant-settings-form" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#111827', borderColor: '#1f2937' }}>
        <div className="tenant-scroll-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#111827' }}>
          {isAddPage ? (
            <section className="settings-block" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <form onSubmit={savePlan} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div className="form-grid" style={{ flex: 1, overflowY: 'auto', paddingRight: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignContent: 'start', alignItems: 'start' }}>
                <div style={{ display: 'grid', gap: '16px' }}>
                  <label style={{ display: 'grid', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#9ca3af' }}>套餐代碼<RequiredMark /></span>
                    <input
                      value={editingPlan?.planCode || ''}
                      onChange={(e) => setEditingPlan({
                        ...editingPlan,
                        planCode: e.target.value,
                      })}
                      placeholder="pro"
                    />
                  </label>
                  <label style={{ display: 'grid', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#9ca3af' }}>套餐名稱<RequiredMark /></span>
                    <input
                      value={editingPlan?.name || ''}
                      onChange={(e) => setEditingPlan({
                        ...editingPlan,
                        name: e.target.value,
                      })}
                      placeholder="Pro"
                    />
                  </label>
                  <label style={{ display: 'grid', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#9ca3af' }}>帳戶數量<RequiredMark /></span>
                    <input
                      type="number"
                      min="1"
                      value={editingPlan?.accountQuantity || 100}
                      onChange={(e) => setEditingPlan({
                        ...editingPlan,
                        accountQuantity: Number(e.target.value),
                      })}
                    />
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <label style={{ display: 'grid', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#9ca3af' }}>狀態<RequiredMark /></span>
                      <select
                        value={editingPlan?.status || 'active'}
                        onChange={(e) => setEditingPlan({
                          ...editingPlan,
                          status: e.target.value,
                        })}
                      >
                        <option value="active">啟用</option>
                        <option value="disabled">停用</option>
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#9ca3af' }}>排序<RequiredMark /></span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={editingPlan?.sortOrder || 10}
                        onChange={(e) => setEditingPlan({
                          ...editingPlan,
                          sortOrder: Number(e.target.value),
                        })}
                      />
                    </label>
                  </div>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    <label style={{ display: 'grid', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#9ca3af' }}>增值服務列表</span>
                      <input
                        value={editingPlan?.addonServices || ''}
                        onChange={(e) => setEditingPlan({
                          ...editingPlan,
                          addonServices: e.target.value,
                        })}
                        placeholder="輸入增值服務代碼，用逗號分隔"
                      />
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', paddingLeft: '4px' }}>
                      {availableAddons.length === 0 ? (
                        <span style={{ fontSize: '13px', color: '#94a3b8' }}>暫無增值服务项目</span>
                      ) : availableAddons.map(addon => {
                        const currentAddons = (editingPlan?.addonServices || '').split(',').map(s => s.trim()).filter(Boolean);
                        const isChecked = currentAddons.includes(addon.addonCode);
                        return (
                          <label key={addon.addonCode} title={`${addon.name} - ${addon.description}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexDirection: 'row', cursor: 'pointer', minWidth: 0 }}>
                            <input 
                              type="checkbox" 
                              checked={isChecked}
                              onChange={(e) => {
                                let newAddons = [...currentAddons];
                                if (e.target.checked) {
                                  if (!newAddons.includes(addon.addonCode)) newAddons.push(addon.addonCode);
                                } else {
                                  newAddons = newAddons.filter(code => code !== addon.addonCode);
                                }
                                setEditingPlan({
                                  ...editingPlan,
                                  addonServices: newAddons.join(', ')
                                });
                              }}
                              style={{ width: 'auto', height: 'auto', margin: 0, padding: 0, flexShrink: 0 }}
                            />
                            <span style={{ fontSize: '13px', fontWeight: 400, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{addon.name} - {addon.description}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gap: '16px' }}>
                  <label style={{ display: 'grid', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#9ca3af' }}>描述</span>
                    <input
                      value={editingPlan?.description || ''}
                      onChange={(e) => setEditingPlan({
                        ...editingPlan,
                        description: e.target.value,
                      })}
                      placeholder="Entry plan for small teams"
                    />
                  </label>
                  <label style={{ display: 'grid', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#9ca3af' }}>功能摘要</span>
                    <input
                      value={editingPlan?.featureSummary || ''}
                      onChange={(e) => setEditingPlan({
                        ...editingPlan,
                        featureSummary: e.target.value,
                      })}
                      placeholder="標準通訊功能"
                    />
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <label style={{ display: 'grid', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#9ca3af' }}>單價/月<RequiredMark /></span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editingPlan?.priceTiers?.[0]?.unitPrice ?? 0}
                        onChange={(e) => {
                          const newPrice = Number(e.target.value);
                          setEditingPlan(p => {
                              const newTiers = [...(p.priceTiers || [])];
                              if (newTiers.length > 0) {
                                  newTiers[0] = { ...newTiers[0], unitPrice: newPrice };
                              }
                              return { ...p, priceTiers: newTiers };
                          });
                        }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#9ca3af' }}>幣種<RequiredMark /></span>
                      <select
                        value={editingPlan?.priceTiers?.[0]?.currency || 'TWD'}
                        onChange={(e) => {
                          const newCurrency = e.target.value;
                          setEditingPlan(p => {
                              const newTiers = [...(p.priceTiers || [])];
                              if (newTiers.length > 0) {
                                  newTiers[0] = { ...newTiers[0], currency: newCurrency };
                              }
                              return { ...p, priceTiers: newTiers };
                          });
                        }}
                      >
                        {currencyOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
                </div>

                <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px', paddingTop: '16px', paddingBottom: '32px', borderTop: '1px solid #1f2937', backgroundColor: '#111827' }}>
                  {message.text && <p className={`form-message ${message.type}`} style={{ marginRight: 'auto', alignSelf: 'center', margin: 0, padding: 0, background: 'transparent' }}>{message.text}</p>}
                  <button className="ghost-btn" type="button" onClick={() => onReturnToList?.()} disabled={isSaving}>取消</button>
                  <button className="primary-btn" type="submit" disabled={isSaving}>{isSaving ? '建立中...' : '建立套餐'}</button>
                </div>
              </form>
            </section>
          ) : (
            <section className="settings-block" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {message.text && <p className={`form-message ${message.type}`}>{message.text}</p>}
            <div className="payment-method-filter" style={{ flexShrink: 0, display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '20px', backgroundColor: '#1a2332', padding: '12px 16px', borderRadius: '8px', border: '1px solid #1f2937', boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)' }}>
              <label className="payment-method-search" style={{ position: 'relative', width: '260px', flex: '0 0 260px' }}>
                <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} aria-hidden="true" />
                <input
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 36px 10px 40px', border: '1px solid #374151', borderRadius: '6px', fontSize: '12px', fontWeight: 400, color: '#e5e7eb', backgroundColor: '#0f172a', outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s', boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.05)' }}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜尋套餐 ID、代碼或名稱..."
                  onFocus={(e) => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#cbd5e1'; e.target.style.boxShadow = 'inset 0 1px 2px rgba(0, 0, 0, 0.05)'; }}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: '#374151', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '4px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background-color 0.2s' }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#4b5563'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#374151'}
                    aria-label="清除搜尋"
                    title="清除"
                  >
                    <X size={14} strokeWidth={2.5} />
                  </button>
                )}
              </label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                aria-label="筛选状态"
                style={{ padding: '10px 32px 10px 16px', border: '1px solid #374151', borderRadius: '6px', fontSize: '12px', backgroundColor: '#0f172a', outline: 'none', cursor: 'pointer', transition: 'all 0.2s ease', color: '#e5e7eb', appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', backgroundSize: '16px 16px' }}
                onFocus={(e) => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)'; }}
                onBlur={(e) => { e.target.style.borderColor = '#374151'; e.target.style.boxShadow = 'none'; }}
              >
                <option value="all">全部狀態</option>
                <option value="active">啟用</option>
                <option value="disabled">停用</option>
              </select>
              <div className="plan-stats" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', flex: 1, whiteSpace: 'nowrap' }}>
                {[
                  ['全部', planStats.total],
                  ['已啟用', planStats.active],
                  ['已停用', planStats.disabled],
                ].map(([label, value]) => (
                  <span key={label} style={{ height: '34px', padding: '0 12px', borderRadius: '999px', backgroundColor: '#1a2332', border: '1px solid #374151', color: '#9ca3af', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '5px', boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)' }}>{label}<strong style={{ color: '#f3f4f6', fontSize: '13px', fontWeight: 700 }}>{value}</strong></span>
                ))}
              </div>
            </div>

            {/* 表格 */}
            <div className="table-wrap billing-table-wrap" style={{ flex: 1, overflowY: 'auto' }}>
              <table className="billing-table">
                <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
                  <tr>
                    <th style={{ width: '50px', textAlign: 'center', padding: 0 }}>
                      <input
                        type="checkbox"
                        checked={isCurrentPageSelected}
                        onChange={(e) => toggleCurrentPageSelection(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                        aria-label="全选当前页"
                      />
                    </th>
                    <th>ID</th>
                    <th>套餐代碼</th>
                    <th>套餐名稱</th>
                    <th>狀態</th>
                    <th>帳戶數量</th>
                    <th>基礎價格</th>
                    <th>功能摘要</th>
                    <th style={{ width: '110px', textAlign: 'center' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '200px', color: '#9ca3af', fontSize: '14px' }}>載入中...</div>
              ) : paginatedPlans.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '200px', color: '#9ca3af', fontSize: '14px' }}>
                  {query || filterStatus !== 'all' ? '未找到匹配的套餐' : '尚未新增任何套餐'}
                </div>
              ) : (
                paginatedPlans.map((plan, index) => (
                      <tr key={plan.id} className={plan.status === 'disabled' ? 'disabled-row' : ''}>
                        <td style={{ width: '50px', textAlign: 'center', padding: 0 }}>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(plan.id)}
                            onChange={(e) => togglePlanSelection(plan.id, e.target.checked)}
                            style={{ cursor: 'pointer' }}
                            aria-label={`選擇套餐 ${plan.name}`}
                          />
                        </td>
                        <td>#{plan.id}</td>
                        <td className="code-cell">
                          <span>{plan.planCode}</span>
                        </td>
                        <td>{plan.name}</td>
                        <td className="status-cell">
                          <span className={`status-badge status-${plan.status}`}>
                            {statusText(plan.status)}
                          </span>
                        </td>
                        <td className="number-cell">{plan.accountQuantity}</td>
                        <td className="price-cell">{getBasePriceText(plan)}</td>
                        <td className="feature-cell">{plan.featureSummary || '-'}</td>
                        <td className="actions-cell" style={{ textAlign: 'center', padding: '0 12px', width: '110px' }}>
                          <div className="row-actions dropdown-container" style={{ display: 'flex', gap: '4px', justifyContent: 'center', whiteSpace: 'nowrap' }}>
                            <button
                              className="ghost-btn"
                              type="button"
                              style={{ fontSize: '12px', padding: '6px 10px' }}
                              onClick={() => handleDetails(plan)}
                            >
                              详情
                            </button>
                            <button
                              className="ghost-btn"
                              type="button"
                              style={{ fontSize: '12px', padding: '6px 10px' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                const button = e.currentTarget;
                                dropdownAnchorRef.current = button;
                                const rect = button.getBoundingClientRect();
                                setDropdownPosition({
                                  top: rect.bottom + 4,
                                  left: rect.left,
                                  right: rect.right,
                                  bottom: rect.top,
                                  width: rect.width,
                                });
                                setOpenDropdownId((current) => (current === plan.id ? null : plan.id));
                              }}
                            >
                              更多
                            </button>
                            {openDropdownId === plan.id ? createPortal(
                              <div
                                ref={dropdownMenuRef}
                                className="dropdown-menu-portal"
                                style={{
                                  top: dropdownPosition.top,
                                  left: dropdownPosition.left,
                                  zIndex: 2147483647,
                                }}
                              >
                                <button type="button" className="dropdown-item" onClick={() => { handleDetails(plan); setOpenDropdownId(null); }}>详情</button>
                                <button type="button" className="dropdown-item" onClick={() => { handleEdit(plan); setOpenDropdownId(null); }}>编辑</button>
                                <button type="button" className="dropdown-item" onClick={(e) => { handleToggleStatus(plan, e); setOpenDropdownId(null); }}>{plan.status === 'active' ? '停用' : '启用'}</button>
                                <button type="button" className="dropdown-item dropdown-item-danger" onClick={(e) => { handleDelete(plan, e); setOpenDropdownId(null); }}>刪除</button>
                              </div>,
                              document.body
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* 分页控制 */}
            {filteredPlans.length > 0 && (
              <div className="device-table-footer" style={{ minHeight: '74px', padding: '0 30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111827', borderTop: '1px solid #1f2937' }}>
                <div className="device-total" style={{ color: '#9ca3af', fontSize: '12px' }}>
                  共 {filteredPlans.length} 條
                </div>
                <div className="device-pagination" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <select className="device-page-size" value={pageSize} onChange={(e) => { const v = e.target.value; setPageSize(v === "全部" ? "全部" : Number(v)); setCurrentPage(1); }} style={{ height: "38px", padding: "0 14px", borderRadius: "8px", border: "1px solid #4b5563", backgroundColor: "#1a2332", color: "#9ca3af", fontSize: "11px", cursor: "pointer" }}>{pageSizeOptions.map(opt => <option key={opt} value={opt}>{opt === "全部" ? "全部" : opt + " 條/頁"}</option>)}</select>
                  <button
                    className="device-page-btn"
                    type="button"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    style={{ width: '38px', height: '38px', borderRadius: '8px', border: '1px solid #4b5563', backgroundColor: currentPage <= 1 ? '#1a2332' : '#1f2937', color: currentPage <= 1 ? '#4b5563' : '#9ca3af', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', lineHeight: 1, cursor: currentPage <= 1 ? 'not-allowed' : 'pointer', padding: 0 }}
                  >
                    ‹
                  </button>
                  <span className="device-page-current" style={{ width: '38px', height: '38px', borderRadius: '8px', border: '1px solid #3b82f6', backgroundColor: '#1e3a5f', color: '#60a5fa', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 600 }}>{currentPage}</span>
                  <button
                    className="device-page-btn"
                    type="button"
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    style={{ width: '38px', height: '38px', borderRadius: '8px', border: '1px solid #4b5563', backgroundColor: currentPage >= totalPages ? '#1a2332' : '#1f2937', color: currentPage >= totalPages ? '#4b5563' : '#9ca3af', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', lineHeight: 1, cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer', padding: 0 }}
                  >
                    ›
                  </button>
                </div>
              </div>
            )}
            </section>
          )}
        </div>
      </div>

      {/* 详情/编辑模态框 */}
      {showDetailModal && editingPlan && (
        <div className="modal-overlay" onClick={closeModal} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '640px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', backgroundColor: '#fff', borderRadius: '12px', overflow: 'hidden' }}>
            <form onSubmit={savePlan} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div className="modal-header" style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>{modalMode === 'add' ? '新增套餐' : modalMode === 'edit' ? '編輯套餐' : '套餐詳情'}</h3>
                <button
                  className="modal-close"
                  type="button"
                  onClick={closeModal}
                  aria-label="关闭"
                >
                  ×
                </button>
              </div>

              <div className="modal-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px' }}>
                <div className="form-grid">
                  <label>
                    <span>套餐代碼<RequiredMark /></span>
                    <input
                      value={editingPlan.planCode}
                      onChange={(e) =>
                        setEditingPlan({
                          ...editingPlan,
                          planCode: e.target.value,
                        })
                      }
                      placeholder="pro"
                      readOnly={isDetails}
                    />
                  </label>
                  <label>
                    <span>套餐名稱<RequiredMark /></span>
                    <input
                      value={editingPlan.name}
                      onChange={(e) =>
                        setEditingPlan({
                          ...editingPlan,
                          name: e.target.value,
                        })
                      }
                      placeholder="Pro"
                      readOnly={isDetails}
                    />
                  </label>
                  <label className="span-2">
                    <span>描述</span>
                    <input
                      value={editingPlan.description}
                      onChange={(e) =>
                        setEditingPlan({
                          ...editingPlan,
                          description: e.target.value,
                        })
                      }
                      placeholder="Entry plan for small teams"
                      readOnly={isDetails}
                    />
                  </label>
                  <label>
                    <span>帳戶數量<RequiredMark /></span>
                    <input
                      type="number"
                      min="1"
                      value={editingPlan.accountQuantity}
                      onChange={(e) =>
                        setEditingPlan({
                          ...editingPlan,
                          accountQuantity: Number(e.target.value),
                        })
                      }
                      readOnly={isDetails}
                    />
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <label>
                      <span>單價/月<RequiredMark /></span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editingPlan.priceTiers?.[0]?.unitPrice ?? 0}
                        onChange={(e) => {
                          const newPrice = Number(e.target.value);
                          setEditingPlan(p => {
                              const newTiers = [...(p.priceTiers || [])];
                              if (newTiers.length > 0) {
                                  newTiers[0] = { ...newTiers[0], unitPrice: newPrice };
                              }
                              return { ...p, priceTiers: newTiers };
                          });
                        }}
                        readOnly={isDetails}
                      />
                    </label>
                    <label>
                      <span>幣種<RequiredMark /></span>
                      <select
                        value={editingPlan.priceTiers?.[0]?.currency || 'TWD'}
                        onChange={(e) => {
                          const newCurrency = e.target.value;
                          setEditingPlan(p => {
                              const newTiers = [...(p.priceTiers || [])];
                              if (newTiers.length > 0) {
                                  newTiers[0] = { ...newTiers[0], currency: newCurrency };
                              }
                              return { ...p, priceTiers: newTiers };
                          });
                        }}
                        disabled={isDetails}
                      >
                        {currencyOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    <span>功能摘要</span>
                    <input
                      value={editingPlan.featureSummary}
                      onChange={(e) =>
                        setEditingPlan({
                          ...editingPlan,
                          featureSummary: e.target.value,
                        })
                      }
                      placeholder="標準通訊功能"
                      readOnly={isDetails}
                    />
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <label>
                      <span>狀態<RequiredMark /></span>
                      <select
                        value={editingPlan.status}
                        onChange={(e) =>
                          setEditingPlan({
                            ...editingPlan,
                            status: e.target.value,
                          })
                        }
                        disabled={isDetails}
                      >
                        <option value="active">啟用</option>
                        <option value="disabled">停用</option>
                      </select>
                    </label>
                    <label>
                      <span>排序<RequiredMark /></span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={editingPlan.sortOrder}
                        onChange={(e) =>
                          setEditingPlan({
                            ...editingPlan,
                            sortOrder: Number(e.target.value),
                          })
                        }
                        readOnly={isDetails}
                      />
                    </label>
                  </div>
                  <div className="span-2" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label>
                      <span>增值服務列表</span>
                      <input
                        value={editingPlan.addonServices || ''}
                        onChange={(e) =>
                          setEditingPlan({
                            ...editingPlan,
                            addonServices: e.target.value,
                          })
                        }
                        placeholder="輸入增值服務代碼，用逗號分隔"
                        readOnly={isDetails}
                      />
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', paddingLeft: '4px', marginTop: '4px' }}>
                      {availableAddons.length === 0 ? (
                        <span style={{ fontSize: '13px', color: '#94a3b8' }}>暫無增值服务项目</span>
                      ) : availableAddons.map(addon => {
                        const currentAddons = (editingPlan?.addonServices || '').split(',').map(s => s.trim()).filter(Boolean);
                        const isChecked = currentAddons.includes(addon.addonCode);
                        return (
                          <label key={addon.addonCode} title={`${addon.name} - ${addon.description}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexDirection: 'row', cursor: 'pointer', minWidth: 0 }}>
                            <input 
                              type="checkbox" 
                              checked={isChecked}
                              onChange={(e) => {
                                let newAddons = [...currentAddons];
                                if (e.target.checked) {
                                  if (!newAddons.includes(addon.addonCode)) newAddons.push(addon.addonCode);
                                } else {
                                  newAddons = newAddons.filter(code => code !== addon.addonCode);
                                }
                                setEditingPlan({
                                  ...editingPlan,
                                  addonServices: newAddons.join(', ')
                                });
                              }}
                              style={{ width: 'auto', height: 'auto', flex: 'none', margin: 0, flexShrink: 0 }}
                              disabled={isDetails}
                            />
                            <span style={{ fontSize: '13px', fontWeight: 400, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{addon.name} - {addon.description}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {isDetails && <div style={{ height: '32px', flexShrink: 0 }} aria-hidden="true" />}
              </div>

              {!isDetails && (
                <div className="modal-footer" style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid #e2e8f0', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  {message.text && <p className={`form-message ${message.type}`} style={{ marginRight: 'auto', alignSelf: 'center' }}>{message.text}</p>}
                  <button className="ghost-btn" type="button" onClick={closeModal} disabled={isSaving}>
                    取消
                  </button>
                  <button className="primary-btn" type="submit" disabled={isSaving}>
                    {isSaving ? '保存中...' : (editingPlan.id === null ? '创建套餐' : '保存修改')}
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </section>
    </>
  );
});

export default Plans;
