import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import apiClient from './apiClient';

const defaultSipDomain = import.meta.env.VITE_WEBRTC_DOMAIN || 'pbx.qrtalkie.org';

const emptyWebAccountForm = {
  id: null,
  username: '',
  domain: defaultSipDomain,
  displayName: '',
  password: 'Lin1971wn719772',
  confirmPassword: 'Lin1971wn719772',
  role: 'user',
  status: 'active',
  phone: '',
  email: '',
};

function RequiredMark() {
  return <span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>;
}

function getStatusBadge(status) {
  const statusMap = {
    active: { label: '啟用中', bg: '#0d2818', color: '#4ade80' },
    disabled: { label: '已停用', bg: '#3b1111', color: '#fca5a5' },
    inactive: { label: '已停用', bg: '#3b1111', color: '#fca5a5' },
    pending: { label: '待審核', bg: '#1e3a5f', color: '#93c5fd' },
    expired: { label: '已過期', bg: '#3b1111', color: '#fca5a5' },
  };
  const item = statusMap[status] || { label: status || '未知', bg: '#1f2937', color: '#9ca3af' };
  return <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '3px 10px', fontSize: '10px', backgroundColor: item.bg, color: item.color, whiteSpace: 'nowrap' }}>{item.label}</span>;
}

const WebAccountRegistration = forwardRef(({ onModeChange }, ref) => {
  const [accounts, setAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSizeOptions = [10, 20, 50, "全部"];
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [viewMode, setViewMode] = useState('list');
  const [viewingAccount, setViewingAccount] = useState(null);
  const [formData, setFormData] = useState(emptyWebAccountForm);
  const [isSaving, setIsSaving] = useState(false);
  const [formMessage, setFormMessage] = useState({ type: '', text: '' });
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [resetPasswordAccount, setResetPasswordAccount] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  // WebRTC 新增弹窗
  const [showAddModal, setShowAddModal] = useState(false);
  const [addExtension, setAddExtension] = useState('');
  const [addMessage, setAddMessage] = useState({ type: '', text: '' });
  const [addSteps, setAddSteps] = useState([]);
  const [isAdding, setIsAdding] = useState(false);
  const [simulatedStep, setSimulatedStep] = useState(-1);

  // 一致性检查
  const [consistencyAccount, setConsistencyAccount] = useState(null);
  const [consistencyResult, setConsistencyResult] = useState(null);
  const [isCheckingConsistency, setIsCheckingConsistency] = useState(false);

  const STEP_LABELS = [
    '驗證 WebRTC 帳號格式',
    '檢查 FreePBX 帳號是否已存在',
    '備份 Asterisk PJSIP 配置',
    '建立 FreePBX 基礎分機',
    '設定 PJSIP 註冊密碼',
    '補全 FreePBX WebRTC 進階配置',
    '套用 FreePBX 配置',
    '驗證 FreePBX 生成的 Endpoint 配置',
    '補齊 WebRTC Runtime 參數',
    '重新套用 Runtime 補充配置',
    '驗證 WebRTC Runtime 狀態',
    '確認既有標準帳號未受影響',
    '完成建立流程',
  ];

  const stepStatusIcons = { pending: '○', running: '◌', success: '✓', failed: '✗', skipped: '—', rollback: '↺' };
  const stepStatusColors = { pending: '#4b5563', running: '#60a5fa', success: '#22c55e', failed: '#ef4444', skipped: '#6b7280', rollback: '#f59e0b' };

  async function handleAddWebrtcAccount() {
    const ext = addExtension.trim();
    if (!ext) { setAddMessage({ type: 'error', text: '請輸入 WebRTC 分機號。' }); return; }
    if (!/^\d+$/.test(ext)) { setAddMessage({ type: 'error', text: 'WebRTC 分機號必須為純數字。' }); return; }
    if (accounts.some(a => a.username === ext)) { setAddMessage({ type: 'error', text: '該分機號已在列表中。' }); return; }

    setIsAdding(true);
    setAddMessage({ type: '', text: '' });
    setAddSteps([]);
    setSimulatedStep(0);

    // 模拟进度：每 3 秒前进一步
    const timer = setInterval(() => {
      setSimulatedStep(s => Math.min(s + 1, STEP_LABELS.length - 1));
    }, 3000);

    try {
      const result = await apiClient.post('/pbx/webrtc-accounts', { extension: ext }, { timeout: 120000 });
      clearInterval(timer);
      setAddSteps(result.data?.steps || []);
      setSimulatedStep(-1);
      if (result.success) {
        setAddMessage({ type: 'success', text: result.message || 'WebRTC 帳號建立成功' });
        setTimeout(() => { setShowAddModal(false); setAddSteps([]); loadAccounts(); }, 3000);
      } else {
        setAddMessage({ type: 'error', text: result.message || 'WebRTC 帳號建立失敗' });
      }
    } catch (err) {
      clearInterval(timer);
      const data = err.response?.data || err.data || {};
      setAddSteps(data.data?.steps || data.steps || []);
      setSimulatedStep(-1);
      setAddMessage({ type: 'error', text: data.error?.message || data.message || err.message || '建立失敗' });
    } finally {
      setIsAdding(false);
    }
  }

  async function handleCheckConsistency(account) {
    setConsistencyAccount(account);
    setConsistencyResult(null);
    setIsCheckingConsistency(true);
    try {
      const result = await apiClient.get(`/pbx/webrtc-accounts/${account.username}/consistency`);
      setConsistencyResult(result.data || result);
    } catch (err) {
      setConsistencyResult({ error: err.message || '查詢失敗' });
    } finally {
      setIsCheckingConsistency(false);
    }
  }

  const [resetConfirmPasswordValue, setResetConfirmPasswordValue] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState({ type: '', text: '' });
  const [batchAddOpen, setBatchAddOpen] = useState(false);
  const [batchAddForm, setBatchAddForm] = useState({ start: '', count: '100' });
  const [isBatchAdding, setIsBatchAdding] = useState(false);
  const [batchAddMessage, setBatchAddMessage] = useState({ type: '', text: '' });
  const [importRows, setImportRows] = useState([]);
  const [importMessage, setImportMessage] = useState({ type: '', text: '' });
  const [isImporting, setIsImporting] = useState(false);
  const dropdownAnchorRef = useRef(null);
  const dropdownMenuRef = useRef(null);

  async function loadAccounts() {
    setIsLoading(true);
    try {
      const data = await apiClient.get('/admin/web-accounts');
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch (error) {
      console.error('Failed to load Web accounts:', error);
      setAccounts([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    onModeChange?.(viewMode);
  }, [onModeChange, viewMode]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds([]);
  }, [searchKeyword, statusFilter, sortConfig]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!event.target.closest('.dropdown-container') && !event.target.closest('.dropdown-menu-portal')) {
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

      const menuHeight = dropdownMenuRef.current?.offsetHeight || 140;
      let top = rect.bottom + 4;
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

  const filteredAccounts = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return accounts.filter((account) => {
      const matchesSearch = !keyword
        || String(account.username || '').toLowerCase().includes(keyword)
        || String(account.displayName || '').toLowerCase().includes(keyword)
        || String(account.domain || '').toLowerCase().includes(keyword)
        || String(account.email || '').toLowerCase().includes(keyword)
        || String(account.phone || '').includes(keyword);

      let matchesStatus = true;
      if (statusFilter === 'assigned') matchesStatus = !!account.tenantName;
      else if (statusFilter === 'unassigned') matchesStatus = !account.tenantName;
      else if (statusFilter === 'disabled') matchesStatus = account.status === 'disabled' || account.status === 'inactive';
      else if (statusFilter !== 'all') matchesStatus = account.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [accounts, searchKeyword, statusFilter]);

  const accountStats = useMemo(() => {
    const active = accounts.filter((account) => account.status === 'active').length;
    const disabled = accounts.filter((account) => account.status === 'disabled' || account.status === 'inactive').length;
    const assigned = accounts.filter((account) => account.tenantName).length;
    const unassigned = accounts.filter((account) => !account.tenantName).length;
    return { total: accounts.length, active, disabled, assigned, unassigned };
  }, [accounts]);

  const sortedAccounts = useMemo(() => {
    if (!sortConfig.key) return filteredAccounts;
    return [...filteredAccounts].sort((left, right) => {
      const leftValue = String(left[sortConfig.key] ?? '').toLowerCase();
      const rightValue = String(right[sortConfig.key] ?? '').toLowerCase();
      const result = leftValue.localeCompare(rightValue, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
      return sortConfig.direction === 'asc' ? result : -result;
    });
  }, [filteredAccounts, sortConfig]);

  const effectivePageSize = pageSize === "全部" ? (sortedAccounts.length || 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(sortedAccounts.length / effectivePageSize));
  const paginatedAccounts = sortedAccounts.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);

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

  function getNextNumericUsername() {
    return String(accounts.reduce((max, account) => {
      const username = String(account.username || '').trim();
      return /^\d+$/.test(username) ? Math.max(max, Number(username)) : max;
    }, 0) + 1);
  }

  function resetForm() {
    setFormData(emptyWebAccountForm);
    setFormMessage({ type: '', text: '' });
  }

  function startAdd() {
    setShowAddModal(true);
    setAddExtension('');
    setAddMessage({ type: '', text: '' });
  }

  function startEdit(account) {
    if (account.tenantName) {
      window.alert('已經分配给租戶的帳號不允許編輯。');
      return;
    }
    setFormData({
      id: account.id,
      username: account.username || '',
      domain: account.domain || defaultSipDomain,
      displayName: account.displayName || '',
      password: '',
      confirmPassword: '',
      role: account.role || 'user',
      status: account.status || 'active',
      phone: account.phone || '',
      email: account.email || '',
    });
    setFormMessage({ type: '', text: '' });
    setViewMode('edit');
  }

  function startBatchAdd() {
    setBatchAddForm({ start: getNextNumericUsername(), count: '100' });
    setBatchAddMessage({ type: '', text: '' });
    setBatchAddOpen(true);
  }

  function startImport() {
    setImportRows([]);
    setImportMessage({ type: '', text: '' });
    setViewMode('import');
  }

  function parseCsvLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells.map((cell) => cell.trim());
  }

  function handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '').replace(/^\uFEFF/, '');
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length <= 1) {
        setImportRows([]);
        setImportMessage({ type: 'error', text: 'CSV 文件没有可導入的數據。' });
        return;
      }
      const rows = lines.slice(1).map((line, index) => {
        const [username, password, displayName, domain, role, status, phone, email] = parseCsvLine(line);
        const item = {
          row: index + 2,
          username: username || '',
          password: password || 'Lin1971wn719772',
          displayName: displayName || username || '',
          domain: domain || defaultSipDomain,
          role: role === 'admin' ? 'admin' : 'user',
          status: ['active', 'inactive', 'disabled', 'pending'].includes(status) ? status : 'active',
          phone: phone || '',
          email: email || '',
          error: '',
        };
        if (!item.username) item.error = '用戶名不能为空';
        else if (item.password.length < 6) item.error = '密碼至少需要 6 個字符';
        else if (accounts.some((account) => account.username === item.username && (account.domain || defaultSipDomain) === item.domain)) item.error = '该域名下用戶名已存在';
        return item;
      });
      setImportRows(rows);
      const errorCount = rows.filter((row) => row.error).length;
      setImportMessage(errorCount > 0 ? { type: 'error', text: `发现 ${errorCount} 條错误，请修正后重新上傳。` } : { type: 'success', text: `已解析 ${rows.length} 條數據，可执行導入。` });
    };
    reader.readAsText(file, 'UTF-8');
  }

  async function handleImportSubmit() {
    const validRows = importRows.filter((row) => !row.error);
    if (validRows.length === 0) {
      setImportMessage({ type: 'error', text: '没有可導入的數據。' });
      return;
    }
    setIsImporting(true);
    setImportMessage({ type: '', text: '' });
    let successCount = 0;
    const errors = [];
    for (const row of validRows) {
      try {
        await apiClient.post('/admin/web-accounts', row);
        successCount += 1;
      } catch (error) {
        errors.push(`第 ${row.row} 行 ${row.username}: ${error.message || '導入失敗'}`);
      }
    }
    await loadAccounts();
    setIsImporting(false);
    if (errors.length > 0) {
      setImportMessage({ type: 'error', text: `成功 ${successCount} 條，失敗 ${errors.length} 條。${errors.slice(0, 3).join('；')}` });
      return;
    }
    setImportMessage({ type: 'success', text: `成功導入 ${successCount} 條 Web 帳號。` });
  }

  function downloadImportTemplate() {
    const csv = `Username,Password,Display Name,SIP Domain,Role,Status,Phone,Email\n200100001,Lin1971wn719772,200100001,${defaultSipDomain},user,active,,`;
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'web_accounts_template.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleExportCsv() {
    const headers = ['Username', 'Display Name', 'SIP Domain', 'Role', 'Status', 'Phone', 'Email', 'Tenant', 'Created At', 'Creator'];
    const rows = accounts.map((account) => [
      account.username || '',
      account.displayName || '',
      account.domain || '',
      account.role || '',
      account.status || '',
      account.phone || '',
      account.email || '',
      account.tenantName || '',
      account.createdAt || '',
      account.creatorName || '',
    ]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `web_accounts_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleSaveAccount(event) {
    event.preventDefault();
    if (!formData.username.trim()) {
      setFormMessage({ type: 'error', text: '請輸入用戶名。' });
      return;
    }
    if (viewMode === 'add' && accounts.some((account) => account.username === formData.username.trim() && (account.domain || defaultSipDomain) === (formData.domain || defaultSipDomain))) {
      setFormMessage({ type: 'error', text: '该域名下用戶名已存在。' });
      return;
    }
    if (viewMode === 'add' && !formData.password) {
      setFormMessage({ type: 'error', text: '請輸入密碼。' });
      return;
    }
    if (formData.password && formData.password.length < 6) {
      setFormMessage({ type: 'error', text: '密碼至少需要 6 個字符。' });
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setFormMessage({ type: 'error', text: '兩次輸入的密碼不一致。' });
      return;
    }

    setIsSaving(true);
    setFormMessage({ type: '', text: '' });
    try {
      if (viewMode === 'edit') await apiClient.put(`/admin/web-accounts/${formData.id}`, formData);
      else await apiClient.post('/admin/web-accounts', formData);
      setFormMessage({ type: 'success', text: viewMode === 'edit' ? '帳號已更新。' : '帳號已登记。' });
      await loadAccounts();
      window.setTimeout(() => {
        setViewMode('list');
        resetForm();
      }, 600);
    } catch (error) {
      setFormMessage({ type: 'error', text: error.message || '儲存失敗。' });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleBatchAddSubmit(event) {
    event.preventDefault();
    const start = Number(batchAddForm.start);
    const count = Number(batchAddForm.count);
    if (!Number.isInteger(start) || start <= 0) {
      setBatchAddMessage({ type: 'error', text: '請輸入有效的起始帳號数值。' });
      return;
    }
    if (!Number.isInteger(count) || count <= 0 || count > 1000) {
      setBatchAddMessage({ type: 'error', text: '增加數量必须在 1 到 1000 之间。' });
      return;
    }
    const existingUsernames = new Set(accounts.map((account) => `${String(account.username || '').trim()}@${account.domain || defaultSipDomain}`));
    const duplicateUsername = Array.from({ length: count }, (_, index) => String(start + index)).find((username) => existingUsernames.has(`${username}@${defaultSipDomain}`));
    if (duplicateUsername) {
      setBatchAddMessage({ type: 'error', text: `帳號 ${duplicateUsername} 已存在，请调整起始帳號或數量。` });
      return;
    }

    setIsBatchAdding(true);
    setBatchAddMessage({ type: '', text: '' });
    let successCount = 0;
    const errors = [];
    for (let index = 0; index < count; index += 1) {
      const username = String(start + index);
      try {
        await apiClient.post('/admin/web-accounts', {
          ...emptyWebAccountForm,
          username,
          displayName: username,
          domain: defaultSipDomain,
        });
        successCount += 1;
      } catch (error) {
        errors.push(`${username}: ${error.message || '儲存失敗'}`);
      }
    }
    await loadAccounts();
    setIsBatchAdding(false);
    if (errors.length > 0) {
      setBatchAddMessage({ type: 'error', text: `已成功增加 ${successCount} 個，失敗 ${errors.length} 個。${errors.slice(0, 3).join('；')}` });
      return;
    }
    setBatchAddMessage({ type: 'success', text: `已成功批量新增 ${successCount} 個帳號。` });
    window.setTimeout(() => setBatchAddOpen(false), 800);
  }

  async function handleBatchDelete() {
    const selectedAccounts = accounts.filter((account) => selectedIds.includes(account.id));
    if (selectedAccounts.length === 0) {
      window.alert('请選擇要刪除的帳號。');
      return;
    }
    const assignedAccounts = selectedAccounts.filter((account) => account.tenantName);
    if (assignedAccounts.length > 0) {
      window.alert(`所选帳號中有 ${assignedAccounts.length} 個已分配给租戶，请先取消分配。`);
      return;
    }
    if (!window.confirm(`確定要刪除选中的 ${selectedAccounts.length} 個 Web 帳號嗎？`)) return;
    try {
      await Promise.all(selectedAccounts.map((account) => apiClient.delete(`/admin/web-accounts/${account.id}`)));
      setSelectedIds([]);
      await loadAccounts();
    } catch (error) {
      window.alert(error.message || '批量刪除失敗。');
    }
  }

  async function handleBatchUnassign() {
    const selectedAccounts = accounts.filter((account) => selectedIds.includes(account.id));
    const assignedAccounts = selectedAccounts.filter((account) => account.tenantName);
    if (selectedAccounts.length === 0) {
      window.alert('请選擇要取消分配的帳號。');
      return;
    }
    if (assignedAccounts.length === 0) {
      window.alert('所选帳號均未分配给租戶。');
      return;
    }
    if (!window.confirm(`確定要取消分配选中的 ${assignedAccounts.length} 個 Web 帳號嗎？`)) return;
    try {
      await Promise.all(assignedAccounts.map((account) => apiClient.post(`/admin/web-accounts/${account.id}/unassign`)));
      setSelectedIds([]);
      await loadAccounts();
    } catch (error) {
      window.alert(error.message || '批量取消分配失敗。');
    }
  }

  async function handleAction(action, account) {
    setOpenDropdownId(null);
    if (action === 'details') {
      setViewingAccount(account);
      setViewMode('detail');
      return;
    }
    if (action === 'edit') {
      startEdit(account);
      return;
    }
    if (action === 'delete') {
      if (account.tenantName) {
        window.alert('已經分配给租戶的帳號不允許刪除。');
        return;
      }
      if (!window.confirm(`確定刪除 Web 帳號 ${account.username} 嗎？`)) return;
      try {
        await apiClient.delete(`/admin/web-accounts/${account.id}`);
        await loadAccounts();
      } catch (error) {
        window.alert(error.message || '刪除失敗。');
      }
      return;
    }
    if (action === 'reset_password') {
      setResetPasswordAccount(account);
      setResetPasswordValue('');
      setResetConfirmPasswordValue('');
      setResetMessage({ type: '', text: '' });
      return;
    }
    if (action === 'unassign') {
      if (!account.tenantName) {
        window.alert('該帳號尚未分配给租戶。');
        return;
      }
      if (!window.confirm(`確定取消 Web 帳號 ${account.username} 的租戶分配嗎？`)) return;
      try {
        await apiClient.post(`/admin/web-accounts/${account.id}/unassign`);
        await loadAccounts();
      } catch (error) {
        window.alert(error.message || '取消分配失敗。');
      }
      return;
    }
    if (action === 'assign') {
      window.alert('請在訂單审核或帳號分配流程中選擇該 Web 帳號完成分配。');
      return;
    }
    if (action === 'toggle_status') {
      const newStatus = account.status === 'active' ? 'inactive' : 'active';
      const actionText = newStatus === 'active' ? '啟用' : '停用';
      if (!window.confirm(`確定要${actionText} Web 帳號「${account.username}」嗎？`)) return;
      try {
        await apiClient.put(`/admin/web-accounts/${account.id}`, { status: newStatus });
        await loadAccounts();
      } catch (error) {
        window.alert(error.message || `${actionText}失敗。`);
      }
      return;
    }
  }

  async function handleResetPassword(event) {
    event.preventDefault();
    if (!resetPasswordAccount) return;
    if (resetPasswordValue.length < 6) {
      setResetMessage({ type: 'error', text: '密碼至少需要 6 個字符。' });
      return;
    }
    if (resetPasswordValue !== resetConfirmPasswordValue) {
      setResetMessage({ type: 'error', text: '兩次輸入的密碼不一致。' });
      return;
    }
    setIsResetting(true);
    setResetMessage({ type: '', text: '' });
    try {
      await apiClient.put(`/admin/web-accounts/${resetPasswordAccount.id}/reset-password`, { password: resetPasswordValue });
      setResetMessage({ type: 'success', text: '密碼已重設。' });
      window.setTimeout(() => setResetPasswordAccount(null), 600);
    } catch (error) {
      setResetMessage({ type: 'error', text: error.message || '密碼重設失敗。' });
    } finally {
      setIsResetting(false);
    }
  }

  useImperativeHandle(ref, () => ({
    returnToList: () => {
      setViewMode('list');
      resetForm();
    },
    handleExportCsv,
    startImport,
    startAdd,
    startBatchAdd,
    handleBatchUnassign,
    handleBatchDelete,
  }));

  const isCurrentPageSelected = paginatedAccounts.length > 0 && paginatedAccounts.every((account) => selectedIds.includes(account.id));

  function toggleCurrentPageSelection(checked) {
    if (checked) {
      const nextIds = new Set(selectedIds);
      paginatedAccounts.forEach((account) => nextIds.add(account.id));
      setSelectedIds(Array.from(nextIds));
      return;
    }
    const pageIds = new Set(paginatedAccounts.map((account) => account.id));
    setSelectedIds((ids) => ids.filter((id) => !pageIds.has(id)));
  }

  if (viewMode === 'edit') {
    return (
      <section className="view active settings-form-page" id="web-account-registration-form" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
          <form className="panel" onSubmit={handleSaveAccount} style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: '#1a2332', color: '#e5e7eb', borderRadius: '8px', border: '1px solid #1f2937', overflow: 'hidden', margin: 0 }}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#e5e7eb', fontWeight: 600 }}>{viewMode === 'edit' ? '編輯 Web 帳號' : '新增 Web 帳號'}</h3>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', scrollbarWidth: 'none' }}>
              <h4 style={{ fontSize: '15px', fontWeight: 600, color: '#d1d5db', marginBottom: '16px', marginTop: 0 }}>基礎帳號信息</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>用戶名 <RequiredMark /></span>
                  <input value={formData.username} readOnly={viewMode === 'edit'} onChange={(event) => {
                    const value = event.target.value;
                    setFormData((current) => ({ ...current, username: value, displayName: current.displayName === current.username ? value : current.displayName }));
                  }} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb', ...(viewMode === 'edit' ? { backgroundColor: '#0f172a', color: '#6b7280', cursor: 'not-allowed' } : {}) }} required />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>SIP Domain <RequiredMark /></span>
                  <input value={formData.domain} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af', cursor: 'not-allowed' }} required />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>顯示名</span>
                  <input value={formData.displayName} onChange={(event) => setFormData({ ...formData, displayName: event.target.value })} placeholder={formData.username || '默認與用戶名相同'} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>密碼 {viewMode === 'add' && <RequiredMark />}</span>
                  <input type="password" value={formData.password} onChange={(event) => setFormData({ ...formData, password: event.target.value })} placeholder={viewMode === 'edit' ? '不修改請留空' : ''} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} required={viewMode === 'add'} minLength={6} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>確認密碼 {viewMode === 'add' && <RequiredMark />}</span>
                  <input type="password" value={formData.confirmPassword} onChange={(event) => setFormData({ ...formData, confirmPassword: event.target.value })} placeholder={viewMode === 'edit' ? '不修改請留空' : ''} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} required={viewMode === 'add'} minLength={6} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>角色 <RequiredMark /></span>
                  <select value={formData.role} onChange={(event) => setFormData({ ...formData, role: event.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>狀態 <RequiredMark /></span>
                  <select value={formData.status} onChange={(event) => setFormData({ ...formData, status: event.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>手機号</span>
                  <input value={formData.phone} onChange={(event) => setFormData({ ...formData, phone: event.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>郵箱</span>
                  <input type="email" value={formData.email} onChange={(event) => setFormData({ ...formData, email: event.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} />
                </label>
              </div>
            </div>
            <div style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              {formMessage.text && <p style={{ marginRight: 'auto', margin: 0, alignSelf: 'center', fontSize: '11px', color: formMessage.type === 'error' ? '#ef4444' : '#10b981' }}>{formMessage.text}</p>}
              <button type="button" onClick={() => { setViewMode('list'); resetForm(); }} disabled={isSaving} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#374151', color: '#d1d5db', border: '1px solid #4b5563', fontSize: '11px', fontWeight: 500 }}>取消</button>
              <button type="submit" disabled={isSaving} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', fontSize: '11px', fontWeight: 500 }}>{isSaving ? '儲存中...' : (viewMode === 'edit' ? '儲存修改' : '提交新增')}</button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  if (viewMode === 'import') {
    return (
      <section className="view active settings-form-page" id="web-account-registration-import" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: '#1a2332', color: '#e5e7eb', borderRadius: '8px', border: '1px solid #1f2937', overflow: 'hidden', margin: 0 }}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#e5e7eb', fontWeight: 600 }}>導入 Web 帳號</h3>
              <button className="ghost-btn" type="button" onClick={downloadImportTemplate}>下載模板</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', scrollbarWidth: 'none', display: 'grid', gap: '16px', alignContent: 'start' }}>
              <input type="file" accept=".csv,text/csv" onChange={handleImportFile} style={{ maxWidth: '360px' }} />
              {importMessage.text && <p style={{ margin: 0, fontSize: '14px', color: importMessage.type === 'error' ? '#dc2626' : '#16a34a' }}>{importMessage.text}</p>}
              <div className="table-wrap" style={{ maxHeight: '420px', overflow: 'auto', border: '1px solid #1f2937', borderRadius: '8px' }}>
                <table style={{ width: '100%', minWidth: '860px', borderCollapse: 'collapse' }}>
                  <thead style={{ backgroundColor: '#1a2332', position: 'sticky', top: 0 }}>
                    <tr>
                      {['行号', '用戶名', '顯示名稱', 'SIP Domain', '角色', '狀態', '手機号', '郵箱', '校验'].map((label) => (
                        <th key={label} style={{ padding: '10px 12px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', fontSize: '13px', color: '#9ca3af', textAlign: 'left' }}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.length === 0 ? (
                      <tr><td colSpan="9" style={{ padding: '40px 16px', textAlign: 'center', color: '#9ca3af' }}>请選擇 CSV 文件</td></tr>
                    ) : importRows.map((row) => (
                      <tr key={row.row}>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #1f2937' }}>{row.row}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #1f2937' }}>{row.username}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #1f2937' }}>{row.displayName || '-'}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #1f2937' }}>{row.domain || '-'}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #1f2937' }}>{row.role}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #1f2937' }}>{row.status}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #1f2937' }}>{row.phone || '-'}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #1f2937' }}>{row.email || '-'}</td>
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid #1f2937', color: row.error ? '#dc2626' : '#16a34a' }}>{row.error || '可導入'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button type="button" onClick={() => setViewMode('list')} disabled={isImporting} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#1a2332', color: '#e5e7eb', color: '#9ca3af', border: '1px solid #1f2937', fontSize: '11px', fontWeight: 500 }}>取消</button>
              <button type="button" onClick={handleImportSubmit} disabled={isImporting || importRows.length === 0 || importRows.some((row) => row.error)} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', fontSize: '11px', fontWeight: 500 }}>{isImporting ? '導入中...' : '执行導入'}</button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (viewMode === 'detail' && viewingAccount) {
    const fieldStyle = { padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#0f172a', color: '#e5e7eb' };
    return (
      <section className="view active settings-form-page" id="web-account-registration-detail" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #1f2937', overflow: 'hidden', margin: 0 }}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6', fontWeight: 600 }}>Web 帳號詳情</h3>
              <button className="ghost-btn" type="button" onClick={() => setViewMode('list')}>返回列表</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', scrollbarWidth: 'none' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {[
                  ['用戶名', viewingAccount.username || '-'],
                  ['顯示名稱', viewingAccount.displayName || '-'],
                  ['SIP Domain', viewingAccount.domain || '-'],
                  ['角色', viewingAccount.role || '-'],
                  ['狀態', viewingAccount.status || '-'],
                  ['手機號碼', viewingAccount.phone || '-'],
                  ['郵箱', viewingAccount.email || '-'],
                  ['所屬租戶', viewingAccount.tenantName || '未分配'],
                  ['建立人', viewingAccount.creatorName || '-'],
                  ['建立時間', viewingAccount.createdAt || '-'],
                ].map(([label, value]) => (
                  <label key={label} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>{label}</span>
                    <input value={value} readOnly style={fieldStyle} />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="view active" id="web-account-registration" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#111827' }}>
      <style>{`
        .dropdown-menu-portal {
          position: fixed;
          width: 140px;
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.16);
          padding: 6px;
          z-index: 2147483647;
        }
        .dropdown-menu-portal .dropdown-item {
          display: block;
          width: 100%;
          border: 0;
          background: transparent;
          color: #334155;
          text-align: left;
          border-radius: 4px;
          padding: 8px 10px;
          font-size: 13px;
          cursor: pointer;
        }
        .dropdown-menu-portal .dropdown-item:hover { background: #f1f5f9; color: #0f172a; }
        .dropdown-menu-portal .dropdown-item-danger { color: #dc2626; }

        /* ========================================================
           复刻設備管理頁面顶部命令按钮的视觉风格
           ======================================================== */
        .page-heading > div > button.ghost-btn,
        .page-heading > div > button.primary-btn {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 8px !important;
          height: 44px !important;
          min-height: 44px !important;
          padding: 0 18px !important;
          border-radius: 8px !important;
          font-size: 12px !important;
          font-weight: 500 !important;
          white-space: nowrap !important;
        }
        .page-heading > div > button.ghost-btn {
          background: #fff !important;
          color: #1e3a8a !important;
          border: 1px solid #dbeafe !important;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08) !important;
        }
        .page-heading > div > button.primary-btn {
          background: linear-gradient(90deg, #2563eb 0%, #06b6d4 100%) !important;
          color: #fff !important;
          border: 0 !important;
          box-shadow: 0 6px 14px rgba(37, 99, 235, 0.22) !important;
        }
        .page-heading > div > button.primary-btn:last-child {
          background: linear-gradient(90deg, #2563eb 0%, #4f46e5 100%) !important;
          box-shadow: 0 6px 14px rgba(79, 70, 229, 0.22) !important;
        }
        .page-heading > div > button.ghost-btn svg,
        .page-heading > div > button.primary-btn svg {
          width: 14px !important;
          height: 14px !important;
        }

        /* ========================================================
           查詢和統計條部分的样式对齐設備管理
           ======================================================== */
        #web-account-registration .web-toolbar {
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
        #web-account-registration .web-filter-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 0 1 auto;
          min-width: 0;
          white-space: nowrap;
        }
        #web-account-registration .web-search {
          position: relative;
          width: clamp(280px, 30vw, 360px);
          flex: 0 1 360px;
          max-width: 100%;
        }
        #web-account-registration .web-search svg {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
          pointer-events: none;
        }
        #web-account-registration .web-search input {
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
        #web-account-registration .web-search input::placeholder { color: #94a3b8; }
        #web-account-registration .web-search input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }
        #web-account-registration .web-status-select {
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
        #web-account-registration .web-stats {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex: 0 0 auto;
          flex-wrap: nowrap;
          white-space: nowrap;
        }
        #web-account-registration .web-stat-pill {
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
        #web-account-registration .web-stat-pill strong {
          color: #0f172a;
          font-size: 13px;
          font-weight: 700;
        }
        #web-account-registration .web-table-card {
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
        #web-account-registration .web-table-wrapper {
          width: 100%;
          flex: 1;
          min-height: 0;
          overflow-x: auto;
          overflow-y: auto;
        }
        #web-account-registration .web-table {
          width: 100%;
          min-width: 1180px;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 12px;
        }
        #web-account-registration .web-table thead { background: #f8fafc; }
        #web-account-registration .web-table th {
          height: 56px;
          padding: 0 22px;
          text-align: left;
          color: #475569;
          font-weight: 600;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }
        #web-account-registration .web-table td {
          height: 64px;
          padding: 0 22px;
          color: #334155;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }
        #web-account-registration .web-table-footer {
          min-height: 74px;
          padding: 0 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #fff;
        }
        #web-account-registration .web-total {
          color: #64748b;
          font-size: 12px;
        }
        #web-account-registration .web-pagination {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        #web-account-registration .web-page-size {
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
        #web-account-registration .web-page-btn,
        #web-account-registration .web-page-current {
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
        #web-account-registration .web-page-current {
          border-color: #2563eb;
          color: #2563eb;
          background: #eff6ff;
          font-weight: 600;
        }
        #web-account-registration .web-page-btn {
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        #web-account-registration .web-page-btn:disabled {
          color: #cbd5e1;
          cursor: not-allowed;
          background: #f8fafc;
        }
        #web-account-registration .web-page-jump {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #64748b;
          font-size: 11px;
        }
        #web-account-registration .web-page-input {
          width: 56px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid #d8e2ef;
          text-align: center;
          outline: none;
          color: #334155;
          font-size: 11px;
        }
        #web-account-registration .web-sort-btn {
          border: 0;
          background: transparent;
          color: inherit;
          padding: 0;
          cursor: pointer;
          font: inherit;
          white-space: nowrap;
        }
        #web-account-registration .web-empty {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #9ca3af;
          min-height: 200px;
        }
        @media (max-width: 1100px) {
          #web-account-registration .web-toolbar {
            overflow-x: auto;
            scrollbar-width: none;
          }
          #web-account-registration .web-toolbar::-webkit-scrollbar { height: 0; }
          #web-account-registration .web-filter-left { flex-wrap: nowrap; }
          #web-account-registration .web-stats { justify-content: flex-end; }
        }
        @media (max-width: 720px) {
          #web-account-registration .web-toolbar { padding: 18px; }
          #web-account-registration .web-table-footer { padding: 14px 20px; flex-wrap: wrap; }
          #web-account-registration .web-pagination { flex-wrap: wrap; }
        }
        /* === Dark theme overrides === */
        #web-account-registration .web-toolbar { background: #111827; border: 1px solid #1f2937; box-shadow: none; }
        #web-account-registration .web-search input { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; }
        #web-account-registration .web-search input::placeholder { color: #6b7280; }
        #web-account-registration .web-search input:focus { border-color: #3b82f6; }
        #web-account-registration .web-status-select { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; }
        #web-account-registration .web-stat-pill { background: #1a2332; border: 1px solid #374151; color: #9ca3af; border-radius: 14px; }
        #web-account-registration .web-stat-pill strong { color: #ffffff; }
        #web-account-registration .web-table-card { background: #1a2332; border: 1px solid #1f2937; box-shadow: none; border-radius: 14px; overflow: hidden; }
        #web-account-registration .web-table thead { background: #1a2332; }
        #web-account-registration .web-table th { color: #e5e7eb; border-bottom: 1px solid #1f2937; }
        #web-account-registration .web-table td { color: #e5e7eb; border-bottom: 1px solid #1f2937; }
        #web-account-registration .web-table tbody tr { background: #111827; }
        #web-account-registration .web-table tbody tr:hover { background: #1e293b; }
        #web-account-registration .web-table td:last-child { background: #111827; box-shadow: -1px 0 0 #1f2937; }
        #web-account-registration .web-table th:last-child { background: #1a2332; box-shadow: -1px 0 0 #1f2937; }
        #web-account-registration .web-table-footer { background: #111827; border-top: 1px solid #1f2937; }
        #web-account-registration .web-total { color: #9ca3af; }
        #web-account-registration .web-page-size { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; cursor: pointer; }
        #web-account-registration .web-page-size:focus { border-color: #3b82f6; }
        #web-account-registration .web-page-btn { background: #1f2937; border: 1px solid #4b5563; color: #9ca3af; }
        #web-account-registration .web-page-btn:hover:not(:disabled) { background: #374151; color: #f3f4f6; }
        #web-account-registration .web-page-btn:disabled { opacity: 0.4; background: #1a2332; color: #4b5563; }
        #web-account-registration .web-page-current { background: #1e3a5f; border-color: #3b82f6; color: #60a5fa; }
        #web-account-registration .web-page-input { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; }
        #web-account-registration .web-page-jump { color: #9ca3af; }
        #web-account-registration .web-table-wrapper { scrollbar-width: none; }
        #web-account-registration .web-table-wrapper::-webkit-scrollbar { display: none; }
        #web-account-registration .ghost-btn { background: #374151; color: #d1d5db; border: 1px solid #4b5563; border-radius: 8px; }
        #web-account-registration .ghost-btn:hover { background: #4b5563; color: #f3f4f6; }
        #web-account-registration .form-message { color: #d1d5db; }
        #web-account-registration .form-message.error { background: #3b1111; color: #ef4444; }
        #web-account-registration .form-message.success { background: #0d2818; color: #22c55e; }
        .dropdown-menu-portal { background: #1e293b; border-color: #374151; }
        .dropdown-menu-portal .dropdown-item { color: #d1d5db; }
        .dropdown-menu-portal .dropdown-item:hover { background: #374151; color: #f3f4f6; }
        .dropdown-menu-portal .dropdown-item.dropdown-item-danger:hover { background: #3b1111; }
      `}</style>
      <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '0', paddingBottom: '0', background: '#111827' }}>
        <div className="web-toolbar">
          <div className="web-filter-left">
            <label className="web-search">
              <Search size={18} />
              <input
                type="search"
                placeholder="搜尋帳號、域名、郵箱或手機号"
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
              />
            </label>
            <select
              className="web-status-select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">全部</option>
              <option value="active">啟用中</option>
              <option value="disabled">已停用</option>
              <option value="assigned">已分配</option>
              <option value="unassigned">未分配</option>
            </select>
          </div>
          <div className="web-stats">
            <span className="web-stat-pill">全部<strong>{accountStats.total}</strong></span>
            <span className="web-stat-pill">啟用<strong>{accountStats.active}</strong></span>
            <span className="web-stat-pill">停用<strong>{accountStats.disabled}</strong></span>
            <span className="web-stat-pill">已分配<strong>{accountStats.assigned}</strong></span>
            <span className="web-stat-pill">未分配<strong>{accountStats.unassigned}</strong></span>
          </div>
        </div>

        <div className="web-table-card">
          {paginatedAccounts.length === 0 && !isLoading ? (
            <div className="web-empty">
              <div>暫無 Web 帳號</div>
            </div>
          ) : (
          <div className="web-table-wrapper">
            <table className="web-table">
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#1a2332' }}>
              <tr>
                <th style={{ width: '50px', textAlign: 'center', padding: 0, background: '#1a2332' }}><input type="checkbox" checked={isCurrentPageSelected} onChange={(event) => toggleCurrentPageSelection(event.target.checked)} /></th>
                {[
                  ['username', '用戶名', '150px'],
                  ['displayName', '顯示名稱', '150px'],
                  ['domain', 'SIP Domain', '150px'],
                  ['role', '角色', '100px'],
                  ['status', '狀態', '100px'],
                  ['tenantName', '所属租戶', '150px'],
                  ['createdAt', '創建時間', '150px'],
                  ['creatorName', '創建人', '150px'],
                ].map(([key, label, width]) => (
                  <th key={key} style={{ width, background: '#1a2332' }}>
                    <button type="button" className="web-sort-btn" onClick={() => handleSort(key)}>{label}{getSortIcon(key)}</button>
                  </th>
                ))}
                <th style={{ position: 'sticky', right: 0, backgroundColor: '#1a2332', zIndex: 3, boxShadow: '-1px 0 0 #1f2937', width: '140px', textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {paginatedAccounts.length > 0 && paginatedAccounts.map((account) => (
                  <tr key={account.id}>
                    <td style={{ width: '50px', textAlign: 'center', padding: 0 }}><input type="checkbox" checked={selectedIds.includes(account.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...new Set([...ids, account.id])] : ids.filter((id) => id !== account.id))} /></td>
                    <td style={{ color: '#e5e7eb', fontWeight: 500 }}>{account.username}</td>
                    <td>{account.displayName || '-'}</td>
                    <td>{account.domain || '-'}</td>
                    <td>{account.role || 'user'}</td>
                    <td>{getStatusBadge(account.status)}</td>
                    <td>{account.tenantName || '未分配'}</td>
                    <td>{account.createdAt || '-'}</td>
                    <td>{account.creatorName || '-'}</td>
                    <td style={{ position: 'sticky', right: 0, backgroundColor: '#1a2332', color: '#e5e7eb', zIndex: 1, boxShadow: '-1px 0 0 #1f2937', width: '140px', textAlign: 'center', padding: '0 12px' }}>
                      <div className="row-actions dropdown-container" style={{ display: 'flex', gap: '8px', justifyContent: 'center', whiteSpace: 'nowrap' }}>
                        <button className="ghost-btn" type="button" title="一致性檢查" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={() => handleCheckConsistency(account)}>🔍</button>
                        <button className="ghost-btn" type="button" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={() => handleAction('details', account)}>詳情</button>
                        <button className="ghost-btn" type="button" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={(event) => {
                          event.stopPropagation();
                          dropdownAnchorRef.current = event.currentTarget;
                          setOpenDropdownId((current) => current === account.id ? null : account.id);
                        }}>更多</button>
                        {openDropdownId === account.id && createPortal(
                          <div ref={dropdownMenuRef} className="dropdown-menu-portal" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                            <button type="button" className="dropdown-item" onClick={() => handleAction('details', account)}>詳情</button>
                            <button type="button" className="dropdown-item" onClick={() => handleAction('edit', account)}>編輯</button>
                            <button type="button" className="dropdown-item" onClick={() => handleAction('reset_password', account)}>重設密碼</button>
                            <button type="button" className="dropdown-item" onClick={() => handleAction('toggle_status', account)}>{account.status === 'active' ? '停用' : '啟用'}</button>
                            <button type="button" className="dropdown-item" onClick={() => handleAction(account.tenantName ? 'unassign' : 'assign', account)}>{account.tenantName ? '取消分配' : '帳號分配'}</button>
                            <button type="button" className="dropdown-item dropdown-item-danger" onClick={() => handleAction('delete', account)}>刪除</button>
                          </div>,
                          document.body
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
        )}

        <div className="web-table-footer">
          <div className="web-total">共 {filteredAccounts.length} 筆記錄</div>
          <div className="web-pagination">
            <select className="web-page-size" value={pageSize} onChange={(e) => { const v = e.target.value; setPageSize(v === "全部" ? "全部" : Number(v)); setCurrentPage(1); }}>{pageSizeOptions.map(opt => <option key={opt} value={opt}>{opt === "全部" ? "全部" : opt + " 條/頁"}</option>)}</select>
            <button className="web-page-btn" type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>‹</button>
            <span className="web-page-current">{currentPage}</span>
            <button className="web-page-btn" type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>›</button>
            <span className="web-page-jump">前往<input className="web-page-input" value={currentPage} readOnly />页</span>
          </div>
        </div>
      </div>
      </div>

      {/* 一致性檢查彈窗 */}
      {consistencyAccount && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 2147483646, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onMouseDown={(e) => { if (e.target === e.currentTarget) { setConsistencyAccount(null); setConsistencyResult(null); } }}>
          <div style={{ backgroundColor: '#111827', borderRadius: '10px', width: '520px', maxWidth: '90vw', maxHeight: '80vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ flexShrink: 0, padding: '18px 20px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>一致性檢查 — {consistencyAccount.username}</h3>
              <button onClick={() => { setConsistencyAccount(null); setConsistencyResult(null); }} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }}>&#10005;</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {isCheckingConsistency ? (
                <p style={{ color: '#9ca3af', textAlign: 'center', padding: '30px' }}>查詢中...</p>
              ) : consistencyResult?.error ? (
                <p style={{ color: '#ef4444', textAlign: 'center' }}>{consistencyResult.error}</p>
              ) : consistencyResult ? (
                <>
                  <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: consistencyResult.overallConsistent ? '#22c55e' : '#f59e0b' }}>
                      {consistencyResult.overallConsistent ? '✓ 三層一致' : '⚠ 存在不一致'}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                    {[
                      { label: 'FreePBX', ok: consistencyResult.checks?.existsConsistent, detail: consistencyResult.freepbx?.exists ? '存在' : '不存在' },
                      { label: 'Runtime', ok: consistencyResult.checks?.runtimeConsistent, detail: consistencyResult.status?.statusText || '-' },
                      { label: 'Overlay', ok: consistencyResult.checks?.overlayConsistent, detail: consistencyResult.config?.overlay?.exists ? '存在' : '無' },
                    ].map(c => (
                      <div key={c.label} style={{ padding: '10px', borderRadius: '8px', background: c.ok ? '#065f46' : '#3b1111', border: `1px solid ${c.ok ? '#059669' : '#7f1d1d'}`, textAlign: 'center' }}>
                        <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>{c.label}</div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: c.ok ? '#6ee7b7' : '#fca5a5' }}>{c.detail}</div>
                      </div>
                    ))}
                  </div>
                  {consistencyResult.status && (
                    <div style={{ marginBottom: '12px', padding: '12px', borderRadius: '8px', background: '#1a2332', border: '1px solid #1f2937' }}>
                      <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '6px' }}>Asterisk 狀態</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '12px', color: '#d1d5db' }}>
                        <span>狀態: <b style={{ color: consistencyResult.status.status === 'online' ? '#22c55e' : '#9ca3af' }}>{consistencyResult.status.statusText || '-'}</b></span>
                        <span>傳輸: {consistencyResult.status.transport || '-'}</span>
                        <span>頻道數: {consistencyResult.status.channelCount ?? '-'}</span>
                        <span>聯絡狀態: {consistencyResult.status.contactStatus || '-'}</span>
                      </div>
                    </div>
                  )}
                  {consistencyResult.warnings?.length > 0 && (
                    <div style={{ padding: '10px', borderRadius: '8px', background: '#1e293b', border: '1px solid #f59e0b' }}>
                      <div style={{ fontSize: '12px', color: '#fbbf24', marginBottom: '4px' }}>警告</div>
                      {consistencyResult.warnings.map((w, i) => (
                        <div key={i} style={{ fontSize: '12px', color: '#fbbf24' }}>• {w}</div>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>,
        document.body
      )}

      {showAddModal && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 2147483646, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onMouseDown={(event) => { if (event.target === event.currentTarget && !isAdding) { setShowAddModal(false); setAddSteps([]); setSimulatedStep(-1); setAddMessage({ type: '', text: '' }); } }}>
          <div style={{ backgroundColor: '#111827', borderRadius: '10px', width: '420px', maxWidth: '90vw', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>新增 WebRTC 帳號</h3>
              <button type="button" onClick={() => { setShowAddModal(false); setAddSteps([]); setAddMessage({ type: '', text: '' }); }} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }}>&#10005;</button>
            </div>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>WebRTC 分機號 <b style={{ color: '#ef4444' }}>*</b></span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="請輸入純數字分機號，如 9521"
                  value={addExtension}
                  disabled={isAdding}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '');
                    setAddExtension(v);
                  }}
                  style={{ padding: '10px 12px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '14px', outline: 'none' }}
                  onFocus={e => e.target.style.borderColor = '#3b82f6'}
                  onBlur={e => e.target.style.borderColor = '#374151'}
                />
              </label>
              <p style={{ margin: 0, fontSize: '12px', color: '#6b7280', lineHeight: 1.6 }}>
                系統將自動以「訪客{addExtension || '分機號'}」作為顯示名稱，密碼與其他參數由預設模板配置。
              </p>
              {addMessage.text && (
                <p style={{ margin: 0, fontSize: '13px', color: addMessage.type === 'error' ? '#ef4444' : addMessage.type === 'info' ? '#60a5fa' : '#22c55e' }}>{addMessage.text}</p>
              )}
              {isAdding && (
                <div style={{ background: '#0f172a', borderRadius: '8px', border: '1px solid #1f2937', padding: '14px' }}>
                  <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                      {STEP_LABELS[simulatedStep] || '準備中...'}
                    </span>
                    <span style={{ fontSize: '11px', color: '#60a5fa' }}>
                      {simulatedStep + 1}/{STEP_LABELS.length}
                    </span>
                  </div>
                  <div style={{ height: '4px', background: '#1f2937', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${Math.round(((simulatedStep + 1) / STEP_LABELS.length) * 100)}%`,
                      background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                      borderRadius: '2px', transition: 'width 0.5s ease',
                    }} />
                  </div>
                </div>
              )}
              {addSteps.length > 0 && (
                <div style={{ maxHeight: '260px', overflowY: 'auto', background: '#0f172a', borderRadius: '8px', border: '1px solid #1f2937', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                  {addSteps.map((step, i) => (
                    <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 12px', borderBottom: i < addSteps.length - 1 ? '1px solid #1f2937' : 'none' }}>
                      <span style={{ width: '18px', textAlign: 'center', fontSize: '14px', fontWeight: 700, color: stepStatusColors[step.status] || '#6b7280', flexShrink: 0 }}>
                        {stepStatusIcons[step.status] || '○'}
                      </span>
                      <span style={{ flex: 1, fontSize: '12px', color: step.status === 'pending' ? '#6b7280' : step.status === 'failed' ? '#ef4444' : '#d1d5db' }}>
                        {step.label}
                      </span>
                      <span style={{ fontSize: '11px', color: stepStatusColors[step.status] || '#6b7280', flexShrink: 0 }}>
                        {step.status === 'pending' ? '等待中' : step.status === 'running' ? '執行中' : step.status === 'success' ? '完成' : step.status === 'failed' ? '失敗' : step.status === 'skipped' ? '已略過' : step.status === 'rollback' ? '已回滾' : step.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
              <button type="button" onClick={() => { if (!isAdding) { setShowAddModal(false); setAddSteps([]); setSimulatedStep(-1); setAddMessage({ type: '', text: '' }); } }} disabled={isAdding} style={{ padding: '8px 20px', borderRadius: '6px', backgroundColor: '#1f2937', color: '#d1d5db', border: '1px solid #374151', fontSize: '13px', cursor: isAdding ? 'not-allowed' : 'pointer' }}>取消</button>
              <button type="button" onClick={handleAddWebrtcAccount} disabled={isAdding || !addExtension} style={{ padding: '8px 20px', borderRadius: '6px', backgroundColor: addExtension && !isAdding ? '#3b82f6' : '#1e3a5f', color: addExtension && !isAdding ? '#fff' : '#6b7280', border: 'none', fontSize: '13px', fontWeight: 500, cursor: addExtension && !isAdding ? 'pointer' : 'not-allowed' }}>{isAdding ? '建立中...' : '確認新增'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {batchAddOpen && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 2147483646, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onMouseDown={(event) => { if (event.target === event.currentTarget) setBatchAddOpen(false); }}>
          <form onSubmit={handleBatchAddSubmit} style={{ width: 'min(480px, 100%)', backgroundColor: '#1a2332', color: '#e5e7eb', borderRadius: '8px', boxShadow: '0 24px 80px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}><h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>批量新增 Web 帳號</h3></div>
            <div style={{ display: 'grid', gap: '14px', padding: '18px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}><span style={{ color: '#9ca3af', fontSize: '14px', fontWeight: 500 }}>起始帳號</span><input value={batchAddForm.start} onChange={(event) => setBatchAddForm((form) => ({ ...form, start: event.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', backgroundColor: '#1a2332', color: '#e5e7eb' }} /></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}><span style={{ color: '#9ca3af', fontSize: '14px', fontWeight: 500 }}>新增數量</span><input value={batchAddForm.count} onChange={(event) => setBatchAddForm((form) => ({ ...form, count: event.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', backgroundColor: '#1a2332', color: '#e5e7eb' }} /></label>
              {batchAddMessage.text && <p style={{ margin: 0, fontSize: '14px', color: batchAddMessage.type === 'error' ? '#ef4444' : '#22c55e' }}>{batchAddMessage.text}</p>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
              <button type="button" disabled={isBatchAdding} onClick={() => setBatchAddOpen(false)} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#374151', color: '#d1d5db', border: '1px solid #4b5563', fontSize: '11px', fontWeight: 500, cursor: 'pointer' }}>取消</button>
              <button className="primary-btn" type="submit" disabled={isBatchAdding}>{isBatchAdding ? '增加中...' : '確認增加'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {resetPasswordAccount && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 2147483646, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onMouseDown={(event) => { if (event.target === event.currentTarget) setResetPasswordAccount(null); }}>
          <form onSubmit={handleResetPassword} style={{ width: 'min(480px, 100%)', backgroundColor: '#1a2332', color: '#e5e7eb', borderRadius: '8px', boxShadow: '0 24px 80px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}><h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>重設密碼</h3></div>
            <div style={{ display: 'grid', gap: '14px', padding: '18px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}><span style={{ color: '#9ca3af', fontSize: '14px', fontWeight: 500 }}>新密碼</span><input type="password" value={resetPasswordValue} onChange={(event) => setResetPasswordValue(event.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', backgroundColor: '#1a2332', color: '#e5e7eb' }} required minLength={6} /></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}><span style={{ color: '#9ca3af', fontSize: '14px', fontWeight: 500 }}>確認密碼</span><input type="password" value={resetConfirmPasswordValue} onChange={(event) => setResetConfirmPasswordValue(event.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', backgroundColor: '#1a2332', color: '#e5e7eb' }} required minLength={6} /></label>
              {resetMessage.text && <p style={{ margin: 0, fontSize: '14px', color: resetMessage.type === 'error' ? '#ef4444' : '#22c55e' }}>{resetMessage.text}</p>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
              <button type="button" disabled={isResetting} onClick={() => setResetPasswordAccount(null)} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#374151', color: '#d1d5db', border: '1px solid #4b5563', fontSize: '11px', fontWeight: 500, cursor: 'pointer' }}>取消</button>
              <button className="primary-btn" type="submit" disabled={isResetting}>{isResetting ? '儲存中...' : '確認重設'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </section>
  );
});

export default WebAccountRegistration;
