import React, { useState, useEffect, useMemo } from 'react';
import apiClient from './apiClient';

function termLabel(months) {
  if (Number(months) === 12) return '一年';
  if (Number(months) === 6) return '半年';
  return months ? `${months} 個月` : '-';
}

function formatChineseDate(value) {
  if (!value) return '-';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value).slice(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch { return String(value).slice(0, 10); }
}

function formatMoney(amount, currency = 'USD') {
  return `${currency} ${Number(amount || 0).toFixed(2)}`;
}

export default function OrderDetail({ orderId, onBack }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [order, setOrder] = useState(null);
  const [plans, setPlans] = useState([]);
  const [addons, setAddons] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [offlinePaymentInfo, setOfflinePaymentInfo] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setLoading(true);
      try {
        const [orderRes, plansRes, addonsRes, pmRes, offlineRes] = await Promise.all([
          apiClient.get(`/billing/orders/${orderId}`),
          apiClient.get('/billing/plans?status=active'),
          apiClient.get('/billing/addon-services?status=active'),
          apiClient.get('/billing/payment-methods'),
          apiClient.get('/billing/offline-payment-account'),
        ]);
        if (!isMounted) return;
        setOrder(orderRes.order || orderRes.data || null);
        setPlans((plansRes.plans || []).filter(p => p.status === 'active'));
        setAddons((addonsRes.addons || []).filter(a => a.status === 'active'));
        setPaymentMethods((pmRes.methods || []).filter(pm => pm.status === 'active'));
        setOfflinePaymentInfo(offlineRes.account || null);
      } catch (e) {
        setError(e.message || '載入失敗');
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    load();
    return () => { isMounted = false; };
  }, [orderId]);

  const selectedPlan = useMemo(() => {
    if (!order) return null;
    return plans.find(p => p.planCode === order.planCode) || null;
  }, [order, plans]);

  const currency = order?.currency || selectedPlan?.priceTiers?.[0]?.currency || 'USD';

  const orderAddonCodes = useMemo(() => {
    const codes = new Set(order?.addonCodes || []);
    if (order?.items) {
      order.items.filter(i => i.itemType === 'addon').forEach(i => codes.add(i.addonCode || i.itemCode));
    }
    return codes;
  }, [order]);

  const selectedAddons = useMemo(() => {
    if (!order) return [];
    return addons.filter(a => orderAddonCodes.has(a.addonCode));
  }, [addons, orderAddonCodes]);

  const billingSummary = useMemo(() => {
    const summary = { items: [], subtotal: 0, discount: 0, total: Number(order?.totalAmount || order?.payableAmount || 0), currency };
    if (!order || !selectedPlan) return summary;

    const months = Number(order.months || 1);
    const qty = Number(order.quantity || 1);
    const planPriceTier = selectedPlan.priceTiers?.[0] || { unitPrice: 0, currency };
    const planLineAmount = planPriceTier.unitPrice * qty * months;
    summary.items.push({
      id: `plan-${selectedPlan.id}`,
      name: `${selectedPlan.name} 套餐`,
      formula: `${currency} ${planPriceTier.unitPrice.toFixed(2)} × ${qty}份 × ${months}月`,
      amount: planLineAmount,
    });
    summary.subtotal += planLineAmount;

    selectedAddons.forEach(addon => {
      const prices = Array.isArray(addon.prices) ? addon.prices : [];
      const priceInfo = prices.find(p => p.currency === currency && Number(p.unitPrice || 0) > 0)
        || prices.find(p => Number(p.unitPrice || 0) > 0)
        || prices.find(p => p.currency === currency)
        || prices[0]
        || { currency, unitPrice: 0, syncWithPlanTerm: true };
      const termMultiplier = priceInfo.syncWithPlanTerm !== false ? months : 1;
      const addonAmount = Number(priceInfo.unitPrice || 0) * qty * termMultiplier;
      summary.items.push({
        id: `addon-${addon.id}`,
        name: addon.name,
        formula: `${currency} ${priceInfo.unitPrice.toFixed(2)} × ${qty}份 × ${termMultiplier}月`,
        amount: addonAmount,
      });
      summary.subtotal += addonAmount;
    });

    if (order.coupon) {
      if (order.coupon.discountType === 'percent') {
        summary.discount = summary.subtotal * (order.coupon.discountValue / 100);
      } else if (order.coupon.discountType === 'fixed_amount' && order.coupon.currency === currency) {
        summary.discount = order.coupon.discountValue;
      }
    }
    summary.total = Math.max(0, summary.subtotal - summary.discount);
    return summary;
  }, [order, selectedPlan, selectedAddons, currency]);

  const paymentMethodLabel = () => {
    if (!order) return '-';
    if (order.paymentMethod === 'offline') return '線下支付';
    if (order.paymentMethod === 'online') return order.paymentChannel ? `線上支付 / ${order.paymentChannel}` : '線上支付';
    return '-';
  };

  if (loading) return <div className="panel" style={{ padding: '40px', textAlign: 'center' }}>載入訂單詳情中...</div>;
  if (error) return <div className="panel" style={{ padding: '40px', textAlign: 'center', color: '#dc2626' }}>{error}</div>;
  if (!order) return <div className="panel" style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>暫無數據</div>;

  return (
    <section className="view active" id="order-detail" style={{ background: '#0f172a' }}>
      <style>{`
        #order-detail.view.active { display: flex; flex-direction: column; overflow: hidden; height: 100%; flex: 1 0 0; min-height: 0; }
        #order-detail .purchase-page-form {
          background: transparent; padding: 18px 24px 36px; overflow: auto;
          scrollbar-width: none;
        }
        #order-detail .purchase-page-form::-webkit-scrollbar { display: none; }
        #order-detail .purchase-page-form .od-card {
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 14px;
          padding: 28px 36px;
          max-width: 860px;
          margin: 0 auto;
        }
        .od-readonly-text { padding: 10px 14px; background: #1a2332; border: 1px solid #1f2937; border-radius: 8px; font-size: 14px; font-weight: 600; color: #e5e7eb; }
        .od-readonly-area { padding: 10px 14px; background: #1a2332; border: 1px solid #1f2937; border-radius: 8px; font-size: 13px; color: #d1d5db; white-space: pre-wrap; min-height: 40px; }
        #order-detail .purchase-side-label { color: #d1d5db !important; font-weight: 600; }
        #order-detail .billing-detail-box { background: #111827 !important; border: 1px solid #1f2937 !important; }
        #order-detail .billing-detail-head { background: #1a2332 !important; border-bottom: 1px solid #1f2937 !important; }
        #order-detail .billing-detail-head strong { color: #f3f4f6 !important; }
        #order-detail .billing-detail-head span { color: #9ca3af !important; }
        #order-detail .billing-detail-row { color: #d1d5db !important; border-bottom: 1px solid #1f2937 !important; }
        #order-detail .billing-detail-row strong { color: #f3f4f6 !important; }
        #order-detail .billing-detail-row b { color: #e5e7eb !important; }
        #order-detail .billing-detail-row.discount b { color: #60a5fa !important; }
        #order-detail .billing-detail-header { color: #9ca3af !important; background: #1a2332 !important; }
        #order-detail .billing-detail-total { background: #1a2332 !important; }
        #order-detail .billing-detail-total span { color: #f3f4f6 !important; }
        #order-detail .billing-detail-total strong { color: #60a5fa !important; }
        #order-detail .addon-service-row { background: #1a2332; border: 1px solid #1f2937; color: #d1d5db; }
        #order-detail .addon-service-row strong { color: #f3f4f6; }
        #order-detail .offline-payment-info { background: #1a2332 !important; border: 1px solid #1f2937 !important; color: #d1d5db !important; }
        #order-detail .offline-payment-info p { color: #60a5fa !important; }
        #order-detail .offline-payment-info dt { color: #9ca3af !important; }
        #order-detail .offline-payment-info dd { color: #e5e7eb !important; }
      `}</style>
      <form className="purchase-page-form" id="purchase-page-form">
        <div className="od-card">
          <div className="purchase-form-body">
            <div className="purchase-side-label">選擇套餐：</div>
            <div className="od-readonly-text">{selectedPlan?.name || order.planName || '-'}</div>

            <label className="purchase-side-label">購買數量：</label>
            <div className="od-readonly-text">{order.quantity || 1} 份 (每份 {selectedPlan?.accountQuantity || order.accountQuantity || 0} 帳號)</div>

            <label className="purchase-side-label">購買時長：</label>
            <div className="od-readonly-text">{termLabel(order.months)}</div>

            {selectedAddons.length > 0 && (
              <>
                <label className="purchase-side-label" style={{ alignSelf: 'flex-start', marginTop: '12px' }}>增值服務：</label>
                <div className="addon-service-list">
                  {selectedAddons.map(addon => {
                    const prices = Array.isArray(addon.prices) ? addon.prices : [];
                    const priceInfo = prices.find(p => p.currency === currency && Number(p.unitPrice || 0) > 0)
                      || prices.find(p => Number(p.unitPrice || 0) > 0)
                      || prices.find(p => p.currency === currency)
                      || prices[0]
                      || { currency, unitPrice: 0 };
                    const unit = addon.billingUnit === 'tenant' ? '租戶' : addon.billingUnit === 'unit' ? '個' : '項';
                    return (
                      <div key={addon.id} className="addon-service-row selected" style={{ cursor: 'default', opacity: 1 }}>
                        <span>{addon.name}</span>
                        <strong>{currency} {Number(priceInfo.unitPrice || 0).toFixed(2)} / {unit} / 月</strong>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="purchase-side-label">帳單地址：</div>
            <div className="od-readonly-area">{order.billingAddress || '-'}</div>

            <label className="purchase-side-label">優惠碼：</label>
            <div className="od-readonly-text" style={{ fontWeight: 400 }}>
              {order.coupon ? `${order.coupon.couponCode || ''} - ${order.coupon.displayName || ''} (${order.coupon.discountType === 'percent' ? `${order.coupon.discountValue}%` : `${order.coupon.currency || currency} ${order.coupon.discountValue}`})` : '未使用'}
            </div>

            <section className="billing-detail-box span-content" aria-label="帳單明細">
              <div className="billing-detail-head">
                <strong>帳單明細</strong>
                <span>{currency}</span>
              </div>
              <div className="billing-detail-table">
                <div className="billing-detail-row billing-detail-header">
                  <span>序號</span><span>項目</span><span>計算方式</span><span>金額</span>
                </div>
                {billingSummary.items.map((item, index) => (
                  <div className="billing-detail-row" key={item.id}>
                    <span>{index + 1}</span>
                    <strong>{item.name}</strong>
                    <span>{item.formula}</span>
                    <b>{item.amount.toFixed(2)}</b>
                  </div>
                ))}
                {billingSummary.discount > 0 && (
                  <div className="billing-detail-row discount">
                    <span>-</span>
                    <strong>優惠折扣</strong>
                    <span>{order.coupon?.displayName || '折扣'}</span>
                    <b>- {billingSummary.discount.toFixed(2)}</b>
                  </div>
                )}
              </div>
              <div className="billing-detail-total">
                <span>訂單金額</span>
                <strong>{currency} {billingSummary.total.toFixed(2)}</strong>
              </div>
            </section>

            <label className="purchase-side-label required payment-label">支付方式：</label>
            <div className="payment-method-area">
              <div className="od-readonly-text" style={{ marginBottom: '8px' }}>{paymentMethodLabel()}</div>
              {order.paymentMethod === 'offline' && offlinePaymentInfo && (
                <div className="offline-payment-info" style={{ opacity: 1 }}>
                  <p>{offlinePaymentInfo.paymentNotice}</p>
                  <dl>
                    <div><dt>收款單位</dt><dd>{offlinePaymentInfo.payeeName}</dd></div>
                    <div><dt>開戶銀行</dt><dd>{offlinePaymentInfo.bankName}</dd></div>
                    <div><dt>銀行帳號</dt><dd>{offlinePaymentInfo.bankAccountNo}</dd></div>
                    {offlinePaymentInfo.contactName && <div><dt>聯絡人</dt><dd>{offlinePaymentInfo.contactName}</dd></div>}
                    {offlinePaymentInfo.contactPhone && <div><dt>聯絡電話</dt><dd>{offlinePaymentInfo.contactPhone}</dd></div>}
                    {offlinePaymentInfo.contactEmail && <div><dt>電子信箱</dt><dd>{offlinePaymentInfo.contactEmail}</dd></div>}
                  </dl>
                </div>
              )}
            </div>

            <label className="purchase-side-label">訂單狀態：</label>
            <div className="od-readonly-text">{order.orderStatus || '-'}</div>

            <label className="purchase-side-label">付款日期：</label>
            <div className="od-readonly-text">{formatChineseDate(order.payment?.paymentDate || order.paymentDate)}</div>

            <label className="purchase-side-label">到期日期：</label>
            <div className="od-readonly-text">{formatChineseDate(order.expiresAt)}</div>
          </div>
        </div>
      </form>
    </section>
  );
}
