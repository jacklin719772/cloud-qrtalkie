import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import apiClient from './apiClient';

const emptyForm = {
  email: '',
  displayName: '',
  organization: '',
  phoneNumber: '',
  password: '',
  status: 'active',
  sipUserIds: [],
};

const statusLabels = { active: '啟用', disabled: '停用', locked: '鎖定' };

export default function TenantSubAdmins() {
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [accountSearch, setAccountSearch] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const messageTimerRef = useRef(null);

  const showMessage = useCallback((type, text) => {
    setMessage({ type, text });
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage({ type: '', text: '' }), 5000);
  }, []);

  useEffect(() => () => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, accountRes] = await Promise.all([
        apiClient.get('/tenant/sub-admins'),
        apiClient.get('/tenant/sub-admins/accounts'),
      ]);
      setItems(Array.isArray(listRes?.items) ? listRes.items : []);
      setAccounts(Array.isArray(accountRes?.accounts) ? accountRes.accounts : []);
    } catch (error) {
      showMessage('error', error?.message || '讀取子管理員失敗。');
    } finally {
      setLoading(false);
    }
  }, [showMessage]);

  useEffect(() => { loadData(); }, [loadData]);

  const visibleAccounts = useMemo(() => {
    const keyword = accountSearch.trim().toLowerCase();
    if (!keyword) return accounts;
    return accounts.filter((account) => (
      String(account.username || '').toLowerCase().includes(keyword)
      || String(account.displayName || '').toLowerCase().includes(keyword)
    ));
  }, [accounts, accountSearch]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setAccountSearch('');
    setModalOpen(true);
  };

  const openEdit = async (item) => {
    setEditing(item);
    setForm({
      email: item.email || '',
      displayName: item.displayName || '',
      organization: item.organization || '',
      phoneNumber: item.phoneNumber || '',
      password: '',
      status: item.status || 'active',
      sipUserIds: [],
    });
    setAccountSearch('');
    setModalOpen(true);
    try {
      const res = await apiClient.get(`/tenant/sub-admins/${item.id}/accounts`);
      setForm((current) => ({ ...current, sipUserIds: Array.isArray(res?.sipUserIds) ? res.sipUserIds : [] }));
    } catch (error) {
      showMessage('error', error?.message || '讀取管轄帳號失敗。');
    }
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const toggleAccount = (sipUserId) => {
    setForm((current) => {
      const selected = new Set(current.sipUserIds);
      if (selected.has(sipUserId)) selected.delete(sipUserId);
      else selected.add(sipUserId);
      return { ...current, sipUserIds: [...selected] };
    });
  };

  const handleSave = async () => {
    if (!editing && !String(form.email || '').trim()) {
      showMessage('error', '請輸入登入信箱。');
      return;
    }
    if (!editing && String(form.password || '').length < 8) {
      showMessage('error', '密碼至少需要 8 位字元。');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await apiClient.put(`/tenant/sub-admins/${editing.id}`, {
          displayName: form.displayName,
          organization: form.organization,
          phoneNumber: form.phoneNumber,
          status: form.status,
          password: form.password || undefined,
          sipUserIds: form.sipUserIds,
        });
        showMessage('success', '子管理員已更新。');
      } else {
        await apiClient.post('/tenant/sub-admins', {
          email: form.email,
          password: form.password,
          displayName: form.displayName,
          organization: form.organization,
          phoneNumber: form.phoneNumber,
          sipUserIds: form.sipUserIds,
        });
        showMessage('success', '子管理員已建立。');
      }
      setModalOpen(false);
      setEditing(null);
      setForm(emptyForm);
      await loadData();
    } catch (error) {
      showMessage('error', error?.message || '儲存子管理員失敗。');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (item) => {
    const nextStatus = item.status === 'active' ? 'disabled' : 'active';
    try {
      await apiClient.put(`/tenant/sub-admins/${item.id}`, { status: nextStatus });
      showMessage('success', nextStatus === 'active' ? '子管理員已啟用。' : '子管理員已停用。');
      await loadData();
    } catch (error) {
      showMessage('error', error?.message || '更新狀態失敗。');
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`確定刪除子管理員 ${item.email}？此操作不可恢復。`)) return;
    setDeletingId(item.id);
    try {
      await apiClient.delete(`/tenant/sub-admins/${item.id}`);
      showMessage('success', '子管理員已刪除。');
      await loadData();
    } catch (error) {
      showMessage('error', error?.message || '刪除子管理員失敗。');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="settings-block" style={{ marginTop: '18px' }}>
      <div className="settings-block-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <h3>子管理員</h3>
          <p style={{ margin: '4px 0 0', color: '#9ca3af', fontSize: '12px' }}>
            子管理員只能管理指定 SIP 帳號的訂閱、通訊錄、名片，以及呼叫中心與門禁配置。
          </p>
        </div>
        <button type="button" className="primary-btn" onClick={openCreate} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Plus size={14} /> 新增子管理員
        </button>
      </div>

      {message.text && (
        <div style={{ margin: '10px 0', padding: '9px 14px', borderRadius: '8px', fontSize: '13px', background: message.type === 'error' ? '#7f1d1d' : '#065f46', color: message.type === 'error' ? '#fecaca' : '#a7f3d0' }}>
          {message.text}
        </div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid #1f2937', borderRadius: '10px', background: '#111827' }}>
        <table style={{ width: '100%', minWidth: '760px', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#1e293b' }}>
              {['登入信箱', '顯示名稱', '所屬單位', '狀態', '管轄帳號', '最後登入', '操作'].map((label) => (
                <th key={label} style={{ padding: '10px 14px', textAlign: 'left', color: '#e5e7eb', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap', background: '#1e293b' }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" style={{ padding: '36px', textAlign: 'center', color: '#9ca3af' }}>載入中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan="7" style={{ padding: '36px', textAlign: 'center', color: '#6b7280' }}>暫無子管理員</td></tr>
            ) : items.map((item) => (
              <tr key={item.id} style={{ borderTop: '1px solid #1f2937' }}>
                <td style={{ padding: '10px 14px', color: '#e5e7eb' }}>{item.email}</td>
                <td style={{ padding: '10px 14px', color: '#d1d5db' }}>{item.displayName || '-'}</td>
                <td style={{ padding: '10px 14px', color: '#d1d5db' }}>{item.organization || '-'}</td>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{ padding: '2px 10px', borderRadius: '999px', fontSize: '11px', background: item.status === 'active' ? '#065f46' : '#374151', color: item.status === 'active' ? '#6ee7b7' : '#9ca3af' }}>
                    {statusLabels[item.status] || item.status}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', color: '#d1d5db' }}>{item.managedCount}</td>
                <td style={{ padding: '10px 14px', color: '#9ca3af', fontSize: '12px' }}>{item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-') : '-'}</td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => openEdit(item)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#93c5fd', fontSize: '12px', cursor: 'pointer' }}>
                      <Pencil size={12} /> 編輯
                    </button>
                    <button type="button" onClick={() => toggleStatus(item)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#d1d5db', fontSize: '12px', cursor: 'pointer' }}>
                      <KeyRound size={12} /> {item.status === 'active' ? '停用' : '啟用'}
                    </button>
                    <button type="button" disabled={deletingId === item.id} onClick={() => handleDelete(item)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: '6px', border: '1px solid #7f1d1d', background: '#1f2937', color: '#fca5a5', fontSize: '12px', cursor: deletingId === item.id ? 'wait' : 'pointer', opacity: deletingId === item.id ? 0.6 : 1 }}>
                      <Trash2 size={12} /> {deletingId === item.id ? '刪除中...' : '刪除'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={closeModal} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)' }} />
          <div style={{ position: 'relative', width: 'min(680px, 94vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: '#111827', border: '1px solid #374151', borderRadius: '14px', boxShadow: '0 25px 60px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid #1f2937' }}>
              <h3 style={{ margin: 0, color: '#e5e7eb', fontSize: '16px' }}>{editing ? '編輯子管理員' : '新增子管理員'}</h3>
              <button type="button" onClick={closeModal} style={{ width: '30px', height: '30px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px', scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: '#d1d5db', fontSize: '12px' }}>
                  登入信箱
                  <input autoComplete="off" type="email" value={form.email} disabled={Boolean(editing)} onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))}
                    style={{ height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #374151', background: editing ? '#0f172a' : '#1a2332', color: '#e5e7eb', outline: 'none' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: '#d1d5db', fontSize: '12px' }}>
                  顯示名稱
                  <input autoComplete="off" value={form.displayName} onChange={(e) => setForm((c) => ({ ...c, displayName: e.target.value }))}
                    style={{ height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: '#d1d5db', fontSize: '12px' }}>
                  所屬單位
                  <input autoComplete="off" value={form.organization} onChange={(e) => setForm((c) => ({ ...c, organization: e.target.value }))} maxLength={120}
                    style={{ height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: '#d1d5db', fontSize: '12px' }}>
                  聯絡電話
                  <input autoComplete="off" value={form.phoneNumber} onChange={(e) => setForm((c) => ({ ...c, phoneNumber: e.target.value }))}
                    style={{ height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: '#d1d5db', fontSize: '12px' }}>
                  {editing ? '重置密碼（留空不修改）' : '登入密碼'}
                  <input autoComplete="new-password" type="password" value={form.password} onChange={(e) => setForm((c) => ({ ...c, password: e.target.value }))}
                    style={{ height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none' }} />
                </label>
                {editing && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: '#d1d5db', fontSize: '12px' }}>
                    狀態
                    <select value={form.status} onChange={(e) => setForm((c) => ({ ...c, status: e.target.value }))}
                      style={{ height: '38px', padding: '0 10px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', outline: 'none' }}>
                      <option value="active">啟用</option>
                      <option value="disabled">停用</option>
                    </select>
                  </label>
                )}
              </div>

              <div style={{ marginTop: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: '#d1d5db', fontSize: '12px' }}>管轄 SIP 帳號（已選 {form.sipUserIds.length} 個）</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button type="button" onClick={() => setForm((c) => ({ ...c, sipUserIds: [...new Set([...c.sipUserIds, ...visibleAccounts.map((a) => a.id)])] }))}
                      style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#93c5fd', fontSize: '11px', cursor: 'pointer' }}>全選</button>
                    <button type="button" onClick={() => setForm((c) => ({ ...c, sipUserIds: [] }))}
                      style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', fontSize: '11px', cursor: 'pointer' }}>清除</button>
                  </div>
                </div>
                <div style={{ border: '1px solid #374151', borderRadius: '10px', overflow: 'hidden', background: '#1a2332' }}>
                  <div style={{ padding: '8px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Search size={14} style={{ color: '#6b7280' }} />
                    <input value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} placeholder="搜尋 SIP 帳號或顯示名稱"
                      style={{ flex: 1, height: '32px', padding: '0 8px', borderRadius: '6px', border: '1px solid #374151', background: '#111827', color: '#e5e7eb', fontSize: '12px', outline: 'none' }} />
                  </div>
                  <div style={{ maxHeight: '220px', overflow: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
                    {visibleAccounts.length === 0 ? (
                      <div style={{ padding: '18px', textAlign: 'center', color: '#6b7280', fontSize: '12px' }}>暫無可分配帳號</div>
                    ) : visibleAccounts.map((account) => (
                      <label key={account.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: '1px solid #1f2937', cursor: 'pointer', color: '#e5e7eb', fontSize: '12px' }}>
                        <input type="checkbox" checked={form.sipUserIds.includes(account.id)} onChange={() => toggleAccount(account.id)} style={{ accentColor: '#3b82f6' }} />
                        <span style={{ fontFamily: 'monospace' }}>{account.username}</span>
                        <span style={{ color: '#9ca3af' }}>{account.displayName || ''}</span>
                        <span style={{ marginLeft: 'auto', color: '#6b7280' }}>{account.serviceExpiresAt || ''}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 22px', borderTop: '1px solid #1f2937' }}>
              <button type="button" onClick={closeModal} disabled={saving} className="ghost-btn">取消</button>
              <button type="button" onClick={handleSave} disabled={saving} className="primary-btn">{saving ? '儲存中...' : '儲存'}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
