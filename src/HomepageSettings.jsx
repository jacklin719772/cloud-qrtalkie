import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
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
  desktopVersion: '',
  androidVersion: '',
  iosVersion: '',
  copyright: '© 2026 QRTalkie. All Rights Reserved.',
  privacyUrl: '#',
};

const DEMO_LINK_SECTIONS = {
  callcenter: { label: '呼叫中心', path: '/admin/settings/homepage-callcenter', placeholder: 'https://cloud.qrtalkie.org/callcenter?id=...' },
  building: { label: '樓宇管理', path: '/admin/settings/homepage-building', placeholder: 'https://cloud.qrtalkie.org/building?id=...' },
  livechat: { label: '線上客服', path: '/admin/settings/homepage-livechat', placeholder: 'https://cloud.qrtalkie.org/livechat?id=...' },
};

const DEMO_LINK_DEFAULTS = {
  url: '',
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

const downloadRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '16px',
  padding: '14px 16px',
  border: '1px solid #1f2937',
  borderRadius: '10px',
  background: '#0f172a',
};

const downloadPlatformStyle = {
  color: '#f3f4f6',
  fontSize: '14px',
  fontWeight: 600,
};

const downloadMetaStyle = {
  marginTop: '4px',
  color: '#9ca3af',
  fontSize: '12px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '560px',
};

const getButtonStyle = {
  padding: '7px 16px',
  borderRadius: '7px',
  border: '1px solid #2563eb',
  background: '#1e3a5f',
  color: '#93c5fd',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const clearButtonStyle = {
  padding: '7px 14px',
  borderRadius: '7px',
  border: '1px solid #4b5563',
  background: 'transparent',
  color: '#9ca3af',
  fontSize: '13px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!value) return '';
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : '';
}

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
  const [demoLinkForms, setDemoLinkForms] = useState({
    callcenter: { ...DEMO_LINK_DEFAULTS },
    building: { ...DEMO_LINK_DEFAULTS },
    livechat: { ...DEMO_LINK_DEFAULTS, sipUserId: '' },
  });
  const [demoLinkLoading, setDemoLinkLoading] = useState({ callcenter: true, building: true, livechat: true });
  const [livechatAccounts, setLivechatAccounts] = useState([]);
  const [livechatAccountsLoading, setLivechatAccountsLoading] = useState(true);
  const [aiVoiceForm, setAiVoiceForm] = useState({ callerWebAccountId: '', aiSipAccountId: '' });
  const [aiVoiceAccounts, setAiVoiceAccounts] = useState({ web: [], sip: [] });
  const [aiVoiceLoading, setAiVoiceLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [releases, setReleases] = useState([]);
  const [picker, setPicker] = useState({ platform: '', selectedId: null });
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

  useEffect(() => {
    let cancelled = false;
    Object.entries(DEMO_LINK_SECTIONS).forEach(([key, config]) => {
      apiClient.get(config.path)
        .then((data) => {
          if (cancelled) return;
          setDemoLinkForms((prev) => ({ ...prev, [key]: { ...DEMO_LINK_DEFAULTS, ...(data?.settings || {}) } }));
        })
        .catch((err) => {
          if (!cancelled) showMessage('error', err.message || `讀取${config.label}設置失敗。`);
        })
        .finally(() => {
          if (!cancelled) setDemoLinkLoading((prev) => ({ ...prev, [key]: false }));
        });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient.get('/admin/settings/homepage-livechat/accounts')
      .then((data) => {
        if (!cancelled) setLivechatAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
      })
      .catch(() => {
        if (!cancelled) setLivechatAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setLivechatAccountsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient.get('/admin/releases').then((data) => {
      if (cancelled) return;
      const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
      setReleases(list.filter((item) => item.status === 'published'));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (activeSection !== 'ai-voice') return undefined;
    let cancelled = false;
    setAiVoiceLoading(true);
    Promise.all([
      apiClient.get('/admin/settings/homepage-ai-voice').catch(() => null),
      apiClient.get('/admin/web-accounts').catch(() => null),
      apiClient.get('/admin/sip-accounts').catch(() => null),
    ]).then(([settings, web, sip]) => {
      if (cancelled) return;
      if (settings?.settings) {
        setAiVoiceForm({
          callerWebAccountId: settings.settings.callerWebAccountId ? String(settings.settings.callerWebAccountId) : '',
          aiSipAccountId: settings.settings.aiSipAccountId ? String(settings.settings.aiSipAccountId) : '',
        });
      }
      setAiVoiceAccounts({
        web: Array.isArray(web?.accounts) ? web.accounts : [],
        sip: Array.isArray(sip?.accounts) ? sip.accounts : [],
      });
    }).finally(() => {
      if (!cancelled) setAiVoiceLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeSection]);

  const update = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  const versionsFor = (platform) => releases
    .filter((item) => String(item.platform || '').toLowerCase() === platform)
    .filter((item) => item.download_url)
    .sort((a, b) => Number(b.version_code || 0) - Number(a.version_code || 0));

  const absoluteDownloadUrl = (url) => {
    const text = String(url || '');
    if (!text) return '';
    return text.startsWith('/') ? `${window.location.origin}${text}` : text;
  };

  const selectedRelease = picker.platform
    ? releases.find((item) => String(item.id) === String(picker.selectedId))
    : null;

  const openVersionPicker = (platform) => {
    const versions = versionsFor(platform);
    if (versions.length === 0) return;
    setPicker({ platform, selectedId: null });
  };

  const applySelectedRelease = () => {
    if (!selectedRelease || !picker.platform) return;
    const fieldMap = {
      windows: ['desktopDownloadUrl', 'desktopVersion'],
      android: ['androidDownloadUrl', 'androidVersion'],
      ios: ['iosDownloadUrl', 'iosVersion'],
    };
    const fields = fieldMap[picker.platform];
    if (!fields) return;
    setForm((prev) => ({
      ...prev,
      [fields[0]]: selectedRelease.download_url || '',
      [fields[1]]: selectedRelease.version || '',
    }));
    setPicker({ platform: '', selectedId: null });
    showMessage('success', `已選擇 ${selectedRelease.platform === 'windows' ? 'Windows' : selectedRelease.platform} v${selectedRelease.version}，請儲存更改。`);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSaving) return;
    if (activeSection === 'ai-voice') {
      setIsSaving(true);
      try {
        const data = await apiClient.put('/admin/settings/homepage-ai-voice', {
          callerWebAccountId: aiVoiceForm.callerWebAccountId || null,
          aiSipAccountId: aiVoiceForm.aiSipAccountId || null,
        });
        if (data?.settings) {
          setAiVoiceForm({
            callerWebAccountId: data.settings.callerWebAccountId ? String(data.settings.callerWebAccountId) : '',
            aiSipAccountId: data.settings.aiSipAccountId ? String(data.settings.aiSipAccountId) : '',
          });
        }
        showMessage('success', data?.message || 'AI 語音問答設置已儲存。');
      } catch (err) {
        showMessage('error', err.message || '儲存 AI 語音問答設置失敗。');
      } finally {
        setIsSaving(false);
      }
      return;
    }
    const demoSection = DEMO_LINK_SECTIONS[activeSection];
    if (demoSection) {
      setIsSaving(true);
      try {
        const payload = activeSection === 'livechat'
          ? { sipUserId: demoLinkForms.livechat.sipUserId }
          : demoLinkForms[activeSection];
        const data = await apiClient.put(demoSection.path, payload);
        if (data?.settings) {
          setDemoLinkForms((prev) => ({ ...prev, [activeSection]: { ...DEMO_LINK_DEFAULTS, ...data.settings } }));
        }
        showMessage('success', data?.message || `${demoSection.label}設置已儲存。`);
      } catch (err) {
        showMessage('error', err.message || `儲存${demoSection.label}設置失敗。`);
      } finally {
        setIsSaving(false);
      }
      return;
    }
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

  const pickerVersions = picker.platform ? versionsFor(picker.platform) : [];
  const pickerLabel = picker.platform === 'windows' ? 'Windows' : picker.platform === 'android' ? 'Android' : 'iOS';
  const sectionLoading = activeSection === 'livechat'
    ? (demoLinkLoading.livechat || livechatAccountsLoading)
    : activeSection === 'ai-voice' ? aiVoiceLoading
    : DEMO_LINK_SECTIONS[activeSection] ? demoLinkLoading[activeSection] : isLoading;
  const selectedLivechatAccount = livechatAccounts.find((account) => String(account.sipUserId) === String(demoLinkForms.livechat.sipUserId)) || null;
  const aiVoiceWebOptions = aiVoiceAccounts.web.filter((account) => account.status === 'active');
  const aiVoiceSipOptions = aiVoiceAccounts.sip.filter((account) => account.status === 'active' && !account.recycledAt);
  const selectedCallerWebAccount = aiVoiceWebOptions.find((account) => String(account.id) === String(aiVoiceForm.callerWebAccountId)) || null;
  const selectedAiSipAccount = aiVoiceSipOptions.find((account) => String(account.id) === String(aiVoiceForm.aiSipAccountId)) || null;

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
                <option value="callcenter">呼叫中心設置</option>
                <option value="building">樓宇管理設置</option>
                <option value="livechat">線上客服設置</option>
                <option value="ai-voice">AI 語音問答</option>
                <option value="banner" disabled>Banner 設置（即將開放）</option>
                <option value="blocks" disabled>首頁區塊設置（即將開放）</option>
              </select>
            </label>
            <span style={{ color: '#6b7280', fontSize: '12px' }}>首頁 Banner 與內容區塊設置將陸續開放。</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '22px 24px', scrollbarWidth: 'thin', scrollbarColor: '#374151 #111827' }}>
            {activeSection === 'footer' && isLoading ? (
              <p style={{ color: '#9ca3af', fontSize: '14px', textAlign: 'center', marginTop: '40px' }}>載入頁腳設置中...</p>
            ) : activeSection !== 'footer' && sectionLoading ? (
              <p style={{ color: '#9ca3af', fontSize: '14px', textAlign: 'center', marginTop: '40px' }}>載入{activeSection === 'ai-voice' ? 'AI 語音問答' : (DEMO_LINK_SECTIONS[activeSection]?.label || '')}設置中...</p>
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
                  {[
                    { platform: 'windows', label: 'Windows', version: form.desktopVersion, url: form.desktopDownloadUrl, versionKey: 'desktopVersion', urlKey: 'desktopDownloadUrl' },
                    { platform: 'android', label: 'Android', version: form.androidVersion, url: form.androidDownloadUrl, versionKey: 'androidVersion', urlKey: 'androidDownloadUrl' },
                    { platform: 'ios', label: 'iOS', version: form.iosVersion, url: form.iosDownloadUrl, versionKey: 'iosVersion', urlKey: 'iosDownloadUrl' },
                  ].map((item) => {
                    const versions = versionsFor(item.platform);
                    return (
                      <div key={item.platform} style={downloadRowStyle}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={downloadPlatformStyle}>{item.label}</div>
                          <div style={downloadMetaStyle}>
                            {item.version
                              ? `v${item.version} · ${item.url || '未設定連結'}`
                              : versions.length > 0
                                ? '尚未選擇版本'
                                : item.platform === 'ios'
                                  ? '暫無已發布版本，可在下方填寫手動連結'
                                  : '暫無已發布版本'}
                          </div>
                          {item.platform === 'ios' && versions.length === 0 && (
                            <input
                              value={form.iosDownloadUrl || ''}
                              onChange={(e) => update('iosDownloadUrl')(e.target.value)}
                              placeholder="https://..."
                              autoComplete="off"
                              style={{ ...inputStyle, marginTop: '8px' }}
                              onFocus={(e) => { e.target.style.borderColor = '#3b82f6'; }}
                              onBlur={(e) => { e.target.style.borderColor = '#374151'; }}
                            />
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                          {item.url && (
                            <button
                              type="button"
                              style={clearButtonStyle}
                              onClick={() => setForm((prev) => ({ ...prev, [item.urlKey]: '', [item.versionKey]: '' }))}
                            >
                              清除
                            </button>
                          )}
                          <button
                            type="button"
                            style={{ ...getButtonStyle, opacity: versions.length ? 1 : 0.5, cursor: versions.length ? 'pointer' : 'not-allowed' }}
                            disabled={versions.length === 0}
                            onClick={() => openVersionPicker(item.platform)}
                          >
                            獲取
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <p style={{ margin: 0, color: '#6b7280', fontSize: '12px' }}>版本列表來自「App 版本管理」中的已發布版本；選擇後會自動生成下載連結與二維碼，儲存後同步到官網頁腳。</p>
                </div>

                <div style={sectionStyle}>
                  <h3 style={sectionTitleStyle}>頁腳底部</h3>
                  <div style={gridStyle}>
                    <Field label="版權文字" value={form.copyright} onChange={update('copyright')} placeholder="© 2026 QRTalkie. All Rights Reserved." />
                    <Field label="隱私政策連結" value={form.privacyUrl} onChange={update('privacyUrl')} placeholder="https://... 或 /privacy-terms/" />
                  </div>
                </div>
              </div>
            ) : activeSection === 'ai-voice' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={sectionStyle}>
                  <h3 style={sectionTitleStyle}>AI 語音問答設置</h3>
                  <label style={labelStyle}>
                    主叫方 Web 帳號
                    <select
                      value={aiVoiceForm.callerWebAccountId}
                      onChange={(e) => setAiVoiceForm((prev) => ({ ...prev, callerWebAccountId: e.target.value }))}
                      style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#0f172a', color: '#e5e7eb', fontSize: '13px', outline: 'none' }}
                    >
                      <option value="">未選擇</option>
                      {aiVoiceWebOptions.map((account) => (
                        <option key={account.id} value={String(account.id)}>
                          {`${account.displayName || account.username}（${account.username}）${account.tenantName ? ` · ${account.tenantName}` : ''}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedCallerWebAccount && (
                    <p style={{ margin: 0, color: '#9ca3af', fontSize: '12px' }}>
                      已選：{selectedCallerWebAccount.displayName || selectedCallerWebAccount.username}（{selectedCallerWebAccount.username}）{selectedCallerWebAccount.tenantName ? ` · ${selectedCallerWebAccount.tenantName}` : ''}
                    </p>
                  )}
                  <label style={labelStyle}>
                    AI 應答方 SIP 帳號
                    <select
                      value={aiVoiceForm.aiSipAccountId}
                      onChange={(e) => setAiVoiceForm((prev) => ({ ...prev, aiSipAccountId: e.target.value }))}
                      style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#0f172a', color: '#e5e7eb', fontSize: '13px', outline: 'none' }}
                    >
                      <option value="">未選擇</option>
                      {aiVoiceSipOptions.map((account) => (
                        <option key={account.id} value={String(account.id)}>
                          {`${account.displayName || account.username}（${account.username}）${account.tenantName ? ` · ${account.tenantName}` : ''}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedAiSipAccount && (
                    <p style={{ margin: 0, color: '#9ca3af', fontSize: '12px' }}>
                      已選：{selectedAiSipAccount.displayName || selectedAiSipAccount.username}（{selectedAiSipAccount.username}）{selectedAiSipAccount.tenantName ? ` · ${selectedAiSipAccount.tenantName}` : ''}
                    </p>
                  )}
                  {!aiVoiceLoading && aiVoiceWebOptions.length === 0 && (
                    <p style={{ margin: 0, color: '#f59e0b', fontSize: '12px' }}>暫無可用的 Web 帳號。</p>
                  )}
                  {!aiVoiceLoading && aiVoiceSipOptions.length === 0 && (
                    <p style={{ margin: 0, color: '#f59e0b', fontSize: '12px' }}>暫無可用的 SIP 帳號。</p>
                  )}
                  <p style={{ margin: 0, color: '#6b7280', fontSize: '12px' }}>主叫方 Web 帳號用於發起 AI 語音問答；AI 應答方為接收呼叫的 SIP 帳號。</p>
                </div>
              </div>
            ) : activeSection === 'livechat' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={sectionStyle}>
                  <h3 style={sectionTitleStyle}>線上客服設置</h3>
                  <label style={labelStyle}>
                    客服帳號（需已設置電子名片）
                    <select
                      value={String(demoLinkForms.livechat.sipUserId || '')}
                      onChange={(e) => setDemoLinkForms((prev) => ({ ...prev, livechat: { ...prev.livechat, sipUserId: e.target.value } }))}
                      style={{ height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#0f172a', color: '#e5e7eb', fontSize: '13px', outline: 'none' }}
                    >
                      <option value="">未選擇</option>
                      {livechatAccounts.map((account) => (
                        <option key={account.sipUserId} value={String(account.sipUserId)}>
                          {`${account.name || account.sipAccount}（${account.sipAccount}）${account.company ? ` · ${account.company}` : ''}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div style={labelStyle}>
                    Ecard 連結
                    {selectedLivechatAccount?.ecardUrl ? (
                      <a
                        href={selectedLivechatAccount.ecardUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ ...inputStyle, display: 'flex', alignItems: 'center', color: '#93c5fd', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {selectedLivechatAccount.ecardUrl}
                      </a>
                    ) : (
                      <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', color: '#6b7280' }}>選擇帳號後自動顯示</div>
                    )}
                  </div>
                  <div style={labelStyle}>
                    SIP 帳號
                    <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', color: '#e5e7eb' }}>
                      {selectedLivechatAccount?.sipAccount || '—'}
                    </div>
                  </div>
                  {livechatAccountsLoading && (
                    <p style={{ margin: 0, color: '#6b7280', fontSize: '12px' }}>載入可選帳號中...</p>
                  )}
                  {!livechatAccountsLoading && livechatAccounts.length === 0 && (
                    <p style={{ margin: 0, color: '#f59e0b', fontSize: '12px' }}>暫無已設置電子名片的帳號。</p>
                  )}
                  {selectedLivechatAccount && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', border: '1px solid #1f2937', borderRadius: '10px', background: '#0f172a' }}>
                      {selectedLivechatAccount.avatarUrl ? (
                        <img
                          src={absoluteDownloadUrl(selectedLivechatAccount.avatarUrl)}
                          alt=""
                          style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }}
                        />
                      ) : null}
                      <div>
                        <div style={{ color: '#f3f4f6', fontSize: '13px', fontWeight: 600 }}>{selectedLivechatAccount.name || selectedLivechatAccount.sipAccount}</div>
                        <div style={{ color: '#9ca3af', fontSize: '12px', marginTop: '2px' }}>
                          {selectedLivechatAccount.duty || '—'}{selectedLivechatAccount.company ? ` · ${selectedLivechatAccount.company}` : ''}
                        </div>
                      </div>
                    </div>
                  )}
                  <p style={{ margin: 0, color: '#6b7280', fontSize: '12px' }}>官網「線上客服」將使用此帳號的電子名片頭像、姓名與職務，並顯示其 Web / SIP 帳號狀態。</p>
                </div>
              </div>
            ) : DEMO_LINK_SECTIONS[activeSection] ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={sectionStyle}>
                  <h3 style={sectionTitleStyle}>{DEMO_LINK_SECTIONS[activeSection].label}設置</h3>
                  <Field
                    label={`${DEMO_LINK_SECTIONS[activeSection].label}訪問連結`}
                    value={demoLinkForms[activeSection].url}
                    onChange={(value) => setDemoLinkForms((prev) => ({ ...prev, [activeSection]: { ...prev[activeSection], url: value } }))}
                    placeholder={DEMO_LINK_SECTIONS[activeSection].placeholder}
                  />
                  <p style={{ margin: 0, color: '#6b7280', fontSize: '12px' }}>用戶在官網「在線演示」中點擊「{DEMO_LINK_SECTIONS[activeSection].label}」時，將在新分頁打開此連結。</p>
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
            <button type="submit" disabled={isSaving || sectionLoading} style={{ padding: '8px 26px', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', cursor: (isSaving || sectionLoading) ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 500, opacity: (isSaving || sectionLoading) ? 0.7 : 1 }}>
              {isSaving ? '儲存中...' : '儲存更改'}
            </button>
          </div>
        </form>
      </div>

      {picker.platform && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 2147483647, background: 'rgba(0,0,0,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={() => setPicker({ platform: '', selectedId: null })}
        >
          <div
            style={{ width: 'min(820px, 94vw)', maxHeight: '86vh', background: '#111827', border: '1px solid #374151', borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1f2937' }}>
              <h3 style={{ margin: 0, color: '#f3f4f6', fontSize: '16px' }}>選擇 {pickerLabel} 版本</h3>
              <button type="button" onClick={() => setPicker({ platform: '', selectedId: null })} style={{ width: '30px', height: '30px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {pickerVersions.length === 0 ? (
                <p style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', margin: '30px 0' }}>暫無已發布版本。</p>
              ) : pickerVersions.map((item) => {
                const selected = String(item.id) === String(picker.selectedId);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPicker((prev) => ({ ...prev, selectedId: item.id }))}
                    style={{ width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: '8px', border: selected ? '1px solid #3b82f6' : '1px solid #374151', background: selected ? '#1e3a5f' : '#0f172a', color: '#e5e7eb', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <strong style={{ fontSize: '14px' }}>v{item.version}</strong>
                      <span style={{ color: '#9ca3af', fontSize: '12px' }}>#{item.version_code}</span>
                      <span style={{ color: '#6b7280', fontSize: '12px', marginLeft: 'auto' }}>{formatDate(item.released_at)} · {formatFileSize(item.file_size)}</span>
                    </div>
                    <div style={{ color: '#9ca3af', fontSize: '12px', marginTop: '5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.download_url}</div>
                  </button>
                );
              })}

              {selectedRelease && (
                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '18px', padding: '14px', border: '1px solid #374151', borderRadius: '10px', background: '#0d1524' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#93c5fd', fontSize: '13px', fontWeight: 600 }}>下載連結</div>
                    <div style={{ color: '#d1d5db', fontSize: '12px', marginTop: '6px', wordBreak: 'break-all' }}>{absoluteDownloadUrl(selectedRelease.download_url)}</div>
                  </div>
                  <div style={{ flexShrink: 0, background: '#fff', padding: '8px', borderRadius: '8px' }}>
                    <QRCodeSVG value={absoluteDownloadUrl(selectedRelease.download_url)} size={150} bgColor="#ffffff" fgColor="#0f172a" level="M" />
                  </div>
                </div>
              )}
            </div>

            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 20px', borderTop: '1px solid #1f2937' }}>
              <button type="button" onClick={() => setPicker({ platform: '', selectedId: null })} style={{ padding: '8px 20px', borderRadius: '6px', border: '1px solid #4b5563', background: 'transparent', color: '#d1d5db', fontSize: '13px', cursor: 'pointer' }}>取消</button>
              <button
                type="button"
                disabled={!selectedRelease}
                onClick={applySelectedRelease}
                style={{ padding: '8px 22px', borderRadius: '6px', border: 'none', background: '#3b82f6', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: selectedRelease ? 'pointer' : 'not-allowed', opacity: selectedRelease ? 1 : 0.55 }}
              >
                使用此版本
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
