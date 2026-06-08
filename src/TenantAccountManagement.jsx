import React, { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import apiClient from './apiClient';

const navMap = { ecard: 'e-business-card', agent: 'call-center', entrance: 'access-control', room: 'access-control' };

function formatDate(value) {
  if (!value) return '-';
  return String(value).slice(0, 10);
}

function formatChineseDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 19) || '-';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isExpiringSoon(value) {
  if (!value) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiresAt = new Date(String(value).slice(0, 10));
  if (Number.isNaN(expiresAt.getTime())) return false;
  expiresAt.setHours(0, 0, 0, 0);

  const daysUntilExpiry = Math.ceil((expiresAt.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  return daysUntilExpiry >= 0 && daysUntilExpiry <= 7;
}

function isPackageExpired(value) {
  if (!value) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiresAt = new Date(String(value).slice(0, 10));
  if (Number.isNaN(expiresAt.getTime())) return false;
  expiresAt.setHours(0, 0, 0, 0);

  return expiresAt.getTime() < today.getTime();
}

function isPackageActive(value) {
  if (!value) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiresAt = new Date(String(value).slice(0, 10));
  if (Number.isNaN(expiresAt.getTime())) return false;
  expiresAt.setHours(0, 0, 0, 0);

  return expiresAt.getTime() >= today.getTime();
}

function canUseAccountActions(account) {
  return !isPackageExpired(account?.serviceExpiresAt);
}

function getStatusBadge(status) {
  const map = {
    active: { label: '啟用中', bg: '#dcfce7', color: '#15803d' },
    inactive: { label: '未啟用', bg: '#f1f5f9', color: '#475569' },
    disabled: { label: '已停用', bg: '#fee2e2', color: '#dc2626' },
    expired: { label: '已过期', bg: '#fef3c7', color: '#b45309' },
    pending: { label: '待啟用', bg: '#e0f2fe', color: '#0369a1' },
  };
  const item = map[status] || { label: status || '未知', bg: '#f1f5f9', color: '#475569' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: '999px', padding: '3px 10px', fontSize: '12px', lineHeight: 1.4, backgroundColor: item.bg, color: item.color }}>
      {item.label}
    </span>
  );
}

function getStatusLabel(status) {
  const map = {
    active: '啟用中',
    inactive: '未啟用',
    disabled: '已停用',
    expired: '已过期',
    pending: '待啟用',
  };
  return map[status] || status || '未知';
}

const TenantAccountManagement = forwardRef(({
  onStatsChange,
  onNavigate,
  onModeChange,
  apiBasePath = '/tenant/sip-accounts',
  accountLabel = 'SIP',
  showDomain = true,
  enableContactBook = true,
  emptyText = '暫無已分配 SIP 帳號',
}, ref) => {
  const [accounts, setAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [packageFilter, setPackageFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortConfig, setSortConfig] = useState({ key: 'username', direction: 'asc' });
  const [selectedIds, setSelectedIds] = useState([]);
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [detailAccount, setDetailAccount] = useState(null);
  const [editAccount, setEditAccount] = useState(null);
  const [editForm, setEditForm] = useState({ displayName: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [editMessage, setEditMessage] = useState({ type: '', text: '' });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [resetPasswordAccount, setResetPasswordAccount] = useState(null);
  const [resetPasswordForm, setResetPasswordForm] = useState({ password: '', confirmPassword: '' });
  const [resetPasswordMessage, setResetPasswordMessage] = useState({ type: '', text: '' });
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [contactBookAccount, setContactBookAccount] = useState(null);
  const [contactBookTargets, setContactBookTargets] = useState([]);
  const [contactBooks, setContactBooks] = useState([]);
  const [selectedContactBookId, setSelectedContactBookId] = useState('');
  const [isLoadingContactBooks, setIsLoadingContactBooks] = useState(false);
  const [isSavingContactBook, setIsSavingContactBook] = useState(false);
  const [contactBookMessage, setContactBookMessage] = useState({ type: '', text: '' });
  const [qrDialogAccount, setQrDialogAccount] = useState(null);
  const [qrRefreshKey, setQrRefreshKey] = useState(0);
  const [configStatus, setConfigStatus] = useState({});
  const dropdownAnchorRef = useRef(null);
  const dropdownMenuRef = useRef(null);

  const accountStats = useMemo(() => ({
    total: accounts.length,
    active: accounts.filter((account) => account.status === 'active').length,
    inactive: accounts.filter((account) => account.status === 'inactive').length,
    disabled: accounts.filter((account) => account.status === 'disabled').length,
    expired: accounts.filter((account) => account.status === 'expired').length,
  }), [accounts]);


  async function loadAccounts() {
    setIsLoading(true);
    try {
      const keyword = searchKeyword.trim();
      const orderQuery = /^ORD/i.test(keyword) ? keyword : '';
      const queryString = orderQuery ? `?q=${encodeURIComponent(orderQuery)}` : '';
      const data = await apiClient.get(`${apiBasePath}${queryString}`);
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch (error) {
      console.error(`Failed to load tenant ${accountLabel} accounts:`, error);
      setAccounts([]);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadContactBooks() {
    setIsLoadingContactBooks(true);
    try {
      const data = await apiClient.get('/contact-books');
      setContactBooks(Array.isArray(data.contactBooks) ? data.contactBooks : []);
    } catch (error) {
      console.error('Failed to load contact books:', error);
      setContactBooks([]);
      setContactBookMessage({ type: 'error', text: error.message || '读取通讯录失敗' });
    } finally {
      setIsLoadingContactBooks(false);
    }
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    const keyword = searchKeyword.trim();
    const timer = setTimeout(() => {
      if (/^ORD/i.test(keyword) || keyword === '') {
        loadAccounts();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchKeyword]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchKeyword, packageFilter, statusFilter, sortConfig]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!event.target.closest('.tenant-account-more-menu') && !event.target.closest('.dropdown-menu-portal')) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!openDropdownId || !dropdownAnchorRef.current) return undefined;
    const updatePosition = () => {
      const rect = dropdownAnchorRef.current.getBoundingClientRect();
      const menuWidth = 150;
      const viewportPadding = 12;
      let left = rect.right - menuWidth;
      if (left < viewportPadding) left = viewportPadding;
      if (left + menuWidth > window.innerWidth - viewportPadding) {
        left = window.innerWidth - viewportPadding - menuWidth;
      }

      const menuHeight = dropdownMenuRef.current?.offsetHeight || 190;
      let top = rect.bottom + 4;
      if (top + menuHeight > window.innerHeight - viewportPadding) {
        top = rect.top - menuHeight - 4;
      }
      if (top < viewportPadding) top = viewportPadding;

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

  const stats = useMemo(() => {
    const active = accounts.filter((account) => account.status === 'active').length;
    const expired = accounts.filter((account) => account.status === 'expired').length;
    const expiringSoon = accounts.filter((account) => isExpiringSoon(account.serviceExpiresAt)).length;
    return { total: accounts.length, active, expired, expiringSoon };
  }, [accounts]);

  useEffect(() => {
    onStatsChange?.(stats);
  }, [onStatsChange, stats]);

  const filteredAccounts = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return accounts.filter((account) => {
      const matchesSearch = !keyword
        || String(account.username || '').toLowerCase().includes(keyword)
        || String(account.displayName || '').toLowerCase().includes(keyword)
        || String(account.orderNo || '').toLowerCase().includes(keyword);
      const matchesPackage = packageFilter === 'all'
        || (packageFilter === 'active' && isPackageActive(account.serviceExpiresAt))
        || (packageFilter === 'expired' && isPackageExpired(account.serviceExpiresAt));
      const matchesStatus = statusFilter === 'all' || account.status === statusFilter;
      return matchesSearch && matchesPackage && matchesStatus;
    });
  }, [accounts, searchKeyword, packageFilter, statusFilter]);

  const sortedAccounts = useMemo(() => {
    const getSortValue = (account) => {
      if (sortConfig.key === 'username') return account.username || '';
      if (sortConfig.key === 'displayName') return account.displayName || '';
      if (sortConfig.key === 'orderNo') return account.orderNo || '';
      if (sortConfig.key === 'status') return account.status || '';
      if (sortConfig.key === 'serviceStartsAt') return account.serviceStartsAt || '';
      if (sortConfig.key === 'serviceExpiresAt') return account.serviceExpiresAt || '';
      if (sortConfig.key === 'domain') return account.domain || '';
      return '';
    };

    return [...filteredAccounts].sort((left, right) => {
      const leftValue = String(getSortValue(left)).toLowerCase();
      const rightValue = String(getSortValue(right)).toLowerCase();
      const result = leftValue.localeCompare(rightValue, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
      return sortConfig.direction === 'asc' ? result : -result;
    });
  }, [filteredAccounts, sortConfig]);

  useEffect(() => {
    setSelectedIds((ids) => ids.filter((id) => filteredAccounts.some((account) => account.id === id)));
  }, [filteredAccounts]);

  const effectivePageSize = pageSize > 0 ? pageSize : filteredAccounts.length;
  const totalPages = Math.max(1, Math.ceil(sortedAccounts.length / effectivePageSize));
  const paginatedAccounts = pageSize > 0 ? sortedAccounts.slice((currentPage - 1) * pageSize, currentPage * pageSize) : sortedAccounts;
  const isCurrentPageSelected = paginatedAccounts.length > 0 && paginatedAccounts.every((account) => selectedIds.includes(account.id));

  function toggleCurrentPageSelection(checked) {
    if (checked) {
      const nextIds = new Set(selectedIds);
      paginatedAccounts.forEach((account) => nextIds.add(account.id));
      setSelectedIds(Array.from(nextIds));
      return;
    }
    const currentPageIds = new Set(paginatedAccounts.map((account) => account.id));
    setSelectedIds((ids) => ids.filter((id) => !currentPageIds.has(id)));
  }

  function toggleAccountSelection(accountId, checked) {
    if (checked) {
      setSelectedIds((ids) => (ids.includes(accountId) ? ids : [...ids, accountId]));
      return;
    }
    setSelectedIds((ids) => ids.filter((id) => id !== accountId));
  }

  function handleSort(key) {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  }

  function getSortIndicator(key) {
    if (sortConfig.key !== key) return '↕';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  }

  function openEditAccount(account) {
    if (!canUseAccountActions(account)) {
      window.alert('已过期帳號不能編輯。');
      return;
    }
    setEditAccount(account);
    setEditForm({
      displayName: account.displayName || '',
      email: account.email || '',
      phone: account.phone || '',
      password: '',
      confirmPassword: '',
    });
    setEditMessage({ type: '', text: '' });
  }

  function closeEditAccount() {
    if (isSavingEdit) return;
    setEditAccount(null);
    setEditForm({ displayName: '', email: '', phone: '', password: '', confirmPassword: '' });
    setEditMessage({ type: '', text: '' });
  }

  async function submitEditAccount(event) {
    event.preventDefault();
    if (!editAccount) return;
    if ((editForm.password || editForm.confirmPassword) && editForm.password !== editForm.confirmPassword) {
      setEditMessage({ type: 'error', text: '两次输入的密碼不一致。' });
      return;
    }
    if (editForm.password && editForm.password.length < 6) {
      setEditMessage({ type: 'error', text: '密碼至少需要 6 個字符。' });
      return;
    }

    setIsSavingEdit(true);
    setEditMessage({ type: '', text: '' });
    try {
      const result = await apiClient.put(`${apiBasePath}/${editAccount.id}`, editForm);
      const updatedAccount = {
        ...editAccount,
        displayName: result.account?.displayName ?? editForm.displayName,
        email: result.account?.email ?? editForm.email,
        phone: result.account?.phone ?? editForm.phone,
      };
      setAccounts((items) => items.map((item) => (item.id === editAccount.id ? { ...item, ...updatedAccount } : item)));
      setDetailAccount((current) => (current?.id === editAccount.id ? { ...current, ...updatedAccount } : current));
      setEditMessage({ type: 'success', text: result.message || '帳號已更新。' });
      window.setTimeout(() => {
        setEditAccount(null);
        setEditForm({ displayName: '', email: '', phone: '', password: '', confirmPassword: '' });
        setEditMessage({ type: '', text: '' });
      }, 600);
    } catch (error) {
      setEditMessage({ type: 'error', text: error.message || '帳號更新失敗。' });
    } finally {
      setIsSavingEdit(false);
    }
  }

  function openResetPassword(account) {
    const targets = Array.isArray(account) ? account : [account];
    const usableTargets = targets.filter(canUseAccountActions);
    if (usableTargets.length === 0) {
      window.alert('已过期帳號不能重設密碼。');
      return;
    }
    setResetPasswordAccount(usableTargets);
    setResetPasswordForm({ password: '', confirmPassword: '' });
    setResetPasswordMessage({ type: '', text: '' });
  }

  function closeResetPassword() {
    if (isResettingPassword) return;
    setResetPasswordAccount(null);
    setResetPasswordForm({ password: '', confirmPassword: '' });
    setResetPasswordMessage({ type: '', text: '' });
  }

  async function submitResetPassword(event) {
    event.preventDefault();
    const targets = Array.isArray(resetPasswordAccount) ? resetPasswordAccount : [resetPasswordAccount].filter(Boolean);
    if (targets.length === 0) return;
    if (!resetPasswordForm.password) {
      setResetPasswordMessage({ type: 'error', text: '請輸入新密碼。' });
      return;
    }
    if (resetPasswordForm.password.length < 6) {
      setResetPasswordMessage({ type: 'error', text: '密碼至少需要 6 個字符。' });
      return;
    }
    if (resetPasswordForm.password !== resetPasswordForm.confirmPassword) {
      setResetPasswordMessage({ type: 'error', text: '两次输入的密碼不一致。' });
      return;
    }

    setIsResettingPassword(true);
    setResetPasswordMessage({ type: '', text: '' });
    try {
      await Promise.all(targets.map((account) => (
        apiClient.put(`${apiBasePath}/${account.id}`, {
          displayName: account.displayName || '',
          email: account.email || '',
          phone: account.phone || '',
          password: resetPasswordForm.password,
          confirmPassword: resetPasswordForm.confirmPassword,
        })
      )));
      setResetPasswordMessage({ type: 'success', text: '密碼已重設。' });
      window.setTimeout(() => {
        setResetPasswordAccount(null);
        setResetPasswordForm({ password: '', confirmPassword: '' });
        setResetPasswordMessage({ type: '', text: '' });
      }, 600);
    } catch (error) {
      setResetPasswordMessage({ type: 'error', text: error.message || '密碼重設失敗。' });
    } finally {
      setIsResettingPassword(false);
    }
  }

  function getSelectedActionableAccounts(actionLabel) {
    const selectedAccounts = accounts.filter((account) => selectedIds.includes(account.id));
    if (selectedAccounts.length === 0) {
      window.alert('请先選擇帳號。');
      return [];
    }
    const usableAccounts = selectedAccounts.filter(canUseAccountActions);
    if (usableAccounts.length === 0) {
      window.alert(`已过期帳號不能${actionLabel}。`);
      return [];
    }
    return usableAccounts;
  }

  function handleBatchResetPassword() {
    const targets = getSelectedActionableAccounts('重設密碼');
    if (targets.length === 0) return;
    openResetPassword(targets);
  }

  useImperativeHandle(ref, () => ({
    handleBatchResetPassword,
  }), []);

  useEffect(() => {
    onModeChange?.(detailAccount || editAccount ? 'detail' : 'list');
  }, [detailAccount, editAccount, onModeChange]);

  function handleBatchConfigureContactBook() {
    const targets = getSelectedActionableAccounts('通訊錄配置').filter((account) => account.status === 'active');
    if (targets.length === 0) {
      window.alert('只有啟用中的帳號可以通訊錄配置。');
      return;
    }
    const firstContactBookId = targets[0]?.contactBookId ? String(targets[0].contactBookId) : '';
    const hasSameContactBook = targets.every((account) => String(account.contactBookId || '') === firstContactBookId);
    setContactBookTargets(targets);
    setContactBookAccount(targets[0] || null);
    setSelectedContactBookId(hasSameContactBook ? firstContactBookId : '');
    setContactBookMessage({ type: '', text: '' });
    if (contactBooks.length === 0) loadContactBooks();
  }

  function handleBatchNotify() {
    const targets = getSelectedActionableAccounts('發送通知');
    if (targets.length === 0) return;
    const recipients = targets.map((account) => account.email).filter(Boolean);
    if (recipients.length === 0) {
      window.alert('所选帳號沒有登记郵箱。');
      return;
    }
    const subject = `${accountLabel}帳號通知`;
    const body = [
      '您好，',
      '',
      `请及时查看并维护您的 ${accountLabel} 帳號信息。`,
      '首次获得帳號后请务必修改帳號初始密碼。',
      '',
      '--',
      'QRTalkie Cloud',
      '重設密碼：请登录控制台，在帳號管理中修改初始密碼。如无法登录，请联系管理員协助重設。',
    ].join('\n');
    window.location.href = `mailto:${recipients.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function saveContactBookConfig(event) {
    event.preventDefault();
    const targets = contactBookTargets.length > 0 ? contactBookTargets : (contactBookAccount ? [contactBookAccount] : []);
    if (targets.length === 0) return;
    const targetText = targets.length === 1 ? `帳號 ${targets[0].username}` : `所选 ${targets.length} 個帳號`;
    if (!window.confirm(`確定要儲存${targetText}的通讯录配置吗？`)) return;
    setIsSavingContactBook(true);
    setContactBookMessage({ type: '', text: '' });
    try {
      const result = await apiClient.put('/tenant/sip-accounts/contact-book', {
        accountIds: targets.map((account) => account.id),
        contactBookId: selectedContactBookId || null,
      });
      const updated = {
        contactBookId: result.account?.contactBookId ?? null,
        contactBookName: result.account?.contactBookName || '',
      };
      const updatedIds = new Set(targets.map((account) => account.id));
      setAccounts((items) => items.map((item) => (updatedIds.has(item.id) ? { ...item, ...updated } : item)));
      setDetailAccount((current) => (current && updatedIds.has(current.id) ? { ...current, ...updated } : current));
      setContactBookAccount(null);
      setContactBookTargets([]);
    } catch (error) {
      setContactBookMessage({ type: 'error', text: error.message || '通訊錄配置失敗。' });
    } finally {
      setIsSavingContactBook(false);
    }
  }

  function closeContactBookConfig() {
    setContactBookAccount(null);
    setContactBookTargets([]);
    setContactBookMessage({ type: '', text: '' });
  }

  function handleAction(action, account) {
    setOpenDropdownId(null);
    if (action === 'details') {
      setDetailAccount(account);
      setConfigStatus({});
      apiClient.get(`/tenant/sip-accounts/${account.id}/config-status`).then(res => {
        if (res?.data) setConfigStatus(res.data);
      }).catch(() => {});
      return;
    }
    if (action === 'email') {
      if (!canUseAccountActions(account)) {
        window.alert('已过期帳號不能發送邮件。');
        return;
      }
      if (!account.email) {
        window.alert('该帳號沒有登记郵箱。');
        return;
      }
    const subject = `${accountLabel}帳號通知`;
    const body = [
      '您好，',
      '',
      `您的 ${accountLabel} 帳號信息如下：`,
      `帳號：${account.username || '-'}`,
      ...(showDomain ? [`域名：${account.domain || '-'}`] : []),
      `顯示名稱：${account.displayName || '-'}`,
        '',
        '首次获得帳號后请务必修改帳號初始密碼。',
        '',
        '--',
        'QRTalkie Cloud',
        '重設密碼：请登录控制台，在帳號管理中修改初始密碼。如无法登录，请联系管理員协助重設。',
      ].join('\n');
      window.location.href = `mailto:${account.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return;
    }
    if (action === 'reset_password') {
      openResetPassword(account);
      return;
    }
    if (action === 'edit') {
      openEditAccount(account);
      return;
    }
    if (action === 'configure_contact_book') {
      if (!enableContactBook) return;
      setContactBookAccount(account);
      setContactBookTargets([account]);
      setSelectedContactBookId(account.contactBookId ? String(account.contactBookId) : '');
      setContactBookMessage({ type: '', text: '' });
      if (contactBooks.length === 0) loadContactBooks();
      return;
    }
    if (action === 'toggle_status') {
      if (!canUseAccountActions(account)) {
        window.alert('已过期帳號不能啟用或停用。');
        return;
      }
      const nextStatus = account.status === 'active' ? 'disabled' : 'active';
      const actionText = nextStatus === 'active' ? '啟用' : '停用';
      if (!window.confirm(`確定要${actionText}帳號 ${account.username} 吗？`)) return;
      apiClient.put(`${apiBasePath}/${account.id}/status`, { status: nextStatus })
        .then((result) => {
          setAccounts((items) => items.map((item) => (item.id === account.id ? { ...item, status: result.account?.status || nextStatus } : item)));
          setDetailAccount((current) => (current?.id === account.id ? { ...current, status: result.account?.status || nextStatus } : current));
        })
        .catch((error) => {
          window.alert(error.message || '帳號狀態更新失敗。');
        });
    }
  }

  if (detailAccount) {
    const readonlyInputStyle = {
      padding: '10px',
      borderRadius: '6px',
      border: '1px solid #1f2937',
      outline: 'none',
      backgroundColor: '#1a2332',
      color: '#64748b',
    };
    const labelStyle = { display: 'flex', flexDirection: 'column', gap: '8px' };
    const labelTextStyle = { fontSize: '14px', fontWeight: 500, color: '#475569' };

    return (
      <section className="view active settings-form-page" id="tenant-account-management-detail" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #1f2937', overflow: 'hidden', margin: 0 }}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6', fontWeight: 600 }}>帳號詳情</h3>
              <button className="ghost-btn" type="button" onClick={() => setDetailAccount(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px' }}>
                返回列表
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
              <h4 style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b', marginBottom: '16px', marginTop: 0 }}>基础帳號信息</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
                <label style={labelStyle}>
                  <span style={labelTextStyle}>用户名</span>
                  <input value={detailAccount.username || '-'} readOnly style={readonlyInputStyle} />
                </label>
                {showDomain && (
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>域名</span>
                    <input value={detailAccount.domain || '-'} readOnly style={readonlyInputStyle} />
                  </label>
                )}
                <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
                  <span style={labelTextStyle}>顯示名稱</span>
                  <input value={detailAccount.displayName || detailAccount.username || '-'} readOnly style={readonlyInputStyle} />
                </label>
                {enableContactBook && (
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>通讯录</span>
                    <input value={detailAccount.contactBookName || '未配置'} readOnly style={readonlyInputStyle} />
                  </label>
                )}
                <label style={labelStyle}>
                  <span style={labelTextStyle}>角色</span>
                  <input value={detailAccount.role || 'user'} readOnly style={readonlyInputStyle} />
                </label>
                <label style={labelStyle}>
                  <span style={labelTextStyle}>狀態</span>
                  <input value={getStatusLabel(detailAccount.status)} readOnly style={readonlyInputStyle} />
                </label>
              </div>

              <h4 style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b', marginBottom: '16px', marginTop: 0 }}>套餐与服务信息</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
                <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
                  <span style={labelTextStyle}>订单编号</span>
                  <input value={detailAccount.orderNo || '-'} readOnly style={readonlyInputStyle} />
                </label>
                <label style={labelStyle}>
                  <span style={labelTextStyle}>开始日期</span>
                  <input value={formatDate(detailAccount.serviceStartsAt)} readOnly style={readonlyInputStyle} />
                </label>
                <label style={labelStyle}>
                  <span style={labelTextStyle}>结束日期</span>
                  <input value={formatDate(detailAccount.serviceExpiresAt)} readOnly style={readonlyInputStyle} />
                </label>
                <label style={labelStyle}>
                  <span style={labelTextStyle}>套餐狀態</span>
                  <input value={isPackageExpired(detailAccount.serviceExpiresAt) ? '已过期套餐' : '生效中套餐'} readOnly style={readonlyInputStyle} />
                </label>
                <label style={labelStyle}>
                  <span style={labelTextStyle}>即将过期</span>
                  <input value={isExpiringSoon(detailAccount.serviceExpiresAt) ? '是' : '否'} readOnly style={readonlyInputStyle} />
                </label>
              </div>

              <h4 style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b', marginBottom: '16px', marginTop: 0 }}>联系信息</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <label style={labelStyle}>
                  <span style={labelTextStyle}>手機号</span>
                  <input value={detailAccount.phone || '-'} readOnly style={readonlyInputStyle} />
                </label>
                <label style={labelStyle}>
                  <span style={labelTextStyle}>郵箱</span>
                  <input value={detailAccount.email || '-'} readOnly style={readonlyInputStyle} />
                </label>
                <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
                  <span style={labelTextStyle}>分配時間</span>
                  <input value={formatChineseDateTime(detailAccount.assignedAt)} readOnly style={readonlyInputStyle} />
                </label>
              </div>

              <h4 style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b', marginBottom: '12px', marginTop: '24px' }}>配置情況</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { label: '電子名片', key: 'ecard', msg: '尚未配置電子名片', doneMsg: '已配置電子名片' },
                  { label: '客服坐席', key: 'agent', msg: '尚未配置為客服坐席', doneMsg: '已配置為客服坐席' },
                  { label: '門禁入口', key: 'entrance', msg: '尚未配置為門禁入口', doneMsg: '已配置為門禁入口' },
                  { label: '房間分配', key: 'room', msg: '尚未分配至房間', doneMsg: '已分配至房間' },
                ].map(item => { const done = configStatus[item.key] || false; return (<div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #1f2937' }}><div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', background: done ? '#16a34a' : '#94a3b8' }}></span>
                      <span style={{ fontSize: '13px', color: '#d1d5db' }}>{item.label}</span>
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>{done ? item.doneMsg : item.msg}</span>
                    </div>
                    <button className="ghost-btn" type="button" style={{ fontSize: '12px', padding: '4px 10px' }} onClick={() => onNavigate && onNavigate(navMap[item.key])}>去配置</button></div>);})}</div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="view active" id="tenant-account-management" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0f172a' }}>
      <style jsx>{`
        .dropdown-menu-portal {
          position: fixed;
          width: 150px;
          background: #1a2332;
          border: 1px solid #1f2937;
          border-radius: 6px;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
          padding: 6px;
          z-index: 2147483647;
        }
        .dropdown-menu-portal .dropdown-item {
          display: block;
          width: 100%;
          border: 0;
          background: transparent;
          color: #d1d5db;
          text-align: left;
          border-radius: 4px;
          padding: 8px 10px;
          font-size: 12px;
          cursor: pointer;
        }
        .dropdown-menu-portal .dropdown-item:hover {
          background: #1f2937;
          color: #f3f4f6;
        }
        .dropdown-menu-portal .dropdown-item:disabled {
          color: #6b7280;
          cursor: not-allowed;
          background: transparent;
        }
        .tenant-account-sort-button {
          width: 100%;
          border: 0;
          background: transparent;
          color: inherit;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 0;
          font: inherit;
          text-align: left;
          cursor: pointer;
        }
        .tenant-account-sort-button span:last-child {
          color: #6b7280;
          font-size: 12px;
        }
        #tenant-account-management .account-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 22px 24px;
          margin-bottom: 24px;
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 14px;
          box-shadow: none;
        }
        #tenant-account-management .account-filter-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 0 1 auto;
          min-width: 0;
          white-space: nowrap;
        }
        #tenant-account-management .account-search {
          position: relative;
          width: clamp(280px, 30vw, 360px);
          flex: 0 1 360px;
          max-width: 100%;
        }
        #tenant-account-management .account-search svg {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          color: #6b7280;
          pointer-events: none;
        }
        #tenant-account-management .account-search input {
          width: 100%;
          height: 46px;
          padding: 0 16px 0 44px;
          border-radius: 9px;
          border: 1px solid #374151;
          background: #1a2332;
          color: #d1d5db;
          font-size: 12px;
          outline: none;
          box-sizing: border-box;
        }
        #tenant-account-management .account-search input::placeholder { color: #6b7280; }
        #tenant-account-management .account-search input:focus {
          border-color: #60a5fa;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }
        #tenant-account-management .account-status-select,
        #tenant-account-management .account-package-select {
          height: 46px;
          min-width: 112px;
          width: 120px;
          padding: 0 12px;
          border-radius: 9px;
          border: 1px solid #374151;
          background: #1a2332;
          color: #d1d5db;
          font-size: 12px;
          outline: none;
          cursor: pointer;
        }
        #tenant-account-management .account-stats {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex: 0 0 auto;
          flex-wrap: nowrap;
          white-space: nowrap;
        }
        #tenant-account-management .account-stat-pill {
          height: 34px;
          padding: 0 12px;
          border-radius: 999px;
          background: #1a2332;
          border: 1px solid #1f2937;
          color: #9ca3af;
          font-size: 12px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          flex: 0 0 auto;
          white-space: nowrap;
        }
        #tenant-account-management .account-stat-pill strong {
          color: #f3f4f6;
          font-size: 12px;
          font-weight: 700;
        }
        #tenant-account-management .account-table-card {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 14px;
          box-shadow: none;
          overflow: hidden;
        }
        #tenant-account-management .account-table-wrapper {
          width: 100%;
          flex: 1;
          min-height: 0;
          overflow-x: auto;
          overflow-y: auto;
          scrollbar-width: none;
        }
        #tenant-account-management .account-table-wrapper::-webkit-scrollbar { display: none; }
        #tenant-account-management .account-table {
          width: 100%;
          min-width: 1180px;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 12px;
        }
        #tenant-account-management .account-table thead { background: #1a2332; }
        #tenant-account-management .account-table th {
          height: 56px;
          padding: 0 22px;
          text-align: left;
          color: #9ca3af;
          font-weight: 600;
          border-bottom: 1px solid #1f2937;
          white-space: nowrap;
          background: #1a2332 !important;
        }
        #tenant-account-management .account-table td {
          height: 64px;
          padding: 0 22px;
          color: #d1d5db;
          border-bottom: 1px solid #1f2937;
          white-space: nowrap;
        }
        #tenant-account-management .account-empty {
          height: 380px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border-bottom: 1px solid #1f2937;
          color: #9ca3af;
        }
        #tenant-account-management .account-table-footer {
          min-height: 74px;
          padding: 0 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #1a2332;
        }
        #tenant-account-management .account-total {
          color: #9ca3af;
          font-size: 12px;
        }
        #tenant-account-management .account-pagination {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        #tenant-account-management .account-page-size {
          height: 38px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid #374151;
          background: #1a2332;
          color: #9ca3af;
          font-size: 11px;
          display: inline-flex;
          align-items: center;
        }
        #tenant-account-management .account-page-btn,
        #tenant-account-management .account-page-current {
          width: 38px;
          height: 38px;
          border-radius: 8px;
          border: 1px solid #374151;
          background: #1a2332;
          color: #9ca3af;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
        }
        #tenant-account-management .account-page-current {
          border-color: #60a5fa;
          color: #60a5fa;
          background: #1e3a5f;
          font-weight: 600;
        }
        #tenant-account-management .account-page-btn {
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        #tenant-account-management .account-page-btn:disabled {
          color: #4b5563;
          cursor: not-allowed;
          background: #1a2332;
        }
        #tenant-account-management .account-page-jump {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #9ca3af;
          font-size: 11px;
        }
        #tenant-account-management .account-page-input {
          width: 56px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid #374151;
          text-align: center;
          outline: none;
          color: #d1d5db;
          background: #1a2332;
          font-size: 11px;
        }
        @media (max-width: 1100px) {
          #tenant-account-management .account-toolbar {
            overflow-x: auto;
            scrollbar-width: none;
          }
          #tenant-account-management .account-toolbar::-webkit-scrollbar { height: 0; }
          #tenant-account-management .account-filter-left { flex-wrap: nowrap; }
          #tenant-account-management .account-stats { justify-content: flex-end; }
        }
        @media (max-width: 720px) {
          #tenant-account-management .account-toolbar { padding: 18px; }
          #tenant-account-management .account-table-footer { padding: 14px 20px; flex-wrap: wrap; }
          #tenant-account-management .account-pagination { flex-wrap: wrap; }
        }
      `}</style>
      <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '0', paddingBottom: '0' }}>
        <div className="account-toolbar">
          <div className="account-filter-left">
            <label className="account-search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="search" placeholder={`搜尋 ${accountLabel} 帳號、顯示名稱或订单编号`} value={searchKeyword} onChange={(event) => setSearchKeyword(event.target.value)} />
            </label>
            <select className="account-package-select" value={packageFilter} onChange={(event) => setPackageFilter(event.target.value)}>
              <option value="all">全部套餐</option>
              <option value="active">生效中套餐</option>
              <option value="expired">已过期套餐</option>
            </select>
            <select className="account-status-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">全部</option>
              <option value="active">啟用中</option>
              <option value="disabled">已停用</option>
            </select>
          </div>
          <div className="account-stats">
            <span className="account-stat-pill">全部<strong>{accountStats.total}</strong></span>
            <span className="account-stat-pill">啟用中<strong>{accountStats.active}</strong></span>
            <span className="account-stat-pill">未啟用<strong>{accountStats.inactive}</strong></span>
            <span className="account-stat-pill">已停用<strong>{accountStats.disabled}</strong></span>
            <span className="account-stat-pill">已过期<strong>{accountStats.expired}</strong></span>
          </div>
        </div>

        <div className="account-table-card">
          <div className="account-table-wrapper">
          <table className="account-table">
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, backgroundColor: '#1a2332' }}>
              <tr>
                <th style={{ width: '50px', textAlign: 'center', padding: 0 }}>
                  <input
                    type="checkbox"
                    checked={isCurrentPageSelected}
                    onChange={(event) => toggleCurrentPageSelection(event.target.checked)}
                    aria-label="選擇當前頁帳號"
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th><button className="tenant-account-sort-button" type="button" onClick={() => handleSort('username')}><span>帳號</span><span>{getSortIndicator('username')}</span></button></th>
                <th><button className="tenant-account-sort-button" type="button" onClick={() => handleSort('displayName')}><span>顯示名稱</span><span>{getSortIndicator('displayName')}</span></button></th>
                <th><button className="tenant-account-sort-button" type="button" onClick={() => handleSort('webAccount')}><span>Web 帳號</span><span>{getSortIndicator('webAccount')}</span></button></th>
                <th><button className="tenant-account-sort-button" type="button" onClick={() => handleSort('contactBookName')}><span>通訊錄</span><span>{getSortIndicator('contactBookName')}</span></button></th>
                <th><button className="tenant-account-sort-button" type="button" onClick={() => handleSort('orderNo')}><span>订单编号</span><span>{getSortIndicator('orderNo')}</span></button></th>
                <th><button className="tenant-account-sort-button" type="button" onClick={() => handleSort('status')}><span>狀態</span><span>{getSortIndicator('status')}</span></button></th>
                <th><button className="tenant-account-sort-button" type="button" onClick={() => handleSort('serviceStartsAt')}><span>开始日期</span><span>{getSortIndicator('serviceStartsAt')}</span></button></th>
                <th><button className="tenant-account-sort-button" type="button" onClick={() => handleSort('serviceExpiresAt')}><span>结束日期</span><span>{getSortIndicator('serviceExpiresAt')}</span></button></th>
                {showDomain && <th><button className="tenant-account-sort-button" type="button" onClick={() => handleSort('domain')}><span>域名</span><span>{getSortIndicator('domain')}</span></button></th>}
                <th style={{ position: 'sticky', right: 0, backgroundColor: '#1a2332', zIndex: 3, boxShadow: '-1px 0 0 #1f2937', width: '140px', textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {paginatedAccounts.length === 0 ? (
                <tr>
                  <td colSpan={showDomain ? 9 : 8} style={{ padding: 0, textAlign: 'center' }}>
              <div className="account-empty">
                    {isLoading ? '載入中...' : '暫無帳號'}
                  </div>
                </td>
                </tr>
              ) : (
                paginatedAccounts.map((account) => (
                  <tr key={account.id}>
                    <td style={{ width: '50px', textAlign: 'center', padding: 0 }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(account.id)}
                        onChange={(event) => toggleAccountSelection(account.id, event.target.checked)}
                        aria-label={`選擇帳號 ${account.username}`}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ color: '#f3f4f6', fontWeight: 500 }}>{account.username}</td>
                    <td>{account.displayName || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{account.webAccount || '—'}</td>
                    <td style={{ fontSize: '12px' }}>{account.contactBookName || '—'}</td>
                    <td>{account.orderNo || '-'}</td>
                    <td style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>{getStatusBadge(account.status)}</td>
                    <td>{formatDate(account.serviceStartsAt)}</td>
                    <td>{formatDate(account.serviceExpiresAt)}</td>
                    {showDomain && <td>{account.domain || '-'}</td>}
                    <td style={{ position: 'sticky', right: 0, backgroundColor: '#111827', zIndex: 1, boxShadow: '-1px 0 0 #e2e8f0', width: '140px', textAlign: 'center', padding: '0 12px' }}>
                      <div className="row-actions tenant-account-more-menu" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button className="ghost-btn" type="button" style={{ fontSize: '12px', padding: '6px 10px' }} onClick={() => handleAction('details', account)}>詳情</button>
                        <button
                          className="ghost-btn"
                          type="button"
                          style={{ fontSize: '12px', padding: '6px 10px' }}
                          onClick={(event) => {
                            event.stopPropagation();
                            dropdownAnchorRef.current = event.currentTarget;
                            setOpenDropdownId((current) => (current === account.id ? null : account.id));
                          }}
                        >
                          更多
                        </button>
                        {openDropdownId === account.id && createPortal(
                          <div ref={dropdownMenuRef} className="dropdown-menu-portal" style={{ top: dropdownPosition.top, left: dropdownPosition.left, zIndex: 2147483647 }}>
                            <button type="button" className="dropdown-item" onClick={() => handleAction('details', account)}>詳情</button>
                            <button type="button" className="dropdown-item" disabled={!canUseAccountActions(account)} onClick={() => handleAction('edit', account)}>編輯</button>
                            <button type="button" className="dropdown-item" disabled={!canUseAccountActions(account)} onClick={() => handleAction('toggle_status', account)}>{account.status === 'active' ? '停用' : '啟用'}</button>
                            <button type="button" className="dropdown-item" disabled={!canUseAccountActions(account)} onClick={() => handleAction('reset_password', account)}>重設密碼</button>
                            <button type="button" className="dropdown-item" disabled={!canUseAccountActions(account)} onClick={() => handleAction('email', account)}>發送邮件</button>
                            {enableContactBook && <button type="button" className="dropdown-item" disabled={!canUseAccountActions(account) || account.status !== 'active'} onClick={() => handleAction('configure_contact_book', account)}>通訊錄配置</button>}
                            <button type="button" className="dropdown-item" onClick={() => setQrDialogAccount(account)}>二維碼管理</button>
                          </div>,
                          document.body
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="account-table-footer">
            <div className="account-total">共 {filteredAccounts.length} 條</div>
            <div className="account-pagination">
              <select className="account-page-size" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}>
                <option value={10}>10 條/頁</option>
                <option value={20}>20 條/頁</option>
                <option value={50}>50 條/頁</option>
                <option value={100}>100 條/頁</option>
                <option value={-1}>全部</option>
              </select>
              <button className="account-page-btn" type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => page - 1)}>‹</button>
              <span className="account-page-current">{currentPage}</span>
              <button className="account-page-btn" type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((page) => page + 1)}>›</button>
              <span className="account-page-jump">前往<input className="account-page-input" value={currentPage} readOnly />页</span>
            </div>
          </div>
        </div>
      </div>
      {detailAccount && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2147483646,
            backgroundColor: 'rgba(15, 23, 42, 0.36)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDetailAccount(null);
          }}
        >
          <div style={{ width: 'min(560px, 100%)', backgroundColor: '#111827', borderRadius: '8px', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.22)', overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>帳號詳情</h3>
              <button className="ghost-btn" type="button" onClick={() => setDetailAccount(null)} style={{ padding: '4px 10px' }}>關閉</button>
            </div>
            <div style={{ overflow: 'auto', flex: 1, padding: '18px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '10px 14px', fontSize: '14px', color: '#d1d5db' }}>
              <span style={{ color: '#64748b' }}>帳號</span><strong style={{ color: '#f3f4f6', fontWeight: 600 }}>{detailAccount.username || '-'}</strong>
              <span style={{ color: '#64748b' }}>顯示名稱</span><span>{detailAccount.displayName || '-'}</span>
              <span style={{ color: '#64748b' }}>狀態</span><span>{getStatusBadge(detailAccount.status)}</span>
              <span style={{ color: '#64748b' }}>订单编号</span><span>{detailAccount.orderNo || '-'}</span>
              <span style={{ color: '#64748b' }}>域名</span><span>{detailAccount.domain || '-'}</span>
              <span style={{ color: '#64748b' }}>郵箱</span><span>{detailAccount.email || '-'}</span>
              <span style={{ color: '#64748b' }}>電話</span><span>{detailAccount.phone || '-'}</span>
              <span style={{ color: '#64748b' }}>开始日期</span><span>{formatDate(detailAccount.serviceStartsAt)}</span>
              <span style={{ color: '#64748b' }}>结束日期</span><span>{formatDate(detailAccount.serviceExpiresAt)}</span>
            </div>
            <div style={{ borderTop: '1px solid #e2e8f0', marginTop: '14px', paddingTop: '14px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#f3f4f6', marginBottom: '12px' }}>配置情況</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { label: '電子名片', key: 'ecard', msg: '尚未配置電子名片', doneMsg: '已配置電子名片' },
                  { label: '客服坐席', key: 'agent', msg: '尚未配置為客服坐席', doneMsg: '已配置為客服坐席' },
                  { label: '門禁入口', key: 'entrance', msg: '尚未配置為門禁入口', doneMsg: '已配置為門禁入口' },
                  { label: '房間分配', key: 'room', msg: '尚未分配至房間', doneMsg: '已分配至房間' },
                ].map(item => (
                  <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #1f2937' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: item.done ? '#16a34a' : '#94a3b8' }}></span>
                      <span style={{ fontSize: '13px', color: '#d1d5db' }}>{item.label}</span>
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>{done ? item.doneMsg : item.msg}</span>
                    </div>
                    <button className="ghost-btn" type="button" style={{ fontSize: '12px', padding: '4px 10px' }} onClick={() => onNavigate && onNavigate(navMap[item.key])}>去配置</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>,
        document.body
      )}
      {editAccount && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2147483646,
            backgroundColor: 'rgba(15, 23, 42, 0.36)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditAccount();
          }}
        >
          <form
            onSubmit={submitEditAccount}
            style={{ width: 'min(560px, 100%)', backgroundColor: '#111827', borderRadius: '8px', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.22)', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>編輯帳號</h3>
              <button className="ghost-btn" type="button" onClick={closeEditAccount} disabled={isSavingEdit} style={{ padding: '4px 10px' }}>關閉</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', padding: '18px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', gridColumn: '1 / -1' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#475569' }}>顯示名稱</span>
                <input value={editForm.displayName} onChange={(event) => setEditForm((form) => ({ ...form, displayName: event.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#475569' }}>电子郵箱</span>
                <input type="email" value={editForm.email} onChange={(event) => setEditForm((form) => ({ ...form, email: event.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#475569' }}>移动電話</span>
                <input value={editForm.phone} onChange={(event) => setEditForm((form) => ({ ...form, phone: event.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#475569' }}>密碼</span>
                <input type="password" value={editForm.password} onChange={(event) => setEditForm((form) => ({ ...form, password: event.target.value }))} placeholder="不修改请留空" style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#475569' }}>密碼確認</span>
                <input type="password" value={editForm.confirmPassword} onChange={(event) => setEditForm((form) => ({ ...form, confirmPassword: event.target.value }))} placeholder="不修改请留空" style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none' }} />
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', borderTop: '1px solid #e2e8f0', backgroundColor: '#1a2332' }}>
              {editMessage.text && <p style={{ margin: 0, marginRight: 'auto', fontSize: '14px', color: editMessage.type === 'error' ? '#dc2626' : '#16a34a' }}>{editMessage.text}</p>}
              <button className="ghost-btn" type="button" onClick={closeEditAccount} disabled={isSavingEdit}>取消</button>
              <button className="primary-btn" type="submit" disabled={isSavingEdit}>{isSavingEdit ? '儲存中...' : '儲存修改'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}
      {resetPasswordAccount && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2147483646,
            backgroundColor: 'rgba(15, 23, 42, 0.36)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeResetPassword();
          }}
        >
          <form
            onSubmit={submitResetPassword}
            style={{ width: 'min(480px, 100%)', backgroundColor: '#111827', borderRadius: '8px', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.22)', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>重設密碼</h3>
              <button className="ghost-btn" type="button" onClick={closeResetPassword} disabled={isResettingPassword} style={{ padding: '4px 10px' }}>關閉</button>
            </div>
            <div style={{ display: 'grid', gap: '14px', padding: '18px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#475569' }}>密碼</span>
                <input
                  type="password"
                  value={resetPasswordForm.password}
                  onChange={(event) => setResetPasswordForm((form) => ({ ...form, password: event.target.value }))}
                  autoComplete="new-password"
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#475569' }}>密碼確認</span>
                <input
                  type="password"
                  value={resetPasswordForm.confirmPassword}
                  onChange={(event) => setResetPasswordForm((form) => ({ ...form, confirmPassword: event.target.value }))}
                  autoComplete="new-password"
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none' }}
                />
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', borderTop: '1px solid #e2e8f0', backgroundColor: '#1a2332' }}>
              {resetPasswordMessage.text && <p style={{ margin: 0, marginRight: 'auto', fontSize: '14px', color: resetPasswordMessage.type === 'error' ? '#dc2626' : '#16a34a' }}>{resetPasswordMessage.text}</p>}
              <button className="ghost-btn" type="button" onClick={closeResetPassword} disabled={isResettingPassword}>取消</button>
              <button className="primary-btn" type="submit" disabled={isResettingPassword}>{isResettingPassword ? '儲存中...' : '確認重設'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}
      {contactBookAccount && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2147483646,
            backgroundColor: 'rgba(15, 23, 42, 0.36)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeContactBookConfig();
          }}
        >
          <form onSubmit={saveContactBookConfig} style={{ width: 'min(560px, 100%)', backgroundColor: '#111827', borderRadius: '8px', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.22)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>通訊錄配置</h3>
              <button className="ghost-btn" type="button" onClick={closeContactBookConfig} style={{ padding: '4px 10px' }}>關閉</button>
            </div>
            <div style={{ display: 'grid', gap: '14px', padding: '18px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#475569' }}>帳號</span>
                <input value={contactBookTargets.length > 1 ? `已選擇 ${contactBookTargets.length} 個帳號` : `${contactBookAccount.username || '-'}${contactBookAccount.domain ? ` | ${contactBookAccount.domain}` : ''}`} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#64748b' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#475569' }}>通讯录</span>
                <select
                  value={selectedContactBookId}
                  onChange={(event) => setSelectedContactBookId(event.target.value)}
                  disabled={isLoadingContactBooks || isSavingContactBook}
                  style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#111827', color: '#d1d5db' }}
                >
                  <option value="">未配置</option>
                  {contactBooks.map((book) => (
                    <option key={book.id} value={book.id}>{book.name}</option>
                  ))}
                </select>
              </label>
              {isLoadingContactBooks && <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>正在載入通讯录...</p>}
              {!isLoadingContactBooks && contactBooks.length === 0 && <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>暫無已創建的通讯录。</p>}
              {contactBookMessage.text && <p style={{ margin: 0, fontSize: '14px', color: contactBookMessage.type === 'error' ? '#dc2626' : '#16a34a' }}>{contactBookMessage.text}</p>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #e2e8f0' }}>
              <button className="ghost-btn" type="button" onClick={closeContactBookConfig} disabled={isSavingContactBook}>取消</button>
              <button className="primary-btn" type="submit" disabled={isLoadingContactBooks || isSavingContactBook}>{isSavingContactBook ? '儲存中...' : '儲存'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}
      {/* 二維碼管理對話框 */}
      {qrDialogAccount && createPortal((
        <div style={{ position: 'fixed', inset: 0, zIndex: 2147483647, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setQrDialogAccount(null)}>
          <div style={{ background: '#111827', borderRadius: '16px', padding: '28px 24px 20px', maxWidth: '480px', width: '90%', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>二維碼管理 — {qrDialogAccount.username}</h3>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button onClick={() => setQrRefreshKey(k => k + 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '16px', padding: '2px' }} title="刷新">🔄</button>
                <button onClick={() => setQrDialogAccount(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '18px' }}>✕</button>
              </div>
            </div>
            <img src={'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent('mock://login/' + qrDialogAccount.username) + '&t=' + qrRefreshKey} alt="QR" style={{ width: '200px', height: '200px', borderRadius: '8px', border: '1px solid #1f2937' }} />
            <div style={{ display: 'flex', gap: '6px', marginTop: '16px', justifyContent: 'center', flexWrap: 'nowrap' }}>
              <button onClick={async () => { try { const r = await fetch('https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent('mock://login/' + qrDialogAccount.username)); const b = await r.blob(); const img = await createImageBitmap(b); const canvas = document.createElement('canvas'); const label = '二維碼管理 ' + (qrDialogAccount.username || ''); const ctx = canvas.getContext('2d'); ctx.font = 'bold 14px system-ui'; const tw = ctx.measureText(label).width; const maxW = Math.max(200, tw + 20); canvas.width = maxW; canvas.height = 240; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, (maxW - 200) / 2, 10); ctx.fillStyle = '#0f172a'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center'; ctx.fillText(label, maxW / 2, 230); const blob2 = await new Promise(r2 => canvas.toBlob(r2, 'image/png')); const a = document.createElement('a'); a.href = URL.createObjectURL(blob2); a.download = (qrDialogAccount.username || 'qrcode') + '-' + (qrDialogAccount.displayName || 'unknown') + '-qrcode.png'; a.click(); URL.revokeObjectURL(a.href); } catch(e) { window.alert('下載失敗'); } }} style={{ height: '32px', padding: '0 8px', borderRadius: '8px', border: '0', background: 'linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>⬇ 下載</button>
              <button onClick={async () => { try { const r = await fetch('https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent('mock://login/' + qrDialogAccount.username)); const b = await r.blob(); const img = await createImageBitmap(b); const canvas = document.createElement('canvas'); const label = '二維碼管理 ' + (qrDialogAccount.username || ''); const ctx = canvas.getContext('2d'); ctx.font = 'bold 14px system-ui'; const tw = ctx.measureText(label).width; const maxW = Math.max(200, tw + 20); canvas.width = maxW; canvas.height = 240; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, (maxW - 200) / 2, 10); ctx.fillStyle = '#0f172a'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center'; ctx.fillText(label, maxW / 2, 230); const blob2 = await new Promise(r2 => canvas.toBlob(r2, 'image/png')); await navigator.clipboard.write([new ClipboardItem({[blob2.type]: blob2})]); window.alert('已複製'); } catch(e) { try { await navigator.clipboard.writeText('mock://login/' + qrDialogAccount.username); window.alert('圖片複製失敗，已複製鏈接'); } catch(e2) { window.alert('複製失敗'); } } }} style={{ height: '32px', padding: '0 8px', borderRadius: '8px', border: '1px solid #374151', background: '#1f2937', color: '#d1d5db', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>📋 複製</button>
              <button onClick={() => { navigator.clipboard.writeText('mock://login/' + qrDialogAccount.username).then(() => window.alert('鏈接已複製')).catch(() => window.alert('複製失敗')); }} style={{ height: '32px', padding: '0 8px', borderRadius: '8px', border: '1px solid #374151', background: '#1f2937', color: '#d1d5db', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>📋 複製鏈接</button>
              <button onClick={() => { if (qrDialogAccount.email) { window.alert('郵件已發送至 ' + qrDialogAccount.email); } else { window.alert('該帳號未設定郵箱'); } }} style={{ height: '32px', padding: '0 8px', borderRadius: '8px', border: '1px solid #374151', background: '#1f2937', color: '#d1d5db', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>✉ 郵件</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </section>
  );
});

export default TenantAccountManagement;
