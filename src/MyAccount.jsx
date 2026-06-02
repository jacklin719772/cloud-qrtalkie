import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import apiClient from './apiClient';
import EcardGeneration from './EcardGeneration';

function formatDate(value) {
  if (!value) return '-';
  return String(value).slice(0, 10);
}

export default function MyAccount({ identity }) {
  const [profile, setProfile] = useState(null);
  const [ecardEnabled, setEcardEnabled] = useState(false);
  const [ecardData, setEcardData] = useState(null);
  const [ecardActive, setEcardActive] = useState(false);
  const [ecardThumbnailUrl, setEcardThumbnailUrl] = useState('');
  const [showEcardEditor, setShowEcardEditor] = useState(false);
  const [showEcardPreview, setShowEcardPreview] = useState(false);
  const [showDeviceDialog, setShowDeviceDialog] = useState(false);
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionDialog, setActionDialog] = useState(null); // 'displayName' | 'email' | 'phone' | 'password' | 'ecard' | null
  const [form, setForm] = useState({ displayName: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const loadProfile = async () => {
    try {
      const data = await apiClient.get('/me');
      setProfile(data);
      const initialEmail = data.admin?.email || '';
      const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      setForm(prev => ({
        ...prev,
        displayName: data.admin?.displayName || '',
        email: isValidEmail(initialEmail) ? initialEmail : '',
        phone: data.admin?.phoneNumber || '',
      }));
      // Check ecard availability
      try {
        const ecardRes = await apiClient.get(`/tenant/ecard-accounts/${data.admin?.id}/ecard`);
        setEcardEnabled(true);
        setEcardData(ecardRes.ecardDataJson || ecardRes.ecard || ecardRes.data || null);
        setEcardActive(ecardRes.status === 'active');
        setEcardThumbnailUrl(ecardRes.thumbnailUrl || '');
      } catch {
        setEcardEnabled(false);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProfile(); }, []);
  const openDialog = (type) => {
    setMessage({ type: '', text: '' });
    if (type === 'password') setForm(prev => ({ ...prev, password: '', confirmPassword: '' }));
    setActionDialog(type);
  };

  const closeDialog = () => {
    if (saving) return;
    setActionDialog(null);
    setMessage({ type: '', text: '' });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    if (actionDialog === 'password') {
      if (!form.password) { setMessage({ type: 'error', text: '请输入新密码。' }); return; }
      if (form.password.length < 6) { setMessage({ type: 'error', text: '密码至少需要 6 个字符。' }); return; }
      if (form.password !== form.confirmPassword) { setMessage({ type: 'error', text: '两次输入的密码不一致。' }); return; }
    }

    setSaving(true);
    try {
      const payload = { displayName: form.displayName, email: form.email || '', phone: form.phone || '' };
      if (actionDialog === 'password') {
        payload.password = form.password;
        payload.confirmPassword = form.confirmPassword;
      }
      await apiClient.put(`/tenant/sip-accounts/${profile.admin.id}`, payload);
      setMessage({ type: 'success', text: '保存成功。' });
      setTimeout(() => { closeDialog(); loadProfile(); }, 800);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || '保存失败。' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEcardStatus = async (e) => {
    e.stopPropagation();
    if (!profile?.admin?.id) return;
    const newStatus = ecardActive ? 'disabled' : 'active';
    try {
      await apiClient.put(`/tenant/ecard-accounts/${profile.admin.id}/ecard/status`, { status: newStatus });
      setEcardActive(!ecardActive);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || '状态切换失败' });
    }
  };

  const handleDownloadEcard = (e) => {
    e.stopPropagation();
    if (!ecardThumbnailUrl) return;
    const url = ecardThumbnailUrl.startsWith('/') ? '/api' + ecardThumbnailUrl : ecardThumbnailUrl;
    const a = document.createElement('a');
    a.href = url;
    a.download = `ecard-${profile?.admin?.username || 'card'}.jpg`;
    a.click();
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>加载中...</div>;

  const admin = profile?.admin || {};
  const tenant = profile?.tenant || {};

  if (showEcardEditor) {
    return <EcardGeneration selfServiceSipUserId={profile?.admin?.id} onSelfServiceBack={() => { setShowEcardEditor(false); loadProfile(); }} />;
  }

  return (
    <section className="view active" id="my-account">
      <style>{`
        .ma-grid { display: grid; grid-template-columns: 1fr 340px; gap: 24px; max-width: 960px; align-items: stretch; }
        .ma-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; box-shadow: 0 10px 26px rgba(15,23,42,0.06); height: 100%; box-sizing: border-box; }
        .ma-card h3 { margin: 0 0 16px; font-size: 16px; font-weight: 600; color: #0f172a; }
        .ma-action-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .ma-action-btn { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; cursor: pointer; font-size: 14px; color: #334155; text-align: left; transition: all 0.15s; }
        .ma-action-btn:hover { border-color: #93c5fd; background: #f8fafc; }
        .ma-action-btn .ma-action-icon { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
        .ma-action-full { grid-column: 1 / -1; }
        .ma-info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
        .ma-info-row:last-child { border-bottom: 0; }
        .ma-info-label { color: #64748b; }
        .ma-info-value { color: #334155; font-weight: 500; }
        .ma-dialog-overlay { position: fixed; inset: 0; z-index: 2147483646; background: rgba(15,23,42,0.36); display: flex; align-items: center; justify-content: center; padding: 20px; }
        .ma-dialog { width: min(440px, 100%); background: #fff; border-radius: 12px; box-shadow: 0 24px 80px rgba(15,23,42,0.22); overflow: hidden; }
        .ma-dialog-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #e2e8f0; }
        .ma-dialog-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
        .ma-dialog-body { padding: 20px; display: grid; gap: 14px; }
        .ma-dialog-body label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 500; color: #475569; }
        .ma-dialog-body input { padding: 10px 12px; border: 1px solid #d8e2ef; border-radius: 8px; font-size: 14px; outline: none; }
        .ma-dialog-body input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.12); }
        .ma-dialog-footer { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid #e2e8f0; background: #f8fafc; }
      `}</style>

      <div className="ma-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
          <div className="ma-card" style={{ flex: 1 }}>
            <h3>账号操作</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="ma-action-row">
                <button className="ma-action-btn" onClick={() => openDialog('displayName')}>
                  <span className="ma-action-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>&#9998;</span>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>设置显示名</div><div style={{ fontSize: '12px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.displayName || '未设置'}</div></div>
                </button>
                <button className="ma-action-btn" onClick={() => openDialog('email')}>
                  <span className="ma-action-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>&#9993;</span>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>设置邮箱</div><div style={{ fontSize: '12px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.email || '未设置'}</div></div>
                </button>
              </div>
              <div className="ma-action-row">
                <button className="ma-action-btn" onClick={() => openDialog('phone')}>
                  <span className="ma-action-icon" style={{ background: '#fef3c7', color: '#b45309' }}>&#9742;</span>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>设置电话</div><div style={{ fontSize: '12px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.phone || '未设置'}</div></div>
                </button>
                <button className="ma-action-btn" onClick={() => openDialog('password')}>
                  <span className="ma-action-icon" style={{ background: '#fef2f2', color: '#dc2626' }}>&#128274;</span>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>设置密码</div><div style={{ fontSize: '12px', color: '#94a3b8' }}>更改登录密码</div></div>
                </button>
              </div>
              <div className="ma-action-row">
                <button className="ma-action-btn" onClick={() => setShowDeviceDialog(true)}>
                  <span className="ma-action-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>&#9881;</span>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>设备管理</div><div style={{ fontSize: '12px', color: '#94a3b8' }}>管理已绑定设备</div></div>
                </button>
                <button className="ma-action-btn" onClick={() => setShowQrDialog(true)}>
                  <span className="ma-action-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>&#128273;</span>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>登录二维码</div><div style={{ fontSize: '12px', color: '#94a3b8' }}>扫码登录</div></div>
                </button>
              </div>
              {ecardEnabled && (
                <div className="ma-action-btn" style={{ cursor: 'default' }}>
                  <span className="ma-action-icon" style={{ background: '#f3e8ff', color: '#7c3aed' }}>&#128196;</span>
                  <div onClick={() => setShowEcardEditor(true)} style={{ minWidth: 0, flex: 1, cursor: 'pointer' }}>
                    <div style={{ fontWeight: 500 }}>电子名片</div>
                    <div style={{ fontSize: '12px', color: ecardData ? (ecardActive ? '#16a34a' : '#94a3b8') : '#94a3b8' }}>{ecardData ? (ecardActive ? '已啟用' : '已停用') : '未设置'}</div>
                  </div>
                  {ecardData && (
                    <div onClick={handleToggleEcardStatus} style={{
                      width: '40px', height: '22px', borderRadius: '11px', cursor: 'pointer',
                      background: ecardActive ? '#16a34a' : '#d1d5db',
                      position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginRight: '8px'
                    }}>
                      <div style={{
                        position: 'absolute', top: '2px', left: ecardActive ? '20px' : '2px',
                        width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
                        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                      }} />
                    </div>
                  )}
                  <span onClick={() => setShowEcardEditor(true)} style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, background: ecardData ? '#eff6ff' : '#fef3c7', color: ecardData ? '#2563eb' : '#b45309', whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer' }}>{ecardData ? '编辑' : '创建'}</span>
                  {ecardData && ecardThumbnailUrl && (
                    <span onClick={handleDownloadEcard} style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, background: '#f0fdf4', color: '#16a34a', whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer', marginLeft: '6px' }}>下载</span>
                  )}
                  {ecardData && ecardThumbnailUrl && (
                    <span onClick={(e) => { e.stopPropagation(); setShowEcardPreview(true); }} style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, background: '#fef3c7', color: '#b45309', whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer', marginLeft: '6px' }}>预览</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ height: '100%' }}>
          <div className="ma-card">
            <h3>基本信息</h3>
            <div className="ma-info-row"><span className="ma-info-label">账号</span><span className="ma-info-value">{admin.username || '-'}</span></div>
            <div className="ma-info-row"><span className="ma-info-label">显示名</span><span className="ma-info-value">{admin.displayName || '-'}</span></div>
            <div className="ma-info-row"><span className="ma-info-label">邮箱</span><span className="ma-info-value">{admin.email || '-'}</span></div>
            <div className="ma-info-row"><span className="ma-info-label">电话</span><span className="ma-info-value">{admin.phoneNumber || '-'}</span></div>
            <div className="ma-info-row"><span className="ma-info-label">租户</span><span className="ma-info-value">{tenant.companyName || '-'}</span></div>
            <div className="ma-info-row"><span className="ma-info-label">SIP 域</span><span className="ma-info-value">{tenant.sipDomain || '-'}</span></div>
          </div>
        </div>
      </div>

      {actionDialog && createPortal(
        <div className="ma-dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget) closeDialog(); }}>
          <form className="ma-dialog" onSubmit={handleSave}>
            <div className="ma-dialog-header">
              <h3>{actionDialog === 'displayName' ? '设置显示名' : actionDialog === 'email' ? '设置邮箱' : actionDialog === 'phone' ? '设置电话' : actionDialog === 'password' ? '设置密码' : '电子名片'}</h3>
              <button type="button" onClick={closeDialog} disabled={saving} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '18px' }}>&#10005;</button>
            </div>
            <div className="ma-dialog-body">
              {actionDialog === 'displayName' && (
                <label>显示名称<input type="text" value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} placeholder="输入显示名称" /></label>
              )}
              {actionDialog === 'email' && (
                <label>电子邮箱<input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="输入电子邮箱" /></label>
              )}
              {actionDialog === 'phone' && (
                <label>电话号码<input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="输入电话号码" /></label>
              )}
              {actionDialog === 'password' && (
                <>
                  <label>新密码<input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="至少 6 位字符" autoComplete="new-password" /></label>
                  <label>确认密码<input type="password" value={form.confirmPassword} onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))} placeholder="再次输入密码" autoComplete="new-password" /></label>
                </>
              )}
              {message.text && <p style={{ margin: 0, fontSize: '13px', color: message.type === 'error' ? '#dc2626' : '#16a34a' }}>{message.text}</p>}
            </div>
            <div className="ma-dialog-footer">
              <button type="button" onClick={closeDialog} disabled={saving} style={{ padding: '8px 16px', border: '1px solid #d8e2ef', borderRadius: '8px', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: '13px' }}>取消</button>
              <button type="submit" disabled={saving} style={{ padding: '8px 20px', border: '0', borderRadius: '8px', background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>{saving ? '保存中...' : '保存'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}
      {showEcardPreview && createPortal(
        <div className="ma-dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setShowEcardPreview(false); }}>
          <div style={{ background: '#fff', borderRadius: '14px', overflow: 'hidden', maxWidth: '90vw', maxHeight: '90vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>名片预览</h3>
              <button onClick={() => setShowEcardPreview(false)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94a3b8' }}>&#10005;</button>
            </div>
            <div style={{ padding: '20px', display: 'flex', justifyContent: 'center' }}>
              <img src={ecardThumbnailUrl.startsWith('/') ? '/api' + ecardThumbnailUrl : ecardThumbnailUrl} alt="电子名片" style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: '8px' }} />
            </div>
          </div>
        </div>,
        document.body
      )}
      {showDeviceDialog && createPortal(
        <div className="ma-dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setShowDeviceDialog(false); }}>
          <div className="ma-dialog">
            <div className="ma-dialog-header">
              <h3>设备管理</h3>
              <button type="button" onClick={() => setShowDeviceDialog(false)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94a3b8' }}>&#10005;</button>
            </div>
            <div className="ma-dialog-body">
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8', fontSize: '14px' }}>设备管理功能将在后续版本中提供。</div>
            </div>
            <div className="ma-dialog-footer">
              <button type="button" onClick={() => setShowDeviceDialog(false)} style={{ padding: '8px 16px', border: '1px solid #d8e2ef', borderRadius: '8px', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: '13px' }}>关闭</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {showQrDialog && createPortal(
        <div className="ma-dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setShowQrDialog(false); }}>
          <div className="ma-dialog" style={{ width: 'min(380px, 100%)' }}>
            <div className="ma-dialog-header">
              <h3>登录二维码</h3>
              <button type="button" onClick={() => setShowQrDialog(false)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94a3b8' }}>&#10005;</button>
            </div>
            <div className="ma-dialog-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent('login://' + (profile?.admin?.username || 'user'))}`}
                alt="登录二维码"
                style={{ width: '200px', height: '200px', borderRadius: '8px', border: '1px solid #e2e8f0' }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button
                  onClick={async () => {
                    try {
                      const r = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent('login://' + (profile?.admin?.username || 'user'))}`);
                      const b = await r.blob();
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(b);
                      a.download = `qrcode-${profile?.admin?.username || 'user'}.png`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    } catch { window.alert('下载失败'); }
                  }}
                  style={{ padding: '6px 14px', borderRadius: '6px', border: '0', background: 'linear-gradient(90deg, #2563eb, #06b6d4)', color: '#fff', fontSize: '12px', cursor: 'pointer' }}
                >下载</button>
                <button
                  onClick={async () => {
                    try {
                      const r = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent('login://' + (profile?.admin?.username || 'user'))}`);
                      const b = await r.blob();
                      await navigator.clipboard.write([new ClipboardItem({ [b.type]: b })]);
                      window.alert('已复制');
                    } catch {
                      try {
                        await navigator.clipboard.writeText('login://' + (profile?.admin?.username || 'user'));
                        window.alert('图片复制失败，已复制链接');
                      } catch { window.alert('复制失败'); }
                    }
                  }}
                  style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #d8e2ef', background: '#fff', color: '#475569', fontSize: '12px', cursor: 'pointer' }}
                >复制</button>
              </div>
            </div>
            <div className="ma-dialog-footer" style={{ justifyContent: 'center' }}>
              <button type="button" onClick={() => setShowQrDialog(false)} style={{ padding: '8px 16px', border: '1px solid #d8e2ef', borderRadius: '8px', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: '13px' }}>关闭</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
