import React, { useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { Download, Upload, Plus, UserPlus, Trash2, UserMinus, Search, RefreshCw } from 'lucide-react';
import apiClient from './apiClient';

const defaultSipDomain = import.meta.env.VITE_SIP_DOMAIN || import.meta.env.SIP_DOMAIN || 'sip.qrtalkie.org';

const emptyAccountForm = {
  id: null,
  username: '',
  displayName: '',
  domain: defaultSipDomain,
  password: '12345678',
  confirmPassword: '12345678',
  role: 'user',
  status: 'active',
  phone: '',
  email: '',
  hasExternal: false,
  externalUsername: '',
  externalDomain: '',
  externalPassword: '',
  realm: '',
  registrar: '',
  outboundProxy: '',
  protocol: 'UDP',
};

function RequiredMark() {
  return <span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>;
}

const SipAccountRegistration = forwardRef(({ onModeChange }, ref) => {
  const [accounts, setAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSizeOptions = [10, 20, 50, "全部"];
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'add' | 'import' | 'detail'
  const [editingOriginal, setEditingOriginal] = useState(null);
  const [viewingAccount, setViewingAccount] = useState(null);
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const dropdownAnchorRef = useRef(null);
  const dropdownMenuRef = useRef(null);

  const [formData, setFormData] = useState(emptyAccountForm);
  const [isSaving, setIsSaving] = useState(false);
  const [formMessage, setFormMessage] = useState({ type: '', text: '' });
  const [batchAddOpen, setBatchAddOpen] = useState(false);
  const [batchAddForm, setBatchAddForm] = useState({ start: '', count: '100' });
  const [isBatchAdding, setIsBatchAdding] = useState(false);
  const [batchAddResults, setBatchAddResults] = useState(null);
  const [batchAddMessage, setBatchAddMessage] = useState({ type: '', text: '' });

  // 删除确认弹窗
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { account, isBatch }

  // 单个创建 tombstone 重试
  const [tombstoneRetry, setTombstoneRetry] = useState(null); // { username, domain, formData }

  const [importStep, setImportStep] = useState(1);
  const [parsedData, setParsedData] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState({ success: 0, fail: 0, errors: [] });

  // 服务器账号导入
  const [serverAccounts, setServerAccounts] = useState([]);
  const [serverImportSelected, setServerImportSelected] = useState([]);
  const [serverImportLoading, setServerImportLoading] = useState(false);
  const [serverImportSaving, setServerImportSaving] = useState(false);
  const [serverImportResults, setServerImportResults] = useState(null);
  const [serverImportSortKey, setServerImportSortKey] = useState('username');
  const [serverImportSortDir, setServerImportSortDir] = useState('asc');

  const [resetPasswordAccount, setResetPasswordAccount] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resetConfirmPasswordValue, setResetConfirmPasswordValue] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState({ type: '', text: '' });
  const [verifyAccount, setVerifyAccount] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  function getNextNumericUsername() {
    const maxUsername = accounts.reduce((max, account) => {
      const username = String(account.username || '').trim();
      if (!/^\d+$/.test(username)) return max;
      return Math.max(max, Number(username));
    }, 0);
    return String(maxUsername + 1);
  }

  function openBatchAddModal() {
    setBatchAddForm({ start: getNextNumericUsername(), count: '100' });
    setBatchAddMessage({ type: '', text: '' });
    setBatchAddOpen(true);
  }

  const fetchRemoteAccounts = async () => {
    setServerImportLoading(true);
    try {
      const res = await apiClient.get('/admin/flexisip/remote-accounts-not-local');
      setServerAccounts(res.accounts || []);
    } catch (err) {
      alert(err.message || '獲取遠端帳號列表失敗');
      setServerAccounts([]);
    } finally {
      setServerImportLoading(false);
    }
  };

  const startServerImport = () => {
    setViewMode('server-import');
    setServerAccounts([]);
    setServerImportSelected([]);
    setServerImportResults(null);
    fetchRemoteAccounts();
  };

  const sortedServerAccounts = useMemo(() => {
    const sorted = [...serverAccounts];
    sorted.sort((a, b) => {
      let aVal = (a[serverImportSortKey] ?? '').toString().toLowerCase();
      let bVal = (b[serverImportSortKey] ?? '').toString().toLowerCase();
      if (aVal < bVal) return serverImportSortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return serverImportSortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [serverAccounts, serverImportSortKey, serverImportSortDir]);

  const handleSelectAllServer = (e) => {
    if (e.target.checked) {
      setServerImportSelected(serverAccounts.filter(a => !a.existsLocally).map(a => String(a.id)));
    } else {
      setServerImportSelected([]);
    }
  };

  const handleToggleServerAccount = (acc) => {
    if (acc.existsLocally) return;
    setServerImportSelected(prev =>
      prev.includes(String(acc.id)) ? prev.filter(id => id !== String(acc.id)) : [...prev, String(acc.id)]
    );
  };

  const handleImportServerAccounts = async () => {
    if (serverImportSelected.length === 0) {
      alert('请至少選擇一個帳號');
      return;
    }
    setServerImportSaving(true);
    try {
      const res = await apiClient.post('/admin/flexisip/import-remote-accounts', { accountIds: serverImportSelected });
      setServerImportResults(res);
      // Refresh list if any were imported
      if (res.success > 0) {
        fetchAccounts();
        setServerImportSelected([]);
        fetchRemoteAccounts();
      }
    } catch (err) {
      alert(err.message || '導入失敗');
    } finally {
      setServerImportSaving(false);
    }
  };

  useImperativeHandle(ref, () => ({
    returnToList: () => {
      setViewMode('list');
      setFormData(emptyAccountForm);
      setFormMessage({ type: '', text: '' });
      setImportStep(1);
      setParsedData([]);
      setServerImportResults(null);
      setServerAccounts([]);
      setServerImportSelected([]);
    },
    handleExportCsv,
    startImport: () => { setViewMode('import'); setImportStep(1); setParsedData([]); },
    startServerImport,
    startAdd: () => { setViewMode('add'); setFormData(emptyAccountForm); setFormMessage({ type: '', text: '' }); },
    startBatchAdd: openBatchAddModal,
    handleBatchUnassign,
    handleBatchDelete
  }));

  useEffect(() => {
    onModeChange?.(viewMode);
  }, [viewMode, onModeChange]);

  useEffect(() => {
    loadAccounts();
  }, []);

  async function loadAccounts() {
    setIsLoading(true);
    try {
      // 獲取真实的 SIP 帳號列表
      const data = await apiClient.get('/admin/sip-accounts');
      console.log('【前端 DEBUG】接口返回的數據:', data);
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch (err) {
      console.error('Failed to load sip accounts:', err);
      setAccounts([]);
    } finally {
      setIsLoading(false);
    }
  }

  // 統計數據
  const stats = useMemo(() => {
    let active = 0;
    let disabled = 0;
    let assigned = 0;

    accounts.forEach((acc) => {
      if (acc.status === 'active') active++;
      else if (acc.status === 'disabled' || acc.status === 'inactive') disabled++;
      
      if (acc.tenantName) assigned++;
    });

    console.log('【前端 DEBUG】當前狀態中的帳號列表长度:', accounts.length);
    return { total: accounts.length, active, disabled, assigned };
  }, [accounts]);

  // 列表過濾
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const matchesSearch = !searchKeyword || 
        (acc.username && acc.username.toLowerCase().includes(searchKeyword.toLowerCase())) ||
        (acc.email && acc.email.toLowerCase().includes(searchKeyword.toLowerCase())) ||
        (acc.phone && acc.phone.includes(searchKeyword));
      
      let matchesStatus = true;
      if (statusFilter !== 'all') {
        if (statusFilter === 'assigned') {
          matchesStatus = !!acc.tenantName;
        } else if (statusFilter === 'disabled') {
          matchesStatus = acc.status === 'disabled' || acc.status === 'inactive';
        } else {
          matchesStatus = acc.status === statusFilter;
        }
      }
      
      return matchesSearch && matchesStatus;
    });
  }, [accounts, searchKeyword, statusFilter]);

  const sortedAccounts = useMemo(() => {
    let sortableItems = [...filteredAccounts];
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
  }, [filteredAccounts, sortConfig]);

  // 分頁計算
  const totalPages = Math.max(1, Math.ceil(sortedAccounts.length / (pageSize === "全部" ? (sortedAccounts.length || 1) : pageSize)));
  const paginatedAccounts = sortedAccounts.slice((currentPage - 1) * (pageSize === "全部" ? (sortedAccounts.length || 1) : pageSize), currentPage * (pageSize === "全部" ? (sortedAccounts.length || 1) : pageSize));

  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds([]);
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
      return <span style={{ color: '#cbd5e1', marginLeft: '4px', fontSize: '10px' }}>↕</span>;
    }
    return sortConfig.direction === 'asc'
      ? <span style={{ color: '#3b82f6', marginLeft: '4px', fontSize: '10px' }}>↑</span>
      : <span style={{ color: '#3b82f6', marginLeft: '4px', fontSize: '10px' }}>↓</span>;
  };

  const handleViewDetail = (account) => {
    setViewingAccount(account);
    setViewMode('detail');
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

  const getStatusBadge = (status) => {
    const statusMap = {
      active: { label: '啟用中', bg: '#dcfce7', color: '#15803d' },
      disabled: { label: '已停用', bg: '#fee2e2', color: '#dc2626' },
      inactive: { label: '已停用', bg: '#fee2e2', color: '#dc2626' },
      pending: { label: '待审核', bg: '#e0f2fe', color: '#0369a1' },
    };
    const item = statusMap[status] || { label: status || '未知', bg: '#f1f5f9', color: '#9ca3af' };
    return <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '3px 10px', fontSize: '10px', backgroundColor: item.bg, color: item.color, whiteSpace: 'nowrap' }}>{item.label}</span>;
  };

  const handleExportCsv = () => {
    if (selectedIds.length === 0) {
      alert("请至少選擇一條記錄进行導出。");
      return;
    }

    const selectedAccounts = accounts.filter(acc => selectedIds.includes(acc.id));
    
    // 嚴格對齊 accounts_example.csv 的表頭（包含 External Registrar 前的空格）
    const headerString = "Username,Password,Role,Status,Phone,Email,External Username,External Domain,External Password,External Realm, External Registrar,External Outbound Proxy,External Protocol";

    const escapeCsv = (val) => {
      if (val == null) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = selectedAccounts.map(acc => [
      escapeCsv(acc.username),
      escapeCsv("12345678"), // 基礎密碼出於安全考量(雜湊)無法匯出明文，統一設為 12345678
      escapeCsv(acc.role),
      escapeCsv(acc.status),
      escapeCsv(""), // 依要求將電話設為空
      escapeCsv(""), // 依要求將信箱設為空
      escapeCsv(acc.externalUsername || acc.username), // External Username 若有則以用戶輸入為主，否則與 username 相同
      escapeCsv(acc.externalDomain || defaultSipDomain), // External Domain 若有則以用戶輸入為主，否則設為預設域名
      escapeCsv(acc.externalPassword || "12345678"), // External Password 若有則以用戶輸入為主，否則設為 12345678
      escapeCsv(acc.externalRealm),
      escapeCsv(acc.externalRegistrar),
      escapeCsv(acc.externalOutboundProxy),
      escapeCsv(acc.externalProtocol || "TLS") // External Protocol 若有則以用戶輸入為主，否則設為 TLS
    ].join(","));

    const csvContent = [headerString, ...rows].join("\n");
    // 移除 BOM 頭，避免干擾部分嚴格校驗欄位的解析器
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    // 導出檔名為 accounts_時間.csv
    link.setAttribute("download", `accounts_${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadTemplate = () => {
    const headerString = "Username,Password,Role,Status,Phone,Email,External Username,External Domain,External Password,External Realm, External Registrar,External Outbound Proxy,External Protocol";
    const exampleRow = "example_user,12345678,user,active,,,,,,,,,";
    const csvContent = [headerString, exampleRow].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "sip_accounts_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) {
      alert("请至少選擇一條記錄进行刪除。");
      return;
    }

    const selectedAccounts = accounts.filter(acc => selectedIds.includes(acc.id));
    const assignedAccounts = selectedAccounts.filter(acc => acc.tenantName);

    if (assignedAccounts.length > 0) {
      alert('选中的帳號中包含已分配给租戶的帳號，已经分配给租戶的帳號不允许刪除。');
      return;
    }

    setDeleteConfirm({ account: null, isBatch: true, ids: selectedIds });
  };

  // 执行删除（permanent: true = 彻底删除，false = 保留删除）
  const executeDelete = async (permanent) => {
    const info = deleteConfirm;
    if (!info) return;
    setDeleteConfirm(null);
    setIsLoading(true);
    try {
      if (info.isBatch) {
        const selectedAccounts = accounts.filter(acc => info.ids.includes(acc.id));
        await Promise.all(selectedAccounts.map(account =>
          apiClient.delete(`/admin/sip-accounts/${account.id}`, { data: { permanent } })
        ));
        setSelectedIds([]);
      } else {
        await apiClient.delete(`/admin/sip-accounts/${info.account.id}`, { data: { permanent } });
      }
      loadAccounts();
    } catch (err) {
      console.error('Failed to delete sip account:', err);
      alert(err.message || '刪除失敗');
      setIsLoading(false);
    }
  };

  // 释放 tombstone 并重试创建
  const handleTombstoneReleaseAndRetry = async () => {
    const info = tombstoneRetry;
    if (!info) return;
    setTombstoneRetry(null);
    setIsSaving(true);
    setFormMessage({ type: '', text: '' });
    try {
      const releaseResult = await apiClient.post('/flexisip/accounts/tombstones/release', {
        username: info.username,
        domain: info.domain,
        reason: '管理員重新創建同名帳號',
      });
      if (!releaseResult?.released) {
        // tombstone 可能已被之前的彻底删除释放，直接尝试创建
        console.log('Tombstone release returned not-found, retrying create anyway');
      }
      // 重试创建
      try {
        await apiClient.post('/admin/sip-accounts', formData);
        setFormMessage({ type: 'success', text: '帳號創建成功！' });
        setTimeout(async () => {
          setViewMode('list');
          setFormData(emptyAccountForm);
          setEditingOriginal(null);
          await loadAccounts();
        }, 800);
      } catch (createErr) {
        if (createErr.code === 'FLEXISIP_USERNAME_TOMBSTONED') {
          setFormMessage({ type: 'error', text: '釋放失敗，該用戶名仍被保留，請聯繫管理員。' });
        } else {
          setFormMessage({ type: 'error', text: createErr.message || '創建失敗' });
        }
      }
    } catch (err) {
      setFormMessage({ type: 'error', text: err.message || '操作失敗' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleBatchUnassign = async () => {
    if (selectedIds.length === 0) {
      alert("请至少選擇一條記錄进行操作。");
      return;
    }

    const selectedAccounts = accounts.filter(acc => selectedIds.includes(acc.id));
    const assignedAccounts = selectedAccounts.filter(acc => acc.tenantName);
    const unassignedAccounts = selectedAccounts.filter(acc => !acc.tenantName);

    if (assignedAccounts.length === 0) {
      alert('选中的帳號均未分配给任何租戶，无需取消分配。');
      return;
    }

    let confirmMsg = `確定要取消选中的 ${assignedAccounts.length} 個帳號的租戶分配吗？`;
    if (unassignedAccounts.length > 0) {
      confirmMsg = `选中的帳號中包含 ${unassignedAccounts.length} 個未分配的帳號。是否跳过它们，仅对已分配的 ${assignedAccounts.length} 個帳號执行取消分配？`;
    }

    if (window.confirm(confirmMsg)) {
      setIsLoading(true);
      try {
        await Promise.all(assignedAccounts.map(account => apiClient.post(`/admin/sip-accounts/${account.id}/unassign`)));
        setSelectedIds([]);
        loadAccounts();
      } catch (err) {
        console.error('Failed to batch unassign sip accounts:', err);
        alert(err.message || '部分或全部帳號取消分配失敗');
        loadAccounts();
      }
    }
  };

  const parseCSVRow = (str) => {
    const arr = [];
    let quote = false;
    let col = '';
    for (let i = 0; i < str.length; i++) {
      let cc = str[i], nc = str[i+1];
      if (cc === '"' && quote && nc === '"') { col += '"'; i++; continue; }
      if (cc === '"') { quote = !quote; continue; }
      if (cc === ',' && !quote) { arr.push(col.trim()); col = ''; continue; }
      col += cc;
    }
    arr.push(col.trim());
    return arr;
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const cleanText = text.replace(/^\uFEFF/, '');
      const lines = cleanText.split(/\r?\n/).filter(line => line.trim());
      if (lines.length <= 1) {
        alert('CSV/VSV 文件为空或没有數據行。');
        return;
      }

      const data = [];
      const seenUsernames = new Set(accounts.map(a => a.username));

      for (let i = 1; i < lines.length; i++) {
        const row = parseCSVRow(lines[i]);
        const acc = {
          _originalRow: i + 1,
          username: row[0] || '',
          password: row[1] || '',
          role: (row[2] || 'user').toLowerCase(),
          status: (row[3] || 'active').toLowerCase(),
          phone: row[4] || '',
          email: row[5] || '',
          hasExternal: !!(row[6] || row[7]),
          externalUsername: row[6] || '',
          externalDomain: row[7] || '',
          externalPassword: row[8] || '',
          realm: row[9] || '',
          registrar: row[10] || '',
          outboundProxy: row[11] || '',
          protocol: (row[12] || 'TLS').toUpperCase(),
          domain: defaultSipDomain,
          displayName: row[0] || '',
          _error: ''
        };

        if (!acc.username) acc._error = '用戶名不能为空';
        else if (seenUsernames.has(acc.username)) acc._error = '用戶名已存在或文件内重复';
        else if (!acc.password || acc.password.length < 6) acc._error = '密碼至少需要 6 個字符';
        else if (acc.hasExternal) {
          if (!acc.externalUsername) acc._error = '外部帳號用戶名不能为空';
          else if (!acc.externalDomain) acc._error = '外部帳號域名不能为空';
          else if (!acc.externalPassword) acc._error = '外部帳號密碼不能为空';
        }

        seenUsernames.add(acc.username);
        data.push(acc);
      }
      setParsedData(data);
      setImportStep(2);
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const executeImport = async () => {
    setImportStep(3);
    setImporting(true);
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (const acc of parsedData) {
      if (acc._error) {
        failCount++;
        errors.push(`第 ${acc._originalRow} 行 (${acc.username}): ${acc._error}`);
        continue;
      }
      try {
        await apiClient.post('/admin/sip-accounts', acc);
        successCount++;
      } catch(err) {
        failCount++;
        errors.push(`第 ${acc._originalRow} 行 (${acc.username}): ${err.message || '導入失敗'}`);
      }
    }

    setImportResults({ success: successCount, fail: failCount, errors });
    setImporting(false);
    loadAccounts();
  };

  const handleAction = async (action, account) => {
    setOpenDropdownId(null);
    if (action === 'details') {
      setViewingAccount(account);
      setViewMode('detail');
      return;
    }

    if (action === 'edit') {
      if (account.tenantName) {
        alert('已经分配给租戶的帳號不允许編輯。');
        return;
      }
      const initialData = {
        id: account.id,
        username: account.username || '',
        displayName: account.displayName || account.username || '',
        domain: account.domain || defaultSipDomain,
        password: '',
        confirmPassword: '',
        role: account.role || 'user',
        status: account.status || 'active',
        phone: account.phone || '',
        email: account.email || '',
        hasExternal: !!(account.externalUsername || account.externalDomain),
        externalUsername: account.externalUsername || '',
        externalDomain: account.externalDomain || '',
        externalPassword: '',
        realm: account.externalRealm || '',
        registrar: account.externalRegistrar || '',
        outboundProxy: account.externalOutboundProxy || '',
        protocol: account.externalProtocol || 'UDP',
      };
      setFormData(initialData);
      setEditingOriginal(initialData);
      setViewMode('edit');
      return;
    }

    if (action === 'delete') {
      if (account.tenantName) {
        alert('已经分配给租戶的帳號不允许刪除。');
        return;
      }
      setDeleteConfirm({ account, isBatch: false });
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
        alert('该帳號尚未分配给任何租戶。');
        return;
      }
      if (window.confirm(`確定要取消帳號「${account.username}」的租戶分配吗？`)) {
        setIsLoading(true);
        try {
          await apiClient.post(`/admin/sip-accounts/${account.id}/unassign`);
          loadAccounts();
        } catch (err) {
          console.error('Failed to unassign sip account:', err);
          alert(err.message || '取消分配失敗');
          setIsLoading(false);
        }
      }
      return;
    }

    if (action === 'toggle_status') {
      const newStatus = account.status === 'active' ? 'inactive' : 'active';
      const actionText = newStatus === 'active' ? '啟用' : '停用';
      if (!window.confirm(`確定要${actionText}帳號「${account.username}」嗎？`)) return;
      setIsLoading(true);
      try {
        await apiClient.put(`/admin/sip-accounts/${account.id}/status`, { status: newStatus });
        loadAccounts();
      } catch (err) {
        console.error('Failed to toggle sip account status:', err);
        alert(err.message || `${actionText}失敗`);
        setIsLoading(false);
      }
      return;
    }

    if (action === 'verify') {
      setVerifyAccount(account);
      setVerifyResult(null);
      setIsVerifying(true);
      try {
        const result = await apiClient.get(`/admin/sip-accounts/${account.id}/verify`);
        setVerifyResult(result);
      } catch (err) {
        setVerifyResult({ error: err.message || '校驗失敗' });
      } finally {
        setIsVerifying(false);
      }
      return;
    }

    alert(`觸發操作: ${action} - 帳號: ${account.username}`);
  };

  const handleResetPasswordSubmit = async (e) => {
    e.preventDefault();
    if (!resetPasswordValue) {
      setResetMessage({ type: 'error', text: '請輸入新密碼。' });
      return;
    }
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
      await apiClient.put(`/admin/sip-accounts/${resetPasswordAccount.id}/reset-password`, { password: resetPasswordValue });
      setResetMessage({ type: 'success', text: '密碼重設成功！' });
      setTimeout(() => {
        setResetPasswordAccount(null);
        setResetPasswordValue('');
        setResetConfirmPasswordValue('');
      }, 1500);
    } catch (err) {
      setResetMessage({ type: 'error', text: err.message || '密碼重設失敗。' });
    } finally {
      setIsResetting(false);
    }
  };

  const handleSaveAccount = async (e) => {
    e.preventDefault();
    if (!formData.username.trim()) {
      setFormMessage({ type: 'error', text: '請輸入用戶名。' });
      return;
    }
    if (viewMode === 'add' && accounts.some(acc => acc.username === formData.username.trim())) {
      setFormMessage({ type: 'error', text: '该用戶名已存在，请使用其他名稱。' });
      return;
    }
    if (!formData.domain.trim()) {
      setFormMessage({ type: 'error', text: '請輸入域名。' });
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
    if (viewMode === 'add' && !formData.confirmPassword) {
      setFormMessage({ type: 'error', text: '请確認密碼。' });
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setFormMessage({ type: 'error', text: '两次输入的密碼不一致。' });
      return;
    }
    if (!formData.role) {
      setFormMessage({ type: 'error', text: '请選擇角色。' });
      return;
    }
    if (!formData.status) {
      setFormMessage({ type: 'error', text: '请選擇狀態。' });
      return;
    }
    if (formData.hasExternal) {
      if (!formData.externalUsername.trim()) {
        setFormMessage({ type: 'error', text: '請輸入外部帳號的用戶名。' });
        return;
      }
      if (!formData.externalDomain.trim()) {
        setFormMessage({ type: 'error', text: '請輸入外部帳號的域名。' });
        return;
      }
      if (viewMode === 'add' && !formData.externalPassword.trim()) {
        setFormMessage({ type: 'error', text: '請輸入外部帳號的密碼。' });
        return;
      }
    }

    // 编辑模式：检测是否有字段变化（仅比较可编辑字段）
    if (viewMode === 'edit' && editingOriginal) {
      const changedFields = ['displayName', 'email', 'phone'];
      const hasChanges = changedFields.some(field => {
        const a = String(editingOriginal[field] ?? '').trim();
        const b = String(formData[field] ?? '').trim();
        return a !== b;
      });
      if (!hasChanges) {
        setFormMessage({ type: 'info', text: '沒有可儲存的修改。' });
        setTimeout(() => setFormMessage({ type: '', text: '' }), 2000);
        return;
      }
    }

    setIsSaving(true);
    setFormMessage({ type: '', text: '' });
    try {
      if (viewMode === 'edit') {
        // 仅提交可编辑字段，不提交 username/domain/password/status
        const editPayload = {
          displayName: formData.displayName.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim(),
        };
        await apiClient.put(`/admin/sip-accounts/${formData.id}`, editPayload);
        setFormMessage({ type: 'success', text: '帳號更新成功！' });
      } else {
        await apiClient.post('/admin/sip-accounts', formData);
        setFormMessage({ type: 'success', text: '帳號儲存成功！' });
      }
      setTimeout(() => {
        setViewMode('list');
        setFormData(emptyAccountForm);
        setFormMessage({ type: '', text: '' });
        loadAccounts();
      }, 1500);
    } catch (err) {
      if (err.code === 'FLEXISIP_USERNAME_TOMBSTONED') {
        setTombstoneRetry({
          username: err.username || formData.username,
          domain: err.domain || defaultSipDomain,
        });
      } else {
        setFormMessage({ type: 'error', text: err.message || '儲存失敗。' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleBatchAddSubmit = async (e) => {
    e.preventDefault();
    const startStr = String(batchAddForm.start || '').trim();
    const count = Number(batchAddForm.count);

    // 纯数字校验
    if (!/^\d+$/.test(startStr)) {
      setBatchAddMessage({ type: 'error', text: '起始 SIP 帳號必須為純數字。' });
      return;
    }
    if (!Number.isInteger(count) || count <= 0) {
      setBatchAddMessage({ type: 'error', text: '請輸入有效的新增數量。' });
      return;
    }
    if (count > 200) {
      setBatchAddMessage({ type: 'error', text: '單次批量新增數量不能超過 200。' });
      return;
    }

    setIsBatchAdding(true);
    setBatchAddMessage({ type: '', text: '' });
    setBatchAddResults(null);

    try {
      const result = await apiClient.post('/admin/sip-accounts/batch', {
        startAccount: startStr,
        count,
        domain: defaultSipDomain,
        password: emptyAccountForm.password,
        role: 'user',
        status: 'active',
      });

      const summary = result.summary || {};
      const createdOk = summary.created || 0;
      const failed = summary.failed || 0;
      const checkedOk = summary.consistent || 0;
      const inconsistent = summary.inconsistent || 0;

      if (failed > 0 || inconsistent > 0) {
        const msgs = [];
        if (failed > 0) msgs.push(`${failed} 個失敗`);
        if (inconsistent > 0) msgs.push(`${inconsistent} 個與服務端不一致`);
        setBatchAddMessage({ type: 'error', text: `已完成：${createdOk} 個成功，${msgs.join('，')}。` });
        setBatchAddResults((result.results || []).filter(r => !r.success || r.check?.consistent === false));
      } else {
        setBatchAddMessage({ type: 'success', text: `批量新增完成，${createdOk} 個帳號全部創建成功。` });
        setTimeout(() => {
          setBatchAddOpen(false);
          setBatchAddResults(null);
          setBatchAddMessage({ type: '', text: '' });
        }, 1000);
      }
    } catch (err) {
      setBatchAddMessage({ type: 'error', text: err.message || '批量新增失敗' });
    } finally {
      setIsBatchAdding(false);
      await loadAccounts();
    }
  };

  // 批量释放 tombstone 并重试
  const handleBatchReleaseAndRetry = async () => {
    if (!batchAddResults) return;
    const tombstoned = batchAddResults.filter(r => r.errorCode === 'FLEXISIP_USERNAME_TOMBSTONED');
    if (tombstoned.length === 0) return;

    setIsBatchAdding(true);
    setBatchAddMessage({ type: '', text: '' });
    try {
      // 批量释放
      const releaseResult = await apiClient.post('/flexisip/accounts/tombstones/batch-release', {
        items: tombstoned.map(r => ({ username: r.username, domain: defaultSipDomain })),
        reason: '批量釋放已刪除保留帳號',
      });
      const releasedCount = releaseResult.results?.filter(r => r.released).length || 0;
      if (releasedCount === 0) {
        setBatchAddMessage({ type: 'error', text: '釋放失敗，請手動處理。' });
        setIsBatchAdding(false);
        return;
      }
      // 重试批量创建
      await handleBatchAddSubmit({ preventDefault: () => {} });
    } catch (err) {
      setBatchAddMessage({ type: 'error', text: '釋放失敗：' + (err.message || '未知錯誤') });
      setIsBatchAdding(false);
    }
  };

  if (viewMode === 'add' || viewMode === 'edit') {
    return (
      <section className="view active settings-form-page" id="sip-account-registration-add" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
          <form className="panel" onSubmit={handleSaveAccount} style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #1f2937', overflow: 'hidden', margin: 0 }}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6', fontWeight: '600' }}>{viewMode === 'edit' ? '編輯帳號' : '新增帳號'}</h3>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', scrollbarWidth: 'none' }}>
              
              <h4 style={{ fontSize: '15px', fontWeight: '600', color: '#d1d5db', marginBottom: '16px', marginTop: 0 }}>基礎帳號資訊</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>用戶名 <RequiredMark /></span>
                  <input value={formData.username} onChange={e => {
                    const val = e.target.value;
                    setFormData(prev => ({
                      ...prev,
                      username: val,
                      displayName: prev.displayName === prev.username ? val : prev.displayName
                    }));
                  }} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb', ...(viewMode === 'edit' ? { backgroundColor: '#0f172a', color: '#6b7280', cursor: 'not-allowed' } : {}) }} onFocus={e => { if (viewMode !== 'edit') e.target.style.borderColor = '#3b82f6'; }} onBlur={e => { if (viewMode !== 'edit') e.target.style.borderColor = '#374151'; }} required readOnly={viewMode === 'edit'} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>域名 <RequiredMark /></span>
                  <input value={formData.domain} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af', cursor: 'not-allowed' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>顯示名</span>
                  <input value={formData.displayName} onChange={e => setFormData({ ...formData, displayName: e.target.value })} placeholder={formData.username || '默认与用戶名相同'} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>密碼 {viewMode === 'add' && <RequiredMark />} <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 400 }}>(至少 6 個字符)</span></span>
                  <input type="password" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} placeholder={viewMode === 'edit' ? '不修改請留空' : ''} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} required={viewMode === 'add'} minLength={6} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>確認密碼 {viewMode === 'add' && <RequiredMark />}</span>
                  <input type="password" value={formData.confirmPassword} onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })} placeholder={viewMode === 'edit' ? '不修改請留空' : ''} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} required={viewMode === 'add'} minLength={6} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>角色 <RequiredMark /></span>
                  <select value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })} disabled={viewMode === 'edit'} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb', ...(viewMode === 'edit' ? { backgroundColor: '#0f172a', color: '#6b7280', cursor: 'not-allowed' } : {}) }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>狀態 <RequiredMark /></span>
                  <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>手機號碼</span>
                  <input type="tel" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>郵箱</span>
                  <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                </label>
              </div>

              <div style={{ borderTop: '1px solid #1f2937', paddingTop: '24px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '16px' }}>
                  <input type="checkbox" checked={formData.hasExternal} onChange={e => setFormData({ ...formData, hasExternal: e.target.checked })} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                  <span style={{ fontSize: '15px', fontWeight: '600', color: '#d1d5db' }}>外部帳號</span>
                </label>
                {formData.hasExternal && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>用戶名 <RequiredMark /></span>
                      <input value={formData.externalUsername} onChange={e => setFormData({ ...formData, externalUsername: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} required={formData.hasExternal} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>域名 <RequiredMark /></span>
                      <input value={formData.externalDomain} onChange={e => setFormData({ ...formData, externalDomain: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} required={formData.hasExternal} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>密碼 {viewMode === 'add' && <RequiredMark />}</span>
                      <input type="password" value={formData.externalPassword} onChange={e => setFormData({ ...formData, externalPassword: e.target.value })} placeholder={viewMode === 'edit' ? '不修改請留空' : ''} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} required={formData.hasExternal && viewMode === 'add'} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>認證域 (Realm)</span>
                      <input value={formData.realm} onChange={e => setFormData({ ...formData, realm: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>註冊伺服器 (Registrar)</span>
                      <input value={formData.registrar} onChange={e => setFormData({ ...formData, registrar: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>出站代理 (Outbound Proxy)</span>
                      <input value={formData.outboundProxy} onChange={e => setFormData({ ...formData, outboundProxy: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>通訊協定 (Protocol)</span>
                      <select value={formData.protocol} onChange={e => setFormData({ ...formData, protocol: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'}>
                        <option value="UDP">UDP</option>
                        <option value="TCP">TCP</option>
                        <option value="TLS">TLS</option>
                      </select>
                    </label>
                  </div>
                )}
              </div>
            </div>
            <div style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              {formMessage.text && <p style={{ marginRight: 'auto', margin: 0, alignSelf: 'center', fontSize: '11px', color: formMessage.type === 'error' ? '#ef4444' : '#10b981' }}>{formMessage.text}</p>}
              <button type="button" onClick={() => { setViewMode('list'); setFormData(emptyAccountForm); setFormMessage({ type: '', text: '' }); }} disabled={isSaving} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#1a2332', color: '#e5e7eb', color: '#9ca3af', border: '1px solid #1f2937', fontSize: '11px', fontWeight: 500 }}>取消</button>
              <button type="submit" disabled={isSaving} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', fontSize: '11px', fontWeight: 500 }}>{isSaving ? '儲存中...' : (viewMode === 'edit' ? '儲存修改' : '提交登记')}</button>
            </div>
          </form>
        </div>

        {/* Tombstone 釋放確認彈窗（必須在 add/edit return 塊內才能渲染） */}
        {tombstoneRetry && createPortal(
          <div className="dialog-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999999 }}>
            <div style={{ backgroundColor: '#111827', borderRadius: '8px', width: '420px', maxWidth: '90vw', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#e5e7eb' }}>用戶名已被保留</h3>
              </div>
              <div style={{ padding: '24px' }}>
                <p style={{ margin: 0, color: '#d1d5db', fontSize: '14px', lineHeight: 1.7 }}>
                  帳號 <strong style={{ color: '#fbbf24' }}>{tombstoneRetry.username}@{tombstoneRetry.domain}</strong> 的用戶名已被刪除保留，無法直接重新創建。
                </p>
                <p style={{ margin: '12px 0 0', color: '#9ca3af', fontSize: '13px', lineHeight: 1.6 }}>
                  是否徹底釋放該用戶名後再重新創建帳號？
                </p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
                <button className="ghost-btn" type="button" onClick={() => { setTombstoneRetry(null); setFormMessage({ type: '', text: '' }); }}>取消</button>
                <button className="primary-btn" type="button" onClick={handleTombstoneReleaseAndRetry}>釋放並創建</button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </section>
    );
  }

  if (viewMode === 'detail' && viewingAccount) {
    return (
      <section className="view active settings-form-page" id="sip-account-registration-detail" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #1f2937', overflow: 'hidden', margin: 0 }}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6', fontWeight: '600' }}>帳號詳情</h3>
              <button type="button" onClick={() => setViewMode('list')} style={{ background: '#374151', color: '#d1d5db', border: '1px solid #4b5563', borderRadius: '8px', cursor: 'pointer', padding: '8px 16px', fontSize: '13px', fontWeight: 500, minHeight: '34px' }}>
                返回列表
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', scrollbarWidth: 'none' }}>
              <h4 style={{ fontSize: '15px', fontWeight: '600', color: '#d1d5db', marginBottom: '16px', marginTop: 0 }}>基础帳號信息</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>用戶名</span>
                  <input value={viewingAccount.username || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>域名</span>
                  <input value={viewingAccount.domain || defaultSipDomain} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>顯示名</span>
                  <input value={viewingAccount.displayName || viewingAccount.username || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>角色</span>
                  <input value={viewingAccount.role || 'user'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>狀態</span>
                  <input value={viewingAccount.status || 'active'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>手機号</span>
                  <input value={viewingAccount.phone || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>郵箱</span>
                  <input value={viewingAccount.email || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>添加人</span>
                  <input value={viewingAccount.creatorName || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>添加時間</span>
                  <input value={viewingAccount.createdAt || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>租戶名稱</span>
                  <input value={viewingAccount.tenantName || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                </label>
              </div>

              <div style={{ borderTop: '1px solid #1f2937', paddingTop: '24px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <input type="checkbox" checked={!!(viewingAccount.externalUsername || viewingAccount.externalDomain)} readOnly style={{ width: '16px', height: '16px' }} disabled />
                  <span style={{ fontSize: '15px', fontWeight: '600', color: '#d1d5db' }}>外部帳號</span>
                </label>
                {(viewingAccount.externalUsername || viewingAccount.externalDomain) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>用戶名</span>
                      <input value={viewingAccount.externalUsername || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>域名</span>
                      <input value={viewingAccount.externalDomain || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>認證域 (Realm)</span>
                      <input value={viewingAccount.externalRealm || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>註冊伺服器 (Registrar)</span>
                      <input value={viewingAccount.externalRegistrar || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>出站代理 (Outbound Proxy)</span>
                      <input value={viewingAccount.externalOutboundProxy || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>通訊協定 (Protocol)</span>
                      <input value={viewingAccount.externalProtocol || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (viewMode === 'server-import') {
    return (
      <section className="view active settings-form-page" id="sip-account-registration-import" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #1f2937', overflow: 'hidden', margin: 0 }}>
            <div style={{ flexShrink: 0, padding: '12px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', alignItems: 'center', gap: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6', fontWeight: '600', flexShrink: 0 }}>導入服務器賬號</h3>
              <span style={{ fontSize: '14px', color: '#9ca3af', flexShrink: 0 }}>
                {serverImportLoading ? '正在載入...' : `共 ${serverAccounts.length} 個，${serverAccounts.filter(a => !a.existsLocally).length} 個可導入`}
              </span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#9ca3af', flexShrink: 0 }}>
                <input type="checkbox" checked={serverImportSelected.length > 0 && serverImportSelected.length === sortedServerAccounts.filter(a => !a.existsLocally).length} onChange={handleSelectAllServer} style={{ accentColor: '#3b82f6', width: '16px', height: '16px', margin: 0 }} />
                全選可導入
              </label>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={() => { setServerImportResults(null); fetchRemoteAccounts(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px', flexShrink: 0, background: '#374151', color: '#d1d5db', border: '1px solid #4b5563', borderRadius: '8px', cursor: 'pointer' }}>
                <RefreshCw size={14} /> 刷新列表
              </button>
              <button className="primary-btn" type="button" onClick={handleImportServerAccounts} disabled={serverImportSelected.length === 0 || serverImportSaving} style={{ flexShrink: 0, padding: '6px 14px', fontSize: '13px' }}>
                {serverImportSaving ? '導入中...' : `導入選中帳號 (${serverImportSelected.length})`}
              </button>
            </div>

            {serverImportResults ? (
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px', scrollbarWidth: 'none' }}>
                <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                  <h4 style={{ fontSize: '24px', color: serverImportResults.fail === 0 ? '#10b981' : '#f59e0b', margin: '0 0 12px 0' }}>導入完成</h4>
                  <p style={{ color: '#9ca3af', fontSize: '15px', margin: 0 }}>成功導入 <strong>{serverImportResults.success}</strong> 條，失敗 <strong>{serverImportResults.fail}</strong> 條。</p>
                </div>
                {serverImportResults.errors.length > 0 && (
                  <div style={{ width: '100%', maxWidth: '600px', backgroundColor: '#3b1111', padding: '20px', borderRadius: '8px', border: '1px solid #7f1d1d', maxHeight: '200px', overflowY: 'auto', margin: '0 auto' }}>
                    {serverImportResults.errors.map((err, i) => (
                      <p key={i} style={{ color: '#fca5a5', fontSize: '13px', margin: 0 }}>{err}</p>
                    ))}
                  </div>
                )}
                <div style={{ textAlign: 'center', marginTop: '24px' }}>
                  <button className="primary-btn" onClick={() => { setViewMode('list'); setServerImportResults(null); }} style={{ padding: '8px 24px' }}>返回帳號登记首页</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ flex: 1, overflow: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
                  {serverImportLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: '#9ca3af' }}>
                      <div style={{ width: '40px', height: '40px', border: '3px solid #374151', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: '12px' }}></div>
                      載入中...
                    </div>
                  ) : serverAccounts.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: '#6b7280', fontSize: '14px' }}>
                      暫無遠端帳號數據
                    </div>
                  ) : (
                    <table className="sip-table" style={{ width: '100%', minWidth: '700px' }}>
                      <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#1a2332' }}>
                        <tr>
                          <th style={{ width: '50px', textAlign: 'center', padding: '12px 8px', background: '#1a2332', borderBottom: '1px solid #1f2937' }}>
                            <input type="checkbox" checked={serverImportSelected.length > 0 && serverImportSelected.length === sortedServerAccounts.filter(a => !a.existsLocally).length} onChange={handleSelectAllServer} style={{ accentColor: '#3b82f6', width: '16px', height: '16px' }} />
                          </th>
                          {[
                            ['username', '帳號'],
                            ['displayName', '顯示名'],
                            ['email', '電子郵箱'],
                            ['phone', '電話'],
                          ].map(([key, label]) => (
                            <th key={key} style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', color: '#9ca3af', fontWeight: 500, background: '#1a2332', cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => {
                              if (serverImportSortKey === key) {
                                setServerImportSortDir(d => d === 'asc' ? 'desc' : 'asc');
                              } else {
                                setServerImportSortKey(key);
                                setServerImportSortDir('asc');
                              }
                            }}>
                              {label} {serverImportSortKey === key ? (serverImportSortDir === 'asc' ? '↑' : '↓') : '↕'}
                            </th>
                          ))}
                          <th style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', color: '#9ca3af', fontWeight: 500, background: '#1a2332', whiteSpace: 'nowrap' }}>導入狀態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedServerAccounts.map(acc => {
                          const isImported = acc.existsLocally;
                          const isSelected = serverImportSelected.includes(String(acc.id));
                          return (
                          <tr key={acc.id} style={{ cursor: isImported ? 'default' : 'pointer', background: isSelected ? '#1e293b' : 'transparent', opacity: isImported ? 0.5 : 1 }} onClick={() => handleToggleServerAccount(acc)}>
                            <td style={{ width: '50px', textAlign: 'center', padding: 0 }}>
                              <input type="checkbox" checked={isSelected} disabled={isImported} readOnly style={{ accentColor: '#3b82f6', width: '16px', height: '16px' }} />
                            </td>
                            <td style={{ padding: '10px 16px', color: '#e5e7eb', fontWeight: 500, whiteSpace: 'nowrap' }}>{acc.username}{acc.domain ? `@${acc.domain}` : ''}</td>
                            <td style={{ padding: '10px 16px', color: '#9ca3af' }}>{acc.displayName || '-'}</td>
                            <td style={{ padding: '10px 16px', color: '#9ca3af' }}>{acc.email || '-'}</td>
                            <td style={{ padding: '10px 16px', color: '#9ca3af' }}>{acc.phone || '-'}</td>
                            <td style={{ padding: '10px 16px', whiteSpace: 'nowrap' }}>{isImported ? <span style={{ color: '#22c55e', fontSize: '12px' }}>已導入</span> : <span style={{ color: '#6b7280', fontSize: '12px' }}>未導入</span>}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (viewMode === 'import') {
    return (
      <section className="view active settings-form-page" id="sip-account-registration-import" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #1f2937', overflow: 'hidden', margin: 0 }}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6', fontWeight: '600' }}>批量導入帳號</h3>
              <button className="ghost-btn" type="button" onClick={handleDownloadTemplate} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px' }}>
                <Download size={14} /> 下載模板
              </button>
            </div>
            
            <div style={{ display: 'flex', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}>
               <div style={{ flex: 1, padding: '16px', textAlign: 'center', fontSize: '15px', fontWeight: importStep === 1 ? '600' : '400', color: importStep === 1 ? '#3b82f6' : '#64748b', borderBottom: importStep === 1 ? '2px solid #3b82f6' : 'none' }}>1. 選擇導入文件</div>
               <div style={{ flex: 1, padding: '16px', textAlign: 'center', fontSize: '15px', fontWeight: importStep === 2 ? '600' : '400', color: importStep === 2 ? '#3b82f6' : '#64748b', borderBottom: importStep === 2 ? '2px solid #3b82f6' : 'none' }}>2. 校验文件數據</div>
               <div style={{ flex: 1, padding: '16px', textAlign: 'center', fontSize: '15px', fontWeight: importStep === 3 ? '600' : '400', color: importStep === 3 ? '#3b82f6' : '#64748b', borderBottom: importStep === 3 ? '2px solid #3b82f6' : 'none' }}>3. 执行導入操作</div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', scrollbarWidth: 'none' }}>
               {importStep === 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px', gap: '16px' }}>
                    <p style={{ color: '#9ca3af', fontSize: '15px' }}>请選擇符合模板格式的 CSV / VSV 文件。</p>
                  <label className="primary-btn" style={{ cursor: 'pointer', padding: '10px 24px', fontSize: '15px' }}>
                       選擇文件并解析
                       <input type="file" accept=".csv,.vsv" style={{ display: 'none' }} onChange={handleFileUpload} />
                    </label>
                  </div>
               )}

               {importStep === 2 && (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                     <p style={{ marginBottom: '16px', color: '#9ca3af', fontSize: '15px' }}>
                       共解析到 <strong style={{ color: '#e5e7eb' }}>{parsedData.length}</strong> 條數據，其中有错误 <strong style={{ color: '#ef4444' }}>{parsedData.filter(d => d._error).length}</strong> 條。
                     </p>
                     <div style={{ flex: 1, overflow: 'auto', border: '1px solid #1f2937', borderRadius: '8px' }}>
                       <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                          <thead style={{ position: 'sticky', top: 0, backgroundColor: '#1a2332', zIndex: 1 }}>
                             <tr>
                               <th style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', color: '#9ca3af', fontWeight: 500 }}>行號</th>
                               <th style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', color: '#9ca3af', fontWeight: 500 }}>用戶名</th>
                               <th style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', color: '#9ca3af', fontWeight: 500 }}>狀態/錯誤資訊</th>
                             </tr>
                          </thead>
                          <tbody>
                             {parsedData.map((d, idx) => (
                               <tr key={idx}>
                                 <td style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', color: '#9ca3af' }}>{d._originalRow}</td>
                                 <td style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', color: '#e5e7eb' }}>{d.username || '-'}</td>
                                 <td style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', color: d._error ? '#ef4444' : '#10b981' }}>{d._error || '校验通过'}</td>
                               </tr>
                             ))}
                          </tbody>
                       </table>
                     </div>
                     <div style={{ flexShrink: 0, marginTop: '24px', display: 'flex', justifyContent: 'center', gap: '16px' }}>
                        <button className="ghost-btn" onClick={() => setImportStep(1)}>重新選擇文件</button>
                        <button className="primary-btn" onClick={executeImport} disabled={parsedData.filter(d => d._error).length > 0}>
                           {parsedData.filter(d => d._error).length > 0 ? '请先修正错误后重新上傳' : '確認无误，执行導入'}
                        </button>
                     </div>
                  </div>
               )}

               {importStep === 3 && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px', gap: '16px' }}>
                     {importing ? (
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ width: '40px', height: '40px', border: '3px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }}></div>
                          <p style={{ fontSize: '16px', color: '#3b82f6', margin: 0 }}>正在执行導入，请勿刷新頁面...</p>
                        </div>
                     ) : (
                        <>
                           <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                              <h4 style={{ fontSize: '24px', color: importResults.fail === 0 ? '#10b981' : '#f59e0b', margin: '0 0 12px 0' }}>導入完成</h4>
                              <p style={{ color: '#9ca3af', fontSize: '15px', margin: 0 }}>成功導入 <strong>{importResults.success}</strong> 條，失敗 <strong>{importResults.fail}</strong> 條。</p>
                           </div>
                           {importResults.errors.length > 0 && (
                              <div style={{ width: '100%', maxWidth: '600px', backgroundColor: '#fef2f2', padding: '20px', borderRadius: '8px', border: '1px solid #fecaca', maxHeight: '200px', overflowY: 'auto' }}>
                                 <h5 style={{ margin: '0 0 12px 0', color: '#ef4444', fontSize: '15px' }}>失敗詳情：</h5>
                                 <ul style={{ margin: 0, paddingLeft: '20px', color: '#ef4444', fontSize: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {importResults.errors.map((err, i) => <li key={i}>{err}</li>)}
                                 </ul>
                              </div>
                           )}
                           <button className="primary-btn" onClick={() => { setViewMode('list'); setImportStep(1); }} style={{ marginTop: '16px' }}>返回帳號登记首页</button>
                        </>
                     )}
                  </div>
               )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
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
           复刻設備管理頁面顶部命令按钮的视觉风格
           严格限定在该頁面挂载时生效，通过子選擇器仅覆盖工具栏操作按钮组
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
        #sip-account-registration .sip-toolbar {
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
        #sip-account-registration .sip-filter-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 0 1 auto;
          min-width: 0;
          white-space: nowrap;
        }
        #sip-account-registration .sip-search {
          position: relative;
          width: clamp(280px, 30vw, 360px);
          flex: 0 1 360px;
          max-width: 100%;
        }
        #sip-account-registration .sip-search svg {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #94a3b8;
          pointer-events: none;
        }
        #sip-account-registration .sip-search input {
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
        #sip-account-registration .sip-search input::placeholder { color: #94a3b8; }
        #sip-account-registration .sip-search input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }
        #sip-account-registration .sip-status-select {
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
        #sip-account-registration .sip-stats {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex: 0 0 auto;
          flex-wrap: nowrap;
          white-space: nowrap;
        }
        #sip-account-registration .sip-stat-pill {
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
        #sip-account-registration .sip-stat-pill strong {
          color: #0f172a;
          font-size: 13px;
          font-weight: 700;
        }
        #sip-account-registration .sip-table-card {
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
        #sip-account-registration .sip-table-wrapper {
          width: 100%;
          flex: 1;
          min-height: 0;
          overflow-x: auto;
          overflow-y: auto;
        }
        #sip-account-registration .sip-table {
          width: 100%;
          min-width: 1180px;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 12px;
        }
        #sip-account-registration .sip-table thead { background: #f8fafc; }
        #sip-account-registration .sip-table th {
          height: 56px;
          padding: 0 22px;
          text-align: left;
          color: #475569;
          font-weight: 600;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }
        #sip-account-registration .sip-table td {
          height: 64px;
          padding: 0 22px;
          color: #334155;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }
        #sip-account-registration .sip-table-footer {
          min-height: 74px;
          padding: 0 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #fff;
        }
        #sip-account-registration .sip-total {
          color: #64748b;
          font-size: 12px;
        }
        #sip-account-registration .sip-pagination {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        #sip-account-registration .sip-page-size {
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
        #sip-account-registration .sip-page-btn,
        #sip-account-registration .sip-page-current {
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
        #sip-account-registration .sip-page-current {
          border-color: #2563eb;
          color: #2563eb;
          background: #eff6ff;
          font-weight: 600;
        }
        #sip-account-registration .sip-page-btn {
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        #sip-account-registration .sip-page-btn:disabled {
          color: #cbd5e1;
          cursor: not-allowed;
          background: #f8fafc;
        }
        #sip-account-registration .sip-page-jump {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #64748b;
          font-size: 11px;
        }
        #sip-account-registration .sip-page-input {
          width: 56px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid #d8e2ef;
          text-align: center;
          outline: none;
          color: #334155;
          font-size: 11px;
        }
        #sip-account-registration .sip-sort-btn {
          border: 0;
          background: transparent;
          color: inherit;
          padding: 0;
          cursor: pointer;
          font: inherit;
          white-space: nowrap;
        }
        #sip-account-registration .sip-empty {
          height: 380px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border-bottom: 1px solid #e2e8f0;
          color: #64748b;
        }
        @media (max-width: 1100px) {
          #sip-account-registration .sip-toolbar {
            overflow-x: auto;
            scrollbar-width: none;
          }
          #sip-account-registration .sip-toolbar::-webkit-scrollbar { height: 0; }
          #sip-account-registration .sip-filter-left { flex-wrap: nowrap; }
          #sip-account-registration .sip-stats { justify-content: flex-end; }
        }
        @media (max-width: 720px) {
          #sip-account-registration .sip-toolbar { padding: 18px; }
          #sip-account-registration .sip-table-footer { padding: 14px 20px; flex-wrap: wrap; }
          #sip-account-registration .sip-pagination { flex-wrap: wrap; }
        }

        /* === Dark theme overrides === */
        #sip-account-registration .sip-toolbar { background: #111827; border: 1px solid #1f2937; box-shadow: none; }
        #sip-account-registration .sip-search input { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; }
        #sip-account-registration .sip-search input::placeholder { color: #6b7280; }
        #sip-account-registration .sip-search input:focus { border-color: #3b82f6; }
        #sip-account-registration .sip-status-select { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; }
        #sip-account-registration .sip-stat-pill { background: #1a2332; border: 1px solid #374151; color: #9ca3af; border-radius: 14px; }
        #sip-account-registration .sip-stat-pill strong { color: #ffffff; }
        #sip-account-registration .sip-table-card { background: #1a2332; border: 1px solid #1f2937; box-shadow: none; border-radius: 14px; overflow: hidden; }
        #sip-account-registration .sip-table thead { background: #1a2332; }
        #sip-account-registration .sip-table th { color: #e5e7eb; border-bottom: 1px solid #1f2937; }
        #sip-account-registration .sip-table td { color: #e5e7eb; border-bottom: 1px solid #1f2937; }
        #sip-account-registration .sip-table tbody tr { background: #111827; }
        #sip-account-registration .sip-table tbody tr:hover { background: #1e293b; }
        #sip-account-registration .sip-table td:last-child { background: #111827; box-shadow: -1px 0 0 #1f2937; }
        #sip-account-registration .sip-table th:last-child { background: #1a2332; box-shadow: -1px 0 0 #1f2937; }
        #sip-account-registration .sip-table-footer { background: #111827; border-top: 1px solid #1f2937; }
        #sip-account-registration .sip-total { color: #9ca3af; }
        #sip-account-registration .sip-page-size { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; cursor: pointer; }
        #sip-account-registration .sip-page-size:focus { border-color: #3b82f6; }
        #sip-account-registration .sip-page-btn { background: #1f2937; border: 1px solid #4b5563; color: #9ca3af; }
        #sip-account-registration .sip-page-btn:hover:not(:disabled) { background: #374151; color: #f3f4f6; }
        #sip-account-registration .sip-page-btn:disabled { opacity: 0.4; background: #1a2332; color: #4b5563; }
        #sip-account-registration .sip-page-current { background: #1e3a5f; border-color: #3b82f6; color: #60a5fa; }
        #sip-account-registration .sip-page-input { background: #1a2332; border: 1px solid #374151; color: #e5e7eb; }
        #sip-account-registration .sip-page-jump { color: #9ca3af; }
        #sip-account-registration .sip-table-wrapper { scrollbar-width: thin; scrollbar-color: #374151 transparent; }
        #sip-account-registration .sip-table-wrapper::-webkit-scrollbar { height: 6px; width: 6px; }
        #sip-account-registration .sip-table-wrapper::-webkit-scrollbar-track { background: transparent; }
        #sip-account-registration .sip-table-wrapper::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
        #sip-account-registration .ghost-btn { background: #374151; color: #d1d5db; border: 1px solid #4b5563; border-radius: 8px; }
        #sip-account-registration .ghost-btn:hover { background: #4b5563; color: #f3f4f6; }
        #sip-account-registration .form-message { color: #d1d5db; }
        #sip-account-registration .form-message.error { background: #3b1111; color: #ef4444; }
        #sip-account-registration .form-message.success { background: #0d2818; color: #22c55e; }
        .dropdown-menu-portal { background: #1e293b; border-color: #374151; }
        .dropdown-menu-portal .dropdown-item { color: #d1d5db; }
        .dropdown-menu-portal .dropdown-item:hover { background: #374151; color: #f3f4f6; }
        .dropdown-menu-portal .dropdown-item.dropdown-item-danger:hover { background: #3b1111; }
      `}</style>
      <section className="view active" id="sip-account-registration" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#111827' }}>
        <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '0', paddingBottom: '0', background: '#111827' }}>
          
          <div className="sip-toolbar">
            <div className="sip-filter-left">
              <label className="sip-search">
                <Search size={18} />
                <input
                  type="search"
                  placeholder="搜寻帳號名稱、手機、郵箱"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                />
              </label>
              <select
                className="sip-status-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">全部狀態</option>
                <option value="active">啟用中</option>
                <option value="disabled">已停用</option>
                <option value="assigned">已分配</option>
              </select>
            </div>
            <div className="sip-stats">
              <span className="sip-stat-pill">全部帳號<strong>{stats.total}</strong></span>
              <span className="sip-stat-pill">啟用中<strong>{stats.active}</strong></span>
              <span className="sip-stat-pill">已停用<strong>{stats.disabled}</strong></span>
              <span className="sip-stat-pill">已分配<strong>{stats.assigned}</strong></span>
            </div>
          </div>

          {/* 表格區域 */}
          <div className="sip-table-card">
            <div className="sip-table-wrapper">
              <table className="sip-table">
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#1a2332' }}>
                <tr>
                  <th style={{ width: '50px', textAlign: 'center', padding: 0, background: '#1a2332' }}>
                    <input
                      type="checkbox"
                      checked={paginatedAccounts.length > 0 && paginatedAccounts.every(acc => selectedIds.includes(acc.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const newIds = new Set(selectedIds);
                          paginatedAccounts.forEach(acc => newIds.add(acc.id));
                          setSelectedIds(Array.from(newIds));
                        } else {
                          const newIds = new Set(selectedIds);
                          paginatedAccounts.forEach(acc => newIds.delete(acc.id));
                          setSelectedIds(Array.from(newIds));
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  {[
                    ['username', '帳號', '190px'],
                    ['status', '狀態', '140px'],
                    ['tenantName', '租戶名稱', '150px'],
                    ['expiresAt', '到期日期', '130px'],
                    ['creatorName', '添加人', '170px'],
                    ['createdAt', '添加時間', '150px'],
                  ].map(([key, label, width]) => (
                    <th key={key} style={{ width, background: '#1a2332' }}>
                      <button type="button" className="sip-sort-btn" onClick={() => handleSort(key)}>{label}{getSortIcon(key)}</button>
                    </th>
                  ))}
                  <th style={{ position: 'sticky', right: 0, backgroundColor: '#1a2332', zIndex: 3, boxShadow: '-1px 0 0 #1f2937', width: '140px', textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {paginatedAccounts.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ padding: 0, textAlign: 'center' }}>
                      <div className="sip-empty">
                        <div>{isLoading ? '載入中...' : '暫無SIP帳號數據'}</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedAccounts.map((acc) => (
                    <tr key={acc.id}>
                      <td style={{ width: '50px', textAlign: 'center', padding: 0 }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(acc.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(prev => [...prev, acc.id]);
                            } else {
                              setSelectedIds(prev => prev.filter(id => id !== acc.id));
                            }
                          }}
                        />
                      </td>
                      <td style={{ color: '#e5e7eb', fontWeight: 500 }}>{acc.username}</td>
                      <td>{getStatusBadge(acc.status)}</td>
                      <td title={acc.tenantName || ''}><span style={{ display: 'block', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.tenantName || '未分配'}</span></td>
                      <td style={{ color: '#9ca3af' }}>{acc.expiresAt ? new Date(acc.expiresAt).toISOString().slice(0, 10) : '-'}</td>
                      <td>{acc.creatorName || '-'}</td>
                      <td>{acc.createdAt || '-'}</td>
                      <td style={{ position: 'sticky', right: 0, backgroundColor: '#111827', zIndex: 1, boxShadow: '-1px 0 0 #1f2937', width: '140px', textAlign: 'center', padding: '0 12px' }}>
                        <div className="row-actions dropdown-container" style={{ display: 'flex', gap: '8px', justifyContent: 'center', whiteSpace: 'nowrap' }}>
                          <button className="ghost-btn" type="button" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={() => handleAction('details', acc)}>詳情</button>
                          <button className="ghost-btn" type="button" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={(e) => {
                            e.stopPropagation();
                            dropdownAnchorRef.current = e.currentTarget;
                            setOpenDropdownId(current => current === acc.id ? null : acc.id);
                          }}>更多</button>
                          {openDropdownId === acc.id && createPortal(
                            <div ref={dropdownMenuRef} className="dropdown-menu-portal" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                              <button type="button" className="dropdown-item" onClick={() => handleAction('details', acc)}>詳情</button>
                              <button type="button" className="dropdown-item" onClick={() => handleAction('edit', acc)}>編輯</button>
                              <button type="button" className="dropdown-item" onClick={() => handleAction('toggle_status', acc)}>{acc.status === 'active' ? '停用' : '啟用'}</button>
                              <button type="button" className="dropdown-item dropdown-item-danger" onClick={() => handleAction('delete', acc)}>刪除</button>
                              <button type="button" className="dropdown-item" onClick={() => handleAction('reset_password', acc)}>重設密碼</button>
                              <button type="button" className="dropdown-item" onClick={() => handleAction('verify', acc)}>帳號校驗</button>
                              {acc.tenantName && (
                                <button type="button" className="dropdown-item" onClick={() => handleAction('unassign', acc)}>取消分配</button>
                              )}
                            </div>, document.body
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 分頁器 */}
          <div className="sip-table-footer">
            <div className="sip-total">共 {filteredAccounts.length} 筆記錄</div>
            <div className="sip-pagination">
              <select className="sip-page-size" value={pageSize} onChange={(e) => { const v = e.target.value; setPageSize(v === '全部' ? '全部' : Number(v)); setCurrentPage(1); }}>{pageSizeOptions.map(opt => <option key={opt} value={opt}>{opt === '全部' ? '全部' : opt + ' 條/頁'}</option>)}</select>
              <button className="sip-page-btn" type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>‹</button>
              <span className="sip-page-current">{currentPage}</span>
              <button className="sip-page-btn" type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>›</button>
              <span className="sip-page-jump">前往<input className="sip-page-input" value={currentPage} readOnly />页</span>
            </div>
          </div>
        </div>
      </div>
      </section>

      {/* 重設密碼彈窗 */}
      {batchAddOpen && createPortal(
        <div className="dialog-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000 }}>
          <form onSubmit={handleBatchAddSubmit} style={{ backgroundColor: '#111827', borderRadius: '8px', width: '460px', maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' }}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#e5e7eb' }}>批量新增帳號</h3>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>起始用戶帳號 <RequiredMark /></span>
                <input type="number" min="1" step="1" value={batchAddForm.start} onChange={e => setBatchAddForm(prev => ({ ...prev, start: e.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} required />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>新增數量 <RequiredMark /></span>
                <input type="number" min="1" max="1000" step="1" value={batchAddForm.count} onChange={e => setBatchAddForm(prev => ({ ...prev, count: e.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} required />
              </label>
              <p style={{ margin: 0, color: '#9ca3af', fontSize: '13px', lineHeight: 1.6 }}>
                系統會按單個增加的預設邏輯建立帳號，用戶名從起始帳號開始遞增，顯示名預設與用戶名一致，預設密碼為 12345678。
              </p>
              {batchAddMessage.text && (
                <p style={{ margin: 0, fontSize: '14px', color: batchAddMessage.type === 'error' ? '#ef4444' : '#10b981', lineHeight: 1.6 }}>{batchAddMessage.text}</p>
              )}
              {batchAddResults && batchAddResults.length > 0 && (
                <>
                  <div style={{ maxHeight: '200px', overflowY: 'auto', background: '#0f172a', borderRadius: '6px', border: '1px solid #1f2937', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {batchAddResults.map((r, i) => (
                      <div key={i} style={{ padding: '8px 12px', borderBottom: i < batchAddResults.length - 1 ? '1px solid #1f2937' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#e5e7eb', fontSize: '13px', fontFamily: 'monospace' }}>{r.username || r.sipUri}</span>
                        <span style={{ color: r.errorCode === 'FLEXISIP_USERNAME_TOMBSTONED' ? '#f59e0b' : '#ef4444', fontSize: '12px' }}>
                          {r.errorCode === 'FLEXISIP_USERNAME_TOMBSTONED' ? '已删除保留' :
                           r.errorCode === 'DUPLICATE_LOCAL_SIP_ACCOUNT' ? '本地已存在' :
                           r.errorCode === 'FLEXISIP_ACCOUNT_ALREADY_EXISTS' ? '远端已存在' :
                           r.errorCode === 'LOCAL_DB_SAVE_FAILED' ? '本地保存失败' :
                           r.message || r.errorCode || '失败'}
                        </span>
                      </div>
                    ))}
                  </div>
                  {batchAddResults.some(r => r.errorCode === 'FLEXISIP_USERNAME_TOMBSTONED') && (
                    <button type="button" disabled={isBatchAdding} onClick={handleBatchReleaseAndRetry} style={{
                      padding: '10px 16px', borderRadius: '6px', backgroundColor: '#1e293b', color: '#fbbf24',
                      border: '1px solid #f59e0b', fontSize: '13px', cursor: 'pointer', width: '100%', fontWeight: 500,
                    }}>
                      {isBatchAdding ? '釋放中...' : `釋放 ${batchAddResults.filter(r => r.errorCode === 'FLEXISIP_USERNAME_TOMBSTONED').length} 個已刪除保留並重試`}
                    </button>
                  )}
                </>
              )}
            </div>
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
              <button type="button" disabled={isBatchAdding} onClick={() => { setBatchAddOpen(false); setBatchAddResults(null); }} style={{ padding: '8px 20px', borderRadius: '6px', backgroundColor: '#1f2937', color: '#d1d5db', border: '1px solid #374151', fontSize: '13px', cursor: 'pointer' }}>取消</button>
              <button className="primary-btn" type="submit" disabled={isBatchAdding}>{isBatchAdding ? '增加中...' : '確認增加'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* 刪除確認彈窗 */}
      {deleteConfirm && createPortal(
        <div className="dialog-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100001 }}>
          <div style={{ backgroundColor: '#111827', borderRadius: '8px', width: '440px', maxWidth: '90vw', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#e5e7eb' }}>
                {deleteConfirm.isBatch ? `確認刪除 ${deleteConfirm.ids.length} 個帳號` : `確認刪除帳號「${deleteConfirm.account?.username}」`}
              </h3>
            </div>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ margin: 0, color: '#d1d5db', fontSize: '14px', lineHeight: 1.7 }}>
                請選擇刪除方式：
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button type="button" onClick={() => executeDelete(false)} style={{
                  padding: '14px 16px', borderRadius: '8px', border: '1px solid #374151', backgroundColor: '#1e293b',
                  color: '#d1d5db', cursor: 'pointer', textAlign: 'left', fontSize: '14px',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: '4px', color: '#fbbf24' }}>保留刪除（預設）</div>
                  <div style={{ fontSize: '12px', color: '#9ca3af' }}>從服務端刪除帳號，但保留該用戶名，防止重複註冊</div>
                </button>
                <button type="button" onClick={() => executeDelete(true)} style={{
                  padding: '14px 16px', borderRadius: '8px', border: '1px solid #dc2626', backgroundColor: '#1e293b',
                  color: '#d1d5db', cursor: 'pointer', textAlign: 'left', fontSize: '14px',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: '4px', color: '#ef4444' }}>徹底刪除</div>
                  <div style={{ fontSize: '12px', color: '#9ca3af' }}>從服務端刪除帳號並釋放該用戶名，允許重新註冊</div>
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
              <button type="button" onClick={() => setDeleteConfirm(null)} style={{ padding: '8px 20px', borderRadius: '6px', backgroundColor: '#1f2937', color: '#d1d5db', border: '1px solid #374151', fontSize: '13px', cursor: 'pointer' }}>取消</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Tombstone 釋放確認彈窗 */}
      {tombstoneRetry && createPortal(
        <div className="dialog-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100001 }}>
          <div style={{ backgroundColor: '#111827', borderRadius: '8px', width: '420px', maxWidth: '90vw', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#e5e7eb' }}>用戶名已被保留</h3>
            </div>
            <div style={{ padding: '24px' }}>
              <p style={{ margin: 0, color: '#d1d5db', fontSize: '14px', lineHeight: 1.7 }}>
                帳號 <strong style={{ color: '#fbbf24' }}>{tombstoneRetry.username}@{tombstoneRetry.domain}</strong> 的用戶名已被刪除保留，無法直接重新創建。
              </p>
              <p style={{ margin: '12px 0 0', color: '#9ca3af', fontSize: '13px', lineHeight: 1.6 }}>
                是否徹底釋放該用戶名後再重新創建帳號？
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
              <button className="ghost-btn" type="button" onClick={() => { setTombstoneRetry(null); setFormMessage({ type: '', text: '' }); }}>取消</button>
              <button className="primary-btn" type="button" onClick={handleTombstoneReleaseAndRetry}>釋放並創建</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 帳號校驗彈窗 */}
      {verifyAccount && createPortal(
        <div className="dialog-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000 }}>
          <div style={{ backgroundColor: '#111827', borderRadius: '10px', width: '520px', maxWidth: '90vw', maxHeight: '80vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#f3f4f6' }}>帳號校驗 — {verifyAccount.username}</h3>
              <button type="button" onClick={() => { setVerifyAccount(null); setVerifyResult(null); }} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '20px' }}>&#10005;</button>
            </div>
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1, scrollbarWidth: 'none' }}>
              {isVerifying ? (
                <p style={{ color: '#9ca3af', textAlign: 'center', padding: '40px 0' }}>正在校驗帳號資訊...</p>
              ) : verifyResult?.error ? (
                <p style={{ color: '#ef4444', textAlign: 'center' }}>{verifyResult.error}</p>
              ) : verifyResult ? (
                <>
                  {verifyResult.consistent ? (
                    <div style={{ textAlign: 'center', padding: '20px 0' }}>
                      <p style={{ color: '#22c55e', fontSize: '16px', fontWeight: 600, margin: '0 0 8px' }}>&#10003; 帳號資訊一致</p>
                      <p style={{ color: '#9ca3af', fontSize: '13px', margin: 0 }}>本地數據與服務端數據完全一致</p>
                    </div>
                  ) : (
                    <>
                      <p style={{ color: '#fbbf24', fontSize: '14px', fontWeight: 600, margin: '0 0 16px' }}>&#9888; 發現以下欄位不一致：</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {verifyResult.differences?.map((diff, i) => (
                          <div key={i} style={{ background: '#1e293b', borderRadius: '8px', padding: '12px 16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ color: '#f3f4f6', fontSize: '13px', fontWeight: 600 }}>{diff.label}</span>
                              {!diff.syncable && (
                                <span style={{ color: '#fbbf24', fontSize: '11px', background: '#3b2508', padding: '2px 8px', borderRadius: '4px' }}>不可同步</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '16px', marginTop: '4px', fontSize: '13px' }}>
                              <span style={{ color: '#9ca3af' }}>本地：<span style={{ color: '#e5e7eb' }}>{diff.localValue || '—'}</span></span>
                              <span style={{ color: '#9ca3af' }}>遠端：<span style={{ color: '#fbbf24' }}>{diff.remoteValue || '—'}</span></span>
                            </div>
                            {diff.reason && <div style={{ marginTop: '4px', fontSize: '11px', color: '#fbbf24' }}>{diff.reason}</div>}
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
                        <button type="button" disabled={isSyncing || !verifyResult.differences?.some(d => d.syncable)} onClick={async () => {
                          setIsSyncing(true);
                          try {
                            await apiClient.post(`/admin/sip-accounts/${verifyAccount.id}/sync-to-flexisip`);
                            loadAccounts();
                            setVerifyAccount(null);
                            setVerifyResult(null);
                            alert('同步成功！');
                          } catch (err) {
                            alert(err.message || '同步失敗');
                          } finally {
                            setIsSyncing(false);
                          }
                        }} style={{ padding: '10px 28px', borderRadius: '8px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', fontSize: '14px', fontWeight: 500, cursor: 'pointer', opacity: (isSyncing || !verifyResult.differences?.some(d => d.syncable)) ? 0.5 : 1 }}>{isSyncing ? '同步中...' : '同步至服務端'}</button>
                        {verifyResult.differences?.some(d => !d.syncable) && !verifyResult.differences?.some(d => d.syncable) && (
                          <p style={{ color: '#fbbf24', fontSize: '12px', textAlign: 'center', margin: '8px 0 0 0' }}>當前差異包含不可同步的 SIP 身份欄位，請人工處理。</p>
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : null}
            </div>
            <div style={{ flexShrink: 0, padding: '14px 18px', borderTop: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setVerifyAccount(null); setVerifyResult(null); }} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#374151', color: '#d1d5db', border: '1px solid #4b5563', fontSize: '14px', fontWeight: 500, cursor: 'pointer' }}>關閉</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {resetPasswordAccount && createPortal(
        <div className="dialog-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000 }}>
          <form onSubmit={handleResetPasswordSubmit} style={{ backgroundColor: '#111827', borderRadius: '10px', width: '420px', maxWidth: '90vw', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#f3f4f6' }}>重設密碼 — {resetPasswordAccount.username}</h3>
            </div>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>新密碼 <RequiredMark /> <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: 400 }}>(至少 6 個字元)</span></span>
                <input type="password" value={resetPasswordValue} onChange={e => setResetPasswordValue(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} required minLength={6} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>確認新密碼 <RequiredMark /></span>
                <input type="password" value={resetConfirmPasswordValue} onChange={e => setResetConfirmPasswordValue(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} required minLength={6} />
              </label>
              {resetMessage.text && <p style={{ margin: '8px 0 0 0', fontSize: '14px', color: resetMessage.type === 'error' ? '#ef4444' : '#22c55e' }}>{resetMessage.text}</p>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
              <button type="button" disabled={isResetting} onClick={() => setResetPasswordAccount(null)} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#374151', color: '#d1d5db', border: '1px solid #4b5563', fontSize: '14px', fontWeight: 500, cursor: 'pointer' }}>取消</button>
              <button className="primary-btn" type="submit" disabled={isResetting}>{isResetting ? '儲存中...' : '確認重設'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </>
  );
});

export default SipAccountRegistration;
