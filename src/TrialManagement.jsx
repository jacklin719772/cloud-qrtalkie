import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, RefreshCw, Search, UserPlus } from 'lucide-react';
import apiClient from './apiClient';

// 試用管理：添加試用帳號（掛靠保留租戶）與列表/提前結束
// 方案：试用账号模块设计方案-实施参考.md（2026-10-14）

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addMonthsMinusOneDay(value, months) {
  const [y, m, day] = String(value).slice(0, 10).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, day));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const PHASE_META = {
  active: { label: '試用中', color: '#4ade80', bg: '#0d2818' },
  expiring: { label: '即將到期', color: '#fbbf24', bg: '#3b2e11' },
  grace: { label: '寬限期', color: '#fb923c', bg: '#3b2411' },
  converted: { label: '已轉正', color: '#60a5fa', bg: '#1e3a5f' },
  reclaimed: { label: '已回收', color: '#9ca3af', bg: '#1f2937' },
};

function emptyForm() {
  return {
    ownerTenantId: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    startedAt: todayStr(),
    expiresAt: addMonthsMinusOneDay(todayStr(), 1),
    notes: '',
  };
}

function emptyNewTenant() {
  return { companyName: '', password: '' };
}

const TrialManagement = forwardRef(({ isPlatform = true, tenantName = '' }, ref) => {
  const [trials, setTrials] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterQInput, setFilterQInput] = useState('');
  const [filterQ, setFilterQ] = useState('');
  const [filterTenantId, setFilterTenantId] = useState('');
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const [assignOpen, setAssignOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [assigning, setAssigning] = useState(false);
  const [formMessage, setFormMessage] = useState({ type: '', text: '' });

  const [stockKeyword, setStockKeyword] = useState('');
  const [stockList, setStockList] = useState([]);
  const [stockTotal, setStockTotal] = useState(0);
  const [stockLoading, setStockLoading] = useState(false);
  const [selectedStocks, setSelectedStocks] = useState([]);

  const [newTenantMode, setNewTenantMode] = useState(false);
  const [newTenant, setNewTenant] = useState(emptyNewTenant());
  const [tenantAdmin, setTenantAdmin] = useState(null);
  const [emailChecking, setEmailChecking] = useState(false);
  const [emailCheck, setEmailCheck] = useState({ status: 'idle', text: '' });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState('manual');
  const [randomCount, setRandomCount] = useState('1');

  async function loadTrials(overrides = {}) {
    const q = overrides.q !== undefined ? overrides.q : filterQ;
    const status = overrides.status !== undefined ? overrides.status : filterStatus;
    const tenantId = overrides.tenantId !== undefined ? overrides.tenantId : filterTenantId;
    const targetPage = overrides.page !== undefined ? overrides.page : page;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(targetPage));
      params.set('pageSize', String(pageSize === 'all' ? 1000 : pageSize));
      if (status && status !== 'all') params.set('status', status);
      if (q) params.set('q', q);
      if (isPlatform && tenantId) params.set('ownerTenantId', tenantId);
      const data = await apiClient.get(`/admin/trials?${params.toString()}`);
      setTrials(Array.isArray(data.trials) ? data.trials : []);
      setTotal(Number(data.total || 0));
    } catch (error) {
      setMessage({ type: 'error', text: error.message || '讀取試用列表失敗。' });
    } finally {
      setLoading(false);
    }
  }

  async function loadTenants() {
    if (!isPlatform) return;
    try {
      const data = await apiClient.get('/admin/tenants');
      const list = Array.isArray(data.tenants) ? data.tenants : [];
      setTenants(list.filter((t) => t.status === 'active'));
    } catch {
      setTenants([]);
    }
  }

  useEffect(() => {
    loadTrials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, filterStatus, filterTenantId, filterQ]);

  useEffect(() => {
    loadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStock(keyword) {
    setStockLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (keyword) params.set('q', keyword);
      const data = await apiClient.get(`/admin/trials/stock-accounts?${params.toString()}`);
      setStockList(Array.isArray(data.accounts) ? data.accounts : []);
      setStockTotal(Number(data.total || 0));
    } catch (error) {
      setStockList([]);
      setStockTotal(0);
    } finally {
      setStockLoading(false);
    }
  }

  // 選定現有租戶後自動載入其管理員信息（回填聯繫人字段，可修改）
  useEffect(() => {
    if (!isPlatform || newTenantMode || !form.ownerTenantId) {
      setTenantAdmin(null);
      return undefined;
    }
    let cancelled = false;
    apiClient.get(`/admin/tenants/${form.ownerTenantId}`)
      .then((data) => {
        if (cancelled) return;
        const tenant = data?.tenant || {};
        setTenantAdmin({
          name: tenant.adminDisplayName || '',
          email: tenant.loginEmail || '',
          phone: tenant.adminPhone || '',
        });
      })
      .catch(() => { if (!cancelled) setTenantAdmin({ name: '', email: '', phone: '' }); });
    return () => { cancelled = true; };
  }, [isPlatform, newTenantMode, form.ownerTenantId]);

  function startNewTenant() {
    setNewTenantMode(true);
    setNewTenant(emptyNewTenant());
    setForm((f) => ({ ...f, contactName: '', contactEmail: '', contactPhone: '' }));
    setFormMessage({ type: '', text: '' });
  }

  function useExistingTenant() {
    setNewTenantMode(false);
    setForm((f) => ({ ...f, contactName: '', contactEmail: '', contactPhone: '' }));
    setFormMessage({ type: '', text: '' });
  }

  async function checkAdminEmail() {
    const email = form.contactEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailCheck({ status: 'taken', text: '郵箱格式無效。' });
      return;
    }
    setEmailChecking(true);
    try {
      const data = await apiClient.get(`/admin/trials/check-admin-email?email=${encodeURIComponent(email)}`);
      setEmailCheck(data?.available ? { status: 'available', text: '信箱可用。' } : { status: 'taken', text: '該信箱已被使用。' });
    } catch (error) {
      setEmailCheck({ status: 'taken', text: error.message || '檢查失敗，請重試。' });
    } finally {
      setEmailChecking(false);
    }
  }

  async function addRandomAccounts() {
    const count = Number(randomCount);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      setFormMessage({ type: 'error', text: '隨機取號數量需為 1~100。' });
      return;
    }
    try {
      const data = await apiClient.get(`/admin/trials/stock-accounts?random=1&limit=${count}`);
      const list = Array.isArray(data.accounts) ? data.accounts : [];
      if (list.length === 0) {
        setFormMessage({ type: 'error', text: '庫存帳號不足。' });
        return;
      }
      setSelectedStocks((prev) => {
        const merged = [...prev];
        for (const account of list) {
          if (!merged.some((s) => s.id === account.id)) merged.push(account);
        }
        return merged.slice(0, 100);
      });
      setFormMessage({ type: 'success', text: `已隨機加入 ${list.length} 個帳號。` });
    } catch (error) {
      setFormMessage({ type: 'error', text: error.message || '隨機取號失敗。' });
    }
  }

  useImperativeHandle(ref, () => ({
    openAssign: () => {
      setForm(emptyForm());
      setSelectedStocks([]);
      setStockKeyword('');
      setStockList([]);
      setStockTotal(0);
      setNewTenantMode(false);
      setNewTenant(emptyNewTenant());
      setTenantAdmin(null);
      setEmailChecking(false);
      setEmailCheck({ status: 'idle', text: '' });
      setPickerOpen(false);
      setPickerMode('manual');
      setRandomCount('1');
      setFormMessage({ type: '', text: '' });
      setMessage({ type: '', text: '' });
      setAssignOpen(true);
    },
    reload: () => loadTrials(),
  }));

  function toggleStock(account) {
    setFormMessage({ type: '', text: '' });
    setSelectedStocks((prev) => {
      const exists = prev.some((s) => s.id === account.id);
      if (exists) return prev.filter((s) => s.id !== account.id);
      if (prev.length >= 100) return prev;
      return [...prev, account];
    });
  }

  async function submitAssign() {
    if (!newTenantMode && isPlatform && !form.ownerTenantId) {
      setFormMessage({ type: 'error', text: '請選擇歸屬租戶。' });
      return;
    }
    // 現有租戶（平台）：聯繫人取該租戶管理員信息（只讀）；新建/租戶管理員：取表單
    const useFormContact = newTenantMode || !isPlatform;
    const contactName = useFormContact ? form.contactName.trim() : (tenantAdmin?.name || '');
    const contactEmail = useFormContact ? form.contactEmail.trim() : (tenantAdmin?.email || '');
    const contactPhone = useFormContact ? form.contactPhone.trim() : (tenantAdmin?.phone || '');
    if (newTenantMode) {
      if (!newTenant.companyName.trim()) {
        setFormMessage({ type: 'error', text: '請輸入租戶公司名稱。' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        setFormMessage({ type: 'error', text: '請輸入有效的管理員登入信箱。' });
        return;
      }
      if ((newTenant.password || '').length < 8) {
        setFormMessage({ type: 'error', text: '管理員密碼至少 8 位字元。' });
        return;
      }
    }
    if (!form.startedAt || !form.expiresAt) {
      setFormMessage({ type: 'error', text: '請設定試用週期。' });
      return;
    }
    if (form.expiresAt < form.startedAt) {
      setFormMessage({ type: 'error', text: '結束日期不能早於開始日期。' });
      return;
    }
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      setFormMessage({ type: 'error', text: '聯繫郵箱格式無效。' });
      return;
    }
    if (selectedStocks.length === 0) {
      setFormMessage({ type: 'error', text: '請添加至少一個測試帳號。' });
      return;
    }

    let ownerTenantId = newTenantMode ? null : Number(form.ownerTenantId) || null;
    const company = newTenantMode
      ? newTenant.companyName.trim()
      : (tenants.find((t) => String(t.id) === String(form.ownerTenantId))?.companyName || '');

    setAssigning(true);
    setFormMessage({ type: '', text: '' });
    let createdTenantId = null;
    try {
      if (newTenantMode) {
        const created = await apiClient.put('/admin/tenants/0', {
          companyName: newTenant.companyName.trim(),
          contactPerson: contactName,
          contactPhone,
          loginEmail: contactEmail,
          password: newTenant.password,
        });
        ownerTenantId = Number(created?.id) || null;
        if (!ownerTenantId) throw new Error('建立租戶失敗。');
        createdTenantId = ownerTenantId;
        await loadTenants();
      }
      const payload = {
        ownerTenantId,
        contactName,
        contactEmail,
        contactPhone,
        company,
        startedAt: form.startedAt,
        expiresAt: form.expiresAt,
        notes: form.notes.trim(),
        sipUserIds: selectedStocks.map((s) => s.id),
      };
      const res = await apiClient.post('/admin/trials', payload, { timeoutMs: 120000 });
      setAssignOpen(false);
      setMessage({ type: 'success', text: res.message || '試用帳號已添加。' });
      setPage(1);
      loadTrials({ page: 1 });
    } catch (error) {
      setFormMessage({
        type: 'error',
        text: createdTenantId
          ? `租戶已建立（#${createdTenantId}），但添加試用失敗：${error.message || '未知錯誤'}`
          : (error.message || '添加失敗。'),
      });
    } finally {
      setAssigning(false);
    }
  }

  async function endTrial(trial, action) {
    const confirmText = action === 'end'
      ? `確定提前結束「${trial.username}」的試用嗎？\n功能將立即停止，帳號進入寬限期（仍可轉正）。`
      : `確定將「${trial.username}」立即回庫嗎？\n帳號將立刻釋放回庫存，且無法再轉正。`;
    if (!window.confirm(confirmText)) return;
    try {
      const res = await apiClient.post(`/admin/trials/${trial.id}/end`, { action });
      setMessage({ type: 'success', text: res.message || '操作成功。' });
      loadTrials();
    } catch (error) {
      setMessage({ type: 'error', text: error.message || '操作失敗。' });
    }
  }

  const effectivePageSize = pageSize === 'all' ? 1000 : pageSize;
  const totalPages = Math.max(1, Math.ceil(total / effectivePageSize));

  return (
    <div id="trial-management" style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, minHeight: 0, height: '100%', background: '#111827', boxSizing: 'border-box' }}>
      <style>{`
        #trial-management .tm-card {
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 14px;
          box-shadow: none;
        }
        #trial-management .tm-card.tm-table-card {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          background: #1a2332;
          overflow: hidden;
        }
        #trial-management .tm-table-scroll {
          flex: 1;
          min-height: 0;
          overflow: auto;
        }
        #trial-management .tm-toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 20px;
          flex-wrap: wrap;
        }
        #trial-management .tm-toolbar select,
        #trial-management .tm-toolbar input {
          height: 38px;
          border-radius: 8px;
          border: 1px solid #374151;
          background: #1a2332;
          color: #e5e7eb;
          font-size: 12px;
          padding: 0 12px;
        }
        #trial-management .tm-toolbar input::placeholder { color: #6b7280; }
        #trial-management .tm-toolbar select:focus,
        #trial-management .tm-toolbar input:focus { border-color: #3b82f6; outline: none; }
        #trial-management .tm-search,
        #trial-management-modal .tm-search {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 38px;
          border: 1px solid #374151;
          border-radius: 8px;
          padding: 0 12px;
          background: #1a2332;
        }
        #trial-management .tm-search input,
        #trial-management-modal .tm-search input {
          border: 0;
          outline: none;
          height: 34px;
          padding: 0;
          min-width: 200px;
          background: transparent;
          color: #e5e7eb;
        }
        #trial-management .tm-btn, #trial-management-modal .tm-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 34px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid #4b5563;
          background: #1f2937;
          color: #d1d5db;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
        }
        #trial-management .tm-btn:hover, #trial-management-modal .tm-btn:hover { background: #374151; color: #f3f4f6; }
        #trial-management .tm-btn.primary, #trial-management-modal .tm-btn.primary {
          border: 0;
          background: linear-gradient(90deg, #2563eb 0%, #06b6d4 100%);
          color: #fff;
        }
        #trial-management .tm-btn.danger, #trial-management-modal .tm-btn.danger { color: #fca5a5; }
        #trial-management .tm-btn.danger:hover, #trial-management-modal .tm-btn.danger:hover { background: #3b1111; color: #fecaca; }
        #trial-management .tm-btn:disabled, #trial-management-modal .tm-btn:disabled { opacity: 0.4; background: #1a2332; color: #4b5563; cursor: not-allowed; }
        #trial-management table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        #trial-management thead { background: #1a2332; }
        #trial-management th {
          height: 48px;
          padding: 0 18px;
          text-align: left;
          color: #e5e7eb;
          font-weight: 600;
          border-bottom: 1px solid #1f2937;
          white-space: nowrap;
        }
        #trial-management tbody tr { background: #111827; }
        #trial-management tbody tr:hover { background: #1e293b; }
        #trial-management td {
          height: 56px;
          padding: 0 18px;
          color: #e5e7eb;
          border-bottom: 1px solid #1f2937;
          white-space: nowrap;
        }
        #trial-management .tm-empty {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px 20px;
          text-align: center;
          color: #9ca3af;
          font-size: 13px;
          background: #111827;
        }
        #trial-management .tm-badge {
          display: inline-flex;
          align-items: center;
          height: 24px;
          padding: 0 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
        }
        #trial-management .tm-footer {
          min-height: 74px;
          padding: 0 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #111827;
          border-top: 1px solid #1f2937;
        }
        #trial-management .tm-total { color: #9ca3af; font-size: 12px; }
        #trial-management .tm-pagination { display: flex; align-items: center; gap: 12px; }
        #trial-management .tm-page-size {
          height: 38px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid #374151;
          background: #1a2332;
          color: #e5e7eb;
          font-size: 11px;
          display: inline-flex;
          align-items: center;
        }
        #trial-management .tm-page-btn,
        #trial-management .tm-page-current {
          width: 38px;
          height: 38px;
          border-radius: 8px;
          border: 1px solid #374151;
          background: #1f2937;
          color: #9ca3af;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
        }
        #trial-management .tm-page-current {
          border-color: #3b82f6;
          color: #60a5fa;
          background: #1e3a5f;
          font-weight: 600;
        }
        #trial-management .tm-page-btn {
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        #trial-management .tm-page-btn:disabled {
          opacity: 0.4;
          background: #1a2332;
          color: #4b5563;
          cursor: not-allowed;
        }
        #trial-management .tm-page-jump {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #9ca3af;
          font-size: 11px;
        }
        #trial-management .tm-page-input {
          width: 56px;
          height: 36px;
          border-radius: 8px;
          border: 1px solid #374151;
          background: #1a2332;
          color: #e5e7eb;
          text-align: center;
          outline: none;
          font-size: 11px;
        }
        #trial-management .tm-banner, #trial-management-modal .tm-banner {
          padding: 10px 16px;
          border-radius: 8px;
          font-size: 12px;
        }
        #trial-management .tm-banner.success, #trial-management-modal .tm-banner.success { background: #0d2818; color: #22c55e; border: 1px solid #14532d; }
        #trial-management .tm-banner.error, #trial-management-modal .tm-banner.error { background: #3b1111; color: #ef4444; border: 1px solid #7f1d1d; }
        #trial-management-modal .tm-field { display: flex; flex-direction: column; gap: 6px; }
        #trial-management-modal .tm-field label { font-size: 12px; color: #9ca3af; }
        #trial-management-modal .tm-field input,
        #trial-management-modal .tm-field select,
        #trial-management-modal .tm-field textarea {
          background: #0b1220;
          border: 1px solid #374151;
          border-radius: 8px;
          color: #e5e7eb;
          font-size: 13px;
          padding: 9px 12px;
          outline: none;
        }
        #trial-management-modal .tm-field input:focus,
        #trial-management-modal .tm-field select:focus { border-color: #3b82f6; }
        #trial-management-modal .tm-field input:disabled { color: #9ca3af; background: #0d1526; }
        /* 覆蓋瀏覽器自動填充的白底（新建租戶的電話/密碼被 Chrome 記憶填充時） */
        #trial-management-modal .tm-field input:-webkit-autofill,
        #trial-management-modal .tm-field input:-webkit-autofill:hover,
        #trial-management-modal .tm-field input:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px #0b1220 inset;
          -webkit-text-fill-color: #e5e7eb;
          transition: background-color 5000s ease-in-out 0s;
        }
        #trial-management-modal .tm-modal {
          position: fixed;
          inset: 0;
          z-index: 2147483646;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.6);
        }
        #trial-management-modal .tm-modal-panel {
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 12px;
          width: 760px;
          max-width: 94vw;
          max-height: 88vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
        }
        #trial-management-modal .tm-modal-head {
          padding: 18px 24px;
          border-bottom: 1px solid #1f2937;
          background: #1a2332;
          border-radius: 12px 12px 0 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        #trial-management-modal .tm-modal-head h3 { margin: 0; font-size: 16px; font-weight: 600; color: #f3f4f6; }
        #trial-management-modal .tm-modal-body { padding: 20px 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
        #trial-management-modal .tm-modal-foot {
          padding: 14px 24px;
          border-top: 1px solid #1f2937;
          background: #1a2332;
          border-radius: 0 0 12px 12px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        #trial-management-modal .tm-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        #trial-management-modal .tm-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
        #trial-management-modal .tm-stock-list {
          border: 1px solid #374151;
          border-radius: 8px;
          max-height: 220px;
          overflow-y: auto;
          background: #0b1220;
        }
        #trial-management-modal .tm-stock-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-bottom: 1px solid #1f2937;
          color: #e5e7eb;
          font-size: 12px;
          cursor: pointer;
        }
        #trial-management-modal .tm-stock-row:hover { background: #1e293b; }
        #trial-management-modal .tm-stock-row input[type="checkbox"] { accent-color: #3b82f6; }
        #trial-management-modal .tm-radio-row { display: flex; gap: 18px; align-items: center; color: #e5e7eb; font-size: 13px; }
        #trial-management-modal .tm-radio-row label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
        #trial-management-modal .tm-radio-row input[type="radio"],
        #trial-management-modal .tm-field input[type="checkbox"] { accent-color: #3b82f6; }
        #trial-management-modal .tm-hint { color: #6b7280; font-size: 11px; }
        #trial-management-modal .tm-section {
          border: 1px solid #1f2937;
          border-radius: 10px;
          background: #0d1526;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        #trial-management-modal .tm-section-title { font-size: 13px; font-weight: 600; color: #93c5fd; }
        #trial-management-modal .tm-account-list {
          border: 1px solid #374151;
          border-radius: 8px;
          background: #0b1220;
          max-height: 200px;
          overflow-y: auto;
        }
        #trial-management-modal .tm-account-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-bottom: 1px solid #1f2937;
          color: #e5e7eb;
          font-size: 12px;
        }
        #trial-management-modal .tm-account-row:last-child { border-bottom: 0; }
        #trial-management-modal .tm-account-name { font-weight: 600; }
        #trial-management-modal .tm-account-empty { padding: 18px 12px; color: #6b7280; font-size: 12px; text-align: center; }
        #trial-management-modal .tm-remove {
          margin-left: auto;
          background: none;
          border: 0;
          color: #f87171;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          padding: 2px 4px;
        }
        #trial-management-modal .tm-remove:hover { color: #fecaca; }
        #trial-management-modal .tm-picker {
          border: 1px dashed #374151;
          border-radius: 8px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          background: #0d1526;
        }
        #trial-management-modal .tm-input {
          background: #0b1220;
          border: 1px solid #374151;
          border-radius: 8px;
          color: #e5e7eb;
          font-size: 13px;
          padding: 9px 12px;
          outline: none;
        }
        #trial-management-modal .tm-input:focus { border-color: #3b82f6; }
        /* 弹窗滚动条深色化（portal 在 #console 之外，不吃全局滚动条样式） */
        #trial-management-modal .tm-modal-body,
        #trial-management-modal .tm-account-list,
        #trial-management-modal .tm-stock-list {
          scrollbar-width: thin;
          scrollbar-color: #374151 transparent;
        }
        #trial-management-modal .tm-modal-body::-webkit-scrollbar,
        #trial-management-modal .tm-account-list::-webkit-scrollbar,
        #trial-management-modal .tm-stock-list::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        #trial-management-modal .tm-modal-body::-webkit-scrollbar-thumb,
        #trial-management-modal .tm-account-list::-webkit-scrollbar-thumb,
        #trial-management-modal .tm-stock-list::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: #374151;
        }
        #trial-management-modal .tm-modal-body::-webkit-scrollbar-thumb:hover,
        #trial-management-modal .tm-account-list::-webkit-scrollbar-thumb:hover,
        #trial-management-modal .tm-stock-list::-webkit-scrollbar-thumb:hover {
          background: #4b5563;
        }
        #trial-management-modal .tm-modal-body::-webkit-scrollbar-track,
        #trial-management-modal .tm-account-list::-webkit-scrollbar-track,
        #trial-management-modal .tm-stock-list::-webkit-scrollbar-track {
          background: transparent;
        }
      `}</style>

      {message.text && (
        <div className={`tm-banner ${message.type || 'success'}`}>{message.text}</div>
      )}

      <div className="tm-card">
        <div className="tm-toolbar">
          <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
            <option value="all">全部狀態</option>
            <option value="active">試用中</option>
            <option value="expiring">即將到期</option>
            <option value="grace">寬限期</option>
            <option value="converted">已轉正</option>
            <option value="reclaimed">已回收</option>
          </select>
          {isPlatform && (
            <select value={filterTenantId} onChange={(e) => { setFilterTenantId(e.target.value); setPage(1); }}>
              <option value="">全部租戶</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.companyName || t.name}</option>
              ))}
            </select>
          )}
          <div className="tm-search">
            <Search size={14} color="#6b7280" />
            <input
              placeholder="搜尋聯繫人 / 公司 / 郵箱 / 帳號"
              value={filterQInput}
              onChange={(e) => setFilterQInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setFilterQ(filterQInput.trim()); setPage(1); } }}
            />
          </div>
          <button className="tm-btn" type="button" onClick={() => { setFilterQ(filterQInput.trim()); setPage(1); }}>搜尋</button>
          <button className="tm-btn" type="button" onClick={() => loadTrials()} title="重新整理">
            <RefreshCw size={13} /> 重新整理
          </button>
        </div>
      </div>

      <div className="tm-card tm-table-card">
        {loading ? (
          <div className="tm-empty">載入中…</div>
        ) : trials.length === 0 ? (
          <div className="tm-empty">暫無試用記錄。點擊右上角「添加試用」開始。</div>
        ) : (
          <div className="tm-table-scroll">
            <table>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#1a2332' }}>
                <tr>
                  <th>帳號</th>
                  <th>歸屬租戶</th>
                  <th>聯繫人</th>
                  <th>試用週期</th>
                  <th>狀態</th>
                  <th>AI 助手</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {trials.map((t) => {
                  const meta = PHASE_META[t.phase] || PHASE_META.active;
                  const actionable = ['active', 'expiring', 'grace'].includes(t.phase);
                  return (
                    <tr key={t.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: '#ffffff' }}>{t.username}{t.webUsername ? `（${t.webUsername}）` : ''}</div>
                        {t.accountDisplayName && t.accountDisplayName !== t.username && (
                          <div style={{ color: '#9ca3af', fontSize: '11px' }}>{t.accountDisplayName}</div>
                        )}
                      </td>
                      <td>{t.ownerTenantName}</td>
                      <td>
                        <div>{t.contactName || '—'}</div>
                        {t.contactEmail && <div style={{ color: '#9ca3af', fontSize: '11px' }}>{t.contactEmail}</div>}
                      </td>
                      <td>{t.startedAt} ~ {t.expiresAt}</td>
                      <td>
                        <span className="tm-badge" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span>
                      </td>
                      <td>{t.aiEnabled ? '已開通' : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {actionable ? (
                          <div style={{ display: 'inline-flex', gap: '8px' }}>
                            <button className="tm-btn danger" type="button" onClick={() => endTrial(t, 'end')}>提前結束</button>
                            {isPlatform && (
                              <button className="tm-btn danger" type="button" onClick={() => endTrial(t, 'reclaim_now')}>立即回庫</button>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#4b5563' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="tm-footer">
          <div className="tm-total">共 {total} 條</div>
          <div className="tm-pagination">
            <select
              className="tm-page-size"
              value={pageSize}
              onChange={(e) => { const v = e.target.value; setPageSize(v === 'all' ? 'all' : Number(v)); setPage(1); }}
            >
              <option value={10}>10 條/页</option>
              <option value={20}>20 條/页</option>
              <option value={50}>50 條/页</option>
              <option value="all">全部</option>
            </select>
            <button className="tm-page-btn" type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
            <span className="tm-page-current">{page}</span>
            <button className="tm-page-btn" type="button" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>›</button>
            <span className="tm-page-jump">前往<input className="tm-page-input" value={page} readOnly />頁</span>
          </div>
        </div>
      </div>

      {assignOpen && createPortal(
        <div id="trial-management-modal">
        <div className="tm-modal" onClick={() => { if (!assigning) setAssignOpen(false); }}>
          <div className="tm-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="tm-modal-head">
              <h3>添加試用帳號</h3>
              <button className="tm-btn" type="button" onClick={() => setAssignOpen(false)} disabled={assigning}>關閉</button>
            </div>
            <div className="tm-modal-body">
              {formMessage.text && (
                <div className={`tm-banner ${formMessage.type || 'success'}`}>{formMessage.text}</div>
              )}

              {/* 第一部分：租戶信息 */}
              <div className="tm-section">
                <div className="tm-section-title">租戶信息</div>
                {isPlatform ? (
                  newTenantMode ? (
                    <div className="tm-grid2">
                      <div className="tm-field">
                        <label>公司名稱 *</label>
                        <input value={newTenant.companyName} onChange={(e) => setNewTenant((v) => ({ ...v, companyName: e.target.value }))} />
                      </div>
                      <div className="tm-field" style={{ justifyContent: 'flex-end' }}>
                        <label>&nbsp;</label>
                        <button className="tm-btn" type="button" onClick={useExistingTenant}>改用現有租戶</button>
                      </div>
                    </div>
                  ) : (
                    <div className="tm-grid2">
                      <div className="tm-field">
                        <label>歸屬租戶 *</label>
                        <select value={form.ownerTenantId} onChange={(e) => setForm((f) => ({ ...f, ownerTenantId: e.target.value }))}>
                          <option value="">請選擇租戶</option>
                          {tenants.map((t) => (
                            <option key={t.id} value={t.id}>{t.companyName || t.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="tm-field" style={{ justifyContent: 'flex-end' }}>
                        <label>&nbsp;</label>
                        <button className="tm-btn" type="button" onClick={startNewTenant}>
                          <UserPlus size={13} /> 新建租戶
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="tm-field">
                    <label>歸屬租戶</label>
                    <input value={tenantName || '本租戶（固定）'} disabled />
                  </div>
                )}
              </div>

              {/* 第二部分：租戶管理員信息 */}
              <div className="tm-section">
                <div className="tm-section-title">租戶管理員信息</div>
                <div className={newTenantMode ? 'tm-grid2' : 'tm-grid3'}>
                  {isPlatform && !newTenantMode ? (
                    <>
                      <div className="tm-field">
                        <label>管理員姓名</label>
                        <input value={tenantAdmin?.name || ''} disabled placeholder="選擇租戶後自動帶入" />
                      </div>
                      <div className="tm-field">
                        <label>管理員信箱</label>
                        <input value={tenantAdmin?.email || ''} disabled placeholder="選擇租戶後自動帶入" />
                      </div>
                      <div className="tm-field">
                        <label>聯繫電話</label>
                        <input value={tenantAdmin?.phone || ''} disabled placeholder="選擇租戶後自動帶入" />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="tm-field">
                        <label>管理員姓名</label>
                        <input autoComplete="off" value={form.contactName} onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} />
                      </div>
                      <div className="tm-field">
                        <label>{newTenantMode ? '管理員登入信箱 *' : '管理員信箱'}</label>
                        {newTenantMode ? (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                              autoComplete="off"
                              style={{ flex: 1, minWidth: 0 }}
                              value={form.contactEmail}
                              onChange={(e) => { setForm((f) => ({ ...f, contactEmail: e.target.value })); setEmailCheck({ status: 'idle', text: '' }); }}
                            />
                            <button className="tm-btn" type="button" onClick={checkAdminEmail} disabled={emailChecking}>
                              {emailChecking ? '檢查中…' : '校驗'}
                            </button>
                          </div>
                        ) : (
                          <input autoComplete="off" value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} />
                        )}
                        {newTenantMode && emailCheck.status !== 'idle' && (
                          <span className="tm-hint" style={{ color: emailCheck.status === 'available' ? '#22c55e' : '#f87171' }}>{emailCheck.text}</span>
                        )}
                      </div>
                      <div className="tm-field">
                        <label>聯繫電話</label>
                        <input autoComplete="off" value={form.contactPhone} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} />
                      </div>
                      {newTenantMode && (
                        <div className="tm-field">
                          <label>管理員密碼 *（至少 8 位）</label>
                          <input type="password" autoComplete="new-password" value={newTenant.password} onChange={(e) => setNewTenant((v) => ({ ...v, password: e.target.value }))} />
                        </div>
                      )}
                    </>
                  )}
                </div>
                {isPlatform && !newTenantMode && form.ownerTenantId && tenantAdmin && (
                  <span className="tm-hint">管理員信息來自該租戶，僅供確認（不可修改）。</span>
                )}
              </div>

              {/* 第三部分：測試帳號列表 */}
              <div className="tm-section">
                <div className="tm-section-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  測試帳號列表
                  <span className="tm-hint">已添加 {selectedStocks.length} / 100 個</span>
                  <button
                    className="tm-btn"
                    type="button"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => { setPickerOpen((v) => !v); if (!pickerOpen && stockList.length === 0) loadStock(''); }}
                  >
                    <Plus size={13} /> 添加測試帳號
                  </button>
                </div>
                <div className="tm-grid2">
                  <div className="tm-field">
                    <label>試用開始 *</label>
                    <input type="date" value={form.startedAt} onChange={(e) => setForm((f) => ({ ...f, startedAt: e.target.value }))} />
                  </div>
                  <div className="tm-field">
                    <label>試用結束 *（預設 1 個月）</label>
                    <input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
                  </div>
                </div>

                <div className="tm-account-list">
                  {selectedStocks.length === 0 ? (
                    <div className="tm-account-empty">尚未添加帳號，點擊下方「添加測試帳號」從庫存選號</div>
                  ) : (
                    selectedStocks.map((a) => (
                      <div key={a.id} className="tm-account-row">
                        <span className="tm-account-name">{a.username}</span>
                        <button className="tm-remove" type="button" title="移除" onClick={() => toggleStock(a)}>✕</button>
                      </div>
                    ))
                  )}
                </div>

                {pickerOpen && (
                  <div className="tm-picker">
                    <div className="tm-radio-row">
                      <label>
                        <input
                          type="radio"
                          checked={pickerMode === 'manual'}
                          onChange={() => { setPickerMode('manual'); if (stockList.length === 0) loadStock(''); }}
                        />
                        手動選號
                      </label>
                      <label>
                        <input type="radio" checked={pickerMode === 'random'} onChange={() => setPickerMode('random')} />
                        隨機取號
                      </label>
                      {pickerMode === 'random' && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          數量
                          <input
                            className="tm-input"
                            style={{ width: '90px' }}
                            value={randomCount}
                            onChange={(e) => setRandomCount(e.target.value.replace(/[^\d]/g, ''))}
                          />
                          <button className="tm-btn" type="button" onClick={addRandomAccounts}>加入</button>
                        </span>
                      )}
                      <button className="tm-btn" type="button" style={{ marginLeft: 'auto' }} onClick={() => setPickerOpen(false)}>收起</button>
                    </div>
                    {pickerMode === 'manual' && (
                      <>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <div className="tm-search" style={{ background: '#0b1220', borderColor: '#374151', flex: 1 }}>
                            <Search size={14} color="#6b7280" />
                            <input
                              style={{ background: 'transparent', color: '#e5e7eb', width: '100%' }}
                              placeholder="搜尋庫存帳號（帳號/名稱）"
                              value={stockKeyword}
                              onChange={(e) => setStockKeyword(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') loadStock(stockKeyword.trim()); }}
                            />
                          </div>
                          <button className="tm-btn" type="button" onClick={() => loadStock(stockKeyword.trim())}>搜尋</button>
                        </div>
                        <div className="tm-hint">庫存共 {stockTotal} 個可用帳號，最多顯示前 100 個；點擊行加入或移除</div>
                        <div className="tm-stock-list">
                          {stockLoading ? (
                            <div style={{ padding: '14px', color: '#9ca3af', fontSize: '12px' }}>載入中…</div>
                          ) : stockList.length === 0 ? (
                            <div style={{ padding: '14px', color: '#9ca3af', fontSize: '12px' }}>無結果（點「搜尋」載入）</div>
                          ) : (
                            stockList.map((a) => {
                              const checked = selectedStocks.some((s) => s.id === a.id);
                              return (
                                <div key={a.id} className="tm-stock-row" onClick={() => toggleStock(a)}>
                                  <input type="checkbox" checked={checked} readOnly />
                                  <span style={{ fontWeight: 600 }}>{a.username}</span>
                                  {a.displayName && a.displayName !== a.username && (
                                    <span style={{ color: '#9ca3af' }}>{a.displayName}</span>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="tm-field">
                  <label>代理商</label>
                  <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="tm-modal-foot">
              <button className="tm-btn" type="button" onClick={() => setAssignOpen(false)} disabled={assigning}>取消</button>
              <button className="tm-btn primary" type="button" onClick={submitAssign} disabled={assigning}>
                <Plus size={13} /> {assigning ? '添加中…' : '確認添加'}
              </button>
            </div>
          </div>
        </div>
        </div>,
        document.body
      )}
    </div>
  );
});

export default TrialManagement;
