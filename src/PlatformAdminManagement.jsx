import React, { useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import apiClient from './apiClient';

function RequiredMark() {
  return <span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span>;
}

const roleLabels = {
  super_admin: '超級管理員',
  admin: '管理員',
  operator: '運營',
  finance: '財務',
  support: '客服',
  auditor: '審計',
};

const PlatformAdminManagement = forwardRef((props, ref) => {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [dialogMode, setDialogMode] = useState(null); // 'add' | 'edit'
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ email: '', password: '', confirmPassword: '', displayName: '', phoneNumber: '', platformRole: 'admin' });
  const [saving, setSaving] = useState(false);

  const loadAdmins = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/platform/admins');
      setAdmins(Array.isArray(res.admins) ? res.admins.filter(a => a.platformRole !== 'super_admin') : []);
    } catch (e) {
      setMessage({ type: 'error', text: e.message || '載入失敗' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAdmins(); }, []);

  useEffect(() => {
    if (!message.text) return;
    const t = setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    return () => clearTimeout(t);
  }, [message]);

  const openAdd = () => {
    setDialogMode('add');
    setEditTarget(null);
    setForm({ email: '', password: '', displayName: '', phoneNumber: '', platformRole: 'admin' });
    setMessage({ type: '', text: '' });
  };

  useImperativeHandle(ref, () => ({ openAdd }));

  const openEdit = (admin) => {
    setDialogMode('edit');
    setEditTarget(admin);
    setForm({
      email: admin.email || '',
      password: '',
      displayName: admin.displayName || '',
      phoneNumber: admin.phoneNumber || '',
      platformRole: admin.platformRole || 'admin',
    });
    setMessage({ type: '', text: '' });
  };

  const closeDialog = () => {
    if (saving) return;
    setDialogMode(null);
    setEditTarget(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      if (dialogMode === 'add') {
        if (!form.email || !form.password) {
          setMessage({ type: 'error', text: '請輸入郵箱和密碼。' });
          setSaving(false);
          return;
        }
        await apiClient.post('/platform/admins', form);
      } else if (dialogMode === 'resetPassword') {
        if (!form.password) {
          setMessage({ type: 'error', text: '請輸入新密碼。' });
          setSaving(false);
          return;
        }
        if (form.password !== form.confirmPassword) {
          setMessage({ type: 'error', text: '兩次輸入的密碼不一致。' });
          setSaving(false);
          return;
        }
        await apiClient.put(`/platform/admins/${editTarget.id}`, { password: form.password });
      } else {
        await apiClient.put(`/platform/admins/${editTarget.id}`, form);
      }
      setMessage({ type: 'success', text: dialogMode === 'add' ? '管理員已建立。' : '管理員已更新。' });
      setTimeout(() => { closeDialog(); loadAdmins(); }, 600);
    } catch (e) {
      setMessage({ type: 'error', text: e.message || '操作失敗' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (admin) => {
    const newStatus = admin.status === 'active' ? 'disabled' : 'active';
    if (!window.confirm(`確定要${newStatus === 'active' ? '啟用' : '停用'}管理員 ${admin.email} 嗎？`)) return;
    try {
      await apiClient.put(`/platform/admins/${admin.id}/status`, { status: newStatus });
      loadAdmins();
    } catch (e) {
      window.alert(e.message || '操作失敗');
    }
  };

  const handleDelete = async (admin) => {
    if (!window.confirm(`確定要刪除管理員 ${admin.email} 嗎？此操作不可恢復。`)) return;
    try {
      await apiClient.delete(`/platform/admins/${admin.id}`);
      loadAdmins();
    } catch (e) {
      window.alert(e.message || '刪除失敗');
    }
  };

  const handleResetPassword = (admin) => {
    setDialogMode('resetPassword');
    setEditTarget(admin);
    setForm(f => ({ ...f, password: '', confirmPassword: '', displayName: admin.displayName || '', email: admin.email || '' }));
    setMessage({ type: '', text: '' });
  };

  const formatDate = (v) => v ? String(v).slice(0, 10) : '-';

  return (
    <section className="view active" id="platform-admin-management">
      <style>{`
        .pam-panel { background: #111827; border: 1px solid #1f2937; border-radius: 14px; box-shadow: 0 10px 26px rgba(0,0,0,0.2); overflow: hidden; }
        .pam-table-wrap { overflow: auto; }
        .pam-table { width: 100%; min-width: 900px; border-collapse: collapse; font-size: 13px; }
        .pam-table th { padding: 12px 16px; text-align: left; font-weight: 600; font-size: 12px; color: #9ca3af; background: #1a2332; border-bottom: 1px solid #1f2937; white-space: nowrap; }
        .pam-table td { padding: 12px 16px; color: #e5e7eb; border-bottom: 1px solid #1f2937; white-space: nowrap; }
        .pam-table th:last-child, .pam-table td:last-child { position: sticky; right: 0; z-index: 1; background: #111827; box-shadow: -2px 0 4px rgba(0,0,0,0.2); }
        .pam-table thead th:last-child { z-index: 3; background: #1a2332; }
        .pam-table tr:hover td { background: #1a2332; }
        .pam-table tr:hover td:last-child { background: #1a2332; }
        .pam-badge { display: inline-flex; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; }
        .pam-badge.active { background: #0d2818; color: #22c55e; }
        .pam-badge.disabled { background: #3b1111; color: #ef4444; }
        .pam-action-btn { padding: 4px 12px; border-radius: 8px; border: 1px solid #4b5563; background: #374151; color: #d1d5db; font-size: 12px; cursor: pointer; margin-right: 4px; }
        .pam-action-btn:hover { background: #4b5563; color: #f3f4f6; }
        .pam-action-btn.danger { color: #fca5a5; border-color: #7f1d1d; }
        .pam-action-btn.danger:hover { background: #3b1111; }
      `}</style>

      <div style={{ marginBottom: '16px' }}></div>

      {message.text && (
        <div style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', background: message.type === 'error' ? '#3b1111' : '#0d2818', color: message.type === 'error' ? '#ef4444' : '#22c55e' }}>
          {message.text}
        </div>
      )}

      <div className="pam-panel">
        <div className="pam-table-wrap">
        <table className="pam-table">
          <thead>
            <tr>
              <th>邮箱</th>
              <th>显示名称</th>
              <th>角色</th>
              <th>电话</th>
              <th>状态</th>
              <th>最后登录</th>
              <th>创建日期</th>
              <th style={{ width: '160px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>加载中...</td></tr>
            ) : admins.length === 0 ? (
              <tr><td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>暂无数据</td></tr>
            ) : admins.map(a => (
              <tr key={a.id}>
                <td style={{ fontWeight: 500 }}>{a.email}</td>
                <td>{a.displayName || '-'}</td>
                <td>{roleLabels[a.platformRole] || a.platformRole}</td>
                <td>{a.phoneNumber || '-'}</td>
                <td><span className={`pam-badge ${a.status}`}>{a.status === 'active' ? '啟用' : '停用'}</span></td>
                <td style={{ color: '#94a3b8' }}>{formatDate(a.lastLoginAt)}</td>
                <td style={{ color: '#94a3b8' }}>{formatDate(a.createdAt)}</td>
                <td>
                  <button className="pam-action-btn" onClick={() => openEdit(a)}>编辑</button>
                  <button className="pam-action-btn" onClick={() => handleResetPassword(a)}>重置密码</button>
                  {a.platformRole !== 'super_admin' && (
                    <>
                      <button className={`pam-action-btn ${a.status === 'active' ? 'danger' : ''}`} onClick={() => handleToggleStatus(a)}>
                        {a.status === 'active' ? '停用' : '啟用'}
                      </button>
                      <button className="pam-action-btn danger" onClick={() => handleDelete(a)}>删除</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {dialogMode && createPortal(
        <div className="dialog-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000 }}>
          <form onSubmit={handleSave} style={{ backgroundColor: '#111827', borderRadius: '10px', width: '460px', maxWidth: '90vw', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#f3f4f6' }}>{dialogMode === 'add' ? '新增管理員' : dialogMode === 'resetPassword' ? '重設密碼' : '編輯管理員'}</h3>
              <button type="button" onClick={closeDialog} disabled={saving} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '20px' }}>&#10005;</button>
            </div>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {dialogMode === 'resetPassword' ? (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>新密碼 <RequiredMark /> <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: 400 }}>(至少 6 個字元)</span></span>
                    <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="至少 6 位字元" style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} autoComplete="new-password" />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>確認密碼 <RequiredMark /></span>
                    <input type="password" value={form.confirmPassword} onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))} placeholder="再次輸入密碼" style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} autoComplete="new-password" />
                  </label>
                </>
              ) : (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>郵箱 <RequiredMark /></span>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>密碼 {dialogMode === 'add' && <RequiredMark />} {dialogMode === 'edit' && <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: 400 }}>(留空則不修改)</span>}</span>
                    <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={dialogMode === 'edit' ? '留空則不修改' : '至少 6 位字元'} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} autoComplete="new-password" />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>顯示名稱</span>
                    <input type="text" value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>電話</span>
                    <input type="tel" value={form.phoneNumber} onChange={e => setForm(f => ({ ...f, phoneNumber: e.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>角色</span>
                    <select value={form.platformRole} onChange={e => setForm(f => ({ ...f, platformRole: e.target.value }))} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb', fontSize: '14px' }}>
                      {Object.entries(roleLabels).filter(([k]) => k !== 'super_admin').map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {message.text && <p style={{ margin: 0, fontSize: '14px', color: message.type === 'error' ? '#ef4444' : '#22c55e', lineHeight: 1.6 }}>{message.text}</p>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
              <button type="button" disabled={saving} onClick={closeDialog} style={{ padding: '8px 20px', borderRadius: '6px', backgroundColor: '#1f2937', color: '#d1d5db', border: '1px solid #374151', fontSize: '13px', cursor: 'pointer' }}>取消</button>
              <button className="primary-btn" type="submit" disabled={saving}>{saving ? '儲存中...' : '確認'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </section>
  );
});

export default PlatformAdminManagement;
