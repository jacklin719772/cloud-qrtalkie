import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import apiClient from './apiClient';

const allowedIconTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const allowedIconExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
const maxIconSize = 512 * 1024;

const emptyMethod = {
  id: null,
  methodCode: '',
  displayName: '',
  methodType: 'online',
  logoClass: '',
  iconUrl: '',
  iconDataUrl: '',
  iconFileName: '',
  iconSizeText: '',
  status: 'active',
  sortOrder: 10,
};

function RequiredMark() {
  return <b className="required-mark" aria-label="必填">*</b>;
}

function normalizeMethod(method = {}, index = 0) {
  return {
    id: method.id ?? null,
    methodCode: method.methodCode || '',
    displayName: method.displayName || '',
    methodType: method.methodType === 'offline' ? 'offline' : 'online',
    logoClass: method.logoClass || '',
    iconUrl: method.iconUrl || '',
    iconDataUrl: '',
    iconFileName: '',
    iconSizeText: '',
    status: method.status === 'disabled' ? 'disabled' : 'active',
    sortOrder: Number(method.sortOrder ?? (index + 1) * 10),
  };
}

function generateMethodCode(displayName, takenCodes = new Set()) {
  let candidate = String(displayName || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^-+|-+$/g, '');

  if (!candidate) candidate = 'payment-method';
  if (!/^[a-z0-9]/.test(candidate)) candidate = `m-${candidate}`;
  candidate = candidate.slice(0, 80);
  if (candidate.length < 2) candidate = candidate.padEnd(2, '0');

  let suffix = 0;
  let generated = candidate;
  while (takenCodes.has(generated)) {
    suffix += 1;
    const suffixText = `-${suffix}`;
    generated = `${candidate.slice(0, 80 - suffixText.length)}${suffixText}`;
  }

  return generated;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 102.4) / 10} KB`;
}

function isAllowedIconFile(file) {
  const fileName = String(file?.name || '').toLowerCase();
  return allowedIconTypes.includes(file?.type) || allowedIconExtensions.some((extension) => fileName.endsWith(extension));
}

function getIconMimeType(file) {
  if (allowedIconTypes.includes(file?.type)) return file.type;
  const fileName = String(file?.name || '').toLowerCase();
  if (fileName.endsWith('.svg')) return 'image/svg+xml';
  if (fileName.endsWith('.webp')) return 'image/webp';
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'image/jpeg';
  if (fileName.endsWith('.png')) return 'image/png';
  return '';
}

const PaymentMethods = forwardRef((props, ref) => {
  useImperativeHandle(ref, () => ({
    startAdd,
  }));

  const [methods, setMethods] = useState([]);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isIconDragOver, setIsIconDragOver] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [draftMethod, setDraftMethod] = useState({ ...emptyMethod });
  const messageTimerRef = useRef(null);
  const iconInputRef = useRef(null);

  const showMessage = (type, text) => {
    setMessage({ type, text });
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    if (text) {
      messageTimerRef.current = window.setTimeout(() => {
        setMessage({ type: '', text: '' });
        messageTimerRef.current = null;
      }, 5000);
    }
  };

  async function loadMethods({ silent = false } = {}) {
    setIsLoading(true);
    if (!silent) showMessage('', '');
    try {
      const data = await apiClient.get('/billing/payment-method-settings');
      const nextMethods = (data.methods || []).map(normalizeMethod);
      setMethods(nextMethods);
    } catch (error) {
      showMessage('error', error.message || '无法载入付款方式。');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadMethods();
    return () => {
      if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const mainElement = document.querySelector('.main');
    if (mainElement) {
      mainElement.classList.add('payment-methods-bg-mode');
    }
    return () => {
      if (mainElement) mainElement.classList.remove('payment-methods-bg-mode');
    };
  }, []);

  const updateDraftMethod = (field) => (event) => {
    const value = event.target.value;
    setDraftMethod((current) => {
      const next = { ...current, [field]: field === 'sortOrder' ? Number(value) : value };
      if (field === 'displayName' && !current.methodCode && next.displayName.trim()) {
        const usedCodes = new Set(
          methods
            .filter((item) => item.id !== current.id)
            .map((item) => item.methodCode.trim().toLowerCase())
            .filter(Boolean),
        );
        next.methodCode = generateMethodCode(next.displayName, usedCodes);
      }
      return next;
    });
  };

  const applyIconFile = (file) => {
    if (!file) return;
    if (!isAllowedIconFile(file)) {
      showMessage('error', '请上传 PNG、JPG、WebP 或 SVG 图标。');
      return;
    }
    if (file.size > maxIconSize) {
      showMessage('error', '图标文件不可超过 512KB。');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      let dataUrl = String(reader.result || '');
      const mimeType = getIconMimeType(file);
      if (mimeType && !dataUrl.startsWith(`data:${mimeType};base64,`)) {
        dataUrl = dataUrl.replace(/^data:[^;]*;base64,/, `data:${mimeType};base64,`);
      }
      const updateIcon = (sizeText = '') => {
        setDraftMethod((current) => ({
          ...current,
          iconUrl: '',
          iconDataUrl: dataUrl,
          iconFileName: file.name,
          iconSizeText: [sizeText, formatFileSize(file.size)].filter(Boolean).join(' · '),
        }));
      };

      const image = new Image();
      image.onload = () => {
        const sizeText = image.naturalWidth && image.naturalHeight ? `${image.naturalWidth}x${image.naturalHeight}px` : '';
        updateIcon(sizeText);
      };
      image.onerror = () => updateIcon();
      image.src = dataUrl;
      showMessage('', '');
    };
    reader.onerror = () => showMessage('error', '无法读取图标文件。');
    reader.readAsDataURL(file);
  };

  const handleIconFileChange = (event) => {
    applyIconFile(event.target.files?.[0]);
    event.target.value = '';
  };

  const handleIconDrag = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsIconDragOver(event.type === 'dragenter' || event.type === 'dragover');
  };

  const handleIconDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsIconDragOver(false);
    applyIconFile(event.dataTransfer.files?.[0]);
  };

  const openIconPicker = () => {
    if (iconInputRef.current) iconInputRef.current.value = '';
    iconInputRef.current?.click();
  };

  const clearDraftIcon = () => {
    if (iconInputRef.current) iconInputRef.current.value = '';
    setDraftMethod((current) => ({ ...current, iconUrl: '', iconDataUrl: '', iconFileName: '', iconSizeText: '' }));
  };

  function startAdd() {
    setDraftMethod({ ...emptyMethod, sortOrder: (methods.length + 1) * 10 });
    setViewMode('add');
    showMessage('', '');
  }

  const startEdit = (method) => {
    setDraftMethod({ ...method });
    setViewMode('edit');
    showMessage('', '');
  };

  const cancelEdit = () => {
    setDraftMethod({ ...emptyMethod });
    setViewMode('list');
  };

  const validateMethod = (method) => {
    const methodCode = method.methodCode.trim().toLowerCase();
    if (!methodCode) return '请输入方式代码。';
    if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(methodCode)) return '方式代码只能使用英文字母、数字、底线或连字符，且至少 2 个字符。';
    if (methods.some((m) => m.id !== method.id && m.methodCode.trim().toLowerCase() === methodCode)) return '方式代码不可重复。';
    if (!method.displayName.trim()) return '请输入显示名称。';
    if (!['online', 'offline'].includes(method.methodType)) return '请选择付款类型。';
    if (!['active', 'disabled'].includes(method.status)) return '请选择启用状态。';
    return '';
  };

  const toApiMethod = (method, index) => ({
    id: method.id,
    methodCode: method.methodCode,
    displayName: method.displayName,
    methodType: method.methodType,
    logoClass: method.logoClass,
    iconUrl: method.iconUrl,
    iconDataUrl: method.iconDataUrl,
    status: method.status,
    sortOrder: Number.isFinite(Number(method.sortOrder)) ? Number(method.sortOrder) : (index + 1) * 10,
  });

  const normalizeDraftMethod = () => {
    const usedCodes = new Set(
      methods
        .filter((method) => method.id !== draftMethod.id)
        .map((method) => method.methodCode.trim().toLowerCase()),
    );
    return {
      ...draftMethod,
      methodCode: draftMethod.methodCode.trim().toLowerCase() || generateMethodCode(draftMethod.displayName, usedCodes),
      displayName: draftMethod.displayName.trim(),
      logoClass: draftMethod.logoClass.trim(),
      iconUrl: draftMethod.iconUrl || '',
      iconDataUrl: draftMethod.iconDataUrl || '',
      iconFileName: draftMethod.iconFileName || '',
      iconSizeText: draftMethod.iconSizeText || '',
      sortOrder: Number.isFinite(Number(draftMethod.sortOrder)) ? Number(draftMethod.sortOrder) : 0,
    };
  };

  const handleDraftSubmit = async (event) => {
    event.preventDefault();
    const normalizedMethod = normalizeDraftMethod();
    const validationMessage = validateMethod(normalizedMethod);
    if (validationMessage) {
      showMessage('error', validationMessage);
      return;
    }

    setIsSaving(true);
    showMessage('', '');
    try {
      const nextMethods = viewMode === 'edit'
        ? methods.map((method) => (method.id === normalizedMethod.id ? normalizedMethod : method))
        : [...methods, normalizedMethod];
      const result = await apiClient.put('/billing/payment-method-settings', {
        methods: nextMethods.map(toApiMethod),
      });
      await loadMethods({ silent: true });
      setViewMode('list');
      showMessage('success', result.message || (viewMode === 'edit' ? '付款方式已更新。' : '付款方式已新增。'));
    } catch (error) {
      showMessage('error', error.message || (viewMode === 'edit' ? '无法更新付款方式。' : '无法新增付款方式。'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (method) => {
    const methodName = method.displayName || method.methodCode;
    if (!window.confirm(`确定要删除「${methodName}」付款方式吗？`)) return;

    setIsSaving(true);
    showMessage('', '');
    try {
      const result = await apiClient.delete(`/billing/payment-method-settings/${encodeURIComponent(method.id)}`);
      await loadMethods({ silent: true });
      showMessage('success', result.message || '付款方式已删除。');
    } catch (error) {
      showMessage('error', error.message || '无法删除付款方式。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (methodToToggle) => {
    const newStatus = methodToToggle.status === 'active' ? 'disabled' : 'active';
    const actionText = newStatus === 'active' ? '启用' : '停用';

    if (!window.confirm(`确定要${actionText}「${methodToToggle.displayName || methodToToggle.methodCode}」付款方式吗？`)) return;

    setIsSaving(true);
    showMessage('', '');
    try {
      const nextMethods = methods.map((m) =>
        m.id === methodToToggle.id ? { ...m, status: newStatus } : m
      );
      await apiClient.put('/billing/payment-method-settings', {
        methods: nextMethods.map(toApiMethod),
      });
      setMethods(nextMethods); // 乐观更新前端状态，让 Switch 立即切换
      showMessage('success', `付款方式已${actionText}。`);
    } catch (error) {
      showMessage('error', error.message || `无法${actionText}付款方式。`);
      await loadMethods({ silent: true }); // 失败时重新拉取数据恢复原状
    } finally {
      setIsSaving(false);
    }
  };

  const isEditing = viewMode === 'edit';
  const draftIconSrc = draftMethod.iconDataUrl || draftMethod.iconUrl;
  const draftIconDetails = [draftMethod.iconFileName, draftMethod.iconSizeText].filter(Boolean).join(' · ');
  const showIconFallback = (event) => {
    event.currentTarget.classList.add('hidden');
    event.currentTarget.nextElementSibling?.classList.remove('hidden');
  };

  if (viewMode === 'add' || viewMode === 'edit') {
    return (
      <section className="view active settings-form-page" id="payment-methods">
        <style>{`
          #payment-methods .settings-block { background: #111827; border: 1px solid #1f2937; }
          #payment-methods .settings-block-head h3 { color: #f3f4f6; }
          #payment-methods .settings-block-head { border-bottom-color: #1f2937; }
          #payment-methods .field-label { color: #d1d5db; }
          #payment-methods .tenant-field-grid label { color: #d1d5db; }
          #payment-methods .tenant-field-grid input,
          #payment-methods .tenant-field-grid select,
          #payment-methods .tenant-field-grid textarea { background: #1a2332; border-color: #374151; color: #e5e7eb; }
          #payment-methods .tenant-field-grid input:focus,
          #payment-methods .tenant-field-grid select:focus,
          #payment-methods .tenant-field-grid textarea:focus { border-color: #3b82f6; }
          #payment-methods .tenant-field-grid input::placeholder,
          #payment-methods .tenant-field-grid textarea::placeholder { color: #6b7280; }
          #payment-methods .tenant-fixed-actions { background: #111827; border-top-color: #1f2937; }
          #payment-methods .ghost-btn { background: #374151; color: #d1d5db; border: 1px solid #4b5563; border-radius: 8px; }
          #payment-methods .ghost-btn:hover { background: #4b5563; color: #f3f4f6; }
          #payment-methods .form-message { color: #d1d5db; }
          #payment-methods .form-message.error { background: #3b1111; color: #ef4444; }
          #payment-methods .form-message.success { background: #0d2818; color: #22c55e; }
          #payment-methods .payment-icon-upload { background: #1a2332; border-color: #374151; }
          #payment-methods .payment-icon-controls small { color: #9ca3af; }
          #payment-methods .payment-icon-meta { color: #9ca3af; }
          #payment-methods .payment-icon-preview { background: #0f172a; border-color: #374151; }
          #payment-methods .payment-icon-preview span { color: #6b7280; }
        `}</style>
        <form className="tenant-settings-form" onSubmit={handleDraftSubmit} style={{ background: '#111827', borderColor: '#1f2937' }}>
          <div className="tenant-scroll-area" style={{ background: '#111827' }}>
            <section className="settings-block">
              <div className="settings-block-head payment-methods-head">
                <h3>{isEditing ? '编辑付款方式' : '新增付款方式'}</h3>
              </div>
              <div className="tenant-field-grid">
                <label>
                  <span className="field-label">方式代码 <RequiredMark /></span>
                  <input value={draftMethod.methodCode} onChange={updateDraftMethod('methodCode')} placeholder="留空将自动由显示名称生成" />
                </label>
                <label>
                  <span className="field-label">显示名称 <RequiredMark /></span>
                  <input value={draftMethod.displayName} onChange={updateDraftMethod('displayName')} required />
                </label>
                <label>
                  <span className="field-label">付款类型 <RequiredMark /></span>
                  <select value={draftMethod.methodType} onChange={updateDraftMethod('methodType')}>
                    <option value="online">线上付款</option>
                    <option value="offline">线下付款</option>
                  </select>
                </label>
                <label>
                  <span className="field-label">启用状态 <RequiredMark /></span>
                  <select value={draftMethod.status} onChange={updateDraftMethod('status')}>
                    <option value="active">启用</option>
                    <option value="disabled">停用</option>
                  </select>
                </label>
                <label>
                  Logo 样式
                  <input value={draftMethod.logoClass} onChange={updateDraftMethod('logoClass')} placeholder="paypal / visa / mastercard" />
                </label>
                <label>
                  排序
                  <input type="number" min="0" step="1" value={draftMethod.sortOrder} onChange={updateDraftMethod('sortOrder')} />
                </label>
                <div className="payment-icon-field span-2">
                  <span className="field-label">付款方式图标</span>
                  <div
                    className={`payment-icon-upload ${isIconDragOver ? 'drag-over' : ''}`}
                    onDragEnter={handleIconDrag}
                    onDragOver={handleIconDrag}
                    onDragLeave={handleIconDrag}
                    onDrop={handleIconDrop}
                  >
                    <button className="payment-icon-preview" type="button" onClick={openIconPicker} aria-label="选择付款方式图标">
                      {draftIconSrc ? (
                        <img src={draftIconSrc} alt={`${draftMethod.displayName || '付款方式'}图标`} />
                      ) : (
                        <span>未上传</span>
                      )}
                    </button>
                    <div className="payment-icon-controls">
                      <input
                        className="payment-icon-file-input"
                        ref={iconInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg"
                        onChange={handleIconFileChange}
                      />
                      <button className="ghost-btn" type="button" onClick={openIconPicker}>
                        {draftIconSrc ? '更换图标' : '上传图标'}
                      </button>
                      {draftIconSrc && <button className="ghost-btn" type="button" onClick={clearDraftIcon}>移除图标</button>}
                      {draftIconDetails && <span className="payment-icon-meta">{draftIconDetails}</span>}
                      <small>建议尺寸 160x64px，透明 PNG/WebP 或 SVG 最佳，文件不超过 512KB。也可以把图片拖到预览框。</small>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
          <div className="tenant-fixed-actions" style={{ background: '#111827', borderTopColor: '#1f2937' }}>
            {message.text && <p className={`form-message ${message.type}`}>{message.text}</p>}
            <menu className="form-actions">
              <button className="ghost-btn" type="button" onClick={cancelEdit} disabled={isSaving}>取消</button>
              <button className="primary-btn" type="submit" disabled={isSaving}>
                {isSaving ? '保存中...' : isEditing ? '保存变更' : '新增付款方式'}
              </button>
            </menu>
          </div>
        </form>
      </section>
    );
  }

  if (viewMode === 'list') {
    return (
      <section className="view active settings-form-page" id="payment-methods">
        <style>{`
          #payment-methods .payment-method-row { background: #1e293b; border-color: #1f2937; }
          #payment-methods .payment-method-row:hover { border-color: #3b82f6; box-shadow: 0 4px 16px rgba(59,130,246,0.1); }
          #payment-methods .payment-logo-box { background: #111827; border-color: #374151; }
          #payment-methods .payment-name { color: #f3f4f6; }
          #payment-methods .payment-code { color: #9ca3af; }
          #payment-methods .payment-desc { color: #9ca3af; }
          #payment-methods .payment-tag-blue { background: #1e3a5f; color: #93c5fd; }
          #payment-methods .payment-tag-green { background: #0d2818; color: #4ade80; }
          #payment-methods .payment-tag-gray { background: #1f2937; color: #d1d5db; }
          #payment-methods .payment-status-text { color: #d1d5db; }
          #payment-methods .payment-status-text.enabled { color: #4ade80; }
          #payment-methods .payment-status-text.disabled { color: #9ca3af; }
          #payment-methods .payment-edit-btn { background: #1e3a5f; color: #93c5fd; border-color: #2563eb; }
          #payment-methods .payment-edit-btn:hover:not(:disabled) { background: #2563eb; color: #fff; }
          #payment-methods .payment-delete-btn { background: #3b1111; color: #fca5a5; border-color: #dc2626; }
          #payment-methods .payment-delete-btn:hover:not(:disabled) { background: #dc2626; color: #fff; }
          #payment-methods .empty-state { background: #1a2332 !important; border-color: #374151 !important; }
          #payment-methods .empty-state-title { color: #f3f4f6; }
          #payment-methods .empty-state-desc { color: #9ca3af; }
          #payment-methods .empty-state-icon { filter: grayscale(0.3); }
          #payment-methods .tenant-fixed-actions { background: #111827; border-top-color: #1f2937; }
          #payment-methods .form-message { color: #d1d5db; }
          #payment-methods .form-message.error { background: #3b1111; color: #ef4444; }
          #payment-methods .form-message.success { background: #0d2818; color: #22c55e; }
          #payment-methods .settings-block { background: #111827; border: 1px solid #1f2937; }
        `}</style>
        <div className="tenant-settings-form" style={{ background: '#111827', borderColor: '#1f2937' }}>
          <div className="tenant-scroll-area" style={{ background: '#111827', paddingBottom: '96px' }}>
            {isLoading && <p className="form-message">载入付款方式中...</p>}

            {!isLoading && (
              <section className="settings-block">
                <div className="payment-method-list">
                  {methods.length === 0 ? (
                    <div className="empty-state" style={{ textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px dashed #e2e8f0' }}>
                      <div className="empty-state-icon">💳</div>
                      <p className="empty-state-title">尚未新增任何付款方式</p>
                      <small className="empty-state-desc">點擊右上角「新增付款方式」開始設定</small>
                    </div>
                  ) : (
                    methods.map((method) => (
                      <div className={`payment-method-row ${method.status === 'disabled' ? 'is-disabled' : ''}`} key={method.id}>
                        <div className="payment-logo-box">
                          {method.iconUrl ? (
                            <>
                              <img
                                className="payment-logo"
                                src={method.iconUrl}
                                alt={`${method.displayName}图标`}
                                onError={showIconFallback}
                              />
                              <span className="payment-logo-fallback hidden">
                                {(method.displayName || method.methodCode || 'PM').slice(0, 2)}
                              </span>
                            </>
                          ) : (
                            <span className="payment-logo-fallback">
                              {(method.displayName || method.methodCode || 'PM').slice(0, 2)}
                            </span>
                          )}
                        </div>

                        <div className="payment-info">
                          <div className="payment-title-line">
                            <span className="payment-name">{method.displayName}</span>
                            <span className={`payment-tag ${method.methodType === 'online' ? 'payment-tag-blue' : 'payment-tag-gray'}`}>
                              {method.methodType === 'online' ? '线上付款' : '线下付款'}
                            </span>
                            {method.status === 'active' && (
                              <span className="payment-tag payment-tag-green">启用</span>
                            )}
                          </div>

                          <div className="payment-code">{method.methodCode}</div>

                          <div className="payment-desc">
                            {method.methodType === 'online'
                              ? '在线支付方式，适用于线上订单收款'
                              : '线下支付方式，适用于人工确认收款'}
                          </div>
                        </div>

                        <div className="payment-status-area">
                          <button
                            type="button"
                            className={`payment-switch ${method.status === 'active' ? 'payment-switch-on' : 'payment-switch-off'}`}
                            disabled={isSaving}
                            aria-label={method.status === 'active' ? '当前已启用' : '当前已停用'}
                            onClick={() => handleToggleStatus(method)}
                          >
                            <span className="payment-switch-dot" />
                          </button>
                          <span className={`payment-status-text ${method.status === 'active' ? 'enabled' : 'disabled'}`}>
                            {method.status === 'active' ? '已启用' : '已禁用'}
                          </span>
                        </div>

                        <div className="payment-actions">
                          <button
                            className="payment-edit-btn"
                            type="button"
                            onClick={() => startEdit(method)}
                            disabled={isSaving}
                          >
                            编辑
                          </button>

                          <button
                            className="payment-delete-btn"
                            type="button"
                            onClick={() => handleDelete(method)}
                            disabled={isSaving}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            )}
          </div>

          <div className="tenant-fixed-actions" style={{ background: '#111827', borderTopColor: '#1f2937' }}>
            {message.text && <p className={`form-message ${message.type}`}>{message.text}</p>}
          </div>
        </div>
      </section>
    );
  }

  return null;
});

export default PaymentMethods;
