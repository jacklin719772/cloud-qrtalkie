import React, { useEffect, useRef, useState } from 'react';
import apiClient from './apiClient';

const FOOTER_DEFAULTS = {
  brandTitle: 'QRTalkie',
  brandSubtitleEn: 'Secure Instant Messaging & IoT App',
  brandSubtitleZh: '安全即时通讯与物联网应用',
  address: '台中市西區五權西四街57號3樓',
  email: 'qtalkie@gmail.com',
  desktopDownloadUrl: '',
  androidDownloadUrl: '',
  iosDownloadUrl: '',
  copyright: '© 2026 QRTalkie. All Rights Reserved.',
  privacyUrl: '#',
};

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  color: '#9ca3af',
  fontSize: '12px',
  fontWeight: 500,
};

const inputStyle = {
  width: '100%',
  height: '40px',
  padding: '0 12px',
  borderRadius: '8px',
  border: '1px solid #374151',
  outline: 'none',
  background: '#0f172a',
  color: '#e5e7eb',
  fontSize: '13px',
  boxSizing: 'border-box',
};

const sectionStyle = {
  border: '1px solid #1f2937',
  borderRadius: '10px',
  background: '#0d1524',
  padding: '18px',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
};

const sectionTitleStyle = {
  margin: 0,
  color: '#93c5fd',
  fontSize: '14px',
  fontWeight: 600,
  borderLeft: '3px solid #3b82f6',
  paddingLeft: '8px',
  lineHeight: 1.2,
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: '14px',
};

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <label style={labelStyle}>
      {label}
      <input
        type={type}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        style={inputStyle}
        onFocus={(e) => { e.target.style.borderColor = '#3b82f6'; }}
        onBlur={(e) => { e.target.style.borderColor = '#374151'; }}
      />
    </label>
  );
}

export default function HomepageSettings() {
  const [activeSection, setActiveSection] = useState('footer');
  const [form, setForm] = useState(FOOTER_DEFAULTS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const messageTimerRef = useRef(null);

  const showMessage = (type, text) => {
    setMessage({ type, text });
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    messageTimerRef.current = window.setTimeout(() => setMessage({ type: '', text: '' }), 3500);
  };

  useEffect(() => () => {
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    apiClient.get('/admin/settings/homepage-footer')
      .then((data) => {
        if (cancelled) return;
        setForm({ ...FOOTER_DEFAULTS, ...(data?.settings || {}) });
      })
      .catch((err) => {
        if (!cancelled) showMessage('error', err.message || '讀取首頁頁腳設置失敗。');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const update = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSaving) return;
    if (!String(form.brandTitle || '').trim()) {
      showMessage('error', '品牌標題不能為空。');
      return;
    }
    setIsSaving(true);
    try {
      const data = await apiClient.put('/admin/settings/homepage-footer', form);
      if (data?.settings) setForm({ ...FOOTER_DEFAULTS, ...data.settings });
      showMessage('success', data?.message || '首頁頁腳設置已儲存。');
    } catch (err) {
      showMessage('error', err.message || '儲存首頁頁腳設置失敗。');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="view active settings-form-page" id="homepage-settings" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
        <form className="panel" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #1f2937', overflow: 'hidden', margin: 0 }}>
          <div style={{ flexShrink: 0, padding: '16px 24px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#9ca3af', fontSize: '13px' }}>
              設置項
              <select
                value={activeSection}
                onChange={(e) => setActiveSection(e.target.value)}
                style={{ height: '36px', minWidth: '150px', padding: '0 10px', borderRadius: '8px', border: '1px solid #374151', background: '#0f172a', color: '#e5e7eb', outline: 'none', fontSize: '13px' }}
              >
                <option value="footer">頁腳設置</option>
                <option value="banner" disabled>Banner 設置（即將開放）</option>
                <option value="blocks" disabled>首頁區塊設置（即將開放）</option>
              </select>
            </label>
            <span style={{ color: '#6b7280', fontSize: '12px' }}>首頁 Banner 與內容區塊設置將陸續開放。</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px', scrollbarWidth: 'thin', scrollbarColor: '#374151 #111827' }}>
            {isLoading ? (
              <p style={{ color: '#9ca3af', fontSize: '14px', textAlign: 'center', marginTop: '40px' }}>載入頁腳設置中...</p>
            ) : activeSection === 'footer' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={sectionStyle}>
                  <h3 style={sectionTitleStyle}>品牌信息</h3>
                  <div style={gridStyle}>
                    <Field label="品牌標題" value={form.brandTitle} onChange={update('brandTitle')} placeholder="例如 QRTalkie" />
                    <Field label="英文副標題" value={form.brandSubtitleEn} onChange={update('brandSubtitleEn')} placeholder="Secure Instant Messaging & IoT App" />
                    <Field label="中文副標題" value={form.brandSubtitleZh} onChange={update('brandSubtitleZh')} placeholder="安全即时通讯与物联网应用" />
                  </div>
                </div>

                <div style={sectionStyle}>
                  <h3 style={sectionTitleStyle}>聯繫方式</h3>
                  <div style={gridStyle}>
                    <Field label="聯絡地址" value={form.address} onChange={update('address')} placeholder="請輸入公司地址" />
                    <Field label="聯絡郵箱" value={form.email} onChange={update('email')} placeholder="support@example.com" type="email" />
                  </div>
                </div>

                <div style={sectionStyle}>
                  <h3 style={sectionTitleStyle}>資源下載</h3>
                  <div style={gridStyle}>
                    <Field label="Windows 下載連結" value={form.desktopDownloadUrl} onChange={update('desktopDownloadUrl')} placeholder="https://..." />
                    <Field label="Android 下載連結" value={form.androidDownloadUrl} onChange={update('androidDownloadUrl')} placeholder="https://..." />
                    <Field label="iOS 下載連結" value={form.iosDownloadUrl} onChange={update('iosDownloadUrl')} placeholder="https://..." />
                  </div>
                  <p style={{ margin: 0, color: '#6b7280', fontSize: '12px' }}>留空時，頁腳仍顯示平台名稱與掃碼提示，但不提供點擊跳轉。</p>
                </div>

                <div style={sectionStyle}>
                  <h3 style={sectionTitleStyle}>頁腳底部</h3>
                  <div style={gridStyle}>
                    <Field label="版權文字" value={form.copyright} onChange={update('copyright')} placeholder="© 2026 QRTalkie. All Rights Reserved." />
                    <Field label="隱私政策連結" value={form.privacyUrl} onChange={update('privacyUrl')} placeholder="https://... 或 /privacy-terms/" />
                  </div>
                </div>
              </div>
            ) : (
              <p style={{ color: '#9ca3af', fontSize: '14px', textAlign: 'center', marginTop: '40px' }}>該設置項暫未開放。</p>
            )}
          </div>

          <div style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid #1f2937', backgroundColor: '#111827', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px' }}>
            {message.text && (
              <p style={{ marginRight: 'auto', margin: 0, fontSize: '13px', color: message.type === 'error' ? '#ef4444' : '#10b981' }}>
                {message.text}
              </p>
            )}
            <button type="submit" disabled={isSaving || isLoading} style={{ padding: '8px 26px', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', cursor: (isSaving || isLoading) ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 500, opacity: (isSaving || isLoading) ? 0.7 : 1 }}>
              {isSaving ? '儲存中...' : '儲存更改'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
