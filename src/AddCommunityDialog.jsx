import React, { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { RefreshCw } from 'lucide-react';
import apiClient from './apiClient';

const generateSlug = () => Math.random().toString(36).substring(2, 10);

const fillForm = (form, data) => {
  if (!form || !data) return;
  form.name.value = data.name || '';
  form.address.value = data.address || '';
  form.latitude.value = data.latitude ?? '';
  form.longitude.value = data.longitude ?? '';
  form.serviceScope.value = data.serviceScope ?? 0;
  form.contactPerson.value = data.contactPerson || '';
  form.contactPhone.value = data.contactPhone || '';
  form.contactEmail.value = data.contactEmail || '';
  form.visitorTitle.value = data.visitorTitle || '';
  if (data.showTips !== undefined) form.showTips.checked = !!data.showTips;
  form.tipsText.value = data.tipsText || '';
};

const accessBaseUrl = import.meta.env.VITE_ACCESS_BASE_URL || window.location.origin;

const AddCommunityDialog = forwardRef(({ onCreated, onUpdated }, ref) => {
  const dialogRef = useRef(null);
  const formRef = useRef(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [editId, setEditId] = useState(null);
  const [slug, setSlug] = useState(generateSlug);
  const [editSlug, setEditSlug] = useState(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');

  const handleImageUpload = async (e, fieldName) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formDataUpload = new FormData();
    formDataUpload.append('image', file);
    try {
      const res = await apiClient.post('/upload/community-image', formDataUpload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res && res.url) {
        if (fieldName === 'logoUrl') setLogoUrl(res.url);
        else setBannerUrl(res.url);
      }
    } catch (err) { console.error('Upload failed:', err); }
  };

  const displaySlug = editSlug || slug;
  const accessUrl = `${accessBaseUrl}/access/${displaySlug}`;

  useImperativeHandle(ref, () => ({
    showModal(editData) {
      setErrorMessage('');
      formRef.current?.reset();
      if (editData) {
        setEditId(editData.id);
        setEditSlug(editData.slug || null);
        setLogoUrl(editData.logoUrl || '');
        setBannerUrl(editData.bannerUrl || '');
        requestAnimationFrame(() => fillForm(formRef.current, editData));
      } else {
        setEditId(null);
        setEditSlug(null);
        setLogoUrl('');
        setBannerUrl('');
        const newSlug = generateSlug();
        setSlug(newSlug);
        requestAnimationFrame(() => {
          if (formRef.current) formRef.current.serviceScope.value = '0';
        });
        // Pre-fill visitor title with tenant name
        apiClient.get('/me').then(data => {
          const tenantName = data?.tenant?.companyName || data?.tenant?.name || '';
          if (tenantName && formRef.current) formRef.current.visitorTitle.value = tenantName;
        }).catch(() => {});
      }
      dialogRef.current?.showModal();
    },
  }));

  const handleClose = () => {
    dialogRef.current?.close();
  };

  const handleRefreshSlug = () => {
    if (editId) {
      setEditSlug(generateSlug());
    } else {
      setSlug(generateSlug());
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    const formData = new FormData(e.target);
    const payload = {
      name: formData.get('name')?.toString().trim(),
      slug: displaySlug,
      address: formData.get('address')?.toString().trim(),
      latitude: formData.get('latitude'),
      longitude: formData.get('longitude'),
      serviceScope: formData.get('serviceScope')?.toString().trim() || '0',
      contactPerson: formData.get('contactPerson')?.toString().trim() || null,
      contactPhone: formData.get('contactPhone')?.toString().trim() || null,
      contactEmail: formData.get('contactEmail')?.toString().trim() || null,
      logoUrl: logoUrl || null,
      bannerUrl: bannerUrl || null,
      visitorTitle: formData.get('visitorTitle')?.toString().trim() || null,
      showTips: formData.get('showTips') === 'on',
      tipsText: formData.get('tipsText')?.toString().trim() || null,
    };

    if (!payload.name) {
      setErrorMessage('請填寫社區名稱。');
      return;
    }
    if (!payload.address) {
      setErrorMessage('請填寫社區地址。');
      return;
    }

    setIsSaving(true);
    try {
      const url = editId ? `/access-communities/${editId}` : '/access-communities';
      const res = editId ? await apiClient.put(url, payload) : await apiClient.post(url, payload);
      if (res && res.code === 0) {
        dialogRef.current?.close();
        if (editId && onUpdated) onUpdated(res.data);
        else if (!editId && onCreated) onCreated(res.data);
      } else {
        setErrorMessage(res?.message || (editId ? '編輯社區失敗。' : '新增社區失敗。'));
      }
    } catch (error) {
      console.error(editId ? '編輯社區失敗:' : '新增社區失敗:', error);
      setErrorMessage(error.response?.data?.message || error.message || (editId ? '編輯社區失敗，請稍後再試。' : '新增社區失敗，請稍後再試。'));
    } finally {
      setIsSaving(false);
    }
  };

  const isEdit = editId != null;

  return (
    <dialog ref={dialogRef} style={{ border: '0', borderRadius: '16px', padding: '0', maxWidth: '560px', width: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', background: '#111827', color: '#e5e7eb' }}>
      <style>{`
        dialog::backdrop {
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
        }
        .add-community-form {
          display: flex;
          flex-direction: column;
          max-height: 85vh;
        }
        .add-community-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 24px 28px 0;
          flex-shrink: 0;
        }
        .add-community-body {
          flex: 1;
          overflow-y: auto;
          padding: 20px 28px 24px;
          scrollbar-width: thin;
          scrollbar-color: #374151 transparent;
        }
        .add-community-body::-webkit-scrollbar { width: 4px; }
        .add-community-body::-webkit-scrollbar-track { background: transparent; }
        .add-community-body::-webkit-scrollbar-thumb { background: #374151; border-radius: 2px; }
        .cc-upload-box {
          text-align: center; border: 1px dashed #374151; border-radius: 10px;
          background: #1a2332; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 8px;
          color: #9ca3af; cursor: pointer; transition: all 0.2s; box-sizing: border-box;
        }
        .cc-upload-box:hover { border-color: #60a5fa; background: #1e293b; color: #60a5fa; }
        .cc-upload-logo { width: 160px; height: 100px; }
        .cc-upload-cover { width: 100%; height: 100px; max-width: 260px; }
        .cc-upload-text { font-size: 12px; font-weight: 500; }
        .cc-upload-hint { font-size: 10px; color: #6b7280; }
        .add-community-footer {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 16px 28px;
          border-top: 1px solid #1f2937;
          background: #0d1117;
          flex-shrink: 0;
          border-radius: 0 0 16px 16px;
        }
      `}</style>
      <form ref={formRef} method="dialog" onSubmit={handleSubmit} className="add-community-form">
        <div className="add-community-header">
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>{isEdit ? '編輯社區' : '新增社區'}</h2>
          <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '18px', padding: '4px' }} onClick={handleClose}>&#x2715;</button>
        </div>

        <div className="add-community-body">
          {errorMessage && (
            <p style={{ color: '#f87171', fontSize: '13px', margin: '0 0 16px', background: '#2d1111', padding: '10px 14px', borderRadius: '8px' }}>{errorMessage}</p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <label style={{ gridColumn: '1 / -1' }}>
              <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>社區名稱 <b style={{ color: '#dc2626' }}>*</b></span>
              <input name="name" required style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#e5e7eb', outline: 'none', boxSizing: 'border-box' }} placeholder="例如：翠湖花園" />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>地址 <b style={{ color: '#dc2626' }}>*</b></span>
              <input name="address" required style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#e5e7eb', outline: 'none', boxSizing: 'border-box' }} placeholder="例如：香港新界沙田翠湖街 18 號" />
            </label>

            <label style={{ gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>唯一標識 Slug <b style={{ color: '#dc2626' }}>*</b></span>
                <button type="button" onClick={handleRefreshSlug} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px' }} title="重新生成"><RefreshCw size={14} /></button>
              </div>
              <input type="text" value={displaySlug} readOnly style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#e5e7eb', outline: 'none', boxSizing: 'border-box', background: '#1a2332' }} />
            </label>

            <label style={{ gridColumn: '1 / -1' }}>
              <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>訪問 URL</span>
              <input type="text" value={accessUrl} readOnly style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#60a5fa', outline: 'none', boxSizing: 'border-box', background: '#1a2332', fontFamily: 'monospace' }} />
            </label>

            <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
              <label>
                <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>緯度</span>
                <input name="latitude" type="number" step="any" style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#e5e7eb', outline: 'none', boxSizing: 'border-box' }} placeholder="22.3790" />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>經度</span>
                <input name="longitude" type="number" step="any" style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#e5e7eb', outline: 'none', boxSizing: 'border-box' }} placeholder="114.1870" />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>服務範圍（米）</span>
                <input name="serviceScope" type="number" defaultValue={0} style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#e5e7eb', outline: 'none', boxSizing: 'border-box' }} placeholder="500" />
              </label>
            </div>
            <label>
              <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>聯絡人</span>
              <input name="contactPerson" style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#e5e7eb', outline: 'none', boxSizing: 'border-box' }} placeholder="例如：黃經理" />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>聯絡電話</span>
              <input name="contactPhone" style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#e5e7eb', outline: 'none', boxSizing: 'border-box' }} placeholder="例如：+852 2123 4567" />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>電子郵箱</span>
              <input name="contactEmail" type="email" style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#e5e7eb', outline: 'none', boxSizing: 'border-box' }} placeholder="例如：info@example.hk" />
            </label>

            <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #1f2937', paddingTop: '14px', marginTop: '4px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6' }}>🌐 訪客頁面設定</span>
            </div>

            <label style={{ gridColumn: '1 / -1' }}>
              <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>網頁標題</span>
              <input name="visitorTitle" style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#e5e7eb', outline: 'none', boxSizing: 'border-box' }} placeholder="預設使用租戶名稱" />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>Logo 圖片</span>
              <input name="logoUrl" type="hidden" value={logoUrl} readOnly />
              <label className="cc-upload-box cc-upload-logo" style={{ padding: logoUrl ? 0 : '12px', overflow: 'hidden' }}>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleImageUpload(e, 'logoUrl')} />
                {logoUrl ? (
                  <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                    <img src={logoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setLogoUrl(''); }}
                      style={{ position: 'absolute', top: '4px', right: '4px', width: '22px', height: '22px', borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
                  </div>
                ) : (
                  <>
                    <span style={{ fontSize: '24px' }}>📷</span>
                    <span className="cc-upload-text">點擊上傳 Logo</span>
                    <span className="cc-upload-hint">支援 JPG、PNG，建議 200×80px</span>
                  </>
                )}
              </label>
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>Banner 圖片</span>
              <input name="bannerUrl" type="hidden" value={bannerUrl} readOnly />
              <label className="cc-upload-box cc-upload-cover" style={{ padding: bannerUrl ? 0 : '12px', overflow: 'hidden' }}>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleImageUpload(e, 'bannerUrl')} />
                {bannerUrl ? (
                  <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                    <img src={bannerUrl} alt="Banner" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setBannerUrl(''); }}
                      style={{ position: 'absolute', top: '4px', right: '4px', width: '22px', height: '22px', borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
                  </div>
                ) : (
                  <>
                    <span style={{ fontSize: '24px' }}>🖼️</span>
                    <span className="cc-upload-text">點擊上傳封面圖</span>
                    <span className="cc-upload-hint">支援 JPG、PNG，建議 1920×400px</span>
                  </>
                )}
              </label>
            </label>

            <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input name="showTips" type="checkbox" defaultChecked style={{ accentColor: '#2563eb', width: '16px', height: '16px' }} />
              <span style={{ fontSize: '13px', fontWeight: 500, color: '#9ca3af' }}>顯示溫馨提示條</span>
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>溫馨提示內容</span>
              <input name="tipsText" style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#e5e7eb', outline: 'none', boxSizing: 'border-box' }} placeholder="預設：如遇門禁問題或需要幫助，請聯繫對應樓宇或房間服務人員。" />
            </label>
          </div>
        </div>

        <div className="add-community-footer">
          <button type="button" onClick={handleClose} disabled={isSaving} style={{ height: '40px', padding: '0 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, border: '1px solid #374151', background: '#111827', color: '#9ca3af', cursor: 'pointer' }}>取消</button>
          <button type="submit" disabled={isSaving} style={{ height: '40px', padding: '0 22px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, border: '0', background: 'linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(37,99,235,0.22)' }}>
            {isSaving ? '儲存中...' : (isEdit ? '儲存變更' : '確認新增')}
          </button>
        </div>
      </form>
    </dialog>
  );
});

export default AddCommunityDialog;
