import React, { lazy, Suspense, useState, useEffect } from 'react';
import LandingRedesign from './LandingRedesign';
import apiClient from './apiClient';

const ConsoleLayout = lazy(() => import('./ConsoleLayout'));
const ECardVisitorPage = lazy(() => import('./pages/ecard/ECardVisitorPage'));

const lazyFallback = (
  <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', color: '#94a3b8', background: '#0b1220' }}>
    載入中...
  </div>
);

class LazyLoadBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('頁面資源載入失敗:', error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', background: '#0b1220', color: '#cbd5e1' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: '0 0 12px', fontSize: '14px' }}>頁面資源載入失敗，可能是網路中斷。</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ height: '38px', padding: '0 18px', border: 0, borderRadius: '8px', background: '#2563eb', color: '#fff', cursor: 'pointer' }}
            >
              重新載入
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function consumeHandoffToken() {
  try {
    const token = localStorage.getItem('qrtalkieHandoffToken');
    const expiresAt = Number(localStorage.getItem('qrtalkieHandoffExpiresAt') || 0);
    if (token && (!expiresAt || Date.now() <= expiresAt)) {
      sessionStorage.setItem('qrtalkieAdminToken', token);
      const userType = localStorage.getItem('qrtalkieHandoffUserType');
      if (userType) sessionStorage.setItem('qrtalkieUserType', userType);
    }
    localStorage.removeItem('qrtalkieHandoffToken');
    localStorage.removeItem('qrtalkieHandoffUserType');
    localStorage.removeItem('qrtalkieHandoffExpiresAt');
  } catch {
    // Storage can be unavailable in private/restricted contexts; normal login still works.
  }
}

function getPublicEcardSlug(pathname, search) {
  const path = String(pathname || '');
  const match = path.match(/^\/u\/([^/?#]+)/);
  if (match?.[1]) return decodeURIComponent(match[1]);

  const legacyMatch = path.match(/^\/ecard\/([^/?#]+)/);
  if (legacyMatch?.[1]) return decodeURIComponent(legacyMatch[1]);

  if (path === '/ecard') {
    const params = new URLSearchParams(String(search || ''));
    const id = params.get('id');
    if (id) return id.trim();
  }
  return '';
}

export default function App() {
  // 模擬登入狀態。後續可以改用 AuthContext 或 React Router 來管理
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // 新增 isInitializing 狀態，避免在檢查 Token 時畫面閃爍
  const [isInitializing, setIsInitializing] = useState(true);
  const [routeInfo, setRouteInfo] = useState(() => ({
    slug: getPublicEcardSlug(window.location.pathname, window.location.search),
    pathname: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    async function checkAutoLogin() {
      if (getPublicEcardSlug(window.location.pathname, window.location.search)) {
        setIsInitializing(false);
        return;
      }

      const params = new URLSearchParams(window.location.search);
      if (params.get('resetPasswordToken')) {
        setIsInitializing(false);
        return;
      }

      consumeHandoffToken();

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

  useEffect(() => {
    const handlePopState = () => {
      setRouteInfo({
        slug: getPublicEcardSlug(window.location.pathname, window.location.search),
        pathname: window.location.pathname,
        search: window.location.search,
      });
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('pushstate', handlePopState);
    window.addEventListener('replacestate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('pushstate', handlePopState);
      window.removeEventListener('replacestate', handlePopState);
    };
  }, []);

  const publicEcardSlug = routeInfo.slug;

  if (publicEcardSlug) {
    return (
      <LazyLoadBoundary>
        <Suspense fallback={lazyFallback}><ECardVisitorPage slug={publicEcardSlug} /></Suspense>
      </LazyLoadBoundary>
    );
  }

  if (isInitializing) {
    // 在驗證 API 回應前，您可以渲染一個全畫面 Loading，或保留空白
    return <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', color: '#666' }}>載入中...</div>;
  }

  return (
    <div className="app-container">
      {isLoggedIn ? (
        <LazyLoadBoundary>
          <Suspense fallback={lazyFallback}>
            <ConsoleLayout onLogout={() => {
              localStorage.removeItem('qrtalkieAdminToken');
              localStorage.removeItem('qrtalkieUserType');
              sessionStorage.removeItem('qrtalkieAdminToken');
              sessionStorage.removeItem('qrtalkieUserType');
              setIsLoggedIn(false);
            }} />
          </Suspense>
        </LazyLoadBoundary>
      ) : (
        <LandingRedesign />
      )}
    </div>
  );
}
