import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Boxes, CircleDollarSign, PackagePlus, Search, ToggleRight, Trash2 } from 'lucide-react';
import apiClient from './apiClient';

const currencyOptions = [
  { value: 'TWD', label: '新臺幣 TWD' },
  { value: 'CNY', label: '人民幣 CNY' },
  { value: 'USD', label: '美元 USD' },
  { value: 'EUR', label: '歐元 EUR' },
];

const emptyAddon = {
  id: null,
  addonCode: '',
  name: '',
  description: '',
  billingUnit: 'account',
  status: 'active',
  sortOrder: 10,
  prices: [],
};

function statusText(status) {
  return status === 'disabled' ? '停用' : '啟用';
}

function billingUnitText(unit) {
  if (unit === 'tenant') return '租戶';
  if (unit === 'unit') return '固定';
  return '帳號';
}

function priceForPlan(addon, planId) {
  return addon.prices.find((price) => price.planId === planId) || {
    planId,
    currency: 'TWD',
    unitPrice: 0,
    syncWithPlanTerm: true,
    status: 'active',
  };
}

const AddonServices = forwardRef((props, ref) => {
  const [addons, setAddons] = useState([]);
  const [plans, setPlans] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [draftAddon, setDraftAddon] = useState(emptyAddon);
  const [query, setQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [mode, setMode] = useState('edit');
  const [saving, setSaving] = useState(false);

  useImperativeHandle(ref, () => ({
    startAdd,
  }));

  useEffect(() => {
    loadAddons();
    loadPlans();
  }, []);

  async function loadPlans() {
    try {
      const data = await apiClient.get('/billing/plans');
      setPlans(data.plans || []);
    } catch (err) {
      console.error('Failed to load plans:', err);
    }
  }

  async function loadAddons() {
    try {
      const data = await apiClient.get('/billing/addon-services');
      const loaded = (data.addons || []).map(a => ({ ...a, prices: a.prices || [] }));
      setAddons(loaded);
      if (loaded.length > 0 && !selectedId) {
        setSelectedId(loaded[0].id);
        setDraftAddon({ ...loaded[0], prices: loaded[0].prices.map(p => ({ ...p })) });
      }
    } catch (err) {
      console.error('Failed to load addons:', err);
    } finally {
      setIsLoading(false);
    }
  }

  const selectedAddon = addons.find((addon) => addon.id === selectedId) || null;
  const primaryPrice = draftAddon.prices[0] || { currency: 'TWD', unitPrice: 0 };
  const filteredAddons = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return addons.filter((addon) => {
      const matchesKeyword = !keyword
        || addon.addonCode.toLowerCase().includes(keyword)
        || addon.name.toLowerCase().includes(keyword);
      const matchesStatus = filterStatus === 'all' || addon.status === filterStatus;
      return matchesKeyword && matchesStatus;
    });
  }, [addons, filterStatus, query]);

  const activeCount = addons.filter((addon) => addon.status === 'active').length;
  const planPriceCount = addons.reduce((sum, addon) => sum + addon.prices.length, 0);

  function startAdd() {
    setMode('add');
    setSelectedId(null);
    setDraftAddon({
      ...emptyAddon,
      prices: plans.map((plan) => ({
        planId: plan.id,
        currency: 'TWD',
        unitPrice: 0,
        syncWithPlanTerm: true,
        status: 'active',
      })),
    });
  }

  const selectAddon = (addon) => {
    setMode('edit');
    setSelectedId(addon.id);
    setDraftAddon({ ...addon, prices: addon.prices.map((price) => ({ ...price })) });
  };

  const toggleAddonStatus = async (addonId, currentStatus, event) => {
    event.stopPropagation();
    const addon = addons.find(a => a.id === addonId);
    if (!addon) return;
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    try {
      await apiClient.put('/billing/addon-services', { ...addon, status: newStatus, prices: addon.prices || [] });
      await loadAddons();
    } catch (err) {
      alert(err.message || '更新失敗');
    }
  };

  const updateDraft = (field) => (event) => {
    const value = event.target.value;
    setDraftAddon((current) => ({ ...current, [field]: field === 'sortOrder' ? Number(value) : value }));
  };

  const updatePrice = (planId, field) => (event) => {
    const value = field === 'syncWithPlanTerm'
      ? event.target.checked
      : field === 'unitPrice'
        ? Number(event.target.value)
        : event.target.value;
    setDraftAddon((current) => {
      const existing = current.prices.some((price) => price.planId === planId)
        ? current.prices
        : [...current.prices, priceForPlan(current, planId)];
      return {
        ...current,
        prices: existing.map((price) => (price.planId === planId ? { ...price, [field]: value } : price)),
      };
    });
  };

  const updateDefaultPrice = (field) => (event) => {
    const value = field === 'unitPrice' ? Number(event.target.value) : event.target.value;
    setDraftAddon((current) => {
      const prices = current.prices.length
        ? current.prices
        : plans.map((plan) => priceForPlan(current, plan.id));
      return {
        ...current,
        prices: prices.map((price) => ({ ...price, [field]: value })),
      };
    });
  };

  const saveDraft = async (event) => {
    event.preventDefault();
    const payload = {
      addonCode: draftAddon.addonCode.trim().toLowerCase(),
      name: draftAddon.name.trim(),
      description: draftAddon.description.trim(),
      billingUnit: draftAddon.billingUnit,
      status: draftAddon.status,
      sortOrder: draftAddon.sortOrder || 0,
      prices: draftAddon.prices || [],
    };
    if (!payload.addonCode || !payload.name) return alert('請輸入服務程式碼和名稱。');
    setSaving(true);
    try {
      await apiClient.put('/billing/addon-services', payload);
      await loadAddons();
      setMode('edit');
    } catch (err) {
      alert(err.message || '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (addonId, event) => {
    event.stopPropagation();
    const addon = addons.find(a => a.id === addonId);
    if (!addon) return;
    if (!window.confirm('確定要刪除這個增值服務嗎？')) return;
    try {
      await apiClient.delete(`/billing/addon-services/${encodeURIComponent(addon.addonCode)}`);
      await loadAddons();
      if (selectedId === addonId) {
        setSelectedId(null);
        setDraftAddon(emptyAddon);
      }
    } catch (err) {
      alert(err.message || '刪除失敗');
    }
  };

  return (
    <section className="view active addon-data-page" id="addon-services">
      <style>{`
        #addon-services .addon-shell { background: #111827; border-color: #1f2937; }
        #addon-services .addon-scroll-area { background: #111827; }
        #addon-services .addon-summary-card { background: #1a2332; border-color: #374151; }
        #addon-services .addon-summary-card svg { color: #60a5fa; background: #1e3a5f; }
        #addon-services .addon-summary-card span { color: #9ca3af; }
        #addon-services .addon-summary-card strong { color: #ffffff; }
        #addon-services .addon-list-panel,
        #addon-services .addon-detail-panel { background: #111827; border-color: #1f2937; }
        #addon-services .addon-detail-panel { scrollbar-width: none; }
        #addon-services .addon-detail-panel::-webkit-scrollbar { display: none; }
        #addon-services .addon-toolbar { border-bottom-color: #1f2937; }
        #addon-services .addon-search { background: #1a2332; border-color: #374151; color: #9ca3af; }
        #addon-services .addon-search input,
        #addon-services .addon-toolbar select { color: #e5e7eb; }
        #addon-services .addon-toolbar select { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #addon-services .addon-list-item { background: #1e293b; border-color: transparent; }
        #addon-services .addon-list-item:hover,
        #addon-services .addon-list-item.active { background: #1e3a5f; border-color: #2563eb; }
        #addon-services .addon-code { color: #f3f4f6; }
        #addon-services .addon-name { color: #9ca3af; }
        #addon-services .addon-list-meta b { color: #60a5fa; }
        #addon-services .addon-status { background: #0d2818; color: #4ade80; }
        #addon-services .addon-status.disabled { background: #1f2937; color: #9ca3af; }
        #addon-services .discount-mini-switch.is-off { background: #4b5563; }
        #addon-services .addon-detail-head span { color: #9ca3af; }
        #addon-services .addon-detail-head h3 { color: #f3f4f6; }
        #addon-services .addon-preview { background: linear-gradient(135deg, #1a2332 0%, #0f172a 100%); border-color: #1f2937; }
        #addon-services .addon-preview small,
        #addon-services .addon-preview span { color: #9ca3af; }
        #addon-services .addon-preview strong { color: #f3f4f6; }
        #addon-services .addon-preview svg { color: #60a5fa; }
        #addon-services .addon-field-grid label { color: #d1d5db; }
        #addon-services .addon-field-grid input,
        #addon-services .addon-field-grid select { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #addon-services .addon-field-grid input:focus,
        #addon-services .addon-field-grid select:focus { border-color: #3b82f6; }
        #addon-services .addon-field-grid input::placeholder { color: #6b7280; }
        #addon-services .addon-price-panel { background: #1a2332; border-color: #1f2937; }
        #addon-services .addon-price-head h4 { color: #f3f4f6; }
        #addon-services .addon-price-head span { color: #9ca3af; }
        #addon-services .addon-price-row { background: #111827; border-color: #1f2937; }
        #addon-services .addon-price-row strong { color: #f3f4f6; }
        #addon-services .addon-price-row span { color: #9ca3af; }
        #addon-services .addon-price-row input,
        #addon-services .addon-price-row select { background: #1a2332; border-color: #374151; color: #e5e7eb; }
        #addon-services .addon-price-row input:focus,
        #addon-services .addon-price-row select:focus { border-color: #3b82f6; }
        #addon-services .addon-sync-toggle span { color: #d1d5db; }
        #addon-services .addon-actions .ghost-btn { background: #374151; color: #d1d5db; border: 1px solid #4b5563; border-radius: 8px; }
        #addon-services .addon-actions .ghost-btn:hover { background: #4b5563; color: #f3f4f6; }
        #addon-services .addon-delete-btn { color: #9ca3af; }
        #addon-services .addon-delete-btn:hover { color: #fca5a5; background: #3b1111; }
        #addon-services .addon-item-content { flex: 1; }
      `}</style>
      <div className="addon-shell">
        <div className="addon-scroll-area">
          <section className="addon-summary-grid" aria-label="增值服務概覽">
            <div className="addon-summary-card">
              <PackagePlus size={20} aria-hidden="true" />
              <span>服務總數</span>
              <strong>{addons.length}</strong>
            </div>
            <div className="addon-summary-card">
              <ToggleRight size={20} aria-hidden="true" />
              <span>啟用中</span>
              <strong>{activeCount}</strong>
            </div>
            <div className="addon-summary-card">
              <CircleDollarSign size={20} aria-hidden="true" />
              <span>定價規則</span>
              <strong>{planPriceCount}</strong>
            </div>
          </section>

          <section className="addon-workspace">
            <div className="addon-list-panel">
              <div className="addon-toolbar">
                <label className="addon-search">
                  <Search size={16} aria-hidden="true" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋程式碼或名稱" style={{ fontSize: '14px' }} />
                </label>
                <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)} aria-label="篩選狀態" style={{ fontSize: '14px' }}>
                  <option value="all">全部狀態</option>
                  <option value="active">啟用</option>
                  <option value="disabled">停用</option>
                </select>
              </div>

              <div className="addon-list">
                {filteredAddons.map((addon) => {
                  const firstPrice = addon.prices[0];
                  return (
                    <div
                      className={`addon-list-item ${selectedId === addon.id ? 'active' : ''}`}
                      key={addon.id}
                    >
                      <div className="addon-item-content" onClick={() => selectAddon(addon)}>
                    <span className="addon-code" style={{ fontSize: '14px' }}>{addon.addonCode}</span>
                    <span className="addon-name" style={{ fontSize: '14px' }}>{addon.name}</span>
                        <span className="addon-list-meta">
                      <b style={{ fontSize: '14px' }}>{firstPrice ? `${firstPrice.currency} ${Number(firstPrice.unitPrice).toFixed(2)} / ${billingUnitText(addon.billingUnit)} / 月` : '未定價'}</b>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              type="button"
                              className={`discount-mini-switch ${addon.status === 'active' ? 'is-on' : 'is-off'}`}
                              onClick={(event) => toggleAddonStatus(addon.id, addon.status, event)}
                              aria-label={addon.status === 'active' ? '已啟用' : '已停用'}
                            >
                              <span className="discount-mini-switch-dot" />
                            </button>
                            <em className={`addon-status ${addon.status}`} style={{ margin: 0 }}>{statusText(addon.status)}</em>
                          </div>
                        </span>
                      </div>
                      <button
                        className="addon-delete-btn"
                        type="button"
                        onClick={(event) => handleDelete(addon.id, event)}
                        title="刪除增值服務"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <form className="addon-detail-panel" onSubmit={saveDraft}>
              <div className="addon-detail-head">
                <div className="addon-detail-title">
                  <span>{mode === 'add' ? '新增服務' : '服務資料'}</span>
                  {(draftAddon.addonCode || selectedAddon?.addonCode) && <h3 style={{ fontSize: '14px', margin: 0 }}>{draftAddon.addonCode || selectedAddon?.addonCode}</h3>}
                </div>
                <em className={`addon-status ${draftAddon.status}`}>{statusText(draftAddon.status)}</em>
              </div>

              <div className="addon-preview">
                <div>
                  <small>購買頁展示</small>
                  <strong style={{ fontSize: '14px' }}>{draftAddon.name || '服務名稱'}</strong>
                  <span style={{ fontSize: '14px' }}>{draftAddon.description || '服務說明'}</span>
                </div>
                <Boxes size={28} aria-hidden="true" />
              </div>

              <div className="tenant-field-grid addon-field-grid">
                <label>
                  服務編號
                  <input value={draftAddon.addonCode} onChange={updateDraft('addonCode')} placeholder="ecard" />
                </label>
                <label>
                  顯示名稱
                  <input value={draftAddon.name} onChange={updateDraft('name')} placeholder="Ecard" />
                </label>
                <label className="span-2">
                  服務說明
                  <input value={draftAddon.description} onChange={updateDraft('description')} placeholder="Electronic business card add-on" />
                </label>
                <label>
                  計費單位
                  <select value={draftAddon.billingUnit} onChange={updateDraft('billingUnit')}>
                    <option value="account">帳號</option>
                    <option value="tenant">租戶</option>
                    <option value="unit">固定</option>
                  </select>
                </label>
                <label>
                  單價
                  <input type="number" min="0" step="0.01" value={primaryPrice.unitPrice} onChange={updateDefaultPrice('unitPrice')} />
                </label>
                <div className="addon-inline-fields span-2">
                  <label>
                    幣種
                    <select value={primaryPrice.currency} onChange={updateDefaultPrice('currency')}>
                      {currencyOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="addon-inline-pair">
                    <label>
                      狀態
                      <select value={draftAddon.status} onChange={updateDraft('status')}>
                        <option value="active">啟用</option>
                        <option value="disabled">停用</option>
                      </select>
                    </label>
                    <label>
                      排序
                      <input type="number" min="0" step="1" value={draftAddon.sortOrder} onChange={updateDraft('sortOrder')} />
                    </label>
                  </div>
                </div>
              </div>

              <section className="addon-price-panel">
                <div className="addon-price-head">
                  <h4>套餐定價</h4>
                  <span>每個套餐可設定不同單價與幣種</span>
                </div>
                <div className="addon-price-list">
                  {plans.map((plan) => {
                    const price = priceForPlan(draftAddon, plan.id);
                    return (
                      <div className="addon-price-row" key={plan.id}>
                        <div>
                          <strong>{plan.name}</strong>
                          <span>{plan.planCode}</span>
                        </div>
                        <select value={price.currency} onChange={updatePrice(plan.id, 'currency')} aria-label={`${plan.name} 幣種`}>
                          {currencyOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.value}</option>
                          ))}
                        </select>
                        <input type="number" min="0" step="0.01" value={price.unitPrice} onChange={updatePrice(plan.id, 'unitPrice')} aria-label={`${plan.name} 單價`} />
                        <label className="addon-sync-toggle">
                          <input type="checkbox" checked={price.syncWithPlanTerm} onChange={updatePrice(plan.id, 'syncWithPlanTerm')} />
                          <span>隨套餐期限</span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>

              <menu className="form-actions addon-actions">
                <button className="ghost-btn" type="button" onClick={() => selectedAddon && selectAddon(selectedAddon)}>取消</button>
                <button className="primary-btn" type="submit" disabled={saving}>{saving ? '儲存中...' : (mode === 'add' ? '建立服務' : '儲存修改')}</button>
              </menu>
            </form>
          </section>
        </div>
      </div>
    </section>
  );
});

export default AddonServices;
