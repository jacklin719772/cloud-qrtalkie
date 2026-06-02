import React, { useState, useEffect, useRef } from 'react';
import apiClient from './src/apiClient';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export default function Landing({ onLogin }) {
  // 使用 React State 控制目前顯示的表單模式：'login', 'signup', 或 'forgot'
  const initialResetToken = new URLSearchParams(window.location.search).get('resetPasswordToken') || '';
  const [authMode, setAuthMode] = useState(initialResetToken ? 'reset' : 'login');
  const [resetToken, setResetToken] = useState(initialResetToken);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  
  // 新增：法律條款彈窗狀態
  const [legalModal, setLegalModal] = useState({
    isOpen: false,
    title: '',
    content: '',
    isLoading: false
  });
  const messageTimerRef = useRef(null);
  const [loadingPhase, setLoadingPhase] = useState('show'); // 'show' | 'fade' | 'done'

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) {
        clearTimeout(messageTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setLoadingPhase('fade'), 2600);
    const removeTimer = setTimeout(() => setLoadingPhase('done'), 3200);
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); };
  }, []);

  const clearMessages = () => {
    setErrorMessage('');
    setSuccessMessage('');
    if (messageTimerRef.current) {
      clearTimeout(messageTimerRef.current);
      messageTimerRef.current = null;
    }
  };

  const showTimedError = (message) => {
    setErrorMessage(message);
    setSuccessMessage('');
    if (messageTimerRef.current) {
      clearTimeout(messageTimerRef.current);
    }
    messageTimerRef.current = setTimeout(() => {
      setErrorMessage('');
      messageTimerRef.current = null;
    }, 5000);
  };

  const showTimedSuccess = (message) => {
    setSuccessMessage(message);
    setErrorMessage('');
    if (messageTimerRef.current) {
      clearTimeout(messageTimerRef.current);
    }
    messageTimerRef.current = setTimeout(() => {
      setSuccessMessage('');
      messageTimerRef.current = null;
    }, 5000);
  };

  const isValidEmail = (value) => {
    if (!value || typeof value !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  };

  // 切換表單模式時，清空所有的錯誤或成功提示
  const changeMode = (mode) => {
    setAuthMode(mode);
    clearMessages();
    if (mode !== 'reset') {
      setResetToken('');
      if (new URLSearchParams(window.location.search).get('resetPasswordToken')) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  };

  // 處理登入送出
  const handleLogin = async (e) => {
    e.preventDefault(); // 阻止表單預設的網頁重整行為
    clearMessages();

    const formData = new FormData(e.target);
    const username = formData.get('username')?.toString().trim();
    const password = formData.get('password')?.toString();
    const rememberMe = formData.get('rememberMe') === 'on';

    if (!username) {
      showTimedError('請輸入登入帳號。');
      return;
    }
    if (!password) {
      showTimedError('請輸入密碼。');
      return;
    }

    setIsLoading(true);
    try {
      const result = await apiClient.post('/auth/login', { username, password });
      const primaryStorage = rememberMe ? localStorage : sessionStorage;
      const secondaryStorage = rememberMe ? sessionStorage : localStorage;
      primaryStorage.setItem('qrtalkieAdminToken', result.token);
      secondaryStorage.removeItem('qrtalkieAdminToken');
      // Store userType for UI differentiation
      if (result.userType) {
        primaryStorage.setItem('qrtalkieUserType', result.userType);
        secondaryStorage.removeItem('qrtalkieUserType');
      }
      onLogin();
    } catch (error) {
      // 优先获取后端返回的自定义错误信息，防止显示默认的 HTTP 状态报错
      const serverMessage = error.response?.data?.message || error.message;
      showTimedError(serverMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // 處理註冊送出
  const handleSignup = async (e) => {
    e.preventDefault();
    clearMessages();

    const formData = new FormData(e.target);
    const companyName = formData.get('companyName')?.toString().trim();
    const email = formData.get('email')?.toString().trim();
    const password = formData.get('password')?.toString();
    const confirmPassword = formData.get('confirmPassword')?.toString();
    const acceptedTerms = formData.get('termsConsent') === 'on';

    if (!companyName) {
      showTimedError('請輸入公司名稱。');
      return;
    }
    if (!email) {
      showTimedError('請輸入管理員信箱。');
      return;
    }
    if (!isValidEmail(email)) {
      showTimedError('請輸入有效的郵件格式。');
      return;
    }
    if (!password) {
      showTimedError('請輸入密碼。');
      return;
    }
    if (password.length < 8) {
      showTimedError('密碼至少需要 8 位字元。');
      return;
    }
    if (!confirmPassword) {
      showTimedError('請再次輸入密碼。');
      return;
    }
    if (password !== confirmPassword) {
      showTimedError('兩次輸入的密碼不一致。');
      return;
    }
    if (!acceptedTerms) {
      showTimedError('請先閱讀並同意服務條款與隱私政策。');
      return;
    }

    setIsLoading(true);
    try {
      const result = await apiClient.post('/auth/register', { companyName, email, password, confirmPassword });
      showTimedSuccess(result.message || '註冊成功，請前往信箱完成驗證。');
      e.target.reset();
    } catch (error) {
      const serverMessage = error.response?.data?.message || error.message;
      showTimedError(serverMessage || '註冊失敗，請使用系統內未註冊的電子郵件或稍後再試。');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    clearMessages();

    const formData = new FormData(e.target);
    const email = formData.get('email')?.toString().trim();

    if (!email) {
      showTimedError('請輸入管理員信箱。');
      return;
    }
    if (!isValidEmail(email)) {
      showTimedError('請輸入有效的郵件格式。');
      return;
    }

    setIsLoading(true);
    try {
      const result = await apiClient.post('/auth/forgot-password', { email });
      showTimedSuccess(result.message || '已發送密碼重設連結，請檢查您的郵箱。');
      e.target.reset();
    } catch (error) {
      const serverMessage = error.response?.data?.message || error.message;
      showTimedError(serverMessage || '無法發送重置郵件，請稍後再試。');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    clearMessages();

    const formData = new FormData(e.target);
    const password = formData.get('password')?.toString() || '';
    const confirmPassword = formData.get('confirmPassword')?.toString() || '';

    if (!resetToken) {
      showTimedError('重置連結無效，請重新申請。');
      return;
    }
    if (password.length < 8) {
      showTimedError('密碼至少需要 8 位字元。');
      return;
    }
    if (password !== confirmPassword) {
      showTimedError('兩次輸入的密碼不一致。');
      return;
    }

    setIsLoading(true);
    try {
      const result = await apiClient.post('/auth/reset-password', { token: resetToken, password, confirmPassword });
      setResetToken('');
      window.history.replaceState({}, document.title, window.location.pathname);
      setAuthMode('login');
      showTimedSuccess(result.message || '密碼已重置，請使用新密碼登入。');
      e.target.reset();
    } catch (error) {
      const serverMessage = error.response?.data?.message || error.message;
      showTimedError(serverMessage || '無法重置密碼，請稍後再試。');
    } finally {
      setIsLoading(false);
    }
  };

  // 動態拉取隱私政策/服務條款
  const handleOpenLegal = async (type) => {
    const title = type === 'privacy' ? '隱私權政策' : '會員服務條款';
    // 注意：這裡假設後端提供了一個免登入的 /public API，請根據實際後端路由調整
    const endpoint = type === 'privacy' ? '/public/settings/privacy-policy' : '/public/settings/terms-of-service';
    
    setLegalModal({ isOpen: true, title, content: '', isLoading: true });
    try {
      const data = await apiClient.get(endpoint);
      setLegalModal({ 
        isOpen: true, 
        title, 
        content: data?.content || '暫無內容，請聯絡管理員。', 
        isLoading: false 
      });
    } catch (error) {
      setLegalModal({ isOpen: true, title, content: '內容載入失敗，請稍後再試。', isLoading: false });
    }
  };

  const homePageUrl = import.meta.env.VITE_HOME_PAGE_URL || 'https://www.qrtalkie.org';

  return (
    <section className="landing" id="landing">
      {loadingPhase !== 'done' && (
        <div className={`landing-loader${loadingPhase === 'fade' ? ' landing-loader--fade' : ''}`}>
          <img src="/assets/landing-animation.gif" alt="載入中..." onError={(e) => { e.target.style.display = 'none'; }} />
          <p className="landing-loader-title">Cloud QRTalkie</p>
        </div>
      )}
      <header className="landing-nav">
        <div className="brand">
          <span className="brand-mark">
            <a href={homePageUrl} target="_blank" rel="noreferrer">
              <img src="/assets/qrtalkie-logo.svg" alt="QRTalkie Cloud" />
            </a>
          </span>
          <strong>QRTalkie Cloud</strong>
        </div>
      </header>

      <main className="hero">
        <div className="hero-copy">
          <p className="hero-badge">企業級即時通訊雲平台</p>
          <h1>
            私密型企業專屬
            <span className="gradient">即時通訊系統</span>
          </h1>
          <div className="hero-features" aria-label="核心優勢">
            <span className="point shield">安全</span>
            <span className="point flash">高效</span>
            <span className="point globe">跨終端適配</span>
          </div>
          <p>
            面向 VoIP、軟電話和 WebRTC 場景，提供租戶註冊、SIP 帳號開通、線上狀態查詢、註冊日誌、問題回饋等自助服務。
          </p>
        </div>

        <div className="product-visual" aria-hidden="true">
          <div className="phone-mock">
            <div className="mock-brand"><img src="/assets/qrtalkie-logo.svg" alt="" />QRTalkie</div>
            <div className="mock-search"></div>
            <div className="mock-tabs"><span></span><span></span><span></span></div>
            <div className="mock-list"><i></i><i></i><i></i><i></i></div>
          </div>
          <div className="chat-bubble bubble-main"><span></span><span></span><span></span></div>
          <div className="chat-bubble bubble-call"></div>
          <div className="message-lines"><span></span><span></span><span></span></div>
        </div>

        <div className="auth-panel" aria-label="帳號入口">
          <div className="auth-tabs" role="tablist">
            <button className={authMode === 'login' ? 'selected' : ''} onClick={() => changeMode('login')}>登入</button>
            <button className={authMode === 'signup' ? 'selected' : ''} onClick={() => changeMode('signup')}>註冊</button>
          </div>

          {authMode === 'login' && (
            <form className="auth-form active" id="login-form" onSubmit={handleLogin}>
              {/* 顯示錯誤或成功訊息 */}
              {errorMessage && <p className="form-message" style={{ color: '#d93025', marginBottom: '1rem' }}>{errorMessage}</p>}
              {successMessage && <p className="form-message" style={{ color: '#1e8e3e', marginBottom: '1rem' }}>{successMessage}</p>}
              
              {/* 加入 name 屬性與 required 驗證 */}
              <label>帳號<input name="username" type="text" placeholder="信箱或 SIP 帳號" required /></label>
              <label>密碼<input name="password" type="password" placeholder="請輸入密碼" required /></label>
              <div className="form-row">
                <label className="checkbox"><input name="rememberMe" type="checkbox" /> 記住我</label>
                <button type="button" className="link-btn" onClick={() => changeMode('forgot')}>忘記密碼？</button>
              </div>
              <button type="submit" className="primary-btn full" disabled={isLoading}>
                {isLoading ? '登入中...' : '登入'}
              </button>
            </form>
          )}

          {authMode === 'signup' && (
            <form className="auth-form active" id="signup-form" onSubmit={handleSignup}>
              <div className="auth-scroll">
                {errorMessage && <p className="form-message" style={{ color: '#d93025', marginBottom: '1rem' }}>{errorMessage}</p>}
                {successMessage && <p className="form-message" style={{ color: '#1e8e3e', marginBottom: '1rem' }}>{successMessage}</p>}
                <label>公司名稱<input name="companyName" placeholder="请输入公司全称或简称" required /></label>
                <label>管理員信箱<input name="email" type="email" placeholder="請輸入正確的郵箱地址" required /></label>
                <label>密碼<input name="password" type="password" placeholder="至少 8 位字元" required minLength={8} /></label>
                <label>確認密碼<input name="confirmPassword" type="password" placeholder="再次輸入密碼" required minLength={8} /></label>
              </div>
              <button type="submit" className="primary-btn full" disabled={isLoading}>
                {isLoading ? '註冊中...' : '註冊並驗證電子郵件'}
              </button>
              <label className="terms-consent">
                <input id="terms-consent" name="termsConsent" type="checkbox" required />
                <span>
                  我已閱讀並同意
                  <button type="button" className="text-link" onClick={() => handleOpenLegal('terms')}>會員服務條款</button>、
                  <button type="button" className="text-link" onClick={() => handleOpenLegal('privacy')}>隱私權政策</button>
                </span>
              </label>
            </form>
          )}

          {authMode === 'forgot' && (
            <form className="auth-form active" id="forgot-form" onSubmit={handleForgotPassword}>
              <h2>找回密碼</h2>
              <p className="muted">輸入管理員信箱，我們將發送密碼重設連結。</p>
              {errorMessage && <p className="form-message" style={{ color: '#d93025', marginBottom: '1rem' }}>{errorMessage}</p>}
              {successMessage && <p className="form-message" style={{ color: '#1e8e3e', marginBottom: '1rem' }}>{successMessage}</p>}
              <label>信箱<input name="email" type="email" placeholder="admin@company.com" required /></label>
              <button type="submit" className="primary-btn full" disabled={isLoading}>
                {isLoading ? '發送中...' : '發送重設郵件'}
              </button>
              <button type="button" className="link-btn center" onClick={() => changeMode('login')}>返回登入</button>
            </form>
          )}

          {authMode === 'reset' && (
            <form className="auth-form active" id="reset-password-form" onSubmit={handleResetPassword}>
              <h2>重置密碼</h2>
              <p className="muted">請設定新的管理員登入密碼。</p>
              {errorMessage && <p className="form-message" style={{ color: '#d93025', marginBottom: '1rem' }}>{errorMessage}</p>}
              {successMessage && <p className="form-message" style={{ color: '#1e8e3e', marginBottom: '1rem' }}>{successMessage}</p>}
              <label>新密碼<input name="password" type="password" placeholder="至少 8 位字元" required minLength={8} /></label>
              <label>確認新密碼<input name="confirmPassword" type="password" placeholder="再次輸入新密碼" required minLength={8} /></label>
              <button type="submit" className="primary-btn full" disabled={isLoading}>
                {isLoading ? '重置中...' : '重置密碼'}
              </button>
              <button type="button" className="link-btn center" onClick={() => changeMode('login')}>返回登入</button>
            </form>
          )}
        </div>
      </main>

      {/* 動態渲染的法律條款彈窗 */}
      {legalModal.isOpen && (
        <div className="modal-backdrop" onClick={() => setLegalModal({ ...legalModal, isOpen: false })}>
          <div className="dialog-card legal-card" onClick={e => e.stopPropagation()}>
            <div className="panel-head">
              <h2>{legalModal.title}</h2>
              <button className="icon-btn" type="button" title="關閉" onClick={() => setLegalModal({ ...legalModal, isOpen: false })}>x</button>
            </div>
            <div className="legal-content" style={{ padding: '16px 0' /* Removed lineHeight: '1.6' here, as it will be handled by .policy-markdown-preview */ }}>
              {legalModal.isLoading ? (
                <p style={{ color: '#64748b', textAlign: 'center' }}>內容載入中...</p>
              ) : (
                // 使用 ReactMarkdown 渲染 Markdown 内容
                <div className="policy-markdown-preview">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {legalModal.content || ''}
                  </ReactMarkdown>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button className="primary-btn" type="button" onClick={() => setLegalModal({ ...legalModal, isOpen: false })}>我知道了</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
