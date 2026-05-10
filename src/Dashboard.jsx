import React, { useState, useEffect } from 'react';
import apiClient from './apiClient';

export default function Dashboard() {
  const [tenantData, setTenantData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        // 使用封裝好的 apiClient，完全不用管 Token 跟錯誤驗證
        const data = await apiClient.get('/me');
        setTenantData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }

    fetchDashboardData();
  }, []); // 傳入空陣列 []，代表這個 Effect 只會在元件初次渲染時執行一次

  return (
    <section className="view active" id="dashboard">
      <div className="metrics">
        {/* 將 API 獲取的 userLimit 動態綁定到畫面上。其他數據若 API 尚未提供，可先暫時保留假資料 */}
        <article className="metric"><span>SIP 使用者</span><strong>{isLoading ? '...' : '1,248'}</strong><small>方案上限 {tenantData?.tenant?.userLimit || 0}</small></article>
        <article className="metric"><span>線上註冊</span><strong>{isLoading ? '...' : '894'}</strong><small className="ok">成功率 99.2%</small></article>
        <article className="metric"><span>今日失敗</span><strong>{isLoading ? '...' : '37'}</strong><small className="warn">{error ? error : '多來自密碼錯誤'}</small></article>
        <article className="metric"><span>Flexisip 節點</span><strong>{isLoading ? '...' : '3/3'}</strong><small className="ok">全部健康</small></article>
      </div>
    </section>
  );
}