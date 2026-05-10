import React, { useEffect, useRef, useState } from 'react';
import apiClient from './apiClient';

const emptyMethod = {
  id: null,
  methodCode: '',
  displayName: '',
  methodType: 'online',
  logoClass: '',
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
    status: method.status === 'disabled' ? 'disabled' : 'active',
    sortOrder: Number(method.sortOrder ?? (index + 1) * 10),
  };
}

function generateMethodCode(displayName, takenCodes = new Set()) {
  let candidate = String(displayName || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^-+|-+$/g, "");

  if (!candidate) candidate = "payment-method";
  if (!/^[a-z0-9]/.test(candidate)) candidate = `m-${candidate}`;
  candidate = candidate.slice(0, 80);
  if (candidate.length < 2) candidate = candidate.padEnd(2, "0");

  let suffix = 0;
  let generated = candidate;
  while (takenCodes.has(generated)) {
    suffix += 1;
    const suffixText = `-${suffix}`;
    generated = `${candidate.slice(0, 80 - suffixText.length)}${suffixText}`;
  }

  return generated;
}

export default function PaymentMethods() {
  const [methods, setMethods] = useState([]);
  const [snapshot, setSnapshot] = useState([]);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const messageTimerRef = useRef(null);

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
      setSnapshot(nextMethods);
    } catch (error) {
      showMessage('error', error.message || '無法載入付款方式。');
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

  const updateMethod = (index, field) => (event) => {
    const value = event.target.value;
    setMethods((current) => current.map((method, methodIndex) => {
      if (methodIndex !== index) return method;
      const next = { ...method, [field]: field === 'sortOrder' ? Number(value) : value };
      if (field === 'displayName' && !method.methodCode && next.displayName.trim()) {
        const usedCodes = new Set(current.map((item, idx) => idx !== index ? item.methodCode.trim().toLowerCase() : '').filter(Boolean));
        next.methodCode = generateMethodCode(next.displayName, usedCodes);
      }
      return next;
    }));
  };

  const addMethod = () => {
    setMethods((current) => [
      ...current,
      {
        ...emptyMethod,
        sortOrder: (current.length + 1) * 10,
      },
    ]);
  };

  const disableMethod = (index) => {
    setMethods((current) => current.map((method, methodIndex) => (
      methodIndex === index ? { ...method, status: 'disabled' } : method
    )));
  };

  const enableMethod = (index) => {
    setMethods((current) => current.map((method, methodIndex) => (
      methodIndex === index ? { ...method, status: 'active' } : method
    )));
  };

  const removeNewMethod = (index) => {
    setMethods((current) => current.filter((_, methodIndex) => methodIndex !== index));
  };

  const prepareMethods = (sourceMethods) => {
    const usedCodes = new Set();
    return sourceMethods.map((method) => {
      const displayName = method.displayName.trim();
      const rawCode = method.methodCode.trim().toLowerCase();
      const methodCode = rawCode || generateMethodCode(displayName, usedCodes);
      usedCodes.add(methodCode);
      return { ...method, methodCode };
    });
  };

  const validateMethods = (methodsToValidate = methods) => {
    if (methodsToValidate.length === 0) return '請至少新增一個付款方式。';
    const codes = new Set();
    for (const method of methodsToValidate) {
      const methodCode = method.methodCode.trim().toLowerCase();
      if (!methodCode) return '請輸入方式代碼。';
      if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(methodCode)) return '方式代碼只能使用英文字母、數字、底線或連字號，且至少 2 個字元。';
      if (codes.has(methodCode)) return '方式代碼不可重複。';
      codes.add(methodCode);
      if (!method.displayName.trim()) return '請輸入顯示名稱。';
      if (!['online', 'offline'].includes(method.methodType)) return '請選擇付款類型。';
      if (!['active', 'disabled'].includes(method.status)) return '請選擇啟用狀態。';
    }
    return '';
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const normalizedMethods = prepareMethods(methods);
    setMethods(normalizedMethods);
    const validationMessage = validateMethods(normalizedMethods);
    if (validationMessage) {
      showMessage('error', validationMessage);
      return;
    }

    setIsSaving(true);
    showMessage('', '');
    try {
      const result = await apiClient.put('/billing/payment-method-settings', {
        methods: normalizedMethods.map((method, index) => ({
          id: method.id,
          methodCode: method.methodCode.trim().toLowerCase(),
          displayName: method.displayName.trim(),
          methodType: method.methodType,
          logoClass: method.logoClass.trim(),
          status: method.status,
          sortOrder: Number.isFinite(Number(method.sortOrder)) ? Number(method.sortOrder) : (index + 1) * 10,
        })),
      });
      await loadMethods({ silent: true });
      showMessage('success', result.message || '付款方式已儲存。');
    } catch (error) {
      showMessage('error', error.message || '無法儲存付款方式。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setMethods(snapshot);
    showMessage('', '');
  };

  return (
    <section className="view active settings-form-page" id="payment-methods">
      <form className="tenant-settings-form" onSubmit={handleSubmit}>
        <div className="tenant-scroll-area">
          {isLoading && <p className="form-message">載入付款方式中...</p>}

          {!isLoading && (
            <section className="settings-block">
              <div className="settings-block-head payment-methods-head">
                <h3>付款方式</h3>
                <button className="ghost-btn" type="button" onClick={addMethod} disabled={isSaving}>新增方式</button>
              </div>

              <div className="payment-method-list">
                {methods.map((method, index) => (
                  <div className={`payment-method-editor ${method.status === 'disabled' ? 'disabled' : ''}`} key={method.id || `new-${index}`}>
                    <div className="tenant-field-grid">
                      <label>
                        <span className="field-label">方式代碼 <RequiredMark /></span>
                        <input value={method.methodCode} onChange={updateMethod(index, 'methodCode')} placeholder="留空將自動從顯示名稱生成" />
                      </label>
                      <label>
                        <span className="field-label">顯示名稱 <RequiredMark /></span>
                        <input value={method.displayName} onChange={updateMethod(index, 'displayName')} required />
                      </label>
                      <label>
                        <span className="field-label">付款類型 <RequiredMark /></span>
                        <select value={method.methodType} onChange={updateMethod(index, 'methodType')} required>
                          <option value="online">線上付款</option>
                          <option value="offline">線下付款</option>
                        </select>
                      </label>
                      <label>
                        Logo 樣式
                        <input value={method.logoClass} onChange={updateMethod(index, 'logoClass')} placeholder="paypal / visa / mastercard" />
                      </label>
                      <label>
                        排序
                        <input type="number" min="0" step="1" value={method.sortOrder} onChange={updateMethod(index, 'sortOrder')} />
                      </label>
                      <label>
                        狀態
                        <select value={method.status} onChange={updateMethod(index, 'status')}>
                          <option value="active">啟用</option>
                          <option value="disabled">停用</option>
                        </select>
                      </label>
                    </div>
                    <div className="payment-method-row-actions">
                      {method.status === 'disabled' ? (
                        <button className="ghost-btn" type="button" onClick={() => enableMethod(index)}>啟用</button>
                      ) : (
                        <button className="ghost-btn" type="button" onClick={() => disableMethod(index)}>停用</button>
                      )}
                      {!method.id && <button className="ghost-btn danger" type="button" onClick={() => removeNewMethod(index)}>移除</button>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="tenant-fixed-actions">
          {message.text && <p className={`form-message ${message.type}`}>{message.text}</p>}
          <menu className="form-actions">
            <button className="ghost-btn" type="button" onClick={handleReset} disabled={isSaving || isLoading}>取消</button>
            <button className="primary-btn" type="submit" disabled={isSaving || isLoading}>{isSaving ? '儲存中...' : '儲存修改'}</button>
          </menu>
        </div>
      </form>
    </section>
  );
}
