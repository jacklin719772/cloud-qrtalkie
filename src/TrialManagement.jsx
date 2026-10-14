import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, RefreshCw, Search, UserPlus } from 'lucide-react';
import apiClient from './apiClient';

// 試用管理：分配試用帳號（掛靠保留租戶）與列表/提前結束
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
  grace: { label: '寬限期', color: '#fbbf24', bg: '#3b2e11' },
  converted: { label: '已轉正', color: '#60a5fa', bg: '#1e3a5f' },
  reclaimed: { label: '已回收', color: '#9ca3af', bg: '#1f2937' },
};

function emptyForm() {
  return {
    ownerTenantId: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    company: '',
    startedAt: todayStr(),
    expiresAt: addMonthsMinusOneDay(todayStr(), 1),
    mode: 'auto',
    count: '1',
    aiEnabled: false,
    notes: '',
  };
}

function emptyNewTenant() {
  return { companyName: '', contactPerson: '', contactPhone: '', loginEmail: '', password: '' };
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

  const [showNewTenant, setShowNewTenant] = useState(false);
  const [newTenant, setNewTenant] = useState(emptyNewTenant());
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [newTenantMessage, setNewTenantMessage] = useState({ type: '', text: '' });

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

  useImperativeHandle(ref, () => ({
    openAssign: () => {
      setForm(emptyForm());
      setSelectedStocks([]);
      setStockKeyword('');
      setStockList([]);
      setStockTotal(0);
      setShowNewTenant(false);
      setNewTenant(emptyNewTenant());
      setNewTenantMessage({ type: '', text: '' });
      setFormMessage({ type: '', text: '' });
      setMessage({ type: '', text: '' });
      setAssignOpen(true);
    },
    reload: () => loadTrials(),
  }));

  function toggleStock(account) {
    setSelectedStocks((prev) => {
      const exists = prev.some((s) => s.id === account.id);
      if (exists) return prev.filter((s) => s.id !== account.id);
      if (prev.length >= 100) return prev;
      return [...prev, account];
    });
  }

  async function submitAssign() {
    if (isPlatform && !form.ownerTenantId) {
      setFormMessage({ type: 'error', text: '請選擇歸屬租戶。' });
      return;
    }
    if (!form.startedAt || !form.expiresAt) {
      setFormMessage({ type: 'error', text: '請設定試用週期。' });
      return;
    }
    if (form.expiresAt < form.startedAt) {
      setFormMessage({ type: 'error', text: '結束日期不能早於開始日期。' });
      return;
    }
    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) {
      setFormMessage({ type: 'error', text: '聯繫郵箱格式無效。' });
      return;
    }
    const payload = {
      contactName: form.contactName.trim(),
      contactEmail: form.contactEmail.trim(),
      contactPhone: form.contactPhone.trim(),
      company: form.company.trim(),
      startedAt: form.startedAt,
      expiresAt: form.expiresAt,
      aiEnabled: form.aiEnabled,
      notes: form.notes.trim(),
    };
    if (isPlatform) payload.ownerTenantId = Number(form.ownerTenantId);
    if (form.mode === 'auto') {
      const count = Number(form.count);
      if (!Number.isInteger(count) || count < 1 || count > 100) {
        setFormMessage({ type: 'error', text: '自動取號數量需為 1~100。' });
        return;
      }
      payload.count = count;
    } else {
      if (selectedStocks.length === 0) {
        setFormMessage({ type: 'error', text: '請至少選擇一個帳號。' });
        return;
      }
      payload.sipUserIds = selectedStocks.map((s) => s.id);
    }

    setAssigning(true);
    setFormMessage({ type: '', text: '' });
    try {
      const res = await apiClient.post('/admin/trials', payload, { timeoutMs: 120000 });
      setAssignOpen(false);
      setMessage({ type: 'success', text: res.message || '試用帳號已分配。' });
      setPage(1);
      loadTrials({ page: 1 });
    } catch (error) {
      setFormMessage({ type: 'error', text: error.message || '分配失敗。' });
    } finally {
      setAssigning(false);
    }
  }

  async function submitNewTenant() {
    if (!newTenant.companyName.trim()) return setNewTenantMessage({ type: 'error', text: '請輸入公司名稱。' });
    if (!newTenant.loginEmail.trim()) return setNewTenantMessage({ type: 'error', text: '請輸入管理員登入信箱。' });
    if ((newTenant.password || '').length < 8) return setNewTenantMessage({ type: 'error', text: '密碼至少 8 位字元。' });
    setCreatingTenant(true);
    setNewTenantMessage({ type: '', text: '' });
    try {
      const res = await apiClient.put('/admin/tenants/0', {
        companyName: newTenant.companyName.trim(),
        contactPerson: newTenant.contactPerson.trim(),
        contactPhone: newTenant.contactPhone.trim(),
        loginEmail: newTenant.loginEmail.trim(),
        password: newTenant.password,
      });
      await loadTenants();
      if (res?.id) setForm((f) => ({ ...f, ownerTenantId: String(res.id) }));
      setShowNewTenant(false);
      setNewTenant(emptyNewTenant());
      setFormMessage({ type: 'success', text: '租戶已建立並自動選中。' });
    } catch (error) {
      setNewTenantMessage({ type: 'error', text: error.message || '建立租戶失敗。' });
    } finally {
      setCreatingTenant(false);
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
        #trial-management .tm-search {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 38px;
          border: 1px solid #374151;
          border-radius: 8px;
          padding: 0 12px;
          background: #1a2332;
        }
        #trial-management .tm-search input {
          border: 0;
          outline: none;
          height: 34px;
          padding: 0;
          min-width: 200px;
          background: transparent;
          color: #e5e7eb;
        }
        #trial-management .tm-btn {
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
        #trial-management .tm-btn:hover { background: #374151; color: #f3f4f6; }
        #trial-management .tm-btn.primary {
          border: 0;
          background: linear-gradient(90deg, #2563eb 0%, #06b6d4 100%);
          color: #fff;
        }
        #trial-management .tm-btn.danger { color: #fca5a5; }
        #trial-management .tm-btn.danger:hover { background: #3b1111; color: #fecaca; }
        #trial-management .tm-btn:disabled { opacity: 0.4; background: #1a2332; color: #4b5563; cursor: not-allowed; }
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
        #trial-management .tm-banner {
          padding: 10px 16px;
          border-radius: 8px;
          font-size: 12px;
        }
        #trial-management .tm-banner.success { background: #0d2818; color: #22c55e; border: 1px solid #14532d; }
        #trial-management .tm-banner.error { background: #3b1111; color: #ef4444; border: 1px solid #7f1d1d; }
        #trial-management .tm-field { display: flex; flex-direction: column; gap: 6px; }
        #trial-management .tm-field label { font-size: 12px; color: #9ca3af; }
        #trial-management .tm-field input,
        #trial-management .tm-field select,
        #trial-management .tm-field textarea {
          background: #0b1220;
          border: 1px solid #374151;
          border-radius: 8px;
          color: #e5e7eb;
          font-size: 13px;
          padding: 9px 12px;
          outline: none;
        }
        #trial-management .tm-field input:focus,
        #trial-management .tm-field select:focus { border-color: #3b82f6; }
        #trial-management .tm-field input:disabled { color: #9ca3af; }
        #trial-management .tm-modal {
          position: fixed;
          inset: 0;
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.6);
        }
        #trial-management .tm-modal-panel {
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
        #trial-management .tm-modal-head {
          padding: 18px 24px;
          border-bottom: 1px solid #1f2937;
          background: #1a2332;
          border-radius: 12px 12px 0 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        #trial-management .tm-modal-head h3 { margin: 0; font-size: 16px; font-weight: 600; color: #f3f4f6; }
        #trial-management .tm-modal-body { padding: 20px 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
        #trial-management .tm-modal-foot {
          padding: 14px 24px;
          border-top: 1px solid #1f2937;
          background: #1a2332;
          border-radius: 0 0 12px 12px;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        #trial-management .tm-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        #trial-management .tm-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
        #trial-management .tm-stock-list {
          border: 1px solid #374151;
          border-radius: 8px;
          max-height: 220px;
          overflow-y: auto;
          background: #0b1220;
        }
        #trial-management .tm-stock-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-bottom: 1px solid #1f2937;
          color: #e5e7eb;
          font-size: 12px;
          cursor: pointer;
        }
        #trial-management .tm-stock-row:hover { background: #1e293b; }
        #trial-management .tm-stock-row input[type="checkbox"] { accent-color: #3b82f6; }
        #trial-management .tm-radio-row { display: flex; gap: 18px; align-items: center; color: #e5e7eb; font-size: 13px; }
        #trial-management .tm-radio-row label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
        #trial-management .tm-radio-row input[type="radio"],
        #trial-management .tm-field input[type="checkbox"] { accent-color: #3b82f6; }
        #trial-management .tm-hint { color: #6b7280; font-size: 11px; }
        #trial-management .tm-new-tenant {
          border: 1px dashed #374151;
          border-radius: 8px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          background: #0d1526;
        }
      `}</style>

      {message.text && (
        <div className={`tm-banner ${message.type || 'success'}`}>{message.text}</div>
      )}

      <div className="tm-card">
        <div className="tm-toolbar">
          <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
            <option value="all">全部狀態</option>
            <option value="active">試用中 / 寬限期</option>
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
          <div className="tm-empty">暫無試用記錄。點擊右上角「分配試用」開始。</div>
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
                  const actionable = t.phase === 'active' || t.phase === 'grace';
                  return (
                    <tr key={t.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: '#ffffff' }}>{t.username}</div>
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
        <div className="tm-modal" onClick={() => { if (!assigning) setAssignOpen(false); }}>
          <div className="tm-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="tm-modal-head">
              <h3>分配試用帳號</h3>
              <button className="tm-btn" type="button" onClick={() => setAssignOpen(false)} disabled={assigning}>關閉</button>
            </div>
            <div className="tm-modal-body">
              {formMessage.text && (
                <div className={`tm-banner ${formMessage.type || 'success'}`}>{formMessage.text}</div>
              )}

              <div className="tm-grid2">
                <div className="tm-field">
                  <label>歸屬租戶 *</label>
                  {isPlatform ? (
                    <select value={form.ownerTenantId} onChange={(e) => setForm((f) => ({ ...f, ownerTenantId: e.target.value }))}>
                      <option value="">請選擇租戶</option>
                      {tenants.map((t) => (
                        <option key={t.id} value={t.id}>{t.companyName || t.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={tenantName || '本租戶（固定）'} disabled />
                  )}
                </div>
                {isPlatform && (
                  <div className="tm-field" style={{ justifyContent: 'flex-end' }}>
                    <label>&nbsp;</label>
                    <button className="tm-btn" type="button" onClick={() => { setShowNewTenant((v) => !v); setNewTenantMessage({ type: '', text: '' }); }}>
                      <UserPlus size={13} /> {showNewTenant ? '收起新建租戶' : '新建租戶'}
                    </button>
                  </div>
                )}
              </div>

              {isPlatform && showNewTenant && (
                <div className="tm-new-tenant">
                  {newTenantMessage.text && (
                    <div className={`tm-banner ${newTenantMessage.type || 'success'}`}>{newTenantMessage.text}</div>
                  )}
                  <div className="tm-grid2">
                    <div className="tm-field">
                      <label>公司名稱 *</label>
                      <input value={newTenant.companyName} onChange={(e) => setNewTenant((v) => ({ ...v, companyName: e.target.value }))} />
                    </div>
                    <div className="tm-field">
                      <label>聯絡人</label>
                      <input value={newTenant.contactPerson} onChange={(e) => setNewTenant((v) => ({ ...v, contactPerson: e.target.value }))} />
                    </div>
                    <div className="tm-field">
                      <label>聯絡電話</label>
                      <input value={newTenant.contactPhone} onChange={(e) => setNewTenant((v) => ({ ...v, contactPhone: e.target.value }))} />
                    </div>
                    <div className="tm-field">
                      <label>管理員登入信箱 *</label>
                      <input value={newTenant.loginEmail} onChange={(e) => setNewTenant((v) => ({ ...v, loginEmail: e.target.value }))} />
                    </div>
                    <div className="tm-field">
                      <label>管理員密碼 *（至少 8 位）</label>
                      <input type="password" value={newTenant.password} onChange={(e) => setNewTenant((v) => ({ ...v, password: e.target.value }))} />
                    </div>
                    <div className="tm-field" style={{ justifyContent: 'flex-end' }}>
                      <label>&nbsp;</label>
                      <button className="tm-btn primary" type="button" onClick={submitNewTenant} disabled={creatingTenant}>
                        {creatingTenant ? '建立中…' : '建立並選中'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="tm-grid3">
                <div className="tm-field">
                  <label>聯繫人姓名</label>
                  <input value={form.contactName} onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} />
                </div>
                <div className="tm-field">
                  <label>聯繫郵箱</label>
                  <input value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} />
                </div>
                <div className="tm-field">
                  <label>聯繫電話</label>
                  <input value={form.contactPhone} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} />
                </div>
              </div>

              <div className="tm-grid3">
                <div className="tm-field">
                  <label>公司</label>
                  <input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
                </div>
                <div className="tm-field">
                  <label>試用開始 *</label>
                  <input type="date" value={form.startedAt} onChange={(e) => setForm((f) => ({ ...f, startedAt: e.target.value }))} />
                </div>
                <div className="tm-field">
                  <label>試用結束 *（預設 1 個月）</label>
                  <input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
                </div>
              </div>

              <div className="tm-field">
                <label>分配帳號 *</label>
                <div className="tm-radio-row">
                  <label>
                    <input type="radio" checked={form.mode === 'auto'} onChange={() => setForm((f) => ({ ...f, mode: 'auto' }))} />
                    自動從庫存取號
                  </label>
                  <label>
                    <input
                      type="radio"
                      checked={form.mode === 'manual'}
                      onChange={() => { setForm((f) => ({ ...f, mode: 'manual' })); if (stockList.length === 0) loadStock(''); }}
                    />
                    手動選號
                  </label>
                  {form.mode === 'auto' ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                      數量
                      <input
                        style={{ width: '90px' }}
                        value={form.count}
                        onChange={(e) => setForm((f) => ({ ...f, count: e.target.value.replace(/[^\d]/g, '') }))}
                      />
                      （1~100）
                    </span>
                  ) : (
                    <span className="tm-hint">已選 {selectedStocks.length} 個</span>
                  )}
                </div>
                {form.mode === 'manual' && (
                  <>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <div className="tm-search" style={{ background: '#0b1220', borderColor: '#1f2937', flex: 1 }}>
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
                    <div className="tm-hint">庫存共 {stockTotal} 個可用帳號，最多顯示前 100 個</div>
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
                    {selectedStocks.length > 0 && (
                      <div className="tm-hint">已選：{selectedStocks.map((s) => s.username).join('、')}</div>
                    )}
                  </>
                )}
              </div>

              <div className="tm-grid2">
                <div className="tm-field">
                  <label>開通 AI 助手</label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: '#e5e7eb', fontSize: '13px' }}>
                    <input
                      type="checkbox"
                      checked={form.aiEnabled}
                      onChange={(e) => setForm((f) => ({ ...f, aiEnabled: e.target.checked }))}
                    />
                    分配時同步開通（到試用結束為止）
                  </label>
                </div>
                <div className="tm-field">
                  <label>備註</label>
                  <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="tm-modal-foot">
              <button className="tm-btn" type="button" onClick={() => setAssignOpen(false)} disabled={assigning}>取消</button>
              <button className="tm-btn primary" type="button" onClick={submitAssign} disabled={assigning}>
                <Plus size={13} /> {assigning ? '分配中…' : '確認分配'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});

export default TrialManagement;
