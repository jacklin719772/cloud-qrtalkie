import React, { useState, useEffect } from 'react';
import Landing from '../Landing';
import ConsoleLayout from './ConsoleLayout';
import apiClient from './apiClient';

export default function App() {
  // 模擬登入狀態。後續可以改用 AuthContext 或 React Router 來管理
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // 新增 isInitializing 狀態，避免在檢查 Token 時畫面閃爍
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    async function checkAutoLogin() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('resetPasswordToken')) {
        setIsInitializing(false);
        return;
      }

      const token = localStorage.getItem('qrtalkieAdminToken') || sessionStorage.getItem('qrtalkieAdminToken');
      
      // 如果沒有 Token，直接結束載入狀態並停留在登入頁
      if (!token) {
        setIsInitializing(false);
        return;
      }

      try {
        // 呼叫 /me 驗證 Token 是否有效，apiClient 會自動帶上 Token
        await apiClient.get('/me');
        setIsLoggedIn(true); // Token 有效，自動登入
      } catch (error) {
        console.error('自動登入檢查失敗:', error);
        // 若為 401，apiClient 的攔截器已經處理了清除 Token 的邏輯
      } finally {
        setIsInitializing(false); // 檢查完畢，關閉載入狀態
      }
    }

    checkAutoLogin();
  }, []);

  if (isInitializing) {
    // 在驗證 API 回應前，您可以渲染一個全畫面 Loading，或保留空白
    return <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', color: '#666' }}>載入中...</div>;
  }

  return (
    <div className="app-container">
      {isLoggedIn ? (
        <ConsoleLayout onLogout={() => {
          localStorage.removeItem('qrtalkieAdminToken');
          localStorage.removeItem('qrtalkieUserType');
          sessionStorage.removeItem('qrtalkieAdminToken');
          sessionStorage.removeItem('qrtalkieUserType');
          setIsLoggedIn(false);
        }} />
      ) : (
        <Landing onLogin={() => setIsLoggedIn(true)} />
      )}
    </div>
  );
}
