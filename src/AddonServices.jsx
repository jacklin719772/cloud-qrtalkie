import React, { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { Boxes, CircleDollarSign, PackagePlus, Search, ToggleRight, Trash2 } from 'lucide-react';

const currencyOptions = [
  { value: 'TWD', label: '新台币 TWD' },
  { value: 'CNY', label: '人民币 CNY' },
  { value: 'USD', label: '美元 USD' },
  { value: 'EUR', label: '欧元 EUR' },
];

const demoPlans = [
  { id: 1, planCode: 'pro', name: 'Pro' },
  { id: 2, planCode: 'business', name: 'Business' },
  { id: 3, planCode: 'enterprise', name: 'Enterprise' },
];

const demoAddons = [
  {
    id: 1,
    addonCode: 'ecard',
    name: 'Ecard',
    description: 'Electronic business card add-on',
    billingUnit: 'account',
    status: 'active',
    sortOrder: 10,
    prices: [
      { planId: 1, currency: 'USD', unitPrice: 2, syncWithPlanTerm: true, status: 'active' },
      { planId: 2, currency: 'USD', unitPrice: 1.8, syncWithPlanTerm: true, status: 'active' },
      { planId: 3, currency: 'USD', unitPrice: 1.5, syncWithPlanTerm: true, status: 'active' },
    ],
  },
  {
    id: 2,
    addonCode: 'call_center',
    name: 'Call Center',
    description: 'Call center capability add-on',
    billingUnit: 'account',
    status: 'active',
    sortOrder: 20,
    prices: [
      { planId: 1, currency: 'USD', unitPrice: 5, syncWithPlanTerm: true, status: 'active' },
      { planId: 2, currency: 'USD', unitPrice: 4.5, syncWithPlanTerm: true, status: 'active' },
      { planId: 3, currency: 'USD', unitPrice: 4, syncWithPlanTerm: true, status: 'active' },
    ],
  },
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
  return status === 'disabled' ? '停用' : '启用';
}

function billingUnitText(unit) {
  if (unit === 'tenant') return '租户';
  if (unit === 'unit') return '固定';
  return '账号';
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
  const [addons, setAddons] = useState(demoAddons);
  const [selectedId, setSelectedId] = useState(demoAddons[0]?.id || null);
  const [draftAddon, setDraftAddon] = useState(demoAddons[0] || emptyAddon);
  const [query, setQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [mode, setMode] = useState('edit');

  useImperativeHandle(ref, () => ({
    startAdd,
  }));

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
      prices: demoPlans.map((plan) => ({
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

  const toggleAddonStatus = (addonId, currentStatus, event) => {
    event.stopPropagation();
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    setAddons((current) =>
      current.map((addon) => (addon.id === addonId ? { ...addon, status: newStatus } : addon))
    );
    if (selectedId === addonId) {
      setDraftAddon((current) => ({ ...current, status: newStatus }));
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
        : demoPlans.map((plan) => priceForPlan(current, plan.id));
      return {
        ...current,
        prices: prices.map((price) => ({ ...price, [field]: value })),
      };
    });
  };

  const saveDraft = (event) => {
    event.preventDefault();
    const nextAddon = {
      ...draftAddon,
      addonCode: draftAddon.addonCode.trim().toLowerCase(),
      name: draftAddon.name.trim(),
      description: draftAddon.description.trim(),
    };
    if (mode === 'add') {
      const created = { ...nextAddon, id: Date.now() };
      setAddons((current) => [created, ...current]);
      selectAddon(created);
      return;
    }
    setAddons((current) => current.map((addon) => (addon.id === nextAddon.id ? nextAddon : addon)));
  };

  const handleDelete = (addonId, event) => {
    event.stopPropagation(); // 阻止事件冒泡，避免触发选择addon
    if (window.confirm('确定要删除这个增值服务吗？')) {
      setAddons((current) => current.filter((addon) => addon.id !== addonId));
      if (selectedId === addonId) {
        setSelectedId(null);
        setDraftAddon(emptyAddon);
        setMode('edit');
      }
    }
  };

  return (
    <section className="view active addon-data-page" id="addon-services">
      <div className="addon-shell">
        <div className="addon-scroll-area">
          <section className="addon-summary-grid" aria-label="增值服务概览">
            <div className="addon-summary-card">
              <PackagePlus size={20} aria-hidden="true" />
              <span>服务总数</span>
              <strong>{addons.length}</strong>
            </div>
            <div className="addon-summary-card">
              <ToggleRight size={20} aria-hidden="true" />
              <span>启用中</span>
              <strong>{activeCount}</strong>
            </div>
            <div className="addon-summary-card">
              <CircleDollarSign size={20} aria-hidden="true" />
              <span>定价规则</span>
              <strong>{planPriceCount}</strong>
            </div>
          </section>

          <section className="addon-workspace">
            <div className="addon-list-panel">
              <div className="addon-toolbar">
                <label className="addon-search">
                  <Search size={16} aria-hidden="true" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索代码或名称" style={{ fontSize: '14px' }} />
                </label>
                <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)} aria-label="筛选状态" style={{ fontSize: '14px' }}>
                  <option value="all">全部状态</option>
                  <option value="active">启用</option>
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
                      <b style={{ fontSize: '14px' }}>{firstPrice ? `${firstPrice.currency} ${Number(firstPrice.unitPrice).toFixed(2)} / ${billingUnitText(addon.billingUnit)} / 月` : '未定价'}</b>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              type="button"
                              className={`discount-mini-switch ${addon.status === 'active' ? 'is-on' : 'is-off'}`}
                              onClick={(event) => toggleAddonStatus(addon.id, addon.status, event)}
                              aria-label={addon.status === 'active' ? '已启用' : '已停用'}
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
                        title="删除增值服务"
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
                  <span>{mode === 'add' ? '新增服务' : '服务资料'}</span>
                  {(draftAddon.addonCode || selectedAddon?.addonCode) && <h3 style={{ fontSize: '14px', margin: 0 }}>{draftAddon.addonCode || selectedAddon?.addonCode}</h3>}
                </div>
                <em className={`addon-status ${draftAddon.status}`}>{statusText(draftAddon.status)}</em>
              </div>

              <div className="addon-preview">
                <div>
                  <small>购买页展示</small>
                  <strong style={{ fontSize: '14px' }}>{draftAddon.name || '服务名称'}</strong>
                  <span style={{ fontSize: '14px' }}>{draftAddon.description || '服务说明'}</span>
                </div>
                <Boxes size={28} aria-hidden="true" />
              </div>

              <div className="tenant-field-grid addon-field-grid">
                <label>
                  服务代码
                  <input value={draftAddon.addonCode} onChange={updateDraft('addonCode')} placeholder="ecard" />
                </label>
                <label>
                  显示名称
                  <input value={draftAddon.name} onChange={updateDraft('name')} placeholder="Ecard" />
                </label>
                <label className="span-2">
                  服务说明
                  <input value={draftAddon.description} onChange={updateDraft('description')} placeholder="Electronic business card add-on" />
                </label>
                <label>
                  计费单位
                  <select value={draftAddon.billingUnit} onChange={updateDraft('billingUnit')}>
                    <option value="account">账号</option>
                    <option value="tenant">租户</option>
                    <option value="unit">固定</option>
                  </select>
                </label>
                <label>
                  单价
                  <input type="number" min="0" step="0.01" value={primaryPrice.unitPrice} onChange={updateDefaultPrice('unitPrice')} />
                </label>
                <div className="addon-inline-fields span-2">
                  <label>
                    币种
                    <select value={primaryPrice.currency} onChange={updateDefaultPrice('currency')}>
                      {currencyOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="addon-inline-pair">
                    <label>
                      状态
                      <select value={draftAddon.status} onChange={updateDraft('status')}>
                        <option value="active">启用</option>
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
                  <h4>套餐定价</h4>
                  <span>每个套餐可设置不同单价与币种</span>
                </div>
                <div className="addon-price-list">
                  {demoPlans.map((plan) => {
                    const price = priceForPlan(draftAddon, plan.id);
                    return (
                      <div className="addon-price-row" key={plan.id}>
                        <div>
                          <strong>{plan.name}</strong>
                          <span>{plan.planCode}</span>
                        </div>
                        <select value={price.currency} onChange={updatePrice(plan.id, 'currency')} aria-label={`${plan.name} 币种`}>
                          {currencyOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.value}</option>
                          ))}
                        </select>
                        <input type="number" min="0" step="0.01" value={price.unitPrice} onChange={updatePrice(plan.id, 'unitPrice')} aria-label={`${plan.name} 单价`} />
                        <label className="addon-sync-toggle">
                          <input type="checkbox" checked={price.syncWithPlanTerm} onChange={updatePrice(plan.id, 'syncWithPlanTerm')} />
                          <span>随套餐期限</span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>

              <menu className="form-actions addon-actions">
                <button className="ghost-btn" type="button" onClick={() => selectedAddon && selectAddon(selectedAddon)}>取消</button>
                <button className="primary-btn" type="submit">{mode === 'add' ? '建立服务' : '保存修改'}</button>
              </menu>
            </form>
          </section>
        </div>
      </div>
    </section>
  );
});

export default AddonServices;
