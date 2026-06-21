import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import apiClient from './apiClient';
import EcardGeneration from './EcardGeneration';
import LoginQrDialog from './LoginQrDialog';

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
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionDialog, setActionDialog] = useState(null); // 'displayName' | 'email' | 'phone' | 'password' | 'ecard' | null
  const [form, setForm] = useState({ displayName: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isMobile, setIsMobile] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

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

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>加载中...</div>;

  const admin = profile?.admin || {};
  const tenant = profile?.tenant || {};

  if (showEcardEditor) {
    if (isMobile) {
      const triggerSave = () => {
        const btn = document.querySelector('.ecard-generation-page .primary-btn, .ecard-add-page .primary-btn');
        if (btn) btn.click();
      };
      return (
        <>
          <style>{`
            .ma-mobile-ecard-wrap .ecard-add-left { flex: 1 1 100% !important; max-width: 100% !important; }
            .ma-mobile-ecard-wrap .ecard-add-right { display: none !important; }
            .ma-mobile-ecard-wrap .ecard-add-content { padding: 16px 12px !important; flex-direction: column !important; }
            .ma-mobile-ecard-wrap .ecard-form-grid { grid-template-columns: 1fr !important; gap: 12px !important; }
            .ma-mobile-ecard-wrap .ecard-form-grid input,
            .ma-mobile-ecard-wrap .ecard-form-grid select { height: 46px !important; font-size: 16px !important; width: 100% !important; }
            .ma-mobile-ecard-wrap .ecard-generation-page { padding: 16px 12px 40px !important; overflow-x: hidden !important; max-width: 100vw !important; }
            .ma-mobile-ecard-wrap .ecard-generation-page h1,
            .ma-mobile-ecard-wrap .ecard-generation-page h2,
            .ma-mobile-ecard-wrap .ecard-add-header { display: none !important; }
            .ma-mobile-ecard-wrap .ecard-preview-panel { display: none !important; }
            .ma-mobile-ecard-wrap .ecard-media-layout { flex-direction: column !important; gap: 12px !important; align-items: flex-start !important; }
            .ma-mobile-ecard-wrap .ecard-upload-area { width: 100px !important; height: 100px !important; flex: 0 0 auto !important; }
            .ma-mobile-ecard-wrap .ecard-form-grid.single-column { margin-left: 0 !important; }
            .ma-mobile-ecard-wrap label input[type="checkbox"] { width: 16px !important; height: 16px !important; flex-shrink: 0; }
            .ma-mobile-ecard-wrap label { flex-wrap: wrap !important; white-space: normal !important; max-width: 100% !important; overflow: visible !important; }
            .ma-mobile-ecard-wrap label span { white-space: normal !important; word-break: break-word; }
          `}</style>
        <div className="ma-mobile-ecard-wrap" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#0f0f10', display: 'flex', flexDirection: 'column', overflowX: 'hidden', maxWidth: '100vw' }}>
          <div className="ma-ecard-mobile-bar" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', height: '56px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#0f0f10' }}>
            <button onClick={() => { setShowEcardEditor(false); loadProfile(); }} style={{ background: 'none', border: 'none', color: '#f97316', fontSize: '15px', fontWeight: 500, cursor: 'pointer', padding: '8px 0', flexShrink: 0 }}>返回</button>
            <button onClick={() => { setShowPreviewModal(true); const right = document.querySelector('.ma-mobile-ecard-wrap .ecard-add-right'); const modalBody = document.getElementById('ma-preview-modal-body'); if (right && modalBody) { right.style.display = ''; modalBody.appendChild(right); } const left = document.querySelector('.ma-mobile-ecard-wrap .ecard-add-left'); if (left) left.style.display = 'none'; }} style={{ background: 'none', border: '1px solid rgba(96,165,250,0.4)', borderRadius: '8px', color: '#60a5fa', fontSize: '14px', fontWeight: 600, cursor: 'pointer', padding: '8px 14px', whiteSpace: 'nowrap' }}>預覽</button>
            <button onClick={triggerSave} style={{ background: 'linear-gradient(90deg, #2563eb, #06b6d4)', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', padding: '8px 14px', whiteSpace: 'nowrap' }}>保存</button>
          </div>
          <div className="ma-mobile-ecard-body" ref={(el) => { if (el) { setTimeout(() => { const right = el.querySelector('.ecard-add-right'); if (right) right.style.display = 'none'; const h1 = el.querySelector('h1, h2, .page-heading, .cc-add-header'); if (h1) h1.style.display = 'none'; const allBtns = el.querySelectorAll('button'); allBtns.forEach(b => { if (b.textContent.includes('返回我的帳號') || b.textContent.includes('返回列表') || b.textContent.includes('儲存并產生圖片')) b.style.display = 'none'; }); }, 100); } }} style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <EcardGeneration selfServiceSipUserId={profile?.admin?.id} onSelfServiceBack={() => { setShowEcardEditor(false); loadProfile(); }} />
          </div>

          {showPreviewModal && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#0f0f10', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 16px', height: '56px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#0f0f10' }}>
                <button onClick={() => { setShowPreviewModal(false); const right = document.getElementById('ma-preview-modal-body').querySelector('.ecard-add-right'); const content = document.querySelector('.ma-mobile-ecard-wrap .ecard-add-content'); if (right && content) { right.style.display = 'none'; content.appendChild(right); } const left = document.querySelector('.ma-mobile-ecard-wrap .ecard-add-left'); if (left) left.style.display = ''; }} style={{ background: 'none', border: 'none', color: '#f97316', fontSize: '15px', fontWeight: 500, cursor: 'pointer', padding: '8px 0' }}>← 返回</button>
                <span style={{ fontWeight: 700, color: '#fff', fontSize: '16px', margin: '0 auto' }}>實時預覽</span>
              </div>
              <div id="ma-preview-modal-body" style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px' }} />
            </div>
          )}
        </div>
        </>
      );
    }
    return <EcardGeneration selfServiceSipUserId={profile?.admin?.id} onSelfServiceBack={() => { setShowEcardEditor(false); loadProfile(); }} />;
  }

  return (
    <section className="view active" id="my-account">
      <style>{`
        .ma-grid { display: grid; grid-template-columns: 1fr 340px; gap: 24px; max-width: 960px; align-items: stretch; }
        .ma-card { background: #111827; border: 1px solid #1f2937; border-radius: 14px; padding: 24px; box-shadow: 0 10px 26px rgba(0,0,0,0.15); height: 100%; box-sizing: border-box; }
        .ma-card h3 { margin: 0 0 16px; font-size: 16px; font-weight: 600; color: #f3f4f6; }
        .ma-action-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .ma-action-btn { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border: 1px solid #1f2937; border-radius: 10px; background: #111827; cursor: pointer; font-size: 14px; color: #e5e7eb; text-align: left; transition: all 0.15s; }
        .ma-action-btn:hover { border-color: #60a5fa; background: #1a2332; }
        .ma-action-btn .ma-action-icon { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
        .ma-action-full { grid-column: 1 / -1; }
        .ma-info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #1f2937; font-size: 13px; }
        .ma-info-row:last-child { border-bottom: 0; }
        .ma-info-label { color: #9ca3af; }
        .ma-info-value { color: #e5e7eb; font-weight: 500; }
        .ma-dialog-overlay { position: fixed; inset: 0; z-index: 2147483646; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; padding: 20px; }
        .ma-dialog { width: min(440px, 100%); background: #111827; border-radius: 12px; box-shadow: 0 24px 80px rgba(0,0,0,0.4); overflow: hidden; border: 1px solid rgba(96,165,250,0.25); }
        .ma-dialog-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #1f2937; }
        .ma-dialog-header h3 { margin: 0; font-size: 16px; font-weight: 600; color: #f3f4f6; }
        .ma-dialog-body { padding: 20px; display: grid; gap: 14px; }
        .ma-dialog-body label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 500; color: #9ca3af; }
        .ma-dialog-body input { padding: 10px 12px; border: 1px solid #374151; border-radius: 8px; font-size: 14px; outline: none; background: #111827; color: #e5e7eb; }
        .ma-dialog-body input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
        .ma-dialog-footer { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid #1f2937; background: #0d1117; }
        .ma-mobile-footer { display: none; text-align: center; padding: 20px 16px; color: #6b7280; font-size: 12px; border-top: 1px solid #1f2937; margin-top: 16px; }
        .ma-mobile-footer a { color: #60a5fa; text-decoration: none; }
        /* PC: ecard actions stay inline */
        .ma-ecard-actions { display: inline-flex !important; width: auto !important; margin-top: 0 !important; }
        .ma-ecard-toggle { display: block; }
        /* PC: hide ecard separate-status text */
        .ma-ecard-status { display: none; }
        @media (max-width: 768px) {
          /* Allow scrolling on mobile */
          html, body { overflow: auto !important; height: auto !important; }
          .app-shell { overflow: auto !important; height: auto !important; }
          .main, .main-scroll { overflow: visible !important; height: auto !important; }
          #my-account { padding: 16px 0 0; background: #0f0f10; min-height: 100vh; overflow-x: hidden; max-width: 100vw; }
          .ma-grid { grid-template-columns: 1fr; gap: 12px; max-width: 100%; padding: 0 16px 16px; overflow-x: hidden; }
          .ma-mobile-footer { display: flex !important; justify-content: center; }
          .sidebar .nav-item, .sidebar .logout-item { display: none; }
          .sidebar { border-bottom: none; }
          .sidebar-foot { display: none !important; }
          .ma-card { padding: 18px; border-radius: 16px; background: #1a1a1d; border: 1px solid rgba(255,255,255,0.06); box-shadow: none; }
          .ma-card h3 { font-size: 18px; font-weight: 700; margin-bottom: 14px; color: #f97316; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; }
          .ma-card h3::before { content: ''; display: inline-block; width: 3px; height: 18px; background: #f97316; border-radius: 2px; }
          .ma-action-row { grid-template-columns: 1fr; gap: 0; }
          .ma-action-btn { border: none; border-bottom: 1px solid rgba(255,255,255,0.06); border-radius: 0; padding: 16px 0; background: transparent; gap: 14px; align-items: center; }
          .ma-action-btn:last-child { border-bottom: none; }
          .ma-action-btn:hover { background: transparent; }
          .ma-ecard-toggle { display: none; }
          .ma-ecard-actions { display: inline-flex !important; margin-left: auto; flex-shrink: 0; }
          .ma-ecard-status { display: block; }
          .ma-action-btn .ma-action-icon { width: 40px; height: 40px; border-radius: 12px; font-size: 18px; }
          .ma-info-row { padding: 12px 0; font-size: 14px; }
          .ma-info-row:last-child { border-bottom: none; }
          .ma-info-label { font-size: 14px; }
          .ma-info-value { font-size: 14px; }
          .ma-dialog-overlay { padding: 0; align-items: flex-end; }
          .ma-dialog { border-radius: 20px 20px 0 0; max-height: 90vh; overflow: auto; width: 100%; }
          .ma-dialog-header { padding: 18px 20px; }
          .ma-dialog-header h3 { font-size: 17px; color: #f3f4f6; }
          .ma-dialog-body { padding: 20px; gap: 14px; }
          .ma-dialog-body input { font-size: 16px; padding: 12px 14px; }
          .ma-dialog-footer { padding: 14px 20px; }
          /* Mobile ecard row */
          .ma-mobile-ecard-row { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
          .ma-mobile-ecard-actions { display: flex; gap: 8px; flex-wrap: wrap; }
          .ma-mobile-ecard-tag { padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap; }
          /* Mobile action text right */
          .ma-mobile-ecard-wrap .ecard-generation-page { padding: 16px 12px !important; }
          .ma-mobile-ecard-wrap .ecard-form-grid { grid-template-columns: 1fr !important; gap: 12px !important; }
          .ma-mobile-ecard-wrap .ecard-form-grid input,
          .ma-mobile-ecard-wrap .ecard-form-grid select { height: 46px !important; font-size: 16px !important; width: 100% !important; }
          .ma-mobile-ecard-wrap .ecard-add-left { flex: 1 1 100% !important; max-width: 100% !important; }
          .ma-mobile-ecard-wrap .ecard-add-content { padding: 16px 12px !important; }
          .ma-mobile-ecard-wrap .ecard-preview-panel { width: 100% !important; max-width: 100% !important; margin-top: 16px !important; }
          .ma-mobile-ecard-wrap .ecard-preview-panel { display: none !important; }
          .ma-mobile-ecard-wrap.view-preview .ecard-preview-panel { display: block !important; position: fixed; inset: 56px 0 0 0; z-index: 100; background: #0f0f10; overflow: auto; -webkit-overflow-scrolling: touch; padding: 16px; }
          .ma-mobile-ecard-wrap.view-preview .ecard-preview-container { max-height: none !important; overflow: auto !important; -webkit-overflow-scrolling: touch; }
          .ma-mobile-ecard-wrap.view-preview .ecard-preview-viewport { overflow: auto !important; }
          .ma-mobile-ecard-wrap.view-preview .ecard-generation-page > *:not(.ecard-preview-panel) { display: none !important; }
          /* Hide page title on mobile */
          .ma-mobile-ecard-wrap .ecard-generation-page h1,
          .ma-mobile-ecard-wrap .ecard-generation-page h2,
          .ma-mobile-ecard-wrap .page-heading { display: none !important; }
          /* Mobile form layout */
          .ma-mobile-ecard-wrap .ecard-generation-page { padding: 16px 12px 80px !important; }
          .ma-mobile-ecard-wrap .ecard-form-grid { grid-template-columns: 1fr !important; gap: 12px !important; }
          .ma-mobile-ecard-wrap .ecard-form-grid input,
          .ma-mobile-ecard-wrap .ecard-form-grid select { height: 46px !important; font-size: 16px !important; width: 100% !important; }
          .ma-mobile-ecard-wrap .ecard-template-cards { flex-wrap: wrap !important; gap: 8px !important; }
          .ma-mobile-ecard-wrap .ecard-template-card { width: 100px !important; height: 70px !important; }
          .ma-mobile-ecard-wrap .ecard-style-field-block { padding: 10px !important; }
          }
        }
      `}</style>

      <div className="ma-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%' }}>
          <div className="ma-card" style={{ flex: 1 }}>
            <h3>账号操作</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="ma-action-row">
                <button className="ma-action-btn" onClick={() => openDialog('displayName')}>
                  <span className="ma-action-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>&#9998;</span>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>设置显示名</div><div style={{ fontSize: '12px', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.displayName || '未设置'}</div></div>
                </button>
                <button className="ma-action-btn" onClick={() => openDialog('email')}>
                  <span className="ma-action-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>&#9993;</span>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>设置邮箱</div><div style={{ fontSize: '12px', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.email || '未设置'}</div></div>
                </button>
              </div>
              <div className="ma-action-row">
                <button className="ma-action-btn" onClick={() => openDialog('phone')}>
                  <span className="ma-action-icon" style={{ background: '#fef3c7', color: '#b45309' }}>&#9742;</span>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>设置电话</div><div style={{ fontSize: '12px', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.phone || '未设置'}</div></div>
                </button>
                <button className="ma-action-btn" onClick={() => openDialog('password')}>
                  <span className="ma-action-icon" style={{ background: '#fef2f2', color: '#dc2626' }}>&#128274;</span>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>设置密码</div><div style={{ fontSize: '12px', color: '#9ca3af' }}>更改登录密码</div></div>
                </button>
              </div>
              <div className="ma-action-row">
                <button className="ma-action-btn" disabled style={{ opacity: 0.45, cursor: 'not-allowed' }}>
                  <span className="ma-action-icon" style={{ background: '#1e293b', color: '#6b7280' }}>&#9881;</span>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500, color: '#9ca3af' }}>设备管理</div><div style={{ fontSize: '12px', color: '#6b7280' }}>即将推出</div></div>
                </button>
                <button className="ma-action-btn" onClick={() => setShowQrDialog(true)}>
                  <span className="ma-action-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>&#128273;</span>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>登录二维码</div><div style={{ fontSize: '12px', color: '#9ca3af' }}>扫码登录</div></div>
                </button>
              </div>
              {ecardEnabled && (
                <div className="ma-action-btn ma-ecard-btn" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                  <span className="ma-action-icon" style={{ background: '#f3e8ff', color: '#7c3aed' }}>&#128196;</span>
                  <div onClick={() => setShowEcardEditor(true)} style={{ minWidth: 0, flex: 1, cursor: 'pointer' }}>
                    <div className="ma-ecard-title" style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>电子名片</div>
                    <div className="ma-ecard-status" style={{ fontSize: '12px', color: ecardData ? (ecardActive ? '#22c55e' : '#9ca3af') : '#9ca3af' }}>{ecardData ? (ecardActive ? '已啟用' : '已停用') : '未设置'}</div>
                  </div>
                  {ecardData && (
                    <div className="ma-ecard-toggle" onClick={handleToggleEcardStatus} style={{
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
                  <div className="ma-ecard-actions" style={{ display: 'flex', gap: '6px' }}>
                    <span onClick={() => setShowEcardEditor(true)} className="ma-ecard-tag" style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 500, background: '#1e3a5f', color: '#60a5fa', cursor: 'pointer' }}>{ecardData ? '编辑' : '创建'}</span>
                    {ecardData && ecardThumbnailUrl && (
                      <span onClick={handleDownloadEcard} className="ma-ecard-tag" style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 500, background: '#0f2818', color: '#22c55e', cursor: 'pointer' }}>下载</span>
                    )}
                    {ecardData && ecardThumbnailUrl && (
                      <span onClick={(e) => { e.stopPropagation(); setShowEcardPreview(true); }} className="ma-ecard-tag" style={{ padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 500, background: '#3b1f06', color: '#f97316', cursor: 'pointer' }}>预览</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ height: '100%' }}>
          <div className="ma-card">
            <h3>基本信息</h3>
            <div className="ma-info-row"><span className="ma-info-label">账号</span><span className="ma-info-value">{admin.username || '-'}</span></div>
            <div className="ma-info-row"><span className="ma-info-label">同步状态</span><span className="ma-info-value" style={{ color: admin.flexisipSyncStatus === 'active' ? '#22c55e' : admin.flexisipSyncStatus === 'local_only' ? '#f59e0b' : '#ef4444' }}>{admin.flexisipSyncStatus === 'active' ? '已同步' : admin.flexisipSyncStatus === 'local_only' ? '仅本地' : admin.flexisipSyncStatus || '-'}</span></div>
            <div className="ma-info-row"><span className="ma-info-label">激活状态</span><span className="ma-info-value" style={{ color: admin.flexisipActivated === true ? '#22c55e' : admin.flexisipActivated === false ? '#ef4444' : '#9ca3af' }}>{admin.flexisipActivated === true ? '已激活' : admin.flexisipActivated === false ? '未激活' : '未知'}</span></div>
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
              <button type="button" onClick={closeDialog} disabled={saving} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '18px' }}>&#10005;</button>
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
              <button type="button" onClick={closeDialog} disabled={saving} style={{ padding: '8px 16px', border: '1px solid #374151', borderRadius: '8px', background: '#111827', color: '#9ca3af', cursor: 'pointer', fontSize: '13px' }}>取消</button>
              <button type="submit" disabled={saving} style={{ padding: '8px 20px', border: '0', borderRadius: '8px', background: 'linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 500 }}>{saving ? '保存中...' : '保存'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}
      {showEcardPreview && createPortal(
        <div className="ma-dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setShowEcardPreview(false); }}>
          <div style={{ background: '#111827', borderRadius: '14px', overflow: 'hidden', maxWidth: '90vw', maxHeight: '90vh', border: '1px solid #1f2937' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>名片预览</h3>
              <button onClick={() => setShowEcardPreview(false)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#9ca3af' }}>&#10005;</button>
            </div>
            <div style={{ padding: '20px', display: 'flex', justifyContent: 'center' }}>
              <img src={ecardThumbnailUrl.startsWith('/') ? '/api' + ecardThumbnailUrl : ecardThumbnailUrl} alt="电子名片" style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: '8px' }} />
            </div>
          </div>
        </div>,
        document.body
      )}
      {showQrDialog && createPortal(
        <LoginQrDialog isOpen={showQrDialog} onClose={() => setShowQrDialog(false)} account={{ id: profile?.admin?.id }} />,
        document.body
      )}

      <div className="ma-mobile-footer">
        All Right Reserved QRTalkie
      </div>
    </section>
  );
}
