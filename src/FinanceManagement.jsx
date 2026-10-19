import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import apiClient from './apiClient';

const todayString = () => new Date().toISOString().slice(0, 10);

const emptyPaymentForm = {
  paymentDate: todayString(),
  receivingAccountId: '',
  receivingAccountName: '',
  receivingBankName: '',
  receivingAccountNo: '',
  amount: '',
  currency: '',
  voucherNo: '',
  voucherDataUrl: '',
  voucherFileName: '',
  invoiced: false,
  invoiceNo: '',
  invoiceCode: '',
  invoiceDate: '',
  invoiceAmount: '',
  invoiceDataUrl: '',
  invoiceFileName: '',
  notes: '',
};

const emptyFilters = {
  search: '',
  tenantId: '',
  paymentStatus: 'all',
  invoiceStatus: 'all',
};

function formatMoney(value, currency = '') {
  const amount = Number(value || 0);
  const formatted = amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${formatted}` : formatted;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
}

function fileUrl(url) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return url;
  return `/api${url.startsWith('/') ? url : `/${url}`}`;
}

function paymentStateBadge(receivable, received) {
  const r = Number(receivable || 0);
  const p = Number(received || 0);
  if (p > r) return { text: '超收', bg: '#1e3a5f', color: '#60a5fa' };
  if (p <= 0) return { text: '未收款', bg: '#7f1d1d', color: '#fca5a5' };
  if (p < r) return { text: '部分收款', bg: '#78350f', color: '#fcd34d' };
  return { text: '已收清', bg: '#065f46', color: '#6ee7b7' };
}

export default function FinanceManagement() {
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState({ orders: 0, orderAmount: 0, receivableAmount: 0, receivedAmount: 0, outstandingAmount: 0, invoicedAmount: 0 });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedSearch, setAppliedSearch] = useState('');
  const [tenants, setTenants] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [receivableModalOrder, setReceivableModalOrder] = useState(null);
  const [receivableValue, setReceivableValue] = useState('');
  const [savingReceivable, setSavingReceivable] = useState(false);
  const [paymentModalOrder, setPaymentModalOrder] = useState(null);
  const [payments, setPayments] = useState([]);
  const [paymentStats, setPaymentStats] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [savingPayment, setSavingPayment] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState(null);
  const [openMenuOrderId, setOpenMenuOrderId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const requestIdRef = useRef(0);
  const messageTimerRef = useRef(null);

  useEffect(() => {
    if (!openMenuOrderId) return undefined;
    const handleOutsideClick = (event) => {
      if (event.target.closest('.fin-dropdown-container') || event.target.closest('.fin-dropdown-menu')) return;
      setOpenMenuOrderId(null);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [openMenuOrderId]);

  const showMessage = useCallback((type, text) => {
    setMessage({ type, text });
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage({ type: '', text: '' }), 5000);
  }, []);

  useEffect(() => () => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const tenantRes = await apiClient.get('/admin/tenants');
        setTenants(Array.isArray(tenantRes?.tenants) ? tenantRes.tenants : []);
      } catch {
        /* 租戶列表失敗不影響其他功能 */
      }
      try {
        const accountRes = await apiClient.get('/platform/finance/receiving-accounts');
        setAccounts(Array.isArray(accountRes?.accounts) ? accountRes.accounts : []);
      } catch {
        /* 收款帳號失敗不影響訂單列表 */
      }
    })();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(filters.search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const loadOrders = useCallback(async ({ silent = false } = {}) => {
    const requestId = ++requestIdRef.current;
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        paymentStatus: filters.paymentStatus,
        invoiceStatus: filters.invoiceStatus,
      });
      if (appliedSearch) params.set('search', appliedSearch);
      if (filters.tenantId) params.set('tenantId', String(filters.tenantId));
      const res = await apiClient.get(`/platform/finance/orders?${params.toString()}`);
      if (requestId !== requestIdRef.current) return;
      const data = res?.data || {};
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setStats(data.stats || { orders: 0, orderAmount: 0, receivableAmount: 0, receivedAmount: 0, outstandingAmount: 0, invoicedAmount: 0 });
      setTotal(Number(data.total || 0));
      setMessage((current) => (current.type === 'error' ? current : { type: '', text: '' }));
    } catch (error) {
      if (requestId === requestIdRef.current) showMessage('error', error?.message || '讀取財務訂單失敗。');
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [page, pageSize, filters.paymentStatus, filters.invoiceStatus, filters.tenantId, appliedSearch, showMessage]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const tenantOptions = useMemo(
    () => tenants.map((tenant) => ({ id: Number(tenant.id), name: tenant.companyName || tenant.name || `#${tenant.id}` })),
    [tenants],
  );

  const openReceivable = (order) => {
    setReceivableModalOrder(order);
    setReceivableValue(String(Number(order.receivableAmount || 0).toFixed(2)));
  };

  const saveReceivable = async () => {
    if (!receivableModalOrder) return;
    const amount = Number(receivableValue);
    if (!Number.isFinite(amount) || amount < 0) {
      showMessage('error', '請輸入有效的應收金額。');
      return;
    }
    setSavingReceivable(true);
    try {
      await apiClient.put(`/platform/finance/orders/${receivableModalOrder.id}/receivable`, { receivableAmount: amount });
      showMessage('success', '應收金額已更新。');
      setReceivableModalOrder(null);
      await loadOrders({ silent: true });
    } catch (error) {
      showMessage('error', error?.message || '更新應收金額失敗。');
    } finally {
      setSavingReceivable(false);
    }
  };

  const loadPayments = useCallback(async (orderId) => {
    setPaymentLoading(true);
    try {
      const res = await apiClient.get(`/platform/finance/orders/${orderId}/payments`);
      const data = res?.data || {};
      setPayments(Array.isArray(data.payments) ? data.payments : []);
      setPaymentStats(data.stats || null);
      return data;
    } catch (error) {
      showMessage('error', error?.message || '讀取收款記錄失敗。');
      return null;
    } finally {
      setPaymentLoading(false);
    }
  }, [showMessage]);

  const openPayments = async (order) => {
    setPaymentModalOrder(order);
    setPaymentFormOpen(false);
    setEditingPaymentId(null);
    setPaymentForm(emptyPaymentForm);
    await loadPayments(order.id);
  };

  const closePayments = () => {
    if (savingPayment) return;
    setPaymentModalOrder(null);
    setPayments([]);
    setPaymentStats(null);
    setPaymentFormOpen(false);
    setEditingPaymentId(null);
  };

  const startCreatePayment = () => {
    setEditingPaymentId(null);
    setPaymentForm({ ...emptyPaymentForm, currency: paymentModalOrder?.currency || '', paymentDate: todayString() });
    setPaymentFormOpen(true);
  };

  const startEditPayment = (payment) => {
    setEditingPaymentId(payment.id);
    setPaymentForm({
      paymentDate: payment.paymentDate || todayString(),
      receivingAccountId: payment.receivingAccountId ? String(payment.receivingAccountId) : '',
      receivingAccountName: payment.receivingAccountName || '',
      receivingBankName: payment.receivingBankName || '',
      receivingAccountNo: payment.receivingAccountNo || '',
      amount: String(payment.amount ?? ''),
      currency: payment.currency || paymentModalOrder?.currency || '',
      voucherNo: payment.voucherNo || '',
      voucherDataUrl: '',
      voucherFileName: '',
      existingVoucherFile: payment.voucherFile || '',
      invoiced: Boolean(payment.invoiced),
      invoiceNo: payment.invoiceNo || '',
      invoiceCode: payment.invoiceCode || '',
      invoiceDate: payment.invoiceDate || '',
      invoiceAmount: payment.invoiceAmount == null ? '' : String(payment.invoiceAmount),
      invoiceDataUrl: '',
      invoiceFileName: '',
      existingInvoiceFile: payment.invoiceFile || '',
      notes: payment.notes || '',
    });
    setPaymentFormOpen(true);
  };

  const handleAccountChange = (value) => {
    const account = accounts.find((item) => String(item.id) === String(value));
    setPaymentForm((current) => ({
      ...current,
      receivingAccountId: value,
      receivingAccountName: account ? (account.displayName || account.payeeName || '') : current.receivingAccountName,
      receivingBankName: account ? (account.bankName || '') : current.receivingBankName,
      receivingAccountNo: account ? (account.bankAccountNo || '') : current.receivingAccountNo,
      currency: current.currency || account?.currency || paymentModalOrder?.currency || '',
    }));
  };

  const handleFile = (file, kind) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showMessage('error', '檔案大小需小於 10MB。');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setPaymentForm((current) => (kind === 'voucher'
        ? { ...current, voucherDataUrl: dataUrl, voucherFileName: file.name }
        : { ...current, invoiceDataUrl: dataUrl, invoiceFileName: file.name }));
    };
    reader.onerror = () => showMessage('error', '讀取檔案失敗。');
    reader.readAsDataURL(file);
  };

  const savePayment = async () => {
    if (!paymentModalOrder) return;
    if (!paymentForm.paymentDate) {
      showMessage('error', '請選擇收款日期。');
      return;
    }
    if (!Number.isFinite(Number(paymentForm.amount)) || Number(paymentForm.amount) <= 0) {
      showMessage('error', '請輸入有效的收款金額。');
      return;
    }
    setSavingPayment(true);
    try {
      const payload = {
        paymentDate: paymentForm.paymentDate,
        receivingAccountId: paymentForm.receivingAccountId || null,
        receivingAccountName: paymentForm.receivingAccountName,
        receivingBankName: paymentForm.receivingBankName,
        receivingAccountNo: paymentForm.receivingAccountNo,
        amount: Number(paymentForm.amount),
        currency: paymentForm.currency,
        voucherNo: paymentForm.voucherNo,
        voucherDataUrl: paymentForm.voucherDataUrl || undefined,
        invoiced: paymentForm.invoiced,
        invoiceNo: paymentForm.invoiceNo,
        invoiceCode: paymentForm.invoiceCode,
        invoiceDate: paymentForm.invoiceDate,
        invoiceAmount: paymentForm.invoiceAmount,
        invoiceDataUrl: paymentForm.invoiceDataUrl || undefined,
        notes: paymentForm.notes,
      };
      if (editingPaymentId) {
        await apiClient.put(`/platform/finance/payments/${editingPaymentId}`, payload);
        showMessage('success', '收款記錄已更新。');
      } else {
        await apiClient.post(`/platform/finance/orders/${paymentModalOrder.id}/payments`, payload);
        showMessage('success', '收款記錄已新增。');
      }
      setPaymentFormOpen(false);
      setEditingPaymentId(null);
      await loadPayments(paymentModalOrder.id);
      await loadOrders({ silent: true });
    } catch (error) {
      showMessage('error', error?.message || '儲存收款記錄失敗。');
    } finally {
      setSavingPayment(false);
    }
  };

  const deletePayment = async (payment) => {
    if (!window.confirm(`確定刪除 ${payment.paymentDate} 的收款記錄（${formatMoney(payment.amount, payment.currency)}）？`)) return;
    setDeletingPaymentId(payment.id);
    try {
      await apiClient.delete(`/platform/finance/payments/${payment.id}`);
      showMessage('success', '收款記錄已刪除。');
      await loadPayments(paymentModalOrder.id);
      await loadOrders({ silent: true });
    } catch (error) {
      showMessage('error', error?.message || '刪除收款記錄失敗。');
    } finally {
      setDeletingPaymentId(null);
    }
  };

  const inputStyle = { width: '100%', height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '13px', outline: 'none' };
  const labelStyle = { display: 'flex', flexDirection: 'column', gap: '6px', color: '#9ca3af', fontSize: '12px' };

  return (
    <section className="view active" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: '14px', overflow: 'hidden', background: '#0f172a' }}>
      <style>{`
        .fin-table-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; scrollbar-width: thin; scrollbar-color: #374151 transparent; }
        .fin-table { width: 100%; min-width: 1180px; border-collapse: separate; border-spacing: 0; font-size: 13px; }
        .fin-table th { height: 48px; padding: 0 12px; text-align: left; font-size: 12px; color: #e5e7eb; background: #1e293b; border-bottom: 2px solid #2d3a4a; white-space: nowrap; position: sticky; top: 0; z-index: 2; }
        .fin-table td { height: 54px; padding: 0 12px; color: #e5e7eb; border-bottom: 1px solid #1f2937; white-space: nowrap; }
        .fin-table tr:hover td { background: #1e293b; }
        .fin-table th.fin-sticky-action,
        .fin-table td.fin-sticky-action { position: sticky; right: 0; z-index: 3; width: 180px; background: #111827; border-left: 1px solid #374151; box-shadow: -4px 0 8px rgba(0,0,0,0.35); }
        .fin-table th.fin-sticky-action { background: #1e293b; z-index: 4; }
        .fin-table tr:hover td.fin-sticky-action { background: #1e293b; }
        .fin-table td .ghost-btn { background: #1f2937 !important; border: 1px solid #4b5563 !important; color: #d1d5db !important; }
        .fin-table td .ghost-btn:hover { background: #374151 !important; color: #f3f4f6 !important; }
        .fin-dropdown-menu { position: fixed; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05); min-width: 140px; display: flex; flex-direction: column; padding: 4px 0; }
        .fin-dropdown-item { padding: 8px 16px; font-size: 13px; color: #334155; background: transparent; border: none; text-align: left; width: 100%; cursor: pointer; }
        .fin-dropdown-item:hover { background: #f1f5f9; }
        .fin-btn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 7px; border: 1px solid #374151; background: #1f2937; color: #93c5fd; font-size: 12px; cursor: pointer; white-space: nowrap; }
        .fin-btn:hover { background: #374151; }
        .fin-btn:disabled { opacity: .5; cursor: not-allowed; }
        .fin-btn.danger { color: #fca5a5; border-color: #7f1d1d; }
      `}</style>

      {message.text && (
        <div style={{ flexShrink: 0, padding: '9px 14px', borderRadius: '8px', fontSize: '13px', background: message.type === 'error' ? '#7f1d1d' : '#065f46', color: message.type === 'error' ? '#fecaca' : '#a7f3d0' }}>
          {message.text}
        </div>
      )}

      <div style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', overflow: 'hidden' }}>
        {[
          { label: '訂單總額', value: formatMoney(stats.orderAmount), color: '#e5e7eb' },
          { label: '應收總額', value: formatMoney(stats.receivableAmount), color: '#93c5fd' },
          { label: '實收總額', value: formatMoney(stats.receivedAmount), color: '#6ee7b7' },
          { label: '欠款總額', value: formatMoney(stats.outstandingAmount), color: Number(stats.outstandingAmount) > 0 ? '#fca5a5' : '#9ca3af' },
          { label: '已開發票金額', value: formatMoney(stats.invoicedAmount), color: '#fcd34d' },
          { label: '訂單數', value: String(stats.orders || 0), color: '#e5e7eb' },
        ].map((card, index) => (
          <div key={card.label} style={{ minWidth: 0, padding: '14px 18px', borderLeft: index ? '1px solid #1f2937' : 'none' }}>
            <div style={{ color: '#9ca3af', fontSize: '12px', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.label}</div>
            <div title={card.value} style={{ color: card.color, fontSize: '20px', lineHeight: 1.1, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', padding: '14px 16px' }}>
        <input type="search" placeholder="搜尋訂單號或租戶" value={filters.search}
          onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))}
          style={{ ...inputStyle, width: '220px' }} />
        <select value={filters.tenantId} onChange={(e) => { setFilters((current) => ({ ...current, tenantId: e.target.value })); setPage(1); }} style={{ ...inputStyle, width: '190px', cursor: 'pointer' }}>
          <option value="">全部租戶</option>
          {tenantOptions.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
        </select>
        <select value={filters.paymentStatus} onChange={(e) => { setFilters((current) => ({ ...current, paymentStatus: e.target.value })); setPage(1); }} style={{ ...inputStyle, width: '140px', cursor: 'pointer' }}>
          <option value="all">全部收款狀態</option>
          <option value="unpaid">未收款</option>
          <option value="partial">部分收款</option>
          <option value="paid">已收清</option>
          <option value="overpaid">超收</option>
        </select>
        <select value={filters.invoiceStatus} onChange={(e) => { setFilters((current) => ({ ...current, invoiceStatus: e.target.value })); setPage(1); }} style={{ ...inputStyle, width: '140px', cursor: 'pointer' }}>
          <option value="all">全部發票狀態</option>
          <option value="invoiced">已開票</option>
          <option value="uninvoiced">未開票</option>
        </select>
        <button type="button" className="fin-btn" onClick={() => loadOrders({ silent: true })} disabled={refreshing} style={{ marginLeft: 'auto', height: '40px' }}>
          <RefreshCw size={14} /> {refreshing ? '刷新中...' : '刷新'}
        </button>
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', background: '#111827', border: '1px solid #1f2937', borderRadius: '12px', overflow: 'hidden' }}>
        <div className="fin-table-wrap" onScroll={() => setOpenMenuOrderId(null)}>
          <table className="fin-table">
            <thead>
              <tr>
                {['訂單號', '租戶', '類型', '訂單金額', '應收', '實收', '欠款', '發票金額', '付款筆數', '收款狀態', '操作'].map((label) => (
                  <th key={label} className={label === '操作' ? 'fin-sticky-action' : undefined}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="11" style={{ padding: '50px', textAlign: 'center', color: '#9ca3af' }}>載入中...</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan="11" style={{ padding: '50px', textAlign: 'center', color: '#6b7280' }}>暫無訂單</td></tr>
              ) : orders.map((order) => {
                const badge = paymentStateBadge(order.receivableAmount, order.receivedAmount);
                return (
                  <tr key={order.id}>
                    <td style={{ fontFamily: 'monospace' }}>{order.orderNo}</td>
                    <td title={order.tenantName}>{order.tenantName || '-'}</td>
                    <td>{order.orderType}</td>
                    <td style={{ fontFamily: 'monospace' }}>{formatMoney(order.orderAmount, order.currency)}</td>
                    <td style={{ fontFamily: 'monospace' }}>{formatMoney(order.receivableAmount, order.currency)}</td>
                    <td style={{ fontFamily: 'monospace', color: '#6ee7b7' }}>{formatMoney(order.receivedAmount, order.currency)}</td>
                    <td style={{ fontFamily: 'monospace', color: order.outstandingAmount > 0 ? '#fca5a5' : '#9ca3af' }}>{formatMoney(order.outstandingAmount, order.currency)}</td>
                    <td style={{ fontFamily: 'monospace', color: '#fcd34d' }}>{formatMoney(order.invoicedAmount, order.currency)}</td>
                    <td style={{ textAlign: 'center' }}>{order.paymentCount}</td>
                    <td><span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '999px', fontSize: '11px', background: badge.bg, color: badge.color }}>{badge.text}</span></td>
                    <td className="fin-sticky-action" style={{ textAlign: 'center' }}>
                      <div className="row-actions fin-dropdown-container" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button className="ghost-btn" type="button" style={{ fontSize: '13px', padding: '4px 8px' }} onClick={() => openPayments(order)}>收款記錄</button>
                        <button className="ghost-btn" type="button" style={{ fontSize: '13px', padding: '4px 8px' }} onClick={(event) => {
                          event.stopPropagation();
                          const rect = event.currentTarget.getBoundingClientRect();
                          setMenuPosition({ top: rect.bottom + 4, left: Math.max(12, rect.right - 140) });
                          setOpenMenuOrderId((current) => (current === order.id ? null : order.id));
                        }}>更多</button>
                        {openMenuOrderId === order.id && createPortal(
                          <div className="fin-dropdown-menu" style={{ top: menuPosition.top, left: menuPosition.left, zIndex: 2147483647 }}>
                            <button type="button" className="fin-dropdown-item" onClick={() => { openPayments(order); setOpenMenuOrderId(null); }}>收款記錄</button>
                            <button type="button" className="fin-dropdown-item" onClick={() => { openReceivable(order); setOpenMenuOrderId(null); }}>設定應收</button>
                          </div>,
                          document.body,
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid #1f2937' }}>
          <span style={{ color: '#9ca3af', fontSize: '12px' }}>共 {total} 筆訂單</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ height: '34px', padding: '0 10px', borderRadius: '6px', border: '1px solid #374151', background: '#1a2332', color: '#e5e7eb', fontSize: '12px' }}>
              {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size} 條/頁</option>)}
            </select>
            <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)} style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: safePage <= 1 ? '#4b5563' : '#9ca3af', cursor: safePage <= 1 ? 'default' : 'pointer' }}>‹</button>
            <span style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #3b82f6', background: '#1e3a5f', color: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}>{safePage}</span>
            <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)} style={{ width: '34px', height: '34px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: safePage >= totalPages ? '#4b5563' : '#9ca3af', cursor: safePage >= totalPages ? 'default' : 'pointer' }}>›</button>
          </div>
        </div>
      </div>

      {receivableModalOrder && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={() => setReceivableModalOrder(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)' }} />
          <div style={{ position: 'relative', width: 'min(440px, 92vw)', background: '#111827', border: '1px solid #374151', borderRadius: '14px', padding: '20px 22px' }}>
            <h3 style={{ margin: '0 0 6px', color: '#e5e7eb', fontSize: '16px' }}>設定應收金額</h3>
            <p style={{ margin: '0 0 14px', color: '#9ca3af', fontSize: '12px' }}>
              {receivableModalOrder.orderNo} · {receivableModalOrder.tenantName} · 訂單金額 {formatMoney(receivableModalOrder.orderAmount, receivableModalOrder.currency)}
            </p>
            <label style={labelStyle}>
              應收金額
              <input type="number" min="0" step="0.01" value={receivableValue} onChange={(e) => setReceivableValue(e.target.value)} style={inputStyle} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
              <button type="button" className="fin-btn" onClick={() => setReceivableModalOrder(null)} disabled={savingReceivable}>取消</button>
              <button type="button" className="fin-btn" onClick={saveReceivable} disabled={savingReceivable} style={{ background: '#2563eb', borderColor: '#2563eb', color: '#fff' }}>{savingReceivable ? '儲存中...' : '儲存'}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {paymentModalOrder && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={closePayments} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)' }} />
          <div style={{ position: 'relative', width: 'min(980px, 95vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: '#111827', border: '1px solid #374151', borderRadius: '14px', overflow: 'hidden' }}>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', borderBottom: '1px solid #1f2937' }}>
              <div>
                <h3 style={{ margin: 0, color: '#e5e7eb', fontSize: '16px' }}>收款記錄 · {paymentModalOrder.orderNo}</h3>
                <p style={{ margin: '4px 0 0', color: '#9ca3af', fontSize: '12px' }}>
                  {paymentModalOrder.tenantName} · 訂單金額 {formatMoney(paymentModalOrder.orderAmount, paymentModalOrder.currency)} · 應收 {formatMoney(paymentModalOrder.receivableAmount, paymentModalOrder.currency)}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="fin-btn" onClick={startCreatePayment}><Plus size={13} /> 新增收款</button>
                <button type="button" className="fin-btn" onClick={closePayments} disabled={savingPayment}>關閉</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 22px', scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
              {paymentStats && (
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '14px', color: '#9ca3af', fontSize: '12px' }}>
                  <span>實收：<strong style={{ color: '#6ee7b7' }}>{formatMoney(paymentStats.receivedAmount, paymentModalOrder.currency)}</strong></span>
                  <span>欠款：<strong style={{ color: Number(paymentStats.outstandingAmount) > 0 ? '#fca5a5' : '#9ca3af' }}>{formatMoney(paymentStats.outstandingAmount, paymentModalOrder.currency)}</strong></span>
                  <span>已開發票：<strong style={{ color: '#fcd34d' }}>{formatMoney(paymentStats.invoicedAmount, paymentModalOrder.currency)}</strong></span>
                </div>
              )}

              {paymentLoading ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#9ca3af' }}>載入中...</div>
              ) : payments.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#6b7280', fontSize: '13px' }}>暫無收款記錄</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="fin-table" style={{ minWidth: '900px' }}>
                    <thead>
                      <tr>{['收款日期', '收款帳號', '金額', '憑證號', '憑證', '發票', '發票金額', '操作'].map((label) => <th key={label}>{label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {payments.map((payment) => (
                        <tr key={payment.id}>
                          <td>{payment.paymentDate || '-'}</td>
                          <td>{payment.receivingAccountName || '-'}<div style={{ color: '#6b7280', fontSize: '11px' }}>{payment.receivingBankName} {payment.receivingAccountNo}</div></td>
                          <td style={{ fontFamily: 'monospace', color: '#6ee7b7' }}>{formatMoney(payment.amount, payment.currency)}</td>
                          <td>{payment.voucherNo || '-'}</td>
                          <td>{payment.voucherFile ? <a href={fileUrl(payment.voucherFile)} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>查看</a> : '-'}</td>
                          <td>{payment.invoiced ? `${payment.invoiceNo || '已開票'}${payment.invoiceCode ? ` / ${payment.invoiceCode}` : ''}` : '未開票'}</td>
                          <td style={{ fontFamily: 'monospace' }}>{payment.invoiced ? formatMoney(payment.invoiceAmount || 0, payment.currency) : '-'}</td>
                          <td>
                            <button type="button" className="fin-btn" onClick={() => startEditPayment(payment)}><Pencil size={12} /> 編輯</button>
                            <button type="button" className="fin-btn danger" onClick={() => deletePayment(payment)} disabled={deletingPaymentId === payment.id} style={{ marginLeft: '6px' }}>
                              <Trash2 size={12} /> {deletingPaymentId === payment.id ? '刪除中...' : '刪除'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {paymentFormOpen && (
                <div style={{ marginTop: '18px', borderTop: '1px solid #1f2937', paddingTop: '16px' }}>
                  <h4 style={{ margin: '0 0 12px', color: '#e5e7eb', fontSize: '14px' }}>{editingPaymentId ? '編輯收款記錄' : '新增收款記錄'}</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                    <label style={labelStyle}>收款日期 *<input type="date" value={paymentForm.paymentDate} onChange={(e) => setPaymentForm((c) => ({ ...c, paymentDate: e.target.value }))} style={inputStyle} /></label>
                    <label style={labelStyle}>收款金額 *<input type="number" min="0" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm((c) => ({ ...c, amount: e.target.value }))} style={inputStyle} /></label>
                    <label style={labelStyle}>收款帳號（基礎資料）
                      <select value={paymentForm.receivingAccountId} onChange={(e) => handleAccountChange(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="">自訂 / 不選擇</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>{account.displayName || account.payeeName || account.bankAccountNo}{account.bankName ? ` · ${account.bankName}` : ''}</option>
                        ))}
                      </select>
                    </label>
                    <label style={labelStyle}>收款帳戶名稱<input value={paymentForm.receivingAccountName} onChange={(e) => setPaymentForm((c) => ({ ...c, receivingAccountName: e.target.value }))} style={inputStyle} /></label>
                    <label style={labelStyle}>收款銀行<input value={paymentForm.receivingBankName} onChange={(e) => setPaymentForm((c) => ({ ...c, receivingBankName: e.target.value }))} style={inputStyle} /></label>
                    <label style={labelStyle}>收款帳號<input value={paymentForm.receivingAccountNo} onChange={(e) => setPaymentForm((c) => ({ ...c, receivingAccountNo: e.target.value }))} style={inputStyle} /></label>
                    <label style={labelStyle}>憑證號<input value={paymentForm.voucherNo} onChange={(e) => setPaymentForm((c) => ({ ...c, voucherNo: e.target.value }))} style={inputStyle} /></label>
                    <label style={labelStyle}>憑證上傳（PNG/JPG/WEBP/PDF）
                      <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => handleFile(e.target.files?.[0], 'voucher')} style={{ ...inputStyle, paddingTop: '9px', height: '40px' }} />
                      {(paymentForm.voucherFileName || paymentForm.existingVoucherFile) && (
                        <span style={{ color: '#60a5fa', fontSize: '11px' }}>
                          {paymentForm.voucherFileName || (paymentForm.existingVoucherFile ? <a href={fileUrl(paymentForm.existingVoucherFile)} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>現有憑證</a> : '')}
                        </span>
                      )}
                    </label>
                    <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: '8px', paddingTop: '22px' }}>
                      <input type="checkbox" checked={paymentForm.invoiced} onChange={(e) => setPaymentForm((c) => ({ ...c, invoiced: e.target.checked }))} style={{ accentColor: '#3b82f6' }} />
                      已開具發票
                    </label>
                    {paymentForm.invoiced && (
                      <>
                        <label style={labelStyle}>發票號碼<input value={paymentForm.invoiceNo} onChange={(e) => setPaymentForm((c) => ({ ...c, invoiceNo: e.target.value }))} style={inputStyle} /></label>
                        <label style={labelStyle}>發票代碼<input value={paymentForm.invoiceCode} onChange={(e) => setPaymentForm((c) => ({ ...c, invoiceCode: e.target.value }))} style={inputStyle} /></label>
                        <label style={labelStyle}>開具日期<input type="date" value={paymentForm.invoiceDate} onChange={(e) => setPaymentForm((c) => ({ ...c, invoiceDate: e.target.value }))} style={inputStyle} /></label>
                        <label style={labelStyle}>發票金額<input type="number" min="0" step="0.01" value={paymentForm.invoiceAmount} onChange={(e) => setPaymentForm((c) => ({ ...c, invoiceAmount: e.target.value }))} style={inputStyle} /></label>
                        <label style={labelStyle}>發票上傳（PNG/JPG/WEBP/PDF）
                          <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => handleFile(e.target.files?.[0], 'invoice')} style={{ ...inputStyle, paddingTop: '9px', height: '40px' }} />
                          {(paymentForm.invoiceFileName || paymentForm.existingInvoiceFile) && (
                            <span style={{ color: '#60a5fa', fontSize: '11px' }}>
                              {paymentForm.invoiceFileName || (paymentForm.existingInvoiceFile ? <a href={fileUrl(paymentForm.existingInvoiceFile)} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>現有發票</a> : '')}
                            </span>
                          )}
                        </label>
                      </>
                    )}
                    <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>備註<textarea value={paymentForm.notes} onChange={(e) => setPaymentForm((c) => ({ ...c, notes: e.target.value }))} rows={2} style={{ ...inputStyle, height: 'auto', padding: '10px 12px', resize: 'vertical' }} /></label>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' }}>
                    <button type="button" className="fin-btn" onClick={() => { setPaymentFormOpen(false); setEditingPaymentId(null); }} disabled={savingPayment}>取消</button>
                    <button type="button" className="fin-btn" onClick={savePayment} disabled={savingPayment} style={{ background: '#2563eb', borderColor: '#2563eb', color: '#fff' }}>{savingPayment ? '儲存中...' : '儲存收款記錄'}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
