import React, { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import apiClient from './apiClient';

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
};

const AddEntranceDialog = forwardRef(({ onCreated, onUpdated }, ref) => {
  const dialogRef = useRef(null);
  const alertRef = useRef(null);
  const formRef = useRef(null);
  const [isSaving, setIsSaving] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [context, setContext] = useState({ type: 'community', id: null, label: '', community: {} });
  const [editId, setEditId] = useState(null);

  const isEdit = editId != null;

  useImperativeHandle(ref, () => ({
    showModal(ctx, editData) {
      setContext(ctx || { type: 'community', id: null, label: '', community: {} });
      if (editData) {
        setEditId(editData.id);
        requestAnimationFrame(() => fillForm(formRef.current, editData));
      } else {
        setEditId(null);
        const defaults = { ...((ctx && ctx.community) || {}) };
        if (ctx && ctx.type === 'building' && ctx.label) {
          defaults.name = ctx.label + '入口';
        }
        requestAnimationFrame(() => fillForm(formRef.current, defaults));
      }
      dialogRef.current?.showModal();
    },
  }));

  const handleClose = () => {
    dialogRef.current?.close();
  };

  const showAlert = (msg) => {
    setAlertMessage(msg);
    alertRef.current?.showModal();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);
    const payload = {
      name: formData.get('name')?.toString().trim(),
      address: formData.get('address')?.toString().trim() || null,
      latitude: formData.get('latitude'),
      longitude: formData.get('longitude'),
      serviceScope: formData.get('serviceScope')?.toString().trim() || '0',
      contactPerson: formData.get('contactPerson')?.toString().trim() || null,
      contactPhone: formData.get('contactPhone')?.toString().trim() || null,
      contactEmail: formData.get('contactEmail')?.toString().trim() || null,
    };

    if (!payload.name) {
      showAlert('請填寫入口名稱。');
      return;
    }

    if (!isEdit) {
      if (context.type === 'community') {
        payload.communityId = context.id;
      } else {
        payload.buildingId = context.id;
      }
    }

    setIsSaving(true);
    try {
      const url = isEdit ? `/access-entrances/${editId}` : '/access-entrances';
      const res = isEdit ? await apiClient.put(url, payload) : await apiClient.post(url, payload);
      if (res && res.code === 0) {
        dialogRef.current?.close();
        if (isEdit && onUpdated) onUpdated(res.data);
        else if (!isEdit && onCreated) onCreated(res.data);
      } else {
        showAlert(res?.message || (isEdit ? '編輯入口失敗。' : '新增入口失敗。'));
      }
    } catch (error) {
      console.error(isEdit ? '編輯入口失敗:' : '新增入口失敗:', error);
      showAlert(error.response?.data?.message || error.message || (isEdit ? '編輯入口失敗，請稍後再試。' : '新增入口失敗，請稍後再試。'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <dialog ref={alertRef} style={{ border: '0', borderRadius: '12px', padding: '0', maxWidth: '380px', width: '85vw', boxShadow: '0 16px 48px rgba(0,0,0,0.4)', background: '#111827', color: '#9ca3af' }}>
        <style>{`
          dialog::backdrop { background: transparent; }
        `}</style>
        <div style={{ padding: '28px 24px 20px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 20px', fontSize: '14px', lineHeight: 1.6, color: '#9ca3af' }}>{alertMessage}</p>
          <button type="button" onClick={() => alertRef.current?.close()} style={{ height: '36px', padding: '0 28px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, border: '0', background: 'linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', cursor: 'pointer' }}>確定</button>
        </div>
      </dialog>

      <dialog ref={dialogRef} style={{ border: '0', borderRadius: '16px', padding: '0', maxWidth: '560px', width: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', background: '#111827', color: '#9ca3af' }}>
        <style>{`
          dialog::backdrop {
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
          }
          .add-entrance-form {
            display: flex;
            flex-direction: column;
            max-height: 85vh;
          }
          .add-entrance-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 24px 28px 0;
            flex-shrink: 0;
          }
          .add-entrance-body {
            flex: 1;
            overflow-y: auto;
            padding: 20px 28px 24px;
            scrollbar-width: none;
            -ms-overflow-style: none;
          }
          .add-entrance-body::-webkit-scrollbar { display: none; }
          .add-entrance-body input, .add-entrance-body textarea, .add-entrance-body select {
            background: #111827 !important;
            color: #e5e7eb !important;
          }
          .add-entrance-footer {
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
        <form ref={formRef} method="dialog" onSubmit={handleSubmit} className="add-entrance-form">
          <div className="add-entrance-header">
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>{isEdit ? '編輯入口' : '新增入口'}</h2>
            <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '18px', padding: '4px' }} onClick={handleClose}>&#x2715;</button>
          </div>

          <div className="add-entrance-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              {context.label && (
                <div style={{ gridColumn: '1 / -1', fontSize: '13px', color: '#9ca3af', background: '#1a2332', padding: '8px 12px', borderRadius: '8px', border: '1px solid #1f2937' }}>
                  {context.type === 'community' ? '所屬社群' : '所屬樓宇'}：<strong style={{ color: '#f3f4f6' }}>{context.label}</strong>
                </div>
              )}

              <label style={{ gridColumn: '1 / -1' }}>
                <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>入口名稱 <b style={{ color: '#dc2626' }}>*</b></span>
                <input name="name" required style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#9ca3af', outline: 'none', boxSizing: 'border-box' }} placeholder="例如：正門" />
              </label>

              <label style={{ gridColumn: '1 / -1' }}>
                <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>地址</span>
                <input name="address" style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#9ca3af', outline: 'none', boxSizing: 'border-box' }} placeholder="預設與社群地址相同" />
              </label>

              <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
                <label>
                  <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>緯度</span>
                  <input name="latitude" type="number" step="any" style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#9ca3af', outline: 'none', boxSizing: 'border-box' }} placeholder="22.3790" />
                </label>
                <label>
                  <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>經度</span>
                  <input name="longitude" type="number" step="any" style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#9ca3af', outline: 'none', boxSizing: 'border-box' }} placeholder="114.1870" />
                </label>
                <label>
                  <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>服務範圍（米）</span>
                  <input name="serviceScope" type="number" defaultValue={0} style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#9ca3af', outline: 'none', boxSizing: 'border-box' }} placeholder="500" />
                </label>
              </div>

              <label>
                <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>聯絡人</span>
                <input name="contactPerson" style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#9ca3af', outline: 'none', boxSizing: 'border-box' }} placeholder="例如：黃經理" />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>聯絡電話</span>
                <input name="contactPhone" style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#9ca3af', outline: 'none', boxSizing: 'border-box' }} placeholder="例如：+852 2123 4567" />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#9ca3af', marginBottom: '6px' }}>電子郵箱</span>
                <input name="contactEmail" type="email" style={{ width: '100%', height: '40px', padding: '0 12px', border: '1px solid #374151', borderRadius: '8px', fontSize: '13px', color: '#9ca3af', outline: 'none', boxSizing: 'border-box' }} placeholder="例如：info@example.hk" />
              </label>
            </div>
          </div>

          <div className="add-entrance-footer">
            <button type="button" onClick={handleClose} disabled={isSaving} style={{ height: '40px', padding: '0 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, border: '1px solid #374151', background: '#111827', color: '#9ca3af', cursor: 'pointer' }}>取消</button>
            <button type="submit" disabled={isSaving} style={{ height: '40px', padding: '0 22px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, border: '0', background: 'linear-gradient(90deg, #2563eb 0%, #4f46e5 100%)', color: '#fff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(37,99,235,0.25)' }}>
              {isSaving ? '儲存中...' : (isEdit ? '儲存變更' : '確認新增')}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
});

export default AddEntranceDialog;
