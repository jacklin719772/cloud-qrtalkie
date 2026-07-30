import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import apiClient from './apiClient';

const AppReleases = forwardRef(({ accountType }, ref) => {
  const isTenant = accountType === 'tenant';
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [message, setMessage] = useState({ type: '', text: '' });

  // 表单
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    platform: 'android',
    version: '',
    versionCode: '',
    downloadUrl: '',
    fileSize: '',
    sha256: '',
    releaseNotes: '',
    status: 'draft',
    releasedAt: (() => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; })(),
  });

  // QR 弹窗
  const [qrUrl, setQrUrl] = useState('');
  const [qrTitle, setQrTitle] = useState('');
  const fileInputRef = useRef(null);
  const qrRef = useRef(null);

  useEffect(() => {
    fetchReleases();
  }, []);

  const displayReleases = isTenant ? releases.filter(r => r.status === 'published') : releases;

  const fetchReleases = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/admin/releases');
      if (res && res.code === 0) {
        setReleases(res.data || []);
      }
    } catch (err) {
      console.error('获取版本列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const showMsg = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 4000);
  };

  // 文件上传
  const handleFileUpload = async (file) => {
    if (!file || !file.name.endsWith('.apk')) {
      showMsg('error', '仅支持 .apk 文件');
      return null;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/admin/releases/upload');
        const token = localStorage.getItem('auth_token');
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
        xhr.addEventListener('load', () => {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error('解析响应失败')); }
        });
        xhr.addEventListener('error', () => reject(new Error('上传失败')));
        xhr.send(formData);
      });

      if (res && res.code === 0 && res.data) {
        setForm(prev => ({
          ...prev,
          downloadUrl: res.data.url,
          fileSize: res.data.fileSize || '',
          sha256: res.data.sha256 || '',
        }));
        showMsg('success', 'APK 上传成功');
        return res.data;
      } else {
        showMsg('error', res?.message || '上传失败');
        return null;
      }
    } catch (err) {
      showMsg('error', err.message || '上传失败');
      return null;
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = '';
  };

  // 保存版本记录
  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.version || !form.downloadUrl) {
      showMsg('error', '版本号和下载地址为必填项');
      return;
    }

    try {
      const payload = {
        platform: form.platform,
        version: form.version,
        versionCode: parseInt(form.versionCode, 10) || 0,
        downloadUrl: form.downloadUrl,
        fileSize: form.fileSize ? parseInt(form.fileSize, 10) : null,
        sha256: form.sha256 || null,
        releaseNotes: form.releaseNotes || null,
        status: form.status,
        releasedAt: form.releasedAt || null,
      };

      if (editingId) {
        await apiClient.put(`/admin/releases/${editingId}`, payload);
        showMsg('success', '版本信息已更新');
      } else {
        await apiClient.post('/admin/releases', payload);
        showMsg('success', '版本已创建');
      }
      setShowForm(false);
      resetForm();
      fetchReleases();
    } catch (err) {
      showMsg('error', err.response?.data?.message || err.message || '保存失败');
    }
  };

  const openAdd = () => {
    resetForm();
    setShowForm(true);
  };

  useImperativeHandle(ref, () => ({ openAdd }));

  const handleEdit = (r) => {
    setEditingId(r.id);
    setForm({
      platform: r.platform || 'android',
      version: r.version || '',
      versionCode: String(r.version_code || ''),
      downloadUrl: r.download_url || '',
      fileSize: r.file_size ? String(r.file_size) : '',
      sha256: r.sha256 || '',
      releaseNotes: r.release_notes || '',
      status: r.status || 'draft',
      releasedAt: r.released_at ? r.released_at.slice(0, 16) : '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除此版本记录吗？')) return;
    try {
      await apiClient.delete(`/admin/releases/${id}`);
      showMsg('success', '已删除');
      fetchReleases();
    } catch (err) {
      showMsg('error', err.response?.data?.message || '删除失败');
    }
  };

  const handlePublish = async (r) => {
    try {
      await apiClient.put(`/admin/releases/${r.id}`, {
        status: 'published',
        releasedAt: r.released_at || new Date().toISOString(),
      });
      showMsg('success', '版本已发布');
      fetchReleases();
    } catch (err) {
      showMsg('error', err.response?.data?.message || '发布失败');
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({
      platform: 'android',
      version: '',
      versionCode: '',
      downloadUrl: '',
      fileSize: '',
      sha256: '',
      releaseNotes: '',
      status: 'draft',
      releasedAt: (() => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; })(),
    });
  };

  const copyQrCode = async () => {
    try {
      const svg = qrRef.current?.querySelector('svg');
      if (!svg) return;
      const canvas = document.createElement('canvas');
      const size = 440;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      const img = new Image();
      const svgData = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      showMsg('success', '二维码已复制到剪贴板');
    } catch (err) {
      showMsg('error', '复制二维码失败: ' + (err.message || ''));
    }
  };

  const showQr = (url, version) => {
    setQrUrl(url);
    setQrTitle(`下载二维码 - v${version}`);
  };

  const copyUrl = (url) => {
    navigator.clipboard.writeText(url.startsWith('/') ? `https://cloud.qrtalkie.org${url}` : url)
      .then(() => showMsg('success', '链接已复制'))
      .catch(() => showMsg('error', '复制失败'));
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '-';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
  };

  const formatDate = (d) => {
    if (!d) return '-';
    return new Date(d).toLocaleString('zh-CN');
  };

  return (
    <section className="view active" id="app-releases">
      <style>{`
        .rel-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
        .rel-btn { height: 38px; padding: 0 16px; border-radius: 8px; border: none; font-size: 13px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all .2s; }
        .rel-btn-primary { background: linear-gradient(90deg, #2563eb, #06b6d4); color: #fff; }
        .rel-btn-primary:hover { filter: brightness(1.1); }
        .rel-btn-outline { background: transparent; border: 1px solid #374151; color: #e5e7eb; }
        .rel-btn-outline:hover { background: #1f2937; border-color: #4b5563; }
        .rel-btn-danger { background: transparent; border: 1px solid #7f1d1d; color: #fca5a5; }
        .rel-btn-danger:hover { background: #1f1111; }
        .rel-btn-sm { height: 30px; padding: 0 10px; font-size: 12px; }
        .rel-card { background: #111827; border: 1px solid #1f2937; border-radius: 14px; box-shadow: 0 10px 26px rgba(0,0,0,0.2); overflow: hidden; }
        .rel-table { width: 100%; border-collapse: collapse; }
        .rel-table th { background: #1a2332; color: #9ca3af; font-weight: 600; font-size: 12px; padding: 12px 16px; text-align: left; border-bottom: 1px solid #1f2937; white-space: nowrap; }
        .rel-table td { padding: 12px 16px; border-bottom: 1px solid #1f2937; font-size: 13px; color: #e5e7eb; }
        .rel-table tr:hover td { background: #1a2332; }
        .rel-badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; }
        .rel-badge-published { background: #0d2818; color: #22c55e; }
        .rel-badge-draft { background: #422006; color: #fbbf24; }
        .rel-msg { padding: 8px 16px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
        .rel-msg-success { background: #052e16; color: #4ade80; }
        .rel-msg-error { background: #450a0a; color: #fca5a5; }
        .rel-empty { color: #6b7280; }
        #app-releases .ghost-btn {
          background: #374151;
          color: #d1d5db;
          border: 1px solid #4b5563;
          border-radius: 8px;
        }
        #app-releases .ghost-btn:hover {
          background: #4b5563;
          color: #f3f4f6;
        }
      `}</style>

      {message.text && <div className={`rel-msg rel-msg-${message.type}`}>{message.text}</div>}

      <div className="rel-toolbar">
        <span style={{ fontSize: 13, color: '#9ca3af' }}>共 {displayReleases.length} 个版本</span>
      </div>

      <div className="rel-card">
        <table className="rel-table">
          <thead>
            <tr>
              <th>版本</th>
              <th>平台</th>
              <th>大小</th>
              <th>状态</th>
              <th>发布时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>加载中...</td></tr>
            ) : displayReleases.length === 0 ? (
              <tr><td colSpan="6" style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>暂无版本记录</td></tr>
            ) : displayReleases.map(r => (
              <tr key={r.id}>
                <td><strong style={{ color: '#f3f4f6' }}>v{r.version}</strong> <span style={{ color: '#9ca3af', fontSize: 11 }}>({r.version_code})</span></td>
                <td>{r.platform}</td>
                <td>{formatBytes(r.file_size)}</td>
                <td><span className={`rel-badge ${r.status === 'published' ? 'rel-badge-published' : 'rel-badge-draft'}`}>{r.status === 'published' ? '已发布' : '草稿'}</span></td>
                <td style={{ fontSize: 12, color: '#9ca3af' }}>{formatDate(r.released_at)}</td>
                {!isTenant && (
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="ghost-btn" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={() => showQr(r.download_url, r.version)}>二维码</button>
                    <button className="ghost-btn" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={() => copyUrl(r.download_url)}>复制链接</button>
                    {r.status !== 'published' && (
                      <button className="ghost-btn" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={() => handlePublish(r)}>发布</button>
                    )}
                    <button className="ghost-btn" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={() => handleEdit(r)}>编辑</button>
                    <button className="ghost-btn" style={{ fontSize: '12px', padding: '4px 8px', background: '#7f1d1d', color: '#fca5a5', borderColor: '#991b1b' }} onClick={() => handleDelete(r.id)}>删除</button>
                  </div>
                </td>
                )}
                {isTenant && (
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="ghost-btn" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={() => showQr(r.download_url, r.version)}>二维码</button>
                    <button className="ghost-btn" style={{ fontSize: '12px', padding: '4px 8px' }} onClick={() => copyUrl(r.download_url)}>复制链接</button>
                  </div>
                </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 编辑/新建弹窗 */}
      {!isTenant && showForm && createPortal(
        <div className="dialog-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000 }} onClick={(e) => { if (e.target === e.currentTarget) { setShowForm(false); resetForm(); } }}>
          <form onSubmit={handleSave} style={{ backgroundColor: '#111827', borderRadius: '10px', width: '520px', maxWidth: '90vw', maxHeight: '90vh', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flexShrink: 0, padding: '20px 24px', borderBottom: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#f3f4f6' }}>{editingId ? '编辑版本' : '新建版本'}</h3>
              <button type="button" onClick={() => { setShowForm(false); resetForm(); }} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '20px' }}>&#10005;</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px', scrollbarWidth: 'none' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>APK 文件上传</span>
                <div style={{ border: '2px dashed #374151', borderRadius: '10px', padding: '20px', textAlign: 'center', cursor: 'pointer', transition: 'all .2s' }}
                  onClick={() => fileInputRef.current?.click()}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.backgroundColor = '#1a2332'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#374151'; e.currentTarget.style.backgroundColor = 'transparent'; }}>
                  {uploading ? (
                    <div>
                      <span style={{ fontSize: 13, color: '#9ca3af' }}>上传中 {uploadProgress}%</span>
                      <div style={{ height: 6, background: '#374151', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: 'linear-gradient(90deg, #2563eb, #06b6d4)', width: uploadProgress + '%', transition: 'width .3s' }} />
                      </div>
                    </div>
                  ) : form.downloadUrl ? (
                    <span style={{ fontSize: 13, color: '#22c55e' }}>已上传: {form.downloadUrl}</span>
                  ) : (
                    <span style={{ fontSize: 13, color: '#9ca3af' }}>点击选择 .apk 文件上传</span>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept=".apk,application/vnd.android.package-archive" hidden onChange={handleFileChange} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>版本号 <span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span></span>
                <input value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} placeholder="如 10.0.2" required style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb', fontSize: '13px' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>版本代码 <span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span></span>
                <input value={form.versionCode} onChange={e => setForm({ ...form, versionCode: e.target.value })} placeholder="如 10000002" required style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb', fontSize: '13px' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>平台</span>
                <select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb', fontSize: '13px' }}>
                  <option value="android">Android</option>
                  <option value="ios">iOS</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>下载地址</span>
                <input value={form.downloadUrl} onChange={e => setForm({ ...form, downloadUrl: e.target.value })} placeholder="上传 APK 后自动填充" style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb', fontSize: '13px' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>文件大小 (bytes)</span>
                <input value={form.fileSize} readOnly placeholder="上传后自动填充" style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af', fontSize: '13px' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>SHA256</span>
                <input value={form.sha256} readOnly placeholder="上传后自动填充" style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af', fontSize: '11px' }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>更新说明</span>
                <textarea value={form.releaseNotes} onChange={e => setForm({ ...form, releaseNotes: e.target.value })} placeholder="此版本的更新内容..." style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb', fontSize: '13px', resize: 'vertical', height: 80 }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>状态</span>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb', fontSize: '13px' }}>
                  <option value="draft">草稿</option>
                  <option value="published">已发布</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>发布时间</span>
                <input type="datetime-local" value={form.releasedAt} onChange={e => setForm({ ...form, releasedAt: e.target.value })} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #374151', outline: 'none', backgroundColor: '#1a2332', color: '#e5e7eb', fontSize: '13px' }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#374151'} />
              </label>
            </div>
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937' }}>
              <button type="button" disabled={uploading} onClick={() => { setShowForm(false); resetForm(); }} style={{ padding: '8px 20px', borderRadius: '6px', backgroundColor: '#1f2937', color: '#d1d5db', border: '1px solid #374151', fontSize: '13px', cursor: 'pointer' }}>取消</button>
              <button className="primary-btn" type="submit" disabled={uploading}>{editingId ? '保存' : '创建'}</button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* QR 码弹窗 */}
      {qrUrl && createPortal(
        <div className="dialog-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100001 }} onClick={() => setQrUrl('')}>
          <div onClick={e => e.stopPropagation()} style={{ backgroundColor: '#111827', borderRadius: '10px', padding: '32px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <h3 style={{ margin: '0 0 16px', color: '#f3f4f6', fontSize: '18px', fontWeight: 600 }}>{qrTitle}</h3>
            <div ref={qrRef} style={{ background: '#fff', padding: 12, borderRadius: 8, display: 'inline-block' }}>
              <QRCodeSVG value={qrUrl.startsWith('/') ? `https://cloud.qrtalkie.org${qrUrl}` : qrUrl} size={220} />
            </div>
            <p style={{ marginTop: 12, fontSize: 12, color: '#9ca3af', wordBreak: 'break-all', maxWidth: 280 }}>
              {qrUrl.startsWith('/') ? `https://cloud.qrtalkie.org${qrUrl}` : qrUrl}
            </p>
            <button className="rel-btn rel-btn-primary rel-btn-sm" style={{ marginTop: 12, padding: '0 14px' }} onClick={() => copyUrl(qrUrl)}>复制链接</button>
            <button className="rel-btn rel-btn-primary rel-btn-sm" style={{ marginTop: 12, marginLeft: 8, padding: '0 14px' }} onClick={copyQrCode}>复制二维码</button>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
});

export default AppReleases;
