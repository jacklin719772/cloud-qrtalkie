import React, { useState, useEffect, useMemo, useRef } from 'react';
import apiClient from './apiClient';

export default function PurchasePlan({ tenant, paymentProofDialogRef, purchaseContext, onBack }) {
  const isRenewalMode = purchaseContext?.mode === 'renewal';
  const isRepurchaseMode = purchaseContext?.mode === 'repurchase';
  const isReadonlyPlan = isRenewalMode || isRepurchaseMode;
  // 1. 狀態管理 (State Management)
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // 從 API 獲取的基礎資料
  const [plans, setPlans] = useState([]);
  const [addons, setAddons] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [offlinePaymentInfo, setOfflinePaymentInfo] = useState(null);
  const [availableCoupons, setAvailableCoupons] = useState([]);

  // 使用者在表單中的選擇
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [termMonths, setTermMonths] = useState(1);
  const [selectedAddonIds, setSelectedAddonIds] = useState(new Set());
  const [couponCode, setCouponCode] = useState('');
  const [selectedCouponAssignmentId, setSelectedCouponAssignmentId] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [paymentType, setPaymentType] = useState('offline');
  const [selectedPaymentMethodCode, setSelectedPaymentMethodCode] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [renewalAccounts, setRenewalAccounts] = useState([]);
  const [selectedRetainedSipUserIds, setSelectedRetainedSipUserIds] = useState(new Set());
  const planCarouselRef = useRef(null);

  // 2. 資料獲取 (Data Fetching)
  useEffect(() => {
    let isMounted = true;
    async function loadPurchaseData() {
      setLoading(true);
      setError(null);
      try {
        const [plansRes, addonsRes, pmRes, offlineInfoRes, couponsRes] = await Promise.all([
          apiClient.get('/billing/plans?status=active'),
          apiClient.get('/billing/addon-services?status=active'),
          apiClient.get('/billing/payment-methods'),
          apiClient.get('/billing/offline-payment-account'),
          apiClient.get('/billing/available-coupons'),
        ]);

        if (!isMounted) return;

        const activePlans = (plansRes.plans || []).filter(plan => plan.status === 'active').sort((a, b) => a.sortOrder - b.sortOrder);
        const activeAddons = (addonsRes.addons || []).filter(addon => addon.status === 'active');
        const activePms = (pmRes.methods || []).filter(pm => pm.status === 'active').sort((a, b) => a.sortOrder - b.sortOrder);

        setPlans(activePlans);
        setAddons(activeAddons);
        setPaymentMethods(activePms);
        setOfflinePaymentInfo(offlineInfoRes.account || null);
        setAvailableCoupons(couponsRes.coupons || []);
        setBillingAddress(tenant?.billingAddress || '');

        // 設定預設值：預設為線下支付
        if (activePlans.length > 0) setSelectedPlanId(activePlans[0].id);
        const offlinePm = activePms.find(pm => pm.methodType === 'offline');
        if (offlinePm) {
          setSelectedPaymentMethodCode(offlinePm.methodCode);
        } else {
          const onlinePms = activePms.filter(pm => pm.methodType === 'online');
          if (onlinePms.length > 0) setSelectedPaymentMethodCode(onlinePms[0].methodCode);
        }

        if (purchaseContext?.orderId) {
          const orderRes = await apiClient.get(`/billing/orders/${purchaseContext.orderId}`);
          if (!isMounted) return;
          const order = orderRes.order || {};
          if (purchaseContext.mode === 'edit' && order.editable === false) {
            setError('当前订单状态不允许修改。');
            return;
          }
          const matchedPlan = activePlans.find(plan => plan.planCode === order.planCode);
          if (matchedPlan) setSelectedPlanId(matchedPlan.id);
          setQuantity(Math.max(1, Number(order.quantity || 1)));
          setTermMonths(Math.max(1, Number(order.months || 1)));
          const orderAddonCodes = new Set(order.addonCodes || []);
          setSelectedAddonIds(new Set(activeAddons.filter(addon => orderAddonCodes.has(addon.addonCode)).map(addon => addon.id)));
          setPaymentType(order.paymentMethod || 'offline');
          setSelectedPaymentMethodCode(order.paymentMethod === 'online' ? order.paymentChannel || onlinePms[0]?.methodCode || '' : '');
          setBillingAddress(order.billingAddress || tenant?.billingAddress || '');
          setAppliedCoupon(null);
          setCouponCode('');
          setSelectedCouponAssignmentId('');
          const accounts = Array.isArray(order.renewalAccounts) ? order.renewalAccounts : [];
          setRenewalAccounts(accounts);
          setSelectedRetainedSipUserIds(new Set(accounts.map(account => Number(account.sipUserId)).filter(Boolean)));
        }

      } catch (err) {
        setError(err.message || '無法載入購買資料，請稍後再試。');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadPurchaseData();
    return () => { isMounted = false; };
  }, [tenant, purchaseContext?.mode, purchaseContext?.orderId]);

  // 3. 價格與帳單試算 (Real-time Calculation)
  const selectedPlan = useMemo(() => plans.find(p => p.id === selectedPlanId), [plans, selectedPlanId]);
  const selectedPlanCurrency = selectedPlan?.priceTiers?.[0]?.currency || 'USD';
  const desiredRenewalAccountCount = Math.max(0, Number(selectedPlan?.accountQuantity || 0) * Math.max(1, Number(quantity || 1)));
  const currentRenewalAccountCount = renewalAccounts.length;
  const isRenewalDowngrade = isRenewalMode && currentRenewalAccountCount > 0 && desiredRenewalAccountCount > 0 && desiredRenewalAccountCount < currentRenewalAccountCount;
  const canSelectRetainedAccounts = isRenewalMode && currentRenewalAccountCount > 0 && desiredRenewalAccountCount > 0 && desiredRenewalAccountCount <= currentRenewalAccountCount;
  const getPlanAddonCodes = (plan) => new Set(
    String(plan?.addonServices || '')
      .split(',')
      .map(code => code.trim())
      .filter(Boolean)
  );
  const getAddonBasePrice = (addon, currency = selectedPlanCurrency) => {
    const prices = Array.isArray(addon.prices) ? addon.prices : [];
    const explicitBasePrice = Number(addon.baseUnitPrice);
    if (Number.isFinite(explicitBasePrice)) {
      return {
        currency: addon.baseCurrency || currency,
        unitPrice: explicitBasePrice,
        syncWithPlanTerm: addon.baseSyncWithPlanTerm ?? true,
      };
    }
    return prices.find(p => p.currency === currency && Number(p.unitPrice || 0) > 0)
      || prices.find(p => Number(p.unitPrice || 0) > 0)
      || prices.find(p => p.currency === currency)
      || prices[0]
      || { currency, unitPrice: 0, syncWithPlanTerm: true };
  };
  const formatAddonUnit = (unit) => {
    if (unit === 'tenant') return '租户';
    if (unit === 'unit') return '个';
    return '项';
  };
  // availableAddons 现在包含所有活跃增值服务，并标记哪些是当前套餐自带的
  const availableAddons = useMemo(() => {
    const planAddonCodes = getPlanAddonCodes(selectedPlan);
    return addons.map(addon => ({
      ...addon,
      isIncluded: planAddonCodes.has(addon.addonCode)
    }));
  }, [addons, selectedPlan]); // 依赖于所有addons和selectedPlan

  const billingSummary = useMemo(() => {
    const summary = {
      items: [],
      subtotal: 0,
      discount: 0,
      total: 0,
      currency: 'USD',
    };

    if (!selectedPlan || termMonths <= 0 || quantity <= 0) return summary;

    const months = termMonths;
    const planPriceTier = selectedPlan.priceTiers?.[0] || { unitPrice: 0, currency: 'USD' };
    summary.currency = planPriceTier.currency;

    // 套餐費用
    const planLineAmount = planPriceTier.unitPrice * quantity * months;
    summary.items.push({
      id: `plan-${selectedPlan.id}`,
      name: `${selectedPlan.name} 套餐`,
      formula: `${summary.currency} ${planPriceTier.unitPrice.toFixed(2)} × ${quantity}份 × ${months}月`,
      amount: planLineAmount,
    });
    summary.subtotal += planLineAmount;

    // 增值服務費用
    availableAddons.forEach(addon => {
      if (addon.isIncluded || selectedAddonIds.has(addon.id)) {
        const addonPriceInfo = addon.isIncluded
          ? { currency: summary.currency, unitPrice: 0, syncWithPlanTerm: true }
          : getAddonBasePrice(addon, summary.currency);
        const termMultiplier = addonPriceInfo.syncWithPlanTerm ? months : 1;
        const addonLineAmount = Number(addonPriceInfo.unitPrice || 0) * quantity * termMultiplier;
        summary.items.push({
          id: `addon-${addon.id}`,
          name: addon.name,
          formula: `${summary.currency} ${addonPriceInfo.unitPrice.toFixed(2)} × ${quantity}份 × ${termMultiplier}月`,
          amount: addonLineAmount,
        });
        summary.subtotal += addonLineAmount;
      }
    });

    // 折扣計算
    if (appliedCoupon) {
      if (appliedCoupon.discountType === 'percent') {
        summary.discount = summary.subtotal * (appliedCoupon.discountValue / 100);
      } else if (appliedCoupon.discountType === 'fixed_amount' && appliedCoupon.currency === summary.currency) {
        summary.discount = appliedCoupon.discountValue;
      }
    }

    summary.total = Math.max(0, summary.subtotal - summary.discount);
    return summary;
  }, [selectedPlan, termMonths, quantity, availableAddons, selectedAddonIds, appliedCoupon]);

  useEffect(() => {
    if (!isRenewalMode || currentRenewalAccountCount === 0 || desiredRenewalAccountCount <= 0) return;
    if (desiredRenewalAccountCount >= currentRenewalAccountCount) {
      setSelectedRetainedSipUserIds(new Set(renewalAccounts.map(account => Number(account.sipUserId)).filter(Boolean)));
      return;
    }
    setSelectedRetainedSipUserIds(prev => {
      const allowedIds = new Set(renewalAccounts.map(account => Number(account.sipUserId)).filter(Boolean));
      const next = new Set(Array.from(prev).filter(id => allowedIds.has(Number(id))));
      return next;
    });
  }, [isRenewalMode, currentRenewalAccountCount, desiredRenewalAccountCount, renewalAccounts]);

  // 4. 事件處理 (Event Handlers)
  const handleAddonToggle = (addonId) => {
    const addon = availableAddons.find(a => a.id === addonId);
    if (addon?.isIncluded) return; // 套餐自带的增值服务不可取消

    setSelectedAddonIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(addonId)) {
        newSet.delete(addonId);
      } else {
        newSet.add(addonId);
      }
      return newSet;
    });
  };

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    try {
      const code = couponCode.trim().toUpperCase();
      const res = await apiClient.get(`/billing/coupons/validate?code=${encodeURIComponent(code)}`);
      setAppliedCoupon(res.coupon || res);
      setError(null);
    } catch (err) {
      setAppliedCoupon(null);
      setError(err.message || '無效的優惠碼或不適用。');
    }
  };

  const formatCouponOption = (coupon) => {
    const discount = coupon.discountType === 'percent'
      ? `${Number(coupon.discountValue || 0).toFixed(0)}%`
      : `${coupon.currency || selectedPlanCurrency} ${Number(coupon.discountValue || 0).toFixed(2)}`;
    const name = coupon.displayName || coupon.couponCode;
    return `${coupon.couponCode} - ${name} (${discount}) #${coupon.assignmentId}`;
  };

  const handleCouponChange = (assignmentId) => {
    setSelectedCouponAssignmentId(assignmentId);
    const coupon = availableCoupons.find(item => String(item.assignmentId) === String(assignmentId)) || null;
    setAppliedCoupon(coupon);
    setCouponCode(coupon?.couponCode || '');
    setError(null);
  };

  const toggleRetainedAccount = (sipUserId) => {
    const numericId = Number(sipUserId);
    if (!canSelectRetainedAccounts) return;
    setSelectedRetainedSipUserIds(prev => {
      const next = new Set(prev);
      if (next.has(numericId)) {
        next.delete(numericId);
        return next;
      }
      if (next.size >= desiredRenewalAccountCount) return next;
      next.add(numericId);
      return next;
    });
  };

  const selectAllRetainedAccounts = () => {
    const accountIds = renewalAccounts.map(account => Number(account.sipUserId)).filter(Boolean);
    setSelectedRetainedSipUserIds(new Set(accountIds.slice(0, desiredRenewalAccountCount || accountIds.length)));
  };

  const clearRetainedAccounts = () => {
    if (!canSelectRetainedAccounts) return;
    setSelectedRetainedSipUserIds(new Set());
  };

  const handleCheckout = async (e) => {
    e.preventDefault();
    if (paymentType === 'online') {
      alert('线上支付功能正在开发中。');
      return;
    }
    const missingPaymentMethod = paymentType === 'online'
      ? !selectedPaymentMethodCode
      : !offlinePaymentInfo;
    if (!selectedPlanId || termMonths <= 0 || missingPaymentMethod) {
      setError('請完整選擇套餐、時長與支付方式。');
      return;
    }
    if (isRenewalMode && currentRenewalAccountCount > 0 && desiredRenewalAccountCount > currentRenewalAccountCount) {
      setError('當前續訂暫不支援增加帳號數量，請減少帳號數量或使用重新購買。');
      return;
    }
    if (canSelectRetainedAccounts && selectedRetainedSipUserIds.size > desiredRenewalAccountCount) {
      setError(`本次續訂最多保留 ${desiredRenewalAccountCount} 個帳號，請調整保留帳號選擇。`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        planCode: selectedPlan.planCode,
        quantity,
        months: termMonths,
        addonCodes: availableAddons.filter(a => a.isIncluded || selectedAddonIds.has(a.id)).map(a => a.addonCode),
        paymentMethod: paymentType,
        paymentChannel: paymentType === 'offline' ? '' : selectedPaymentMethodCode,
        couponCode: appliedCoupon ? appliedCoupon.couponCode : undefined,
        tenantCouponId: appliedCoupon ? Number(selectedCouponAssignmentId) : undefined,
        billingAddress: billingAddress,
        retainedSipUserIds: isRenewalMode ? Array.from(selectedRetainedSipUserIds) : undefined,
      };
      
      const endpoint = purchaseContext?.mode === 'renewal' && purchaseContext.orderId
        ? `/billing/orders/${purchaseContext.orderId}/renew`
        : purchaseContext?.mode === 'repurchase' && purchaseContext.orderId
          ? `/billing/orders/${purchaseContext.orderId}/repurchase`
          : purchaseContext?.mode === 'edit' && purchaseContext.orderId
            ? `/billing/orders/${purchaseContext.orderId}`
            : '/billing/orders';
      const orderRes = purchaseContext?.mode === 'edit' && purchaseContext.orderId
        ? await apiClient.put(endpoint, payload)
        : await apiClient.post(endpoint, payload);
      const order = orderRes.order || orderRes;

      if (paymentType === 'offline') {
        alert(purchaseContext?.mode === 'edit'
          ? '订单修改已保存，原付款凭证已清空，支付状态已重置为未支付。请重新上传付款凭证后再提交审核。'
          : isRenewalMode
            ? '订单续订已保存。请在付款后上传付款凭证，然后提交审核。'
            : '保存成功。请在付款后上传付款凭证，然后提交审核。');
        onBack(); // 返回我的套餐頁面
      } else {
        // TODO: 處理線上支付跳轉
        alert(`訂單 #${order.orderNo || order.id} 已建立！應付金額 ${order.currency} ${Number(order.payableAmount || 0).toFixed(2)}，接下來將跳轉至支付頁面...`);
        // window.location.href = order.paymentUrl;
      }
    } catch (err) {
      setError(err.message || '訂單建立失敗，請稍後再試。');
    } finally {
      setSubmitting(false);
    }
  };

  const scrollPlanCarousel = (direction) => {
    planCarouselRef.current?.scrollBy({ left: direction * 244, behavior: 'smooth' });
  };

  const handlePaymentTypeChange = (type) => {
    setPaymentType(type);
    const targetMethods = paymentMethods.filter(pm => pm.methodType === type);
    if (targetMethods.length > 0) {
      setSelectedPaymentMethodCode(targetMethods[0].methodCode);
    } else {
      setSelectedPaymentMethodCode('');
    }
  };

  if (loading) return <div className="panel" style={{ padding: '40px', textAlign: 'center' }}>載入套餐資料中...</div>;

  return (
    <section className="view active" id="purchase-plan" style={{ background: '#0f172a' }}>
      <style>{`
        #purchase-plan.view.active { height: 100%; flex: 1 0 0; min-height: 0; }
        #purchase-plan .purchase-page-form {
          background: transparent;
          scrollbar-width: none;
        }
        #purchase-plan .purchase-page-form::-webkit-scrollbar { display: none; }
        #purchase-plan .purchase-card {
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 14px;
          padding: 28px 36px;
          max-width: 860px;
          margin: 0 auto;
          width: 100%;
          color: #e5e7eb;
        }
        #purchase-plan .purchase-page-actions { margin-top: 24px; }
        #purchase-plan .billing-detail-box {
          background: #111827 !important;
          border: 1px solid #1f2937 !important;
        }
        #purchase-plan .billing-detail-head {
          background: #1a2332 !important;
          border-bottom: 1px solid #1f2937 !important;
        }
        #purchase-plan .billing-detail-head strong { color: #f3f4f6 !important; }
        #purchase-plan .billing-detail-head span { color: #9ca3af !important; }
        #purchase-plan .billing-detail-row {
          color: #d1d5db !important;
          border-bottom: 1px solid #1f2937 !important;
        }
        #purchase-plan .billing-detail-row strong { color: #f3f4f6 !important; }
        #purchase-plan .billing-detail-row b { color: #e5e7eb !important; }
        #purchase-plan .billing-detail-row.discount b { color: #60a5fa !important; }
        #purchase-plan .billing-detail-header {
          color: #9ca3af !important;
          background: #1a2332 !important;
        }
        #purchase-plan .billing-detail-total {
          background: #1a2332 !important;
        }
        #purchase-plan .billing-detail-total span { color: #f3f4f6 !important; }
        #purchase-plan .billing-detail-total strong { color: #60a5fa !important; }
        #purchase-plan .addon-service-row {
          background: #1a2332;
          border: 1px solid #1f2937;
          color: #d1d5db;
        }
        #purchase-plan .addon-service-row:hover { background: #1e293b; }
        #purchase-plan .addon-service-row.selected {
          background: #1e3a5f;
          border-color: #3b82f6;
          color: #e5e7eb;
        }
        #purchase-plan .addon-service-row strong { color: #f3f4f6; }
        #purchase-plan input[type='text'],
        #purchase-plan input[type='number'],
        #purchase-plan input[type='email'],
        #purchase-plan select {
          background: #1a2332;
          color: #e5e7eb;
          border: 1px solid #374151;
          border-radius: 6px;
          padding: 10px 12px;
        }
        #purchase-plan input:focus, #purchase-plan select:focus {
          border-color: #3b82f6;
          outline: none;
        }
        #purchase-plan label { color: #9ca3af; }
        #purchase-plan .primary-btn { background: #3b82f6; color: #fff; border: none; }
        #purchase-plan .ghost-btn { background: #1f2937; color: #d1d5db; border: 1px solid #374151; }
        #purchase-plan .plan-nav-btn {
          background: #1f2937 !important;
          border: 1px solid #374151 !important;
          color: #93c5fd !important;
        }
        #purchase-plan .plan-nav-btn:hover { background: #374151 !important; border-color: #3b82f6 !important; }
        #purchase-plan .plan-choice {
          background: #1e293b !important;
          border: 1px solid #374151 !important;
          color: #e5e7eb !important;
        }
        #purchase-plan .plan-choice strong { color: #f3f4f6 !important; }
        #purchase-plan .plan-choice span { color: #60a5fa !important; }
        #purchase-plan .plan-choice small { color: #9ca3af !important; }
        #purchase-plan .plan-choice em { color: #9ca3af !important; }
        #purchase-plan .plan-choice b { color: #d1d5db !important; }
        #purchase-plan .plan-choice.selected {
          border-color: #3b82f6 !important;
          box-shadow: 0 0 18px rgba(59, 130, 246, 0.2) !important;
        }
        #purchase-plan .plan-choice.selected::after {
          background: linear-gradient(135deg, transparent 0 48%, #3b82f6 49% 100%) !important;
        }
        #purchase-plan .purchase-side-label { color: #d1d5db !important; font-weight: 600; }
        #purchase-plan .number-stepper {
          background: #111827 !important;
          border-color: #374151 !important;
        }
        #purchase-plan .number-stepper button {
          background: #1f2937 !important;
          border: 0 !important;
          color: #93c5fd !important;
        }
        #purchase-plan .number-stepper button:hover { background: #374151 !important; }
        #purchase-plan .number-stepper input {
          background: #1a2332 !important;
          border-color: #374151 !important;
          color: #e5e7eb !important;
        }
        #purchase-plan .number-stepper span { color: #9ca3af !important; }
        #purchase-plan .billing-address-line textarea {
          background: #1a2332 !important;
          color: #e5e7eb !important;
          border: 1px solid #374151 !important;
        }
        #purchase-plan .billing-address-line textarea:focus {
          border-color: #3b82f6 !important;
          outline: none !important;
        }
        #purchase-plan .offline-payment-info {
          background: #1a2332 !important;
          border: 1px solid #1f2937 !important;
          color: #d1d5db !important;
        }
        #purchase-plan .offline-payment-info p { color: #60a5fa !important; }
        #purchase-plan .offline-payment-info dt { color: #9ca3af !important; }
        #purchase-plan .offline-payment-info dd { color: #e5e7eb !important; }
        #purchase-plan .option-pill {
          background: #1a2332 !important;
          border: 1px solid #374151 !important;
          color: #9ca3af !important;
        }
        #purchase-plan .option-pill.selected {
          background: #3b82f6 !important;
          border-color: #3b82f6 !important;
          color: #fff !important;
        }
      `}</style>
      <form className="purchase-page-form" id="purchase-page-form" onSubmit={handleCheckout}>
        <div className="purchase-card">
          <div className="purchase-form-body">
          <div className="purchase-side-label">{isRenewalMode ? '續訂套餐：' : '選擇套餐：'}</div>
          {isReadonlyPlan ? (
            <div className="renewal-plan-readonly" title={selectedPlan?.name || ''}>
              {selectedPlan?.name || '原订单套餐'}
            </div>
          ) : (
            <div className="purchase-plan-carousel">
              <button className="plan-nav-btn" onClick={() => scrollPlanCarousel(-1)} type="button" aria-label="上一個套餐">‹</button>
              <div className="purchase-plan-options" ref={planCarouselRef}>
                {plans.map(plan => {
                  const priceTier = plan.priceTiers?.[0] || { currency: 'USD', unitPrice: 0 };
                  return (
                    <label key={plan.id} className={`plan-choice ${selectedPlanId === plan.id ? 'selected' : ''}`}>
                      <input type="radio" name="planId" value={plan.id} checked={selectedPlanId === plan.id} onChange={() => setSelectedPlanId(plan.id)} />
                      <strong>{plan.name}</strong>
                      <span><i>{priceTier.currency}</i>{priceTier.unitPrice.toFixed(2)}</span>
                      <small>每月每帳號</small>
                      <em>{plan.accountQuantity} 個帳號</em>
                      <b>{plan.featureSummary || plan.description}</b>
                    </label>
                  );
                })}
              </div>
              <button className="plan-nav-btn" onClick={() => scrollPlanCarousel(1)} type="button" aria-label="下一個套餐">›</button>
            </div>
          )}

          <label className="purchase-side-label">購買數量：</label>
          {isRepurchaseMode ? (
            <div className="renewal-plan-readonly">{quantity} 份 (每份 {selectedPlan?.accountQuantity || 0} 帳號)</div>
          ) : (
            <div className="number-stepper">
              <button type="button" onClick={() => setQuantity(q => Math.max(1, q - 1))}>-</button>
              <input name="purchaseQuantity" type="number" min="1" value={quantity} onChange={e => setQuantity(Math.max(1, Number(e.target.value)))} inputMode="numeric" />
              <button type="button" onClick={() => setQuantity(q => q + 1)}>+</button>
              <span>份 (每份 {selectedPlan?.accountQuantity || 0} 帳號)</span>
            </div>
          )}

          <label className="purchase-side-label">購買時長：</label>
          {isRepurchaseMode ? (
            <div className="renewal-plan-readonly">{termMonths} 個月</div>
          ) : (
            <div className="number-stepper">
              <button type="button" onClick={() => setTermMonths(m => Math.max(1, m - 1))}>-</button>
              <input name="termMonths" type="number" min="1" value={termMonths} onChange={e => setTermMonths(Math.max(1, Number(e.target.value)))} inputMode="numeric" />
              <button type="button" onClick={() => setTermMonths(m => m + 1)}>+</button>
              <span>個月</span>
            </div>
          )}

          {isRenewalMode && currentRenewalAccountCount > 0 && (
            <>
              <label className="purchase-side-label" style={{ alignSelf: 'flex-start', marginTop: '12px' }}>保留帳號：</label>
              <div className="renewal-account-panel">
                <div className="renewal-account-toolbar">
                  <div className="renewal-account-summary">
                    當前已有 {currentRenewalAccountCount} 個帳號，本次續訂 {desiredRenewalAccountCount || 0} 個帳號，已選擇 {selectedRetainedSipUserIds.size} 個。
                    {canSelectRetainedAccounts
                      ? ` 最多保留 ${desiredRenewalAccountCount} 個，未保留部分將在審核時重新分配。`
                      : ' 當前續訂暫不支援增加帳號數量。'}
                  </div>
                  <div className="renewal-account-actions" aria-label="保留帳號選擇操作">
                    <button type="button" className="link-btn" onClick={selectAllRetainedAccounts} disabled={!canSelectRetainedAccounts}>全選</button>
                    <button type="button" className="link-btn" onClick={clearRetainedAccounts} disabled={!canSelectRetainedAccounts}>清空</button>
                  </div>
                </div>
                <div className="renewal-account-listbox" role="group" aria-label="原订单已分配账号">
                  {renewalAccounts.map(account => {
                    const sipUserId = Number(account.sipUserId);
                    const checked = selectedRetainedSipUserIds.has(sipUserId);
                    const disabled = !canSelectRetainedAccounts;
                    return (
                      <label key={sipUserId} className={`renewal-account-option ${checked ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleRetainedAccount(sipUserId)}
                        />
                        <span className="renewal-account-text">
                          <strong>{account.username}{account.sipDomain ? ` | ${account.sipDomain}` : ''}</strong>
                          {account.displayName && account.displayName !== account.username && <small>{account.displayName}</small>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {availableAddons.length > 0 && (
            <>
              <label className="purchase-side-label" style={{ alignSelf: 'flex-start', marginTop: '12px' }}>增值服務：</label>
              <div className="addon-service-list">
                {availableAddons.map(addon => {
                  const isSelected = addon.isIncluded || selectedAddonIds.has(addon.id);
                  const priceInfo = addon.isIncluded
                    ? { currency: billingSummary.currency, unitPrice: 0 }
                    : getAddonBasePrice(addon, billingSummary.currency);
                  return (<button key={addon.id} className={`addon-service-row ${isSelected ? 'selected' : ''}`} type="button" onClick={() => handleAddonToggle(addon.id)} disabled={addon.isIncluded || isReadonlyPlan}>
                      <span>{addon.name}</span>
                      <strong>{`${billingSummary.currency} ${Number(priceInfo.unitPrice || 0).toFixed(2)} / ${formatAddonUnit(addon.billingUnit)} / 月`}</strong>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="purchase-side-label label-with-action">
            <span className="required-text">帳單地址：</span>
            <span className="label-action-row">
              {isEditingAddress && <button className="link-btn" onClick={() => { setIsEditingAddress(false); setBillingAddress(tenant?.billingAddress || ''); }} type="button">取消</button>}
              <button className="link-btn" onClick={() => setIsEditingAddress(!isEditingAddress)} type="button">{isEditingAddress ? '完成' : '編輯'}</button>
            </span>
          </div>
          <div className="billing-address-line">
            <textarea name="purchaseBillingAddress" rows="1" value={billingAddress} onChange={e => setBillingAddress(e.target.value)} readOnly={!isEditingAddress}></textarea>
          </div>

          <label className="purchase-side-label">優惠碼：</label>
          <div className="coupon-entry">
            <select name="tenantCouponId" value={selectedCouponAssignmentId} onChange={e => handleCouponChange(e.target.value)}>
              <option value="">不使用優惠碼</option>
              {availableCoupons.map(coupon => (
                <option key={coupon.assignmentId} value={coupon.assignmentId}>
                  {formatCouponOption(coupon)}
                </option>
              ))}
            </select>
            {availableCoupons.length === 0 ? (
              <div className="coupon-summary" style={{ color: '#9ca3af' }}>暫無可用優惠碼</div>
            ) : (
              <div className="coupon-summary" style={{ color: '#9ca3af' }}>請選擇優惠碼</div>
            )}
            {appliedCoupon && <div className="coupon-summary">{appliedCoupon.displayName || appliedCoupon.couponCode} 已套用</div>}
          </div>

          <section className="billing-detail-box span-content" aria-label="帳單明細">
            <div className="billing-detail-head">
              <strong>帳單明細</strong>
              <span>{billingSummary.currency}</span>
            </div>
            <div className="billing-detail-table">
              <div className="billing-detail-row billing-detail-header">
                <span>序號</span>
                <span>項目</span>
                <span>計算方式</span>
                <span>金額</span>
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
                  <span>{appliedCoupon?.displayName || '折扣'}</span>
                  <b>- {billingSummary.discount.toFixed(2)}</b>
                </div>
              )}
            </div>
            <div className="billing-detail-total">
              <span>應支付金額</span>
              <strong>{billingSummary.currency} {billingSummary.total.toFixed(2)}</strong>
            </div>
          </section>

          <label className="purchase-side-label required payment-label">支付方式：</label>
          <div className="payment-method-area">
            <div className="purchase-option-row payment-type-row">
              <button className={`option-pill ${paymentType === 'online' ? 'selected' : ''}`} onClick={() => handlePaymentTypeChange('online')} type="button">線上支付</button>
              <button className={`option-pill ${paymentType === 'offline' ? 'selected' : ''}`} onClick={() => handlePaymentTypeChange('offline')} type="button">線下支付</button>
            </div>
            <div className={`payment-logo-row ${paymentType === 'online' ? '' : 'hidden'}`} aria-label="支援的線上付款方式">
              {paymentMethods.filter(pm => pm.methodType === 'online').map(pm => (
                <label key={pm.id} className={`payment-logo with-icon ${pm.logoClass} ${selectedPaymentMethodCode === pm.methodCode ? 'selected' : ''}`}>
                  <input type="radio" name="paymentMethodCode" value={pm.methodCode} checked={selectedPaymentMethodCode === pm.methodCode} onChange={e => setSelectedPaymentMethodCode(e.target.value)} />
                  {pm.iconUrl && <img src={pm.iconUrl} alt={pm.displayName} />}
                </label>
              ))}
            </div>
            {offlinePaymentInfo && (
              <div className={`offline-payment-info ${paymentType === 'offline' ? '' : 'hidden'}`}>
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
        </div>

        <div className="purchase-page-actions">
          {error && <p className="form-message error">{error}</p>}
          <button className="primary-btn" type="submit" disabled={submitting || loading}>
            {submitting ? '處理中...' : paymentType === 'offline' ? '保存' : '支付'}
          </button>
          <button className="ghost-btn" type="button" onClick={onBack}>取消</button>
        </div>
        </div>
      </form>
    </section>
  );
}
