﻿﻿﻿﻿﻿import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { BadgePercent, CalendarDays, CalendarX, CircleDollarSign, Search, TicketPercent } from 'lucide-react';
import apiClient from './apiClient';

const currencyOptions = [
  { value: 'TWD', label: '新台币 TWD' },
  { value: 'CNY', label: '人民币 CNY' },
  { value: 'USD', label: '美元 USD' },
  { value: 'EUR', label: '欧元 EUR' },
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
  if (status === 'expired') return '过期';
  return '启用';
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
      showMessage('error', error.message || '无法读取折扣资料。');
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
    
    // 在前端强制使用 ID 排序（降序：最新创建的在最前面），确保顺序稳定，不受后端状态或更新时间排序的影响
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
    if (!coupon.couponCode) return '请输入折扣代码。';
    if (!/^[A-Z0-9][A-Z0-9_-]{1,79}$/.test(coupon.couponCode)) return '折扣代码只能使用英文大写字母、数字、底线或连字符，且至少 2 个字符。';
    if (coupons.some((item) => item.id !== draftCoupon.id && item.couponCode.trim().toUpperCase() === coupon.couponCode)) return '折扣代码不可重复。';
    if (!coupon.displayName) return '请输入显示名称。';
    if (coupon.discountValue <= 0) return '折扣值必须大于 0。';
    if (coupon.discountType === 'percent' && coupon.discountValue > 100) return '百分比折扣不可超过 100%。';
    if (coupon.discountType === 'fixed_amount' && !currencyOptions.some((option) => option.value === coupon.currency)) return '请选择有效币种。';
    if (!coupon.validUntil) return '请选择到期日期。';
    if (coupon.validFrom && coupon.validUntil < coupon.validFrom) return '到期日期不可早于生效日期。';
    if (!Number.isFinite(coupon.discountValue)) return '折扣值格式无效。';
    if (coupon.maxRedemptions !== '' && !Number.isFinite(coupon.maxRedemptions)) return '使用上限格式无效。';
    if (coupon.maxRedemptions !== '' && coupon.maxRedemptions < 0) return '使用上限不可小于 0。';
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
      showMessage('success', result.message || '折扣资料已保存。');
    } catch (error) {
      showMessage('error', error.message || '无法保存折扣资料。');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteDraft = async () => {
    if (!selectedCoupon?.id) return;
    if (!window.confirm(`确定要删除「${selectedCoupon.couponCode}」折扣吗？`)) return;

    setIsSaving(true);
    showMessage('', '');
    try {
      const result = await apiClient.delete(`/billing/coupon-settings/${encodeURIComponent(selectedCoupon.id)}`);
      await loadCoupons({ silent: true, preferredId: null });
      showMessage('success', result.message || '折扣资料已删除。');
    } catch (error) {
      showMessage('error', error.message || '无法删除折扣资料。');
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
      showMessage('success', result.message || '折扣状态已更新。');
    } catch (error) {
      showMessage('error', error.message || '无法更新折扣状态。');
    } finally {
      setIsSaving(false);
    }
  };
  const isEditing = mode === 'edit';
  const detailTitle = draftCoupon.couponCode || selectedCoupon?.couponCode || '';

  return (
    <section className="view active discount-data-page" id="discount-data">
      <div className="discount-shell">
        <div className="discount-scroll-area">
          <section className="discount-summary-grid" aria-label="折扣概览">
            <div className="discount-summary-card">
              <TicketPercent size={20} aria-hidden="true" />
              <span>折扣码总数</span>
              <strong>{coupons.length}</strong>
            </div>
            <div className="discount-summary-card">
              <BadgePercent size={20} aria-hidden="true" />
              <span>启用中</span>
              <strong>{activeCount}</strong>
            </div>
            <div className="discount-summary-card">
              <CircleDollarSign size={20} aria-hidden="true" />
              <span>已使用次数</span>
              <strong>{redeemedCount}</strong>
            </div>
          <div className="discount-summary-card">
            <CalendarX size={20} aria-hidden="true" />
            <span>已过期</span>
            <strong>{expiredCount}</strong>
          </div>
          </section>

          <section className="discount-workspace">
            <div className="discount-list-panel">
              <div className="discount-toolbar">
                <label className="discount-search">
                  <Search size={16} aria-hidden="true" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索代码或名称" />
                </label>
                <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)} aria-label="筛选状态">
                  <option value="all">全部状态</option>
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                  <option value="expired">过期</option>
                </select>
              </div>

              <div className="discount-list">
                {isLoading && <p className="form-message">载入折扣资料中...</p>}
                {!isLoading && filteredCoupons.length === 0 && <p className="form-message">没有符合条件的折扣资料。</p>}
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
                          aria-label={coupon.status === 'active' ? '已启用' : '已停用'}
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
                  <span>{mode === 'add' ? '新增折扣' : '折扣规则'}</span>
                  {detailTitle && <h3 style={{ fontSize: '14px', margin: 0 }}>{detailTitle}</h3>}
                </div>
                <em className={`discount-status ${draftCoupon.status}`}>{statusText(draftCoupon.status)}</em>
              </div>

              <div className="discount-preview">
                <div>
                  <small>结算页展示</small>
                  <strong style={{ fontSize: '14px' }}>{draftCoupon.displayName || '折扣名称'}</strong>
                  <span style={{ fontSize: '14px' }}>{draftCoupon.couponCode || 'COUPON'}：{formatDiscount(draftCoupon)} 折扣</span>
                </div>
                <BadgePercent size={28} aria-hidden="true" />
              </div>

              <div className="tenant-field-grid discount-field-grid">
                <label>
                  折扣代码
                  <input value={draftCoupon.couponCode} onChange={updateDraft('couponCode')} placeholder="SAVE20" disabled={isSaving} />
                </label>
                <label>
                  显示名称
                  <input value={draftCoupon.displayName} onChange={updateDraft('displayName')} placeholder="20% launch discount" disabled={isSaving} />
                </label>
                <label>
                  折扣类型
                  <select value={draftCoupon.discountType} onChange={updateDraft('discountType')} disabled={isSaving}>
                    <option value="percent">百分比折扣</option>
                    <option value="fixed_amount">固定金额减免</option>
                  </select>
                </label>
                <label>
                  折扣值
                  <input type="number" min="0" step="0.01" value={draftCoupon.discountValue} onChange={updateDraft('discountValue')} disabled={isSaving} />
                </label>
                <label>
                  币种
                  <select value={draftCoupon.currency || 'TWD'} onChange={updateDraft('currency')} disabled={isSaving}>
                    {currencyOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  状态
                  <select value={draftCoupon.status} onChange={updateDraft('status')} disabled={isSaving}>
                    <option value="active">启用</option>
                    <option value="disabled">停用</option>
                    <option value="expired">过期</option>
                  </select>
                </label>
                <label className="discount-date-field">
                  生效日期
                  <input type="date" value={draftCoupon.validFrom || ''} onChange={updateDraft('validFrom')} disabled={isSaving} />
                  <small className="discount-field-hint">可为空，表示不限制起始日期。</small>
                </label>
                <label className="discount-date-field">
                  到期日期
                  <input type="date" value={draftCoupon.validUntil || ''} onChange={updateDraft('validUntil')} disabled={isSaving} />
                </label>
                <label className="span-2">
                  使用上限
                  <input type="number" min="0" value={draftCoupon.maxRedemptions || ''} onChange={updateDraft('maxRedemptions')} placeholder="不填写表示不限次数" disabled={isSaving} />
                </label>
              </div>

              <div className="discount-rule-strip">
                <CalendarDays size={18} aria-hidden="true" />
                <span>{draftCoupon.validFrom || '不限起始日期'} 至 {draftCoupon.validUntil || '未设置'}</span>
                <b>{Number(draftCoupon.redeemedCount || 0)} / {draftCoupon.maxRedemptions || '不限'}</b>
              </div>

              {message.text && <p className={`form-message ${message.type}`}>{message.text}</p>}

              <menu className="form-actions discount-actions">
                {isEditing && <button className="ghost-btn danger" type="button" onClick={deleteDraft} disabled={isSaving}>删除</button>}
                <button className="ghost-btn" type="button" onClick={cancelEdit} disabled={isSaving}>取消</button>
                <button className="primary-btn" type="submit" disabled={isSaving}>{isSaving ? '保存中...' : mode === 'add' ? '建立折扣' : '保存修改'}</button>
              </menu>
            </form>
          </section>
        </div>
      </div>
    </section>
  );
});

export default DiscountData;
