﻿﻿﻿﻿﻿import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { BadgePercent, CalendarDays, CalendarX, CircleDollarSign, Search, TicketPercent } from 'lucide-react';
import apiClient from './apiClient';

const currencyOptions = [
  { value: 'TWD', label: '新臺幣 TWD' },
  { value: 'CNY', label: '人民幣 CNY' },
  { value: 'USD', label: '美元 USD' },
  { value: 'EUR', label: '歐元 EUR' },
];

const emptyCoupon = {
  id: null,
  couponCode: '',
  displayName: '',
  discountType: 'percent',
  discountValue: 0,
  currency: 'TWD',
  validFrom: '',
  validUntil: '',
  maxRedemptions: '',
  redeemedCount: 0,
  status: 'active',
};

function normalizeCoupon(coupon = {}) {
  return {
    id: coupon.id ?? null,
    couponCode: coupon.couponCode || '',
    displayName: coupon.displayName || '',
    discountType: coupon.discountType === 'fixed_amount' ? 'fixed_amount' : 'percent',
    discountValue: Number(coupon.discountValue || 0),
    currency: coupon.currency || 'TWD',
    validFrom: coupon.validFrom || '',
    validUntil: coupon.validUntil || '',
    maxRedemptions: coupon.maxRedemptions === 0 || coupon.maxRedemptions ? Number(coupon.maxRedemptions) : '',
    redeemedCount: Number(coupon.redeemedCount || 0),
    status: ['active', 'disabled', 'expired'].includes(coupon.status) ? coupon.status : 'active',
  };
}

function formatDiscount(coupon) {
  if (coupon.discountType === 'percent') return `${Number(coupon.discountValue || 0)}%`;
  return `${coupon.currency || 'TWD'} ${Number(coupon.discountValue || 0).toFixed(2)}`;
}

function statusText(status) {
  if (status === 'disabled') return '停用';
  if (status === 'expired') return '過期';
  return '啟用';
}

function toApiCoupon(coupon) {
  return {
    id: coupon.id,
    couponCode: coupon.couponCode.trim().toUpperCase(),
    displayName: coupon.displayName.trim(),
    discountType: coupon.discountType,
    discountValue: Number(coupon.discountValue || 0),
    currency: coupon.discountType === 'fixed_amount' ? String(coupon.currency || 'TWD').trim().toUpperCase() : '',
    validFrom: coupon.validFrom || '',
    validUntil: coupon.validUntil || '',
    maxRedemptions: coupon.maxRedemptions === '' ? '' : Number(coupon.maxRedemptions),
    status: coupon.status,
  };
}

const DiscountData = forwardRef((props, ref) => {
  const [coupons, setCoupons] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [draftCoupon, setDraftCoupon] = useState({ ...emptyCoupon });
  const [mode, setMode] = useState('list');
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const messageTimerRef = useRef(null);

  useImperativeHandle(ref, () => ({
    startAdd,
  }));

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

  async function loadCoupons({ silent = false, preferredId = selectedId } = {}) {
    setIsLoading(true);
    if (!silent) showMessage('', '');
    try {
      const data = await apiClient.get('/billing/coupon-settings');
      const nextCoupons = (data.coupons || []).map(normalizeCoupon);
      setCoupons(nextCoupons);

      const nextSelected = nextCoupons.find((coupon) => coupon.id === preferredId) || nextCoupons[0] || null;
      if (nextSelected) {
        setSelectedId(nextSelected.id);
        setDraftCoupon({ ...nextSelected });
        setMode('edit');
      } else {
        setSelectedId(null);
        setDraftCoupon({ ...emptyCoupon });
        setMode('list');
      }
    } catch (error) {
      showMessage('error', error.message || '無法讀取優惠資料。');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadCoupons();
    return () => {
      if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    };
  }, []);

  const selectedCoupon = coupons.find((coupon) => coupon.id === selectedId) || null;
  const filteredCoupons = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = coupons.filter((coupon) => {
      const matchesKeyword = !keyword
        || coupon.couponCode.toLowerCase().includes(keyword)
        || coupon.displayName.toLowerCase().includes(keyword);
      const matchesStatus = filterStatus === 'all' || coupon.status === filterStatus;
      return matchesKeyword && matchesStatus;
    });
    
    // 在前端強制使用 ID 排序（降冪：最新建立的在最前面），確保順序穩定，不受後端狀態或更新時間排序的影響
    return filtered.sort((a, b) => (b.id || 0) - (a.id || 0));
  }, [coupons, filterStatus, query]);

  const activeCount = coupons.filter((coupon) => coupon.status === 'active').length;
  const expiredCount = coupons.filter((coupon) => coupon.status === 'expired').length;
  const redeemedCount = coupons.reduce((sum, coupon) => sum + Number(coupon.redeemedCount || 0), 0);

  function startAdd() {
    setMode('add');
    setSelectedId(null);
    setDraftCoupon({ ...emptyCoupon });
    showMessage('', '');
  }

  const selectCoupon = (coupon) => {
    setMode('edit');
    setSelectedId(coupon.id);
    setDraftCoupon({ ...coupon });
    showMessage('', '');
  };

  const updateDraft = (field) => (event) => {
    const value = event.target.value;
    setDraftCoupon((current) => ({
      ...current,
      [field]: ['discountValue', 'maxRedemptions'].includes(field) ? value : value,
    }));
  };

  const validateDraft = () => {
    const coupon = toApiCoupon(draftCoupon);
    if (!coupon.couponCode) return '請輸入優惠碼。';
    if (!/^[A-Z0-9][A-Z0-9_-]{1,79}$/.test(coupon.couponCode)) return '優惠碼只能使用英文大寫字母、數字、底線或連字元，且至少 2 個字元。';
    if (coupons.some((item) => item.id !== draftCoupon.id && item.couponCode.trim().toUpperCase() === coupon.couponCode)) return '優惠碼不可重複。';
    if (!coupon.displayName) return '請輸入顯示名稱。';
    if (coupon.discountValue <= 0) return '優惠值必須大於 0。';
    if (coupon.discountType === 'percent' && coupon.discountValue > 100) return '百分比優惠不可超過 100%。';
    if (coupon.discountType === 'fixed_amount' && !currencyOptions.some((option) => option.value === coupon.currency)) return '請選擇有效幣種。';
    if (!coupon.validUntil) return '請選擇到期日期。';
    if (coupon.validFrom && coupon.validUntil < coupon.validFrom) return '到期日期不可早於生效日期。';
    if (!Number.isFinite(coupon.discountValue)) return '優惠值格式無效。';
    if (coupon.maxRedemptions !== '' && !Number.isFinite(coupon.maxRedemptions)) return '使用上限格式無效。';
    if (coupon.maxRedemptions !== '' && coupon.maxRedemptions < 0) return '使用上限不可小於 0。';
    return '';
  };

  const saveDraft = async (event) => {
    event.preventDefault();
    const validationMessage = validateDraft();
    if (validationMessage) {
      showMessage('error', validationMessage);
      return;
    }

    setIsSaving(true);
    showMessage('', '');
    try {
      const payload = toApiCoupon(draftCoupon);
      const result = await apiClient.put('/billing/coupon-settings', payload);
      await loadCoupons({ silent: true, preferredId: result.id || draftCoupon.id });
      showMessage('success', result.message || '優惠資料已儲存。');
    } catch (error) {
      showMessage('error', error.message || '無法儲存優惠資料。');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteDraft = async () => {
    if (!selectedCoupon?.id) return;
    if (!window.confirm(`確定要刪除「${selectedCoupon.couponCode}」優惠嗎？`)) return;

    setIsSaving(true);
    showMessage('', '');
    try {
      const result = await apiClient.delete(`/billing/coupon-settings/${encodeURIComponent(selectedCoupon.id)}`);
      await loadCoupons({ silent: true, preferredId: null });
      showMessage('success', result.message || '優惠資料已刪除。');
    } catch (error) {
      showMessage('error', error.message || '無法刪除優惠資料。');
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    if (selectedCoupon) {
      selectCoupon(selectedCoupon);
    } else {
      setMode('list');
      setDraftCoupon({ ...emptyCoupon });
    }
  };

  const toggleCouponStatus = async (couponId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    setIsSaving(true);
    showMessage('', '');
    try {
      const targetCoupon = coupons.find(c => c.id === couponId);
      const updatedCoupon = { ...targetCoupon, status: newStatus };
      const payload = toApiCoupon(updatedCoupon);
      const result = await apiClient.put('/billing/coupon-settings', payload);
      await loadCoupons({ silent: true, preferredId: couponId });
      showMessage('success', result.message || '優惠狀態已更新。');
    } catch (error) {
      showMessage('error', error.message || '無法更新優惠狀態。');
    } finally {
      setIsSaving(false);
    }
  };
  const isEditing = mode === 'edit';
  const detailTitle = draftCoupon.couponCode || selectedCoupon?.couponCode || '';

  return (
    <section className="view active discount-data-page" id="discount-data">
      <style>{`
        #discount-data .discount-shell { background: #111827; border-color: #1f2937; }
        #discount-data .discount-scroll-area { background: #111827; }
        #discount-data .discount-summary-card { background: #1a2332; border-color: #374151; }
        #discount-data .discount-summary-card svg { color: #60a5fa; background: #1e3a5f; }
        #discount-data .discount-summary-card span { color: #9ca3af; }
        #discount-data .discount-summary-card strong { color: #f3f4f6; }
        #discount-data .discount-list-panel,
        #discount-data .discount-detail-panel { background: #111827; border-color: #1f2937; }
        #discount-data .discount-detail-panel { scrollbar-width: none; }
        #discount-data .discount-detail-panel::-webkit-scrollbar { display: none; }
        #discount-data .discount-toolbar { border-bottom-color: #1f2937; }
        #discount-data .discount-search { background: #1a2332; border-color: #374151; color: #9ca3af; }
        #discount-data .discount-search input,
        #discount-data .discount-toolbar select { color: #e5e7eb; }
        #discount-data .discount-toolbar select { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #discount-data .discount-list-item { background: #1e293b; border-color: transparent; }
        #discount-data .discount-list-item:hover,
        #discount-data .discount-list-item.active { background: #1e3a5f; border-color: #2563eb; }
        #discount-data .discount-code { color: #f3f4f6; }
        #discount-data .discount-name { color: #9ca3af; }
        #discount-data .discount-list-meta b { color: #60a5fa; }
        #discount-data .discount-status { background: #0d2818; color: #4ade80; }
        #discount-data .discount-status.disabled { background: #1f2937; color: #9ca3af; }
        #discount-data .discount-status.expired { background: #3b1111; color: #fca5a5; }
        #discount-data .discount-mini-switch.is-off { background: #4b5563; }
        #discount-data .discount-list-arrow { color: #6b7280; }
        #discount-data .discount-detail-head span { color: #9ca3af; }
        #discount-data .discount-detail-head h3 { color: #f3f4f6; }
        #discount-data .discount-preview { background: linear-gradient(135deg, #1a2332 0%, #0f172a 100%); border-color: #1f2937; }
        #discount-data .discount-preview small,
        #discount-data .discount-preview span { color: #9ca3af; }
        #discount-data .discount-preview strong { color: #f3f4f6; }
        #discount-data .discount-preview svg { color: #60a5fa; }
        #discount-data .discount-field-grid label { color: #d1d5db; }
        #discount-data .discount-field-grid input,
        #discount-data .discount-field-grid select { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #discount-data .discount-field-grid input:focus,
        #discount-data .discount-field-grid select:focus { border-color: #3b82f6; }
        #discount-data .discount-field-grid input::placeholder { color: #6b7280; }
        #discount-data .discount-field-hint { color: #9ca3af; }
        #discount-data .discount-rule-strip { background: #1a2332; border-color: #374151; color: #d1d5db; }
        #discount-data .discount-rule-strip b { color: #f3f4f6; }
        #discount-data .discount-rule-strip svg { color: #60a5fa; }
        #discount-data .discount-actions .ghost-btn { background: #374151; color: #d1d5db; border: 1px solid #4b5563; border-radius: 8px; }
        #discount-data .discount-actions .ghost-btn:hover { background: #4b5563; color: #f3f4f6; }
        #discount-data .discount-actions .ghost-btn.danger { background: #3b1111; color: #fca5a5; border-color: #dc2626; }
        #discount-data .discount-actions .ghost-btn.danger:hover { background: #dc2626; color: #fff; }
        #discount-data .form-message { color: #d1d5db; }
        #discount-data .form-message.error { background: #3b1111; color: #ef4444; }
        #discount-data .form-message.success { background: #0d2818; color: #22c55e; }
        #discount-data .discount-summary-card strong { color: #ffffff; }
        #discount-data .discount-list-item-actions .discount-mini-switch-dot { background: #e5e7eb; }
      `}</style>
      <div className="discount-shell">
        <div className="discount-scroll-area">
          <section className="discount-summary-grid" aria-label="優惠概覽">
            <div className="discount-summary-card">
              <TicketPercent size={20} aria-hidden="true" />
              <span>優惠碼總數</span>
              <strong>{coupons.length}</strong>
            </div>
            <div className="discount-summary-card">
              <BadgePercent size={20} aria-hidden="true" />
              <span>啟用中</span>
              <strong>{activeCount}</strong>
            </div>
            <div className="discount-summary-card">
              <CircleDollarSign size={20} aria-hidden="true" />
              <span>已使用次數</span>
              <strong>{redeemedCount}</strong>
            </div>
          <div className="discount-summary-card">
            <CalendarX size={20} aria-hidden="true" />
            <span>已過期</span>
            <strong>{expiredCount}</strong>
          </div>
          </section>

          <section className="discount-workspace">
            <div className="discount-list-panel">
              <div className="discount-toolbar">
                <label className="discount-search">
                  <Search size={16} aria-hidden="true" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋程式碼或名稱" />
                </label>
                <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)} aria-label="篩選狀態">
                  <option value="all">全部狀態</option>
                  <option value="active">啟用</option>
                  <option value="disabled">停用</option>
                  <option value="expired">過期</option>
                </select>
              </div>

              <div className="discount-list">
                {isLoading && <p className="form-message">載入優惠資料中...</p>}
                {!isLoading && filteredCoupons.length === 0 && <p className="form-message">沒有符合條件的優惠資料。</p>}
                {!isLoading && filteredCoupons.map((coupon) => (
              <div
                    className={`discount-list-item ${selectedId === coupon.id ? 'active' : ''}`}
                    key={coupon.id}
                    onClick={() => selectCoupon(coupon)}
                  >
                    <span className="discount-code" style={{ fontSize: '14px' }}>{coupon.couponCode}</span>
                    <span className="discount-name" style={{ fontSize: '14px' }}>{coupon.displayName}</span>
                    <span className="discount-list-meta">
                      <b>{formatDiscount(coupon)}</b>
                      <div className="discount-list-item-actions">
                        <button
                          type="button"
                          className={`discount-mini-switch ${coupon.status === 'active' ? 'is-on' : 'is-off'}`}
                          disabled={isSaving}
                          onClick={async (event) => {
                            event.stopPropagation(); // Prevent selecting the coupon when clicking the switch
                            await toggleCouponStatus(coupon.id, coupon.status);
                          }}
                          aria-label={coupon.status === 'active' ? '已啟用' : '已停用'}
                        >
                          <span className="discount-mini-switch-dot" />
                        </button>
                        <span className="discount-list-arrow">›</span>
                      </div>
                    </span>
              </div>
                ))}
              </div>
            </div>

            <form className="discount-detail-panel" onSubmit={saveDraft}>
              <div className="discount-detail-head">
                <div className="discount-detail-title">
                  <span>{mode === 'add' ? '新增優惠' : '優惠規則'}</span>
                  {detailTitle && <h3 style={{ fontSize: '14px', margin: 0 }}>{detailTitle}</h3>}
                </div>
                <em className={`discount-status ${draftCoupon.status}`}>{statusText(draftCoupon.status)}</em>
              </div>

              <div className="discount-preview">
                <div>
                  <small>結算頁展示</small>
                  <strong style={{ fontSize: '14px' }}>{draftCoupon.displayName || '優惠名稱'}</strong>
                  <span style={{ fontSize: '14px' }}>{draftCoupon.couponCode || 'COUPON'}：{formatDiscount(draftCoupon)} 優惠</span>
                </div>
                <BadgePercent size={28} aria-hidden="true" />
              </div>

              <div className="tenant-field-grid discount-field-grid">
                <label>
                  優惠碼
                  <input value={draftCoupon.couponCode} onChange={updateDraft('couponCode')} placeholder="SAVE20" disabled={isSaving} />
                </label>
                <label>
                  顯示名稱
                  <input value={draftCoupon.displayName} onChange={updateDraft('displayName')} placeholder="20% launch discount" disabled={isSaving} />
                </label>
                <label>
                  優惠類型
                  <select value={draftCoupon.discountType} onChange={updateDraft('discountType')} disabled={isSaving}>
                    <option value="percent">百分比優惠</option>
                    <option value="fixed_amount">固定金額減免</option>
                  </select>
                </label>
                <label>
                  優惠值
                  <input type="number" min="0" step="0.01" value={draftCoupon.discountValue} onChange={updateDraft('discountValue')} disabled={isSaving} />
                </label>
                <label>
                  幣種
                  <select value={draftCoupon.currency || 'TWD'} onChange={updateDraft('currency')} disabled={isSaving}>
                    {currencyOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  狀態
                  <select value={draftCoupon.status} onChange={updateDraft('status')} disabled={isSaving}>
                    <option value="active">啟用</option>
                    <option value="disabled">停用</option>
                    <option value="expired">過期</option>
                  </select>
                </label>
                <label className="discount-date-field">
                  生效日期
                  <input type="date" value={draftCoupon.validFrom || ''} onChange={updateDraft('validFrom')} disabled={isSaving} />
                  <small className="discount-field-hint">可為空，表示不限制起始日期。</small>
                </label>
                <label className="discount-date-field">
                  到期日期
                  <input type="date" value={draftCoupon.validUntil || ''} onChange={updateDraft('validUntil')} disabled={isSaving} />
                </label>
                <label className="span-2">
                  使用上限
                  <input type="number" min="0" value={draftCoupon.maxRedemptions || ''} onChange={updateDraft('maxRedemptions')} placeholder="不填寫表示不限次數" disabled={isSaving} />
                </label>
              </div>

              <div className="discount-rule-strip">
                <CalendarDays size={18} aria-hidden="true" />
                <span>{draftCoupon.validFrom || '不限起始日期'} 至 {draftCoupon.validUntil || '未設定'}</span>
                <b>{Number(draftCoupon.redeemedCount || 0)} / {draftCoupon.maxRedemptions || '不限'}</b>
              </div>

              {message.text && <p className={`form-message ${message.type}`}>{message.text}</p>}

              <menu className="form-actions discount-actions">
                {isEditing && <button className="ghost-btn danger" type="button" onClick={deleteDraft} disabled={isSaving}>刪除</button>}
                <button className="ghost-btn" type="button" onClick={cancelEdit} disabled={isSaving}>取消</button>
                <button className="primary-btn" type="submit" disabled={isSaving}>{isSaving ? '儲存中...' : mode === 'add' ? '建立優惠' : '儲存修改'}</button>
              </menu>
            </form>
          </section>
        </div>
      </div>
    </section>
  );
});

export default DiscountData;
