import React, { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import apiClient from './apiClient';

function getReviewStatus(order) {
  if (order.orderStatus === 'review_approved') return { key: 'approved', label: '通過', className: 'online' };
  if (order.orderStatus === 'review_rejected') return { key: 'rejected', label: '未通過', className: 'failed' };
  if (order.orderStatus === 'pending_review') return { key: 'pending', label: '待審核', className: 'pending' };
  return { key: 'none', label: '-', className: 'pending' };
}

function getBusinessOrderStatus(order) {
  if (order.orderStatus === 'review_approved') return { key: 'active', label: '已生效', className: 'online' };
  if (order.orderStatus === 'review_rejected') return { key: 'inactive', label: '未生效', className: 'failed' };
  if (order.orderStatus === 'pending_review') return { key: 'submitted', label: '已提交', className: 'pending' };
  return { key: 'unsubmitted', label: '未提交', className: 'pending' };
}

function paymentMethodLabel(order) {
  if (order.paymentMethod === 'offline') return '線下支付';
  if (order.paymentMethod === 'online') return order.paymentChannel ? `線上支付 / ${order.paymentChannel}` : '線上支付';
  return '-';
}

function formatChineseDate(value) {
  if (!value) return '-';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value).slice(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch { return String(value).slice(0, 10); }
}

function termLabel(months) {
  if (Number(months) === 12) return '一年';
  if (Number(months) === 6) return '半年';
  return months ? `${months} 個月` : '-';
}

function formatMoney(amount, currency = 'USD') {
  return `${currency} ${Number(amount || 0).toFixed(2)}`;
}

function selectedPlanItem(order) {
  return (order.items || []).find(item => item.itemType === 'plan') || null;
}

function selectedAddonItems(order) {
  return (order.items || []).filter(item => item.itemType === 'addon');
}

function packageStatus(order) {
  if (order.orderStatus !== 'review_approved') return { key: 'inactive', label: '未生效', className: 'pending' };
  const today = new Date();
  const end = order.expiresAt ? new Date(`${order.expiresAt}T23:59:59`) : null;
  if (end && today > end) return { key: 'expired', label: '已過期', className: 'expired' };
  if (end && end.getTime() - today.getTime() <= 30 * 24 * 60 * 60 * 1000) {
    return { key: 'expiring', label: '即將過期', className: 'expiring' };
  }
  return { key: 'active', label: '生效中', className: 'online' };
}

const statusFilterOptions = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '生效中' },
  { key: 'expiring', label: '即將過期' },
  { key: 'expired', label: '已過期' },
  { key: 'inactive', label: '未生效' },
];

const Domain = forwardRef(({ onOpenPurchase, paymentProofDialogRef, reloadToken, onOpenDetail }, ref) => {
  const [orders, setOrders] = useState([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showPayments, setShowPayments] = useState(false);
  const [paymentData, setPaymentData] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuAnchorRef = useRef(null);
  const menuRef = useRef(null);

  const updateMenuPosition = useCallback(() => {
    const anchor = menuAnchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const menuWidth = 142;
    const menuHeight = menuRef.current?.offsetHeight || 190;
    let left = rect.right - menuWidth;
    let top = rect.bottom + 6;
    if (left < 8) left = 8;
    if (top + menuHeight > window.innerHeight - 8) top = Math.max(8, rect.top - 6 - menuHeight);
    setMenuPosition({ top, left });
  }, []);

  useEffect(() => {
    if (!openMenuId) return;
    updateMenuPosition();
    const h = (e) => { if (!menuRef.current?.contains(e.target) && !menuAnchorRef.current?.contains(e.target)) setOpenMenuId(null); };
    document.addEventListener('mousedown', h);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('resize', updateMenuPosition); window.removeEventListener('scroll', updateMenuPosition, true); };
  }, [openMenuId, updateMenuPosition]);

  useImperativeHandle(ref, () => ({
    showPayments() {
      setShowPayments(true);
      setPaymentLoading(true);
      apiClient.get('/tenant/payments').then(res => {
        if (res?.data) setPaymentData(res.data);
      }).catch(() => {}).finally(() => setPaymentLoading(false));
    },
  }));

  async function loadOrders() {
    setIsLoading(true);
    setMessage({ type: '', text: '' });
    try {
      const result = await apiClient.get('/billing/orders');
      setOrders(Array.isArray(result.orders) ? result.orders : []);
    } catch (error) {
      setOrders([]);
      setMessage({ type: 'error', text: error.message || '讀取套餐列表失敗。' });
    } finally { setIsLoading(false); }
  }

  useEffect(() => { loadOrders(); }, [reloadToken]);

  const filteredOrders = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return orders.filter(order => {
      if (keyword && !(String(order.planName || '').toLowerCase().includes(keyword) || String(order.orderNo || '').toLowerCase().includes(keyword))) return false;
      if (statusFilter === 'all') return true;
      return packageStatus(order).key === statusFilter;
    });
  }, [orders, query, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts = { all: orders.length };
    statusFilterOptions.forEach(o => { if (o.key !== 'all') counts[o.key] = orders.filter(order => packageStatus(order).key === o.key).length; });
    return counts;
  }, [orders]);

  const effectivePageSize = pageSize > 0 ? pageSize : filteredOrders.length;
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / effectivePageSize));
  const normalizedPage = Math.min(Math.max(1, page), totalPages);
  const pageOrders = pageSize > 0 ? filteredOrders.slice((normalizedPage - 1) * pageSize, normalizedPage * pageSize) : filteredOrders;

  async function handleAction(action, order) {
    setOpenMenuId(null);
    if (action === 'detail') {
      onOpenDetail?.(order.id);
      return;
    }
    if (action === 'upload-proof') { paymentProofDialogRef?.current?.show(order); return; }
    if (action === 'repurchase') { onOpenPurchase?.({ mode: 'repurchase', orderId: order.id }); return; }
    if (action === 'renew') { onOpenPurchase?.({ mode: 'renewal', orderId: order.id }); return; }
    if (action === 'edit') { onOpenPurchase?.({ mode: 'edit', orderId: order.id }); return; }
    if (action === 'delete') {
      if (!window.confirm(`確定要刪除訂單 ${order.orderNo} 嗎？`)) return;
      try {
        await apiClient.delete(`/billing/orders/${order.id}`);
        setMessage({ type: 'success', text: '訂單已刪除。' });
        loadOrders();
      } catch (e) { window.alert(e.message || '刪除失敗'); }
      return;
    }
    if (action === 'submit-review') {
      if (!window.confirm('確認提交該訂單進行後台審核嗎？')) return;
      try { await apiClient.post(`/billing/orders/${order.id}/review-submission`, { action: 'submit' }); loadOrders(); setMessage({ type: 'success', text: '訂單已提交審核。' }); }
      catch (e) { window.alert(e.message || '操作失敗'); }
      return;
    }
    if (action === 'revoke-review') {
      if (!window.confirm('確認撤銷提交嗎？')) return;
      try { await apiClient.post(`/billing/orders/${order.id}/review-submission`, { action: 'revoke' }); loadOrders(); setMessage({ type: 'success', text: '已撤銷提交。' }); }
      catch (e) { window.alert(e.message || '操作失敗'); }
    }
  }

  function getOrderActions(order) {
    const showProof = order.paymentMethod === 'offline' && (order.orderStatus === 'pending_payment' || ['payment_submitted','pending_review','review_approved','review_rejected'].includes(order.orderStatus) || Boolean(order.paymentDate));
    const canModify = !['review_approved','review_rejected'].includes(order.orderStatus);
    const canDelete = order.orderStatus === 'pending_payment' && order.paymentStatus === 'unpaid';
    const canRenew = order.orderStatus === 'review_approved';
    const review = order.orderStatus === 'pending_review' ? { action: 'revoke-review', label: '撤銷提交' } : { action: 'submit-review', label: '重新提交', disabled: order.orderStatus === 'review_approved' };
    return [
      { action: 'detail', label: '查看詳情' },
      showProof ? { action: 'upload-proof', label: '支付憑證' } : null,
      canRenew ? { action: 'renew', label: '訂單續訂' } : null,
      { action: 'repurchase', label: '重新購買' },
      { action: 'edit', label: '訂單修改', disabled: !canModify },
      { action: 'delete', label: '訂單刪除', disabled: !canDelete },
      review,
    ].filter(Boolean);
  }

  return (
    <section className="view active" id="domain" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0f172a' }}>
      <style>{`
        .domain-page { display: flex; flex-direction: column; height: 100%; }
        .domain-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 22px 24px; margin-bottom: 24px; background: #111827; border: 1px solid #1f2937; border-radius: 14px; box-shadow: none; flex-wrap: wrap; }
        .domain-search { position: relative; width: 260px; }
        .domain-search input { width: 100%; height: 46px; padding: 0 16px 0 42px; border: 1px solid #374151; border-radius: 9px; font-size: 13px; outline: none; color: #d1d5db; box-sizing: border-box; }
        .domain-search input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.12); }
        .domain-search svg { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #6b7280; }
        .domain-stats { display: flex; gap: 6px; flex-wrap: wrap; }
        .domain-stat-pill { padding: 6px 14px; border-radius: 999px; font-size: 12px; border: 1px solid #374151; background: #1a2332; color: #9ca3af; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
        .domain-stat-pill:hover { border-color: #3b82f6; }
        .domain-stat-pill.active { background: #3b82f6; color: #fff; border-color: #3b82f6; }
        .domain-stat-pill strong { font-weight: 700; color: inherit; }
        .domain-table-card { flex: 1; min-height: 0; background: #111827; border: 1px solid #1f2937; border-radius: 14px; box-shadow: none; overflow: hidden; display: flex; flex-direction: column; }
        .domain-table-wrap { flex: 1; overflow: auto; scrollbar-width: none; } .domain-table-wrap::-webkit-scrollbar { display: none; }
        .domain-table { width: 100%; min-width: 1000px; border-collapse: collapse; font-size: 13px; }
        .domain-table thead { position: sticky; top: 0; z-index: 2; background: #1a2332; }
        .domain-table th { background: #1a2332; padding: 12px 16px; text-align: left; font-weight: 600; font-size: 12px; color: #9ca3af; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
        .domain-table td { padding: 12px 16px; color: #d1d5db; border-bottom: 1px solid #1f2937; white-space: nowrap; }
        .domain-table th:last-child, .domain-table td:last-child { position: sticky; right: 0; z-index: 1; background: #111827; box-shadow: -2px 0 4px rgba(0,0,0,0.2); }
        .domain-table thead th:last-child { z-index: 3; background: #1a2332; }
        .domain-table tr:hover td:last-child { background: #1a2332; }
        .domain-table tr:hover td { background: #1a2332; }
        .domain-empty { text-align: center; padding: 60px 20px; color: #6b7280; font-size: 14px; }
        .domain-footer { padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #1f2937; background: #111827; font-size: 13px; color: #9ca3af; }
        .domain-pagination { display: flex; align-items: center; gap: 8px; }
        .domain-page-size { height: 38px; padding: 0 14px; border-radius: 8px; border: 1px solid #374151; background: #1a2332; color: #e5e7eb; font-size: 12px; outline: none; cursor: pointer; }
        .domain-page-btn { width: 38px; height: 38px; border-radius: 8px; border: 1px solid #374151; background: #1f2937; color: #9ca3af; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; }
        .domain-page-btn:disabled { color: #4b5563; cursor: not-allowed; background: #1a2332; }
        .domain-page-current { width: 38px; height: 38px; border-radius: 8px; border: 1px solid #2563eb; background: #1e3a5f; color: #60a5fa; font-weight: 600; display: flex; align-items: center; justify-content: center; font-size: 13px; }
        .badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; }
        .badge.online { background: #dcfce7; color: #15803d; }
        .badge.failed { background: #fee2e2; color: #dc2626; }
        .badge.pending { background: #fef3c7; color: #b45309; }
        .badge.expired { background: #f1f5f9; color: #6b7280; }
        .badge.expiring { background: #fef3c7; color: #b45309; }
        .ghost-btn { background: none; border: none; cursor: pointer; color: #9ca3af; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
        .ghost-btn:hover { background: #f1f5f9; }
        .dropdown-portal { position: fixed; width: 150px; background: #fff; border: 1px solid #374151; border-radius: 8px; box-shadow: 0 10px 30px rgba(15,23,42,0.15); padding: 4px; z-index: 2147483647; }
        .dropdown-portal button { display: block; width: 100%; border: none; background: none; padding: 8px 12px; text-align: left; font-size: 12px; color: #d1d5db; cursor: pointer; border-radius: 4px; }
        .dropdown-portal button:hover { background: #f1f5f9; }
        .dropdown-portal button:disabled { color: #6b7280; cursor: not-allowed; }
        .dropdown-portal button.danger { color: #dc2626; }
      
        .domain-search input { background: #1a2332; }
        .domain-search input::placeholder { color: #6b7280; }
        .domain-page-size { background: #1a2332; color: #e5e7eb; }
        .domain-page-btn:hover:not(:disabled) { background: #374151; color: #f3f4f6; }
        .dropdown-portal { position: fixed; background: #1a2332; border: 1px solid #1f2937; border-radius: 8px; box-shadow: 0 12px 30px rgba(0,0,0,0.4); padding: 6px; z-index: 99999; min-width: 140px; }
        .dropdown-portal button { display: block; width: 100%; text-align: left; padding: 8px 14px; border: none; background: transparent; color: #d1d5db; font-size: 13px; border-radius: 4px; cursor: pointer; }
        .dropdown-portal button:hover { background: #1f2937; color: #f3f4f6; }
        .badge.online { background: #065f46; color: #6ee7b7; }
        .badge.failed { background: #7f1d1d; color: #fca5a5; }
        .badge.pending { background: #1e293b; color: #fbbf24; }
        .domain-table tr:hover td { background: #1e293b; }
        .domain-table tr:hover td:last-child { background: #1e293b; }
`}</style>

      <div className="domain-toolbar">
        <div className="domain-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="search" placeholder="搜尋套餐名稱或訂單編號" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="domain-stats">
          {statusFilterOptions.map(o => (
            <button key={o.key} className={`domain-stat-pill${statusFilter === o.key ? ' active' : ''}`} onClick={() => setStatusFilter(o.key)}>
              {o.label} <strong>{statusCounts[o.key] ?? 0}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="domain-table-card">
        <div className="domain-table-wrap">
          <table className="domain-table">
            <thead>
              <tr>
                <th>訂單編號</th>
                <th>套餐名稱</th>
                <th>訂單狀態</th>
                <th>審核狀態</th>
                <th>帳號數量</th>
                <th>增值服務</th>
                <th>租期</th>
                <th>金額</th>
                <th>支付方式</th>
                <th>付款日期</th>
                <th>到期日期</th>
                <th style={{ width: '80px', textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {pageOrders.length === 0 ? (
                <tr><td colSpan="12" className="domain-empty">{isLoading ? '載入中...' : '暫無套餐記錄'}</td></tr>
              ) : pageOrders.map(order => {
                const plan = selectedPlanItem(order);
                const addons = selectedAddonItems(order);
                const ps = packageStatus(order);
                const bs = getBusinessOrderStatus(order);
                return (
                  <tr key={order.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{order.orderNo || '-'}</td>
                    <td style={{ fontWeight: 600 }}>{plan?.planName || order.planName || '-'}</td>
                    <td><span className={`badge ${bs.className}`}>{bs.label}</span></td>
                    <td><span className={`badge ${getReviewStatus(order).className}`}>{getReviewStatus(order).label}</span></td>
                    <td>{order.accountQuantity ?? plan?.quantity ?? '-'}</td>
                    <td style={{ color: '#64748b' }}>{order.addonNames || (addons.length > 0 ? addons.map(a => a.itemName || a.addonName).join('、') : '-')}</td>
                    <td>{termLabel(plan?.months || order.months || order.termMonths)}</td>
                    <td style={{ fontWeight: 500 }}>{formatMoney(order.totalAmount || order.payableAmount || 0, plan?.currency || order.currency || 'USD')}</td>
                    <td>{paymentMethodLabel(order)}</td>
                    <td style={{ color: '#64748b' }}>{formatChineseDate(order.paymentDate)}</td>
                    <td>{formatChineseDate(order.expiresAt)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="ghost-btn" style={{ color: '#2563eb', marginRight: 4 }} onClick={() => onOpenDetail?.(order.id)}>詳情</button>
                      <button className="ghost-btn" ref={openMenuId === order.id ? menuAnchorRef : null} onClick={(e) => { e.stopPropagation(); if (openMenuId === order.id) { setOpenMenuId(null); return; } setOpenMenuId(order.id); }}>⋯</button>
                      {openMenuId === order.id && createPortal(
                        <div className="dropdown-portal" ref={menuRef} style={{ top: menuPosition.top, left: menuPosition.left }}>
                          {getOrderActions(order).map(a => <button key={a.action} onClick={() => handleAction(a.action, order)} disabled={a.disabled}>{a.label}</button>)}
                        </div>, document.body
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="domain-footer">
          <span>共 {filteredOrders.length} 筆記錄</span>
          <div className="domain-pagination">
            <select className="domain-page-size" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
              <option value={10}>10 條/頁</option>
              <option value={20}>20 條/頁</option>
              <option value={50}>50 條/頁</option>
              <option value={-1}>全部</option>
            </select>
            <button className="domain-page-btn" disabled={normalizedPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹</button>
            <span className="domain-page-current">{normalizedPage}</span>
            <button className="domain-page-btn" disabled={normalizedPage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>›</button>
          </div>
        </div>
      </div>

      {showPayments && createPortal((
        <div style={{ position: 'fixed', inset: 0, zIndex: 2147483647, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowPayments(false)}>
          <div style={{ background: '#111827', borderRadius: '10px', padding: '24px', maxWidth: '700px', width: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', border: '1px solid #1f2937', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>付款記錄</h3>
              <button onClick={() => setShowPayments(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '18px' }}>&#10005;</button>
            </div>
            {paymentLoading ? <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>載入中...</div> : !paymentData ? <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>暫無資料</div> : (<>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexShrink: 0 }}>
                <span style={{ padding: '6px 14px', borderRadius: '999px', background: '#1a2332', border: '1px solid #374151', fontSize: '12px', color: '#9ca3af' }}>記錄總數 <strong style={{ color: '#f3f4f6' }}>{paymentData.totalCount}</strong></span>
                <span style={{ padding: '6px 14px', borderRadius: '999px', background: '#065f46', border: '1px solid #059669', fontSize: '12px', color: '#6ee7b7' }}>付款總額 <strong style={{ color: '#f3f4f6' }}>¥{paymentData.totalAmount}</strong></span>
              </div>
              <div style={{ flex: 1, overflow: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '550px' }}>
                  <thead><tr style={{ background: '#1a2332' }}><th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#9ca3af', fontSize: '11px', borderBottom: '1px solid #1f2937' }}>訂單編號</th><th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#9ca3af', fontSize: '11px', borderBottom: '1px solid #1f2937' }}>金額</th><th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#9ca3af', fontSize: '11px', borderBottom: '1px solid #1f2937' }}>付款方式</th><th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#9ca3af', fontSize: '11px', borderBottom: '1px solid #1f2937' }}>付款日期</th><th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, color: '#9ca3af', fontSize: '11px', borderBottom: '1px solid #1f2937' }}>憑證</th></tr></thead>
                  <tbody>{paymentData.payments.map((p, i) => <tr key={i} style={{ borderTop: '1px solid #1f2937' }}><td style={{ padding: '8px 12px', color: '#d1d5db' }}>{p.orderNo || '—'}</td><td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 500, color: '#e5e7eb' }}>¥{Number(p.amount).toFixed(2)}</td><td style={{ padding: '8px 12px', color: '#9ca3af' }}>{p.paymentChannel || p.paymentMethod || '—'}</td><td style={{ padding: '8px 12px', color: '#9ca3af' }}>{p.paidAt || '—'}</td><td style={{ padding: '8px 12px', textAlign: 'center' }}>{p.proofFileUrl ? <a href={p.proofFileUrl.startsWith('/') ? '/api' + p.proofFileUrl : p.proofFileUrl} target="_blank" style={{ color: '#60a5fa', fontSize: '12px', textDecoration: 'none' }}>查看</a> : <span style={{ color: '#6b7280' }}>—</span>}</td></tr>)}</tbody>
                </table>
              </div>
            </>)}
          </div>
        </div>
      ), document.body)}
    </section>
  );
});

export default Domain;
