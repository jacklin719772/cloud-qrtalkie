import React, { useState } from 'react';
import { BarChart3 } from 'lucide-react';

const TABS = [
  { key: 'web', label: 'Web 帳號狀態' },
  { key: 'sip', label: 'SIP 帳號狀態' },
];

export default function Analytics() {
  const [activeTab, setActiveTab] = useState('web');

  return (
    <section className="view active" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#0f172a' }}>
      {/* Tab 栏 */}
      <div style={{ flexShrink: 0, display: 'flex', borderBottom: '1px solid #1f2937', background: '#111827', padding: '0 24px' }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '14px 24px',
              fontSize: '14px',
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? '#60a5fa' : '#9ca3af',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #3b82f6' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
        <BarChart3 size={48} color="#374151" style={{ marginBottom: '20px' }} />
        <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#e5e7eb', margin: '0 0 8px' }}>
          {activeTab === 'web' ? 'Web 帳號狀態分析' : 'SIP 帳號狀態分析'}
        </h3>
        <p style={{ fontSize: '13px', color: '#9ca3af', margin: 0, textAlign: 'center', maxWidth: '360px', lineHeight: 1.8 }}>
          {activeTab === 'web'
            ? 'WebRTC 帳號總數、在線狀態、使用率等統計數據即將推出。'
            : 'SIP 帳號分配率、啟用率、到期分佈等統計數據即將推出。'}
        </p>
      </div>
    </section>
  );
}
