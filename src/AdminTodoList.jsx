import React, { useState, useEffect, useCallback } from 'react';
import { ClipboardList, ExternalLink } from 'lucide-react';
import apiClient from './apiClient';

const PLATFORM_TASKS = [
  { id: 'platform_admin', label: '設置平台管理員', view: 'platform-admin-management', api: '/platform/admins', key: 'admins' },
  { id: 'privacy_policy', label: '設置隱私政策', view: 'privacy-policy', api: '/admin/settings/privacy-policy', key: 'content' },
  { id: 'terms_of_service', label: '設置服務條款', view: 'terms-of-service', api: '/admin/settings/terms-of-service', key: 'content' },
  { id: 'ecard_styles', label: '設置電子名片樣式', view: 'ecard-styles-management', api: '/admin/ecard-styles', key: 'styles' },
  { id: 'offline_account', label: '設置收款賬戶', view: 'offline-account', api: '/billing/offline-payment-account', key: 'account' },
  { id: 'payment_methods', label: '設置線上支付方式', view: 'payment-methods', api: '/billing/payment-method-settings', key: 'methods' },
  { id: 'discount_data', label: '設置折扣資料', view: 'discount-data', api: '/billing/coupon-settings', key: 'coupons' },
  { id: 'addon_services', label: '設置增值服務', view: 'addons', api: '/billing/addon-services', key: 'addons' },
  { id: 'plans', label: '設置套餐資料', view: 'plans', api: '/billing/plans', key: 'plans' },
  { id: 'devices', label: '設置門控設備', view: 'device-management', api: '/admin/gate-devices', key: 'devices' },
  { id: 'sip_accounts', label: '添加 SIP 帳號', view: 'sip-account-registration', api: '/admin/sip-accounts', key: 'accounts' },
  { id: 'web_accounts', label: '添加 Web 帳號', view: 'sip-account-allocation', api: '/admin/web-accounts', key: 'accounts' },
  { id: 'pending_subscriptions', label: '審核待訂閱套餐', view: 'plan-management', api: '/admin/billing-orders?status=pending_review', key: 'orders' },
];

const TENANT_TASKS = [
  { id: 'has_subscription', label: '是否有已生效套餐', view: 'purchase-plan', api: '/billing/orders', key: 'orders', check: 'subscription' },
  { id: 'pending_review_order', label: '是否有訂單待提交審核', view: 'purchase-plan', api: '/billing/orders', key: 'orders', check: 'pending_review' },
  { id: 'contact_books', label: '是否已建立通訊錄', view: 'contact-books', api: '/contact-books', key: 'contactBooks' },
  { id: 'ecards', label: '是否已創建電子名片', view: 'e-business-card', api: '/tenant/ecard-accounts', key: 'accounts' },
  { id: 'call_center', label: '是否已設置呼叫中心', view: 'call-center', api: '/call-centers', key: 'list' },
];

export default function AdminTodoList({ isOpen, onClose, onNavigate, role }) {
  const TASKS = role === 'platform' ? PLATFORM_TASKS : TENANT_TASKS;
  const [tasks, setTasks] = useState(() => TASKS.map(t => ({ ...t, done: false, checking: true })));
  const [autoShow, setAutoShow] = useState(() => {
    return localStorage.getItem('qrtalkie_todo_autoshow') !== 'false';
  });

  const checkTask = useCallback(async (task) => {
    try {
      const result = await apiClient.get(task.api);
      let val = result?.[task.key];

      // 呼叫中心响应格式: { code: 0, data: { list: [...] } }
      if (task.id === 'call_center') {
        val = result?.data?.list;
      }

      if (val === undefined || val === null) return false;
      if (typeof val === 'string') return val.length > 0;
      if (Array.isArray(val)) {
        // 平台：待审核订阅
        if (task.id === 'pending_subscriptions') {
          return val.filter(s => s.status === 'pending_review' || s.order_status === 'pending_review' || s.orderStatus === 'pending_review').length > 0;
        }
        // 租户：是否有已生效套餐（审核通过）
        if (task.check === 'subscription') {
          return val.filter(o => o.orderStatus === 'review_approved').length > 0;
        }
        // 租户：待提交审核（有未提交/未完成的订单）
        if (task.check === 'pending_review') {
          return val.filter(o => !['review_approved', 'review_rejected', 'cancelled'].includes(o.orderStatus)).length > 0;
        }
        return val.length > 0;
      }
      if (typeof val === 'object') {
        if (task.id === 'offline_account') return !!(val.bankName || val.accountName || val.id);
        return Object.keys(val).length > 0;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    // 每次打开都重新检查所有任务
    setTasks(TASKS.map(t => ({ ...t, done: false, checking: true })));
    let cancelled = false;
    const run = async () => {
      const updated = await Promise.all(
        TASKS.map(async (t) => {
          const done = await checkTask(t);
          return { ...t, done, checking: false };
        })
      );
      if (!cancelled) {
        setTasks(updated);
        // 只缓存 done 状态，不缓存 checking（每次打开都重新检查）
        const cached = updated.map(({ checking, ...rest }) => rest);
        localStorage.setItem('qrtalkie_todo_tasks', JSON.stringify(cached));
      }
    };
    run();
    return () => { cancelled = true; };
  }, [isOpen, role]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAutoShow = () => {
    const next = !autoShow;
    setAutoShow(next);
    localStorage.setItem('qrtalkie_todo_autoshow', String(next));
  };

  const doneCount = tasks.filter(t => t.done).length;
  const totalCount = tasks.length;
  const progressPercent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999999,
      background: 'rgba(0,0,0,0.5)', display: 'flex',
      alignItems: 'flex-start', justifyContent: 'flex-end',
      paddingTop: '60px', paddingRight: '24px',
    }} onClick={onClose}>
      <div style={{
        width: '420px', maxWidth: '90vw', maxHeight: '80vh',
        background: '#111827', borderRadius: '10px',
        border: '1px solid #1f2937',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          flexShrink: 0, padding: '18px 20px',
          borderBottom: '1px solid #1f2937',
          backgroundColor: '#1a2332',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ClipboardList size={20} color="#60a5fa" />
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>
              {role === 'platform' ? '平台初始化待辦清單' : '租戶待辦清單'}
            </h3>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#9ca3af',
            cursor: 'pointer', fontSize: '18px', lineHeight: 1,
          }}>&#10005;</button>
        </div>

        {/* Progress bar */}
        <div style={{ flexShrink: 0, padding: '14px 20px', borderBottom: '1px solid #1f2937' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ color: '#9ca3af', fontSize: '12px' }}>完成進度</span>
            <span style={{ color: '#60a5fa', fontSize: '12px', fontWeight: 600 }}>{doneCount}/{totalCount} ({progressPercent}%)</span>
          </div>
          <div style={{ height: '4px', background: '#1f2937', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${progressPercent}%`,
              background: progressPercent === 100 ? '#22c55e' : '#3b82f6',
              borderRadius: '2px', transition: 'width 0.5s ease',
            }} />
          </div>
        </div>

        {/* Task list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {tasks.map((task) => (
            <div key={task.id} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 12px', borderRadius: '6px',
              borderBottom: '1px solid #1f2937',
              transition: 'background 0.2s',
            }}>
              {/* Check indicator */}
              <div style={{
                width: '20px', height: '20px', borderRadius: '50%',
                flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: task.checking ? '#1f2937' : (task.done ? '#065f46' : '#1f2937'),
                border: `2px solid ${task.checking ? '#374151' : (task.done ? '#22c55e' : '#4b5563')}`,
                color: task.done ? '#22c55e' : '#6b7280',
                fontSize: '12px', fontWeight: 700,
              }}>
                {task.checking ? (
                  <span style={{ fontSize: '10px', color: '#6b7280' }}>···</span>
                ) : task.done ? '✓' : ''}
              </div>

              {/* Task label */}
              <span style={{
                flex: 1, fontSize: '13px',
                color: task.done ? '#6b7280' : '#d1d5db',
                textDecoration: task.done ? 'line-through' : 'none',
              }}>
                {task.label}
              </span>

              {/* Navigate button */}
              <button
                type="button"
                onClick={() => { onNavigate?.(task.view); onClose?.(); }}
                title={task.done ? '查看' : '前往設定'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  padding: '5px 12px', borderRadius: '5px',
                  backgroundColor: task.done ? '#1a2332' : '#1d4ed8',
                  color: task.done ? '#6b7280' : '#e5e7eb',
                  border: task.done ? '1px solid #374151' : 'none',
                  fontSize: '11px', fontWeight: 500, cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}>
                <ExternalLink size={12} />
                {task.done ? '查看' : '前往'}
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          flexShrink: 0, padding: '12px 20px',
          borderTop: '1px solid #1f2937',
          backgroundColor: '#1a2332',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoShow}
              onChange={toggleAutoShow}
              style={{ accentColor: '#3b82f6', width: '14px', height: '14px' }}
            />
            <span style={{ color: '#9ca3af', fontSize: '12px' }}>登入時自動顯示</span>
          </label>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 16px', borderRadius: '5px',
              backgroundColor: '#1f2937', color: '#d1d5db',
              border: '1px solid #374151', fontSize: '12px', cursor: 'pointer',
            }}>
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
