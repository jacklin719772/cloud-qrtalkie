import React, { forwardRef, useState, useEffect, useMemo, useRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import apiClient from './apiClient';

// 代理商名錄（登记表）：参照租户管理页结构（列表 + 页头新增 + 表单视图 + 详情弹窗 + 状态启停）
// 银行账号为纯登记用途：列表/详情脱敏（尾 4 位），编辑回填完整值；不提供删除（只停用不删除）

function RequiredMark() {
  return <span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

const emptyForm = {
  name: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  notes: '',
  payeeName: '',
  bankName: '',
  bankBranch: '',
  bankAccountNo: '',
  swiftCode: '',
};

export default forwardRef(function AgentsDirectory(props, ref) {
  const [agents, setAgents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedAgentDetails, setSelectedAgentDetails] = useState(null);

  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'add' | 'edit'
  const [addForm, setAddForm] = useState({ ...emptyForm });
  const [addMessage, setAddMessage] = useState({ type: '', text: '' });
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const dropdownAnchorRef = useRef(null);
  const messageTimerRef = useRef(null);
  const dropdownMenuRef = useRef(null);

  useImperativeHandle(ref, () => ({
    startAdd,
    get viewMode() { return viewMode; },
  }));

  function startAdd() {
    setViewMode('add');
    setEditingId(null);
    setAddForm({ ...emptyForm });
    setAddMessage({ type: '', text: '' });
  }

  const showAddMessage = (type, text) => {
    setAddMessage({ type, text });
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    if (text) {
      messageTimerRef.current = window.setTimeout(() => {
        setAddMessage({ type: '', text: '' });
        messageTimerRef.current = null;
      }, 5000);
    }
  };

  const updateAddField = (field) => (event) => {
    setAddForm((current) => ({ ...current, [field]: event.target.value }));
  };

  useEffect(() => {
    loadAgents();
  }, []);

  async function loadAgents() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.get('/admin/agents');
      setAgents(Array.isArray(data?.agents) ? data.agents : []);
    } catch (err) {
      console.error('Failed to load agents:', err);
      setError(err.message || '無法載入代理商名錄');
      setAgents([]);
    } finally {
      setIsLoading(false);
    }
  }

  const filteredAgents = agents.filter((agent) => {
    const keyword = searchKeyword.toLowerCase();
    const matchesSearch = !searchKeyword
      || (agent.name && agent.name.toLowerCase().includes(keyword))
      || (agent.contactName && agent.contactName.toLowerCase().includes(keyword))
      || (agent.contactPhone && agent.contactPhone.toLowerCase().includes(keyword))
      || (agent.contactEmail && agent.contactEmail.toLowerCase().includes(keyword));

    let matchesStatus = true;
    if (statusFilter === 'active') matchesStatus = agent.status === 'active';
    else if (statusFilter === 'disabled') matchesStatus = agent.status !== 'active';

    return matchesSearch && matchesStatus;
  });

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      active: { label: '啟用中', className: 'status-active' },
      disabled: { label: '已停用', className: 'status-inactive' },
    };
    const statusInfo = statusMap[status] || { label: status || '未知', className: '' };
    return <span className={`status-badge ${statusInfo.className}`}>{statusInfo.label}</span>;
  };

  const stats = useMemo(() => {
    let active = 0;
    let disabled = 0;
    let withBank = 0;
    agents.forEach((agent) => {
      if (agent.status === 'active') active += 1;
      else disabled += 1;
      if (agent.hasBankAccount) withBank += 1;
    });
    return { total: agents.length, active, disabled, withBank };
  }, [agents]);

  // Pagination & Sorting（与租户管理页同款）
  const pageSizeOptions = [10, 20, 50, '全部'];
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const sortedFilteredAgents = useMemo(() => {
    const sortableItems = [...filteredAgents];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        const aVal = String(a[sortConfig.key] || '').toLowerCase();
        const bVal = String(b[sortConfig.key] || '').toLowerCase();
        const result = aVal.localeCompare(bVal, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
        return sortConfig.direction === 'asc' ? result : -result;
      });
    }
    return sortableItems;
  }, [filteredAgents, sortConfig]);

  const effectivePageSize = pageSize === '全部' ? sortedFilteredAgents.length || 1 : pageSize;
  const totalPages = Math.max(1, Math.ceil(sortedFilteredAgents.length / effectivePageSize));
  const paginatedAgents = sortedFilteredAgents.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);

  useEffect(() => {
    setCurrentPage(1);
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

  // Dropdown 定位与外部点击关闭（与租户管理页同款）
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.agent-dropdown-container') && !e.target.closest('.dropdown-menu-portal')) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!openDropdownId || !dropdownAnchorRef.current) return undefined;
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

  const handleDetails = (agent) => {
    setSelectedAgentDetails(agent);
    setDetailsModalOpen(true);
    setOpenDropdownId(null);
  };

  const handleEdit = async (agent) => {
    setOpenDropdownId(null);
    try {
      const data = await apiClient.get(`/admin/agents/${agent.id}`);
      const a = data.agent || {};
      setAddForm({
        name: a.name || '',
        contactName: a.contactName || '',
        contactPhone: a.contactPhone || '',
        contactEmail: a.contactEmail || '',
        notes: a.notes || '',
        payeeName: a.payeeName || '',
        bankName: a.bankName || '',
        bankBranch: a.bankBranch || '',
        bankAccountNo: a.bankAccountNo || '',
        swiftCode: a.swiftCode || '',
      });
      setEditingId(a.id);
      setViewMode('edit');
      setAddMessage({ type: '', text: '' });
    } catch (err) {
      console.error(err);
      window.alert(err.message || '無法載入代理商資料');
    }
  };

  const handleToggleStatus = async (agent, e) => {
    if (e) e.stopPropagation();
    const newStatus = agent.status === 'active' ? 'disabled' : 'active';
    const actionText = newStatus === 'active' ? '啟用' : '停用';
    if (!window.confirm(`確定要${actionText}代理商「${agent.name}」嗎？`)) return;
    try {
      await apiClient.put(`/admin/agents/${agent.id}/status`, { status: newStatus });
      setAgents((current) => current.map((a) => (a.id === agent.id ? { ...a, status: newStatus } : a)));
    } catch (err) {
      console.error('Failed to update agent status:', err);
      window.alert(err.message || `無法${actionText}代理商`);
    }
  };

  const validateAddForm = () => {
    if (!addForm.name.trim()) return '請輸入代理商名稱。';
    if (addForm.contactEmail.trim() && !isValidEmail(addForm.contactEmail.trim())) return '請輸入有效的聯絡信箱。';
    return null;
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    const validationError = validateAddForm();
    if (validationError) {
      showAddMessage('error', validationError);
      return;
    }
    setIsAdding(true);
    showAddMessage('', '');
    try {
      const payload = {
        name: addForm.name.trim(),
        contactName: addForm.contactName.trim(),
        contactPhone: addForm.contactPhone.trim(),
        contactEmail: addForm.contactEmail.trim(),
        notes: addForm.notes.trim(),
        payeeName: addForm.payeeName.trim(),
        bankName: addForm.bankName.trim(),
        bankBranch: addForm.bankBranch.trim(),
        bankAccountNo: addForm.bankAccountNo.trim(),
        swiftCode: addForm.swiftCode.trim(),
      };
      const isEdit = viewMode === 'edit';
      if (isEdit) {
        await apiClient.put(`/admin/agents/${editingId}`, payload);
      } else {
        await apiClient.post('/admin/agents', payload);
      }
      showAddMessage('success', isEdit ? '代理商資料已儲存。' : '代理商新增成功。');
      setAddForm({ ...emptyForm });
      setTimeout(() => { setViewMode('list'); loadAgents(); }, 1000);
    } catch (err) {
      showAddMessage('error', err.message || (viewMode === 'edit' ? '儲存代理商失敗。' : '新增代理商失敗。'));
    } finally {
      setIsAdding(false);
    }
  };

  if (viewMode === 'add' || viewMode === 'edit') {
    const isEdit = viewMode === 'edit';
    return (
      <section className="view active settings-form-page" id="agents-directory-add" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <style>{`
          #agents-directory-add .settings-block { background: #111827; border: 1px solid #1f2937; }
          #agents-directory-add .settings-block-head h3 { color: #f3f4f6; }
          #agents-directory-add .settings-block-head { border-bottom-color: #1f2937; }
          #agents-directory-add .field-label { color: #d1d5db; }
          #agents-directory-add .tenant-fixed-actions { background: #111827; border-top-color: #1f2937; }
          #agents-directory-add .ghost-btn { background: #374151; color: #d1d5db; border: 1px solid #4b5563; border-radius: 8px; }
          #agents-directory-add .ghost-btn:hover { background: #4b5563; color: #f3f4f6; }
          #agents-directory-add .form-message { color: #d1d5db; }
          #agents-directory-add .form-message.error { background: #3b1111; color: #ef4444; }
          #agents-directory-add .form-message.success { background: #0d2818; color: #22c55e; }
          #console #agents-directory-add .tenant-settings-form input,
          #console #agents-directory-add .tenant-settings-form textarea { background: #1a2332; border-color: #374151; color: #e5e7eb; }
          #console #agents-directory-add .tenant-settings-form input:focus,
          #console #agents-directory-add .tenant-settings-form textarea:focus { border-color: #3b82f6; }
          #console #agents-directory-add .tenant-settings-form input::placeholder,
          #console #agents-directory-add .tenant-settings-form textarea::placeholder { color: #6b7280; }
          #console #agents-directory-add .tenant-settings-form input:-webkit-autofill,
          #console #agents-directory-add .tenant-settings-form input:-webkit-autofill:hover,
          #console #agents-directory-add .tenant-settings-form input:-webkit-autofill:focus {
            -webkit-box-shadow: 0 0 0 1000px #1a2332 inset;
            -webkit-text-fill-color: #e5e7eb;
            caret-color: #e5e7eb;
          }
          #console #agents-directory-add .tenant-field-grid label { color: #d1d5db; }
        `}</style>
        <form className="tenant-settings-form" onSubmit={handleAddSubmit} style={{ background: '#111827', borderColor: '#1f2937' }}>
          <div className="tenant-scroll-area" style={{ background: '#111827' }}>
            <section className="settings-block">
              <div className="settings-block-head">
                <h3>基本資訊</h3>
              </div>
              <div className="tenant-field-grid">
                <label><span className="field-label">代理商名稱 <RequiredMark /></span><input value={addForm.name} onChange={updateAddField('name')} placeholder="請輸入代理商名稱" required /></label>
                <label>聯絡人<input value={addForm.contactName} onChange={updateAddField('contactName')} placeholder="請輸入聯絡人姓名" /></label>
                <label>聯絡電話<input type="tel" value={addForm.contactPhone} onChange={updateAddField('contactPhone')} placeholder="請輸入聯絡電話" /></label>
                <label>聯絡信箱<input type="email" value={addForm.contactEmail} onChange={updateAddField('contactEmail')} placeholder="agent@example.com" /></label>
              </div>
            </section>

            <section className="settings-block">
              <div className="settings-block-head">
                <h3>銀行帳號（僅登記用途）</h3>
              </div>
              <div className="tenant-field-grid">
                <label>開戶名<input value={addForm.payeeName} onChange={updateAddField('payeeName')} placeholder="請輸入開戶名" /></label>
                <label>開戶銀行<input value={addForm.bankName} onChange={updateAddField('bankName')} placeholder="請輸入開戶銀行" /></label>
                <label>支行<input value={addForm.bankBranch} onChange={updateAddField('bankBranch')} placeholder="請輸入支行" /></label>
                <label>銀行帳號<input value={addForm.bankAccountNo} onChange={updateAddField('bankAccountNo')} placeholder="完整帳號（列表僅顯示尾 4 位）" /></label>
                <label>SWIFT<input value={addForm.swiftCode} onChange={updateAddField('swiftCode')} placeholder="跨境打款可選填" /></label>
              </div>
            </section>

            <section className="settings-block">
              <div className="settings-block-head">
                <h3>備註</h3>
              </div>
              <div className="tenant-field-grid">
                <label className="span-2"><textarea rows="3" value={addForm.notes} onChange={updateAddField('notes')} placeholder="備註（可選）"></textarea></label>
              </div>
            </section>
          </div>

          <div className="tenant-fixed-actions" style={{ background: '#111827', borderTopColor: '#1f2937' }}>
            {addMessage.text && <p className={`form-message ${addMessage.type}`}>{addMessage.text}</p>}
            <menu className="form-actions">
              <button className="ghost-btn" type="button" onClick={() => setViewMode('list')} disabled={isAdding}>返回列表</button>
              <button className="primary-btn" type="submit" disabled={isAdding}>{isAdding ? '儲存中...' : isEdit ? '儲存修改' : '新增代理商'}</button>
            </menu>
          </div>
        </form>
      </section>
    );
  }

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
        .dropdown-menu-portal .dropdown-item:hover { background-color: #f1f5f9; }
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
        #agents-directory .agent-toolbar {
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
        #agents-directory .agent-filter-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 0 1 auto;
          min-width: 0;
          white-space: nowrap;
        }
        #agents-directory .agent-search {
          position: relative;
          width: clamp(280px, 30vw, 360px);
          flex: 0 1 360px;
          max-width: 100%;
        }
        #agents-directory .agent-search svg {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
          pointer-events: none;
        }
        #agents-directory .agent-search input {
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
        #agents-directory .agent-search input::placeholder { color: #94a3b8; }
        #agents-directory .agent-search input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }
        #agents-directory .agent-status-select {
          height: 46px;
          min-width: 112px;
          width: 132px;
          padding: 0 12px;
          border-radius: 9px;
          border: 1px solid #d8e2ef;
          background: #fff;
          color: #334155;
          font-size: 12px;
          outline: none;
          cursor: pointer;
        }
        #agents-directory .agent-stats {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex: 0 0 auto;
          flex-wrap: nowrap;
          white-space: nowrap;
        }
        #agents-directory .agent-stat-pill {
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
        #agents-directory .agent-stat-pill strong { color: #0f172a; font-size: 13px; font-weight: 700; }
        #agents-directory .agent-table-card {
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
        #agents-directory .agent-table-wrapper {
          width: 100%;
          flex: 1;
          min-height: 0;
          overflow-x: auto;
          overflow-y: auto;
        }
        #agents-directory .agent-table {
          width: 100%;
          min-width: 1080px;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 12px;
        }
        #agents-directory .agent-table thead { background: #f8fafc; }
        #agents-directory .agent-table th {
          height: 56px;
          padding: 0 22px;
          text-align: left;
          color: #475569;
          font-weight: 600;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }
        #agents-directory .agent-table td {
          height: 64px;
          padding: 0 22px;
          color: #334155;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #agents-directory .agent-table-footer {
          min-height: 74px;
          padding: 0 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #fff;
        }
        #agents-directory .agent-total { color: #64748b; font-size: 12px; }
        #agents-directory .agent-pagination { display: flex; align-items: center; gap: 12px; }
        #agents-directory .agent-page-size {
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
        #agents-directory .agent-page-btn,
        #agents-directory .agent-page-current {
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
        #agents-directory .agent-page-current {
          border-color: #2563eb;
          color: #2563eb;
          background: #eff6ff;
          font-weight: 600;
        }
        #agents-directory .agent-page-btn { cursor: pointer; font-size: 18px; line-height: 1; }
        #agents-directory .agent-page-btn:disabled { color: #cbd5e1; cursor: not-allowed; background: #f8fafc; }
        #agents-directory .agent-page-jump {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #64748b;
          font-size: 11px;
        }
        #agents-directory .agent-page-input {
          width: 56px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid #d8e2ef;
          text-align: center;
          outline: none;
          color: #334155;
          font-size: 11px;
        }

        /* === Dark theme overrides === */
        #agents-directory .agent-content { background: #111827; }
        #agents-directory .agent-toolbar { background: #111827; border-color: #1f2937; box-shadow: none; }
        #agents-directory .agent-search input { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #agents-directory .agent-search input::placeholder { color: #6b7280; }
        #agents-directory .agent-search input:focus { border-color: #3b82f6; }
        #agents-directory .agent-status-select { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #agents-directory .agent-stat-pill { background: #1a2332; border-color: #374151; color: #9ca3af; }
        #agents-directory .agent-stat-pill strong { color: #ffffff; }
        #agents-directory .agent-table-card { background: #1a2332; border: 1px solid #374151; box-shadow: none; border-radius: 14px; min-height: 300px; overflow: hidden; }
        #agents-directory .agent-content { border-radius: 14px; overflow: hidden; }
        #agents-directory .agent-table thead { background: #1a2332; }
        #agents-directory .agent-table th { color: #e5e7eb; border-bottom-color: #1f2937; }
        #agents-directory .agent-table td { color: #e5e7eb; border-bottom-color: #1f2937; }
        #agents-directory .agent-table tbody tr { background: #111827; }
        #agents-directory .agent-table tbody tr:hover { background: #1e293b; }
        #agents-directory .agent-table .status-active { background: #0d2818; color: #4ade80; }
        #agents-directory .agent-table .status-inactive { background: #1f2937; color: #9ca3af; }
        #agents-directory .agent-table-footer { background: #111827; border-top-color: #1f2937; }
        #agents-directory .agent-page-current { background: #1e3a5f; border-color: #3b82f6; color: #60a5fa; }
        #agents-directory .agent-page-input { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #agents-directory .agent-page-size { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #agents-directory .agent-table-wrapper { scrollbar-width: none; }
        #agents-directory .agent-table-wrapper::-webkit-scrollbar { display: none; }
        #agents-directory .dropdown-menu-portal { background: #1e293b; border-color: #374151; }
        #agents-directory .dropdown-menu-portal button { color: #d1d5db; }
        #agents-directory .dropdown-menu-portal button:hover { background: #374151; }
        #agents-directory .ghost-btn { background: #374151; color: #d1d5db; border: 1px solid #4b5563; border-radius: 8px; }
        #agents-directory .ghost-btn:hover { background: #4b5563; color: #f3f4f6; }
        #agents-directory .row-actions .ghost-btn { background: #374151; color: #d1d5db; border: 1px solid #4b5563; }
      `}</style>
      <section className="view active" id="agents-directory" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#111827' }}>
        <div className="agent-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '0', paddingBottom: '0', background: '#111827' }}>

          <div className="agent-toolbar">
            <div className="agent-filter-left">
              <label className="agent-search">
                <Search size={18} />
                <input
                  type="search"
                  placeholder="搜尋代理商名稱、聯絡人、電話、信箱"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                />
              </label>
              <select
                className="agent-status-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">全部代理商</option>
                <option value="active">啟用中</option>
                <option value="disabled">已停用</option>
              </select>
            </div>
            <div className="agent-stats">
              <span className="agent-stat-pill">全部代理商<strong>{stats.total}</strong></span>
              <span className="agent-stat-pill">啟用中<strong style={{ color: '#16a34a' }}>{stats.active}</strong></span>
              <span className="agent-stat-pill">已停用<strong style={{ color: '#ef4444' }}>{stats.disabled}</strong></span>
              <span className="agent-stat-pill">含銀行帳號<strong>{stats.withBank}</strong></span>
            </div>
          </div>

          {error && (
            <div style={{ marginBottom: '16px', padding: '12px 16px', background: '#3b1111', color: '#fca5a5', borderRadius: '8px', fontSize: '13px' }}>{error}</div>
          )}

          <div className="agent-table-card">
            <div className="agent-table-wrapper">
              <table className="agent-table">
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#1a2332' }}>
                  <tr>
                    {[
                      ['name', '代理商名稱', '190px'],
                      ['contactName', '聯絡人', '120px'],
                      ['contactPhone', '聯絡電話', '140px'],
                      ['contactEmail', '聯絡信箱', '210px'],
                      ['bankAccountNo', '銀行帳號', '150px'],
                      ['createdAt', '建立時間', '140px'],
                      ['status', '狀態', '100px'],
                    ].map(([key, label, width]) => (
                      <th key={key} style={{ width, background: '#1a2332' }}>
                        <button type="button" onClick={() => handleSort(key)} style={{ border: 0, background: 'transparent', color: 'inherit', padding: 0, cursor: 'pointer', font: 'inherit', whiteSpace: 'nowrap' }}>
                          {label}{getSortIcon(key)}
                        </button>
                      </th>
                    ))}
                    <th style={{ position: 'sticky', right: 0, backgroundColor: '#1a2332', zIndex: 3, boxShadow: '-1px 0 0 #1f2937', width: '150px', textAlign: 'center' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', padding: '60px 32px', color: '#9ca3af', fontSize: '14px' }}>載入代理商名錄中...</td>
                    </tr>
                  ) : paginatedAgents.length === 0 ? (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', padding: '60px 32px', color: '#9ca3af', fontSize: '14px' }}>
                        {searchKeyword || statusFilter !== 'all' ? '沒有符合條件的代理商' : '目前尚無代理商資料'}
                      </td>
                    </tr>
                  ) : (
                    paginatedAgents.map((agent) => (
                      <tr key={agent.id}>
                        <td style={{ color: '#f3f4f6', fontWeight: 500 }}>{agent.name || '-'}</td>
                        <td>{agent.contactName || '-'}</td>
                        <td>{agent.contactPhone || '-'}</td>
                        <td>{agent.contactEmail || '-'}</td>
                        <td title={agent.hasBankAccount ? '完整帳號可在詳情/編輯中查看' : ''}>{agent.bankAccountNo || '-'}</td>
                        <td>{formatDate(agent.createdAt)}</td>
                        <td>{getStatusBadge(agent.status)}</td>
                        <td style={{ position: 'sticky', right: 0, backgroundColor: '#111827', zIndex: 1, boxShadow: '-1px 0 0 #1f2937', width: '150px', textAlign: 'center', padding: '0 12px' }}>
                          <div className="row-actions agent-dropdown-container" style={{ display: 'flex', gap: '8px', justifyContent: 'center', whiteSpace: 'nowrap' }}>
                            <button
                              className="ghost-btn"
                              type="button"
                              style={{ fontSize: '12px', padding: '4px 8px', background: '#1e3a5f', color: '#93c5fd', border: '1px solid #2563eb' }}
                              onClick={() => handleDetails(agent)}
                            >
                              詳情
                            </button>
                            <button
                              className="ghost-btn"
                              type="button"
                              style={{ fontSize: '12px', padding: '4px 8px', background: '#374151', color: '#d1d5db', border: '1px solid #4b5563' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                dropdownAnchorRef.current = e.currentTarget;
                                setOpenDropdownId((current) => (current === agent.id ? null : agent.id));
                              }}
                            >
                              更多
                            </button>
                            {openDropdownId === agent.id ? createPortal(
                              <div ref={dropdownMenuRef} className="dropdown-menu-portal" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                                <button type="button" className="dropdown-item" onClick={() => handleDetails(agent)}>詳情</button>
                                <button type="button" className="dropdown-item" onClick={() => handleEdit(agent)}>編輯</button>
                                <button type="button" className="dropdown-item" onClick={(e) => { handleToggleStatus(agent, e); setOpenDropdownId(null); }}>
                                  {agent.status === 'active' ? '停用' : '啟用'}
                                </button>
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

            <div className="agent-table-footer">
              <div className="agent-total">共 {filteredAgents.length} 筆資料</div>
              <div className="agent-pagination">
                <select className="agent-page-size" value={pageSize} onChange={(e) => { const v = e.target.value; setPageSize(v === '全部' ? '全部' : Number(v)); setCurrentPage(1); }}>
                  {pageSizeOptions.map((opt) => <option key={opt} value={opt}>{opt === '全部' ? '全部' : `${opt} 條/頁`}</option>)}
                </select>
                <button className="agent-page-btn" type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)}>‹</button>
                <span className="agent-page-current">{currentPage}</span>
                <button className="agent-page-btn" type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => p + 1)}>›</button>
                <span className="agent-page-jump">前往<input className="agent-page-input" value={currentPage} readOnly />頁</span>
              </div>
            </div>
          </div>
        </div>

        {detailsModalOpen && createPortal(
          <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div className="modal-content" style={{ backgroundColor: '#111827', borderRadius: '12px', width: '500px', maxWidth: '90%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)' }}>
              <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1a2332' }}>
                <h3 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6', fontWeight: '600' }}>代理商詳細資訊</h3>
                <button className="ghost-btn" onClick={() => setDetailsModalOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '24px', lineHeight: 1, color: '#9ca3af', padding: '0 4px' }}>&times;</button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px', minHeight: 0, scrollbarWidth: 'none' }}>
                {selectedAgentDetails ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {[
                      ['代理商名稱', selectedAgentDetails.name],
                      ['聯絡人', selectedAgentDetails.contactName],
                      ['聯絡電話', selectedAgentDetails.contactPhone],
                      ['聯絡信箱', selectedAgentDetails.contactEmail],
                      ['備註', selectedAgentDetails.notes],
                    ].map(([label, value]) => (
                      <div key={label} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'start' }}>
                        <span style={{ color: '#9ca3af', fontSize: '14px' }}>{label}:</span>
                        <span style={{ color: '#f3f4f6', fontSize: '14px' }}>{value || '-'}</span>
                      </div>
                    ))}
                    <div style={{ borderTop: '1px solid #1f2937', margin: '4px 0' }}></div>
                    {[
                      ['開戶名', selectedAgentDetails.payeeName],
                      ['開戶銀行', selectedAgentDetails.bankName],
                      ['支行', selectedAgentDetails.bankBranch],
                      ['銀行帳號', selectedAgentDetails.bankAccountNo ? `${selectedAgentDetails.bankAccountNo}（脫敏）` : ''],
                      ['SWIFT', selectedAgentDetails.swiftCode],
                    ].map(([label, value]) => (
                      <div key={label} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'start' }}>
                        <span style={{ color: '#9ca3af', fontSize: '14px' }}>{label}:</span>
                        <span style={{ color: '#f3f4f6', fontSize: '14px' }}>{value || '-'}</span>
                      </div>
                    ))}
                    <div style={{ borderTop: '1px solid #1f2937', margin: '4px 0' }}></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                      <span style={{ color: '#9ca3af', fontSize: '14px' }}>建立人:</span>
                      <span style={{ color: '#f3f4f6', fontSize: '14px' }}>{selectedAgentDetails.createdByName || '-'}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                      <span style={{ color: '#9ca3af', fontSize: '14px' }}>建立時間:</span>
                      <span style={{ color: '#f3f4f6', fontSize: '14px' }}>{formatDate(selectedAgentDetails.createdAt)}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', alignItems: 'center' }}>
                      <span style={{ color: '#9ca3af', fontSize: '14px' }}>目前狀態:</span>
                      <div style={{ display: 'flex' }}>{getStatusBadge(selectedAgentDetails.status)}</div>
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
      </section>
    </>
  );
});
