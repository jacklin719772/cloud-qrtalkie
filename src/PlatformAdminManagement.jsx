import React, { useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import apiClient from './apiClient';

const roleLabels = {
  super_admin: '超级管理员',
  admin: '管理员',
  operator: '运营',
  finance: '财务',
  support: '客服',
  auditor: '审计',
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
      setMessage({ type: 'error', text: e.message || '加载失败' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAdmins(); }, []);

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
          setMessage({ type: 'error', text: '请输入邮箱和密码。' });
          setSaving(false);
          return;
        }
        await apiClient.post('/platform/admins', form);
      } else if (dialogMode === 'resetPassword') {
        if (!form.password) {
          setMessage({ type: 'error', text: '请输入新密码。' });
          setSaving(false);
          return;
        }
        if (form.password !== form.confirmPassword) {
          setMessage({ type: 'error', text: '两次输入的密码不一致。' });
          setSaving(false);
          return;
        }
        await apiClient.put(`/platform/admins/${editTarget.id}`, { password: form.password });
      } else {
        await apiClient.put(`/platform/admins/${editTarget.id}`, form);
      }
      setMessage({ type: 'success', text: dialogMode === 'add' ? '管理员已创建。' : '管理员已更新。' });
      setTimeout(() => { closeDialog(); loadAdmins(); }, 600);
    } catch (e) {
      setMessage({ type: 'error', text: e.message || '操作失败' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (admin) => {
    const newStatus = admin.status === 'active' ? 'disabled' : 'active';
    if (!window.confirm(`确定要${newStatus === 'active' ? '啟用' : '停用'}管理员 ${admin.email} 吗？`)) return;
    try {
      await apiClient.put(`/platform/admins/${admin.id}/status`, { status: newStatus });
      loadAdmins();
    } catch (e) {
      window.alert(e.message || '操作失败');
    }
  };

  const handleDelete = async (admin) => {
    if (!window.confirm(`确定要删除管理员 ${admin.email} 吗？此操作不可恢复。`)) return;
    try {
      await apiClient.delete(`/platform/admins/${admin.id}`);
      loadAdmins();
    } catch (e) {
      window.alert(e.message || '删除失败');
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
        .pam-badge.active { background: #dcfce7; color: #15803d; }
        .pam-badge.disabled { background: #fee2e2; color: #dc2626; }
        .pam-action-btn { padding: 4px 12px; border-radius: 6px; border: 1px solid #d8e2ef; background: #fff; color: #475569; font-size: 12px; cursor: pointer; margin-right: 4px; }
        .pam-action-btn:hover { background: #f1f5f9; }
        .pam-action-btn.danger { color: #dc2626; border-color: #fecaca; }
        .pam-action-btn.danger:hover { background: #fef2f2; }
      `}</style>

      <div style={{ marginBottom: '16px' }}></div>

      {message.text && (
        <div style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px', background: message.type === 'error' ? '#fef2f2' : '#f0fdf4', color: message.type === 'error' ? '#dc2626' : '#16a34a' }}>
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
        <div style={{ position: 'fixed', inset: 0, zIndex: 2147483646, background: 'rgba(15,23,42,0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onMouseDown={e => { if (e.target === e.currentTarget) closeDialog(); }}>
          <form onSubmit={handleSave} style={{ width: 'min(480px, 100%)', background: '#fff', borderRadius: '12px', boxShadow: '0 24px 80px rgba(15,23,42,0.22)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px' }}>{dialogMode === 'add' ? '新增管理员' : dialogMode === 'resetPassword' ? '重置密码' : '编辑管理员'}</h3>
              <button type="button" onClick={closeDialog} disabled={saving} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94a3b8' }}>&#10005;</button>
            </div>
            <div style={{ padding: '20px', display: 'grid', gap: '14px' }}>
              {dialogMode === 'resetPassword' ? (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 500, color: '#475569' }}>
                    <span>新密码 <span style={{ color: '#dc2626' }}>*</span></span>
                    <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="至少 6 位字符" style={{ padding: '10px', border: '1px solid #d8e2ef', borderRadius: '8px', fontSize: '14px', outline: 'none' }} autoComplete="new-password" />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 500, color: '#475569' }}>
                    <span>确认密码 <span style={{ color: '#dc2626' }}>*</span></span>
                    <input type="password" value={form.confirmPassword} onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))} placeholder="再次输入密码" style={{ padding: '10px', border: '1px solid #d8e2ef', borderRadius: '8px', fontSize: '14px', outline: 'none' }} autoComplete="new-password" />
                  </label>
                </>
              ) : (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 500, color: '#475569' }}>
                    <span>邮箱 <span style={{ color: '#dc2626' }}>*</span></span>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={{ padding: '10px', border: '1px solid #d8e2ef', borderRadius: '8px', fontSize: '14px', outline: 'none' }} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 500, color: '#475569' }}>
                    <span>密码 {dialogMode === 'add' && <span style={{ color: '#dc2626' }}>*</span>}</span>
                    <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={dialogMode === 'edit' ? '留空则不修改' : '至少 6 位字符'} style={{ padding: '10px', border: '1px solid #d8e2ef', borderRadius: '8px', fontSize: '14px', outline: 'none' }} autoComplete="new-password" />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 500, color: '#475569' }}>
                    显示名称
                    <input type="text" value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} style={{ padding: '10px', border: '1px solid #d8e2ef', borderRadius: '8px', fontSize: '14px', outline: 'none' }} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 500, color: '#475569' }}>
                    电话
                    <input type="tel" value={form.phoneNumber} onChange={e => setForm(f => ({ ...f, phoneNumber: e.target.value }))} style={{ padding: '10px', border: '1px solid #d8e2ef', borderRadius: '8px', fontSize: '14px', outline: 'none' }} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 500, color: '#475569' }}>
                    角色
                    <select value={form.platformRole} onChange={e => setForm(f => ({ ...f, platformRole: e.target.value }))} style={{ padding: '10px', border: '1px solid #d8e2ef', borderRadius: '8px', fontSize: '14px', outline: 'none', background: '#fff' }}>
                      {Object.entries(roleLabels).filter(([k]) => k !== 'super_admin').map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {message.text && <p style={{ margin: 0, fontSize: '13px', color: message.type === 'error' ? '#dc2626' : '#16a34a' }}>{message.text}</p>}
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={closeDialog} disabled={saving} style={{ padding: '8px 16px', border: '1px solid #d8e2ef', borderRadius: '8px', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: '13px' }}>取消</button>
              <button type="submit" disabled={saving} style={{ padding: '8px 20px', border: '0', borderRadius: '8px', background: 'linear-gradient(90deg, #2563eb, #06b6d4)', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>{saving ? '保存中...' : '保存'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </section>
  );
});

export default PlatformAdminManagement;
