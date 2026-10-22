import React, { useState, useEffect, useRef } from 'react';
import apiClient from './src/apiClient';
import { useLandingI18nOptional } from './src/landing/i18n/LandingI18n.jsx';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export default function Landing({ onLogin, embedded = false, onTrialUnavailable }) {
  const { t } = useLandingI18nOptional();
  // 使用 React State 控制目前顯示的表單模式：'login', 'signup', 或 'forgot'
  const initialResetToken = new URLSearchParams(window.location.search).get('resetPasswordToken') || '';
  const [authMode, setAuthMode] = useState(initialResetToken ? 'reset' : 'login');
  const [resetToken, setResetToken] = useState(initialResetToken);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [registeredEmail, setRegisteredEmail] = useState(''); // 記住註冊信箱用於重發驗證
  const [trialSignupEnabled, setTrialSignupEnabled] = useState(true); // 後台控制「申請試用」開關（缺省開放）

  // 拉取試用申請開關（公開接口；讀取失敗 fail-open，仍由服務端兜底）
  useEffect(() => {
    let cancelled = false;
    apiClient.get('/public/settings/trial-signup')
      .then((data) => { if (!cancelled) setTrialSignupEnabled(data?.enabled !== false); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // 開關關閉時：若正停留在試用申請表單，切回登入
  useEffect(() => {
    if (!trialSignupEnabled && authMode === 'signup') {
      setAuthMode('login');
      if (onTrialUnavailable) onTrialUnavailable(t('试用申请暂未开放，请联系平台管理员。'));
      else showTimedError(t('试用申请暂未开放，请联系平台管理员。'));
    }
  }, [trialSignupEnabled, authMode, onTrialUnavailable]);
  // 點擊「申請試用」：關閉時僅提示，不切換表單
  const handleTrialTabClick = () => {
    if (!trialSignupEnabled) {
      if (onTrialUnavailable) onTrialUnavailable(t('试用申请暂未开放，请联系平台管理员。'));
      else showTimedError(t('试用申请暂未开放，请联系平台管理员。'));
      return;
    }
    changeMode('signup');
  };
  const [isResending, setIsResending] = useState(false);
  
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

  // 處理 URL 中的信箱驗證 token
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get('verifyEmailToken');
    if (!verifyToken) return;

    const verify = async () => {
      try {
        const result = await apiClient.get(`/auth/verify-email?token=${encodeURIComponent(verifyToken)}`);
        showTimedSuccess(result.message || t('电子邮箱验证成功，请登录。'));
        // 清除 URL 中的 token
        const url = new URL(window.location);
        url.searchParams.delete('verifyEmailToken');
        window.history.replaceState({}, document.title, url.pathname + url.search);
      } catch (error) {
        showTimedError(error.response?.data?.message || t('验证失败，链接可能已过期。'));
      }
    };
    verify();
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
    setRegisteredEmail('');
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
      showTimedError(t('请输入登录账号。'));
      return;
    }
    if (!password) {
      showTimedError(t('请输入密码。'));
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
      onLogin?.();
    } catch (error) {
      // 優先獲取後端返回的自定義錯誤資訊，防止顯示預設的 HTTP 狀態報錯
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
      showTimedError(t('请输入公司名称。'));
      return;
    }
    if (!email) {
      showTimedError(t('请输入管理员邮箱。'));
      return;
    }
    if (!isValidEmail(email)) {
      showTimedError(t('请输入有效的邮箱格式。'));
      return;
    }
    if (!password) {
      showTimedError(t('请输入密码。'));
      return;
    }
    if (password.length < 8) {
      showTimedError(t('密码至少需要 8 位字符。'));
      return;
    }
    if (!confirmPassword) {
      showTimedError(t('请再次输入密码。'));
      return;
    }
    if (password !== confirmPassword) {
      showTimedError(t('两次输入的密码不一致。'));
      return;
    }
    if (!acceptedTerms) {
      showTimedError(t('请先阅读并同意服务条款与隐私政策。'));
      return;
    }

    setIsLoading(true);
    try {
      const result = await apiClient.post('/auth/register', { companyName, email, password, confirmPassword });
      showTimedSuccess(result.message || t('试用申请已提交，请前往邮箱完成验证。'));
      if (result.devVerificationUrl) {
        setRegisteredEmail(email);
      }
      e.target.reset();
    } catch (error) {
      const serverData = error.response?.data || {};
      if (serverData.code === 'EMAIL_UNVERIFIED') {
        setRegisteredEmail(serverData.email || email);
        clearMessages();
      } else {
        showTimedError(serverData.message || t('试用申请失败，请使用系统内未注册的电子邮箱或稍后重试。'));
      }
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
      showTimedError(t('请输入管理员邮箱。'));
      return;
    }
    if (!isValidEmail(email)) {
      showTimedError(t('请输入有效的邮箱格式。'));
      return;
    }

    setIsLoading(true);
    try {
      const result = await apiClient.post('/auth/forgot-password', { email });
      showTimedSuccess(result.message || t('已发送密码重置链接，请检查您的邮箱。'));
      e.target.reset();
    } catch (error) {
      const serverMessage = error.response?.data?.message || error.message;
      showTimedError(serverMessage || t('无法发送重置邮件，请稍后再试。'));
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
      showTimedError(t('重置链接无效，请重新申请。'));
      return;
    }
    if (password.length < 8) {
      showTimedError(t('密码至少需要 8 位字符。'));
      return;
    }
    if (password !== confirmPassword) {
      showTimedError(t('两次输入的密码不一致。'));
      return;
    }

    setIsLoading(true);
    try {
      const result = await apiClient.post('/auth/reset-password', { token: resetToken, password, confirmPassword });
      setResetToken('');
      window.history.replaceState({}, document.title, window.location.pathname);
      setAuthMode('login');
      showTimedSuccess(result.message || t('密码已重置，请使用新密码登录。'));
      e.target.reset();
    } catch (error) {
      const serverMessage = error.response?.data?.message || error.message;
      showTimedError(serverMessage || t('无法重置密码，请稍后再试。'));
    } finally {
      setIsLoading(false);
    }
  };

  // 重發驗證郵件
  const handleResendVerification = async () => {
    if (!registeredEmail) return;
    setIsResending(true);
    try {
      const result = await apiClient.post('/auth/resend-verification', { email: registeredEmail });
      showTimedSuccess(result.message || t('验证邮件已重新发送。'));
    } catch (error) {
      showTimedError(error.response?.data?.message || t('重新发送失败，请稍后再试。'));
    } finally {
      setIsResending(false);
    }
  };

  // 動態拉取隱私政策/服務條款
  const handleOpenLegal = async (type) => {
    const title = type === 'privacy' ? t('隐私权政策') : t('会员服务条款');
    // 注意：這裡假設後端提供了一個免登入的 /public API，請根據實際後端路由調整
    const endpoint = type === 'privacy' ? '/public/settings/privacy-policy' : '/public/settings/terms-of-service';
    
    setLegalModal({ isOpen: true, title, content: '', isLoading: true });
    try {
      const data = await apiClient.get(endpoint);
      setLegalModal({ 
        isOpen: true, 
        title, 
        content: data?.content || t('暂无内容，请联系管理员。'),
        isLoading: false 
      });
    } catch (error) {
      setLegalModal({ isOpen: true, title, content: t('内容加载失败，请稍后再试。'), isLoading: false });
    }
  };

  const homePageUrl = import.meta.env.VITE_HOME_PAGE_URL || 'https://www.qrtalkie.org';

  return (
    <section className={`landing${embedded ? ' landing--embed' : ''}`} id="landing">
      {loadingPhase !== 'done' && (
        <div className={`landing-loader${loadingPhase === 'fade' ? ' landing-loader--fade' : ''}`}>
          <img src="/assets/landing-animation.gif" alt={t('加载中…')} onError={(e) => { e.target.style.display = 'none'; }} />
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
          <p className="hero-badge">{t('企业级即时通讯云平台')}</p>
          <h1>
            {t('私密型企业专属')}
            <span className="gradient">{t('即时通讯系统')}</span>
          </h1>
          <div className="hero-features" aria-label={t('核心优势')}>
            <span className="point shield">{t('安全')}</span>
            <span className="point flash">{t('高效')}</span>
            <span className="point globe">{t('跨终端适配')}</span>
          </div>
          <p>
            {t('面向 VoIP、软电话和 WebRTC 场景，提供租户注册、SIP 账号开通、在线状态查询、注册日志、问题反馈等自助服务。')}
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

        <div className="auth-panel" aria-label={t('账号入口')}>
          <div className="auth-tabs" role="tablist">
            <button className={authMode === 'login' ? 'selected' : ''} onClick={() => changeMode('login')}>{t('登录')}</button>
            <button className={authMode === 'signup' ? 'selected' : ''} onClick={handleTrialTabClick}>{t('申请试用')}</button>
          </div>

          {authMode === 'login' && (
            <form className="auth-form active" id="login-form" onSubmit={handleLogin}>
              {/* 顯示錯誤或成功訊息 */}
              {errorMessage && <p className="form-message" style={{ color: '#d93025', marginBottom: '1rem' }}>{errorMessage}</p>}
              {successMessage && <p className="form-message" style={{ color: '#1e8e3e', marginBottom: '1rem' }}>{successMessage}</p>}

              {/* 加入 name 屬性與 required 驗證 */}
              <label>{t('账号')}<input name="username" type="text" placeholder={t('邮箱或 SIP 账号')} required /></label>
              <label>{t('密码')}<input name="password" type="password" placeholder={t('请输入密码')} required /></label>
              <div className="form-row">
                <label className="checkbox"><input name="rememberMe" type="checkbox" /> {t('记住我')}</label>
                <button type="button" className="link-btn" onClick={() => changeMode('forgot')}>{t('忘记密码？')}</button>
              </div>
              <button type="submit" className="primary-btn full" disabled={isLoading}>
                {isLoading ? t('登录中…') : t('登录')}
              </button>
              <p className="auth-legal-note">
                {t('登录即表示您已阅读并同意')}
                <button type="button" className="text-link" onClick={() => handleOpenLegal('terms')}>{t('《会员服务条款》')}</button>
                {t('和')}
                <button type="button" className="text-link" onClick={() => handleOpenLegal('privacy')}>{t('《隐私权政策》')}</button>
              </p>
            </form>
          )}

          {authMode === 'signup' && (
            <form className="auth-form active" id="signup-form" onSubmit={handleSignup}>
              <div className="auth-scroll">
                {errorMessage && <p className="form-message" style={{ color: '#d93025', marginBottom: '1rem' }}>{errorMessage}</p>}
                {successMessage && <p className="form-message" style={{ color: '#1e8e3e', marginBottom: '1rem' }}>{successMessage}</p>}
                <label>{t('公司名称')}<input name="companyName" placeholder={t('请输入公司全称或简称')} required /></label>
                <label>{t('管理员邮箱')}<input name="email" type="email" placeholder={t('请输入正确的邮箱地址')} required /></label>
                <label>{t('密码')}<input name="password" type="password" placeholder={t('至少 8 位字符')} required minLength={8} /></label>
                <label>{t('确认密码')}<input name="confirmPassword" type="password" placeholder={t('再次输入密码')} required minLength={8} /></label>
              </div>
              <button type="submit" className="primary-btn full" disabled={isLoading}>
                {isLoading ? t('提交中…') : t('提交试用申请（需验证邮箱）')}
              </button>
              {registeredEmail && (
                <div style={{ marginTop: '16px', padding: '14px 16px', backgroundColor: '#065f46', borderRadius: '8px', border: '1px solid #059669' }}>
                  <p style={{ margin: '0 0 10px', color: '#6ee7b7', fontSize: '13px', fontWeight: 600 }}>&#10003; {t('试用申请已提交！验证邮件已发送至 {email}', { email: registeredEmail })}</p>
                  <p style={{ margin: '0 0 10px', color: '#6ee7b7', fontSize: '12px' }}>{t('若未收到邮件，可点击下方按钮重新发送。')}</p>
                  <button type="button" onClick={handleResendVerification} disabled={isResending}
                    style={{ padding: '8px 20px', borderRadius: '6px', backgroundColor: '#059669', color: '#fff', border: 'none', fontSize: '13px', cursor: 'pointer', fontWeight: 500 }}>
                    {isResending ? t('发送中…') : t('重新发送验证邮件')}
                  </button>
                  {errorMessage && <p style={{ margin: '10px 0 0', color: '#fca5a5', fontSize: '12px' }}>{errorMessage}</p>}
                  {successMessage && <p style={{ margin: '10px 0 0', color: '#6ee7b7', fontSize: '12px' }}>{successMessage}</p>}
                </div>
              )}
              {!registeredEmail && errorMessage && errorMessage.includes('尚未驗證') && (
                <div style={{ marginTop: '16px', padding: '14px 16px', backgroundColor: '#1e293b', borderRadius: '8px', border: '1px solid #f59e0b' }}>
                  <p style={{ margin: '0 0 10px', color: '#fbbf24', fontSize: '13px' }}>&#9888; {errorMessage}</p>
                  <button type="button" onClick={async () => {
                    const emailInput = document.querySelector('#signup-form input[name="email"]');
                    const email = emailInput?.value?.trim();
                    if (!email) return;
                    setRegisteredEmail(email);
                    clearMessages();
                    setIsResending(true);
                    try {
                      const res = await apiClient.post('/auth/resend-verification', { email });
                      showTimedSuccess(res.message || t('验证邮件已重新发送。'));
                    } catch (e) {
                      showTimedError(e.response?.data?.message || t('发送失败'));
                    } finally {
                      setIsResending(false);
                    }
                  }}
                    style={{ padding: '8px 20px', borderRadius: '6px', backgroundColor: '#f59e0b', color: '#111827', border: 'none', fontSize: '13px', cursor: 'pointer', fontWeight: 600 }}>
                    {t('重新发送验证邮件')}
                  </button>
                </div>
              )}
              <label className="terms-consent">
                <input id="terms-consent" name="termsConsent" type="checkbox" required />
                <span>
                  {t('我已阅读并同意')}
                  <button type="button" className="text-link" onClick={() => handleOpenLegal('terms')}>{t('会员服务条款')}</button>、
                  <button type="button" className="text-link" onClick={() => handleOpenLegal('privacy')}>{t('隐私权政策')}</button>
                </span>
              </label>
            </form>
          )}

          {authMode === 'forgot' && (
            <form className="auth-form active" id="forgot-form" onSubmit={handleForgotPassword}>
              <h2>{t('找回密码')}</h2>
              <p className="muted">{t('输入管理员邮箱，我们将发送密码重置链接。')}</p>
              {errorMessage && <p className="form-message" style={{ color: '#d93025', marginBottom: '1rem' }}>{errorMessage}</p>}
              {successMessage && <p className="form-message" style={{ color: '#1e8e3e', marginBottom: '1rem' }}>{successMessage}</p>}
              <label>{t('邮箱')}<input name="email" type="email" placeholder="admin@company.com" required /></label>
              <button type="submit" className="primary-btn full" disabled={isLoading}>
                {isLoading ? t('发送中…') : t('发送重置邮件')}
              </button>
              <button type="button" className="link-btn center" onClick={() => changeMode('login')}>{t('返回登录')}</button>
            </form>
          )}

          {authMode === 'reset' && (
            <form className="auth-form active" id="reset-password-form" onSubmit={handleResetPassword}>
              <h2>{t('重置密码')}</h2>
              <p className="muted">{t('请设置新的管理员登录密码。')}</p>
              {errorMessage && <p className="form-message" style={{ color: '#d93025', marginBottom: '1rem' }}>{errorMessage}</p>}
              {successMessage && <p className="form-message" style={{ color: '#1e8e3e', marginBottom: '1rem' }}>{successMessage}</p>}
              <label>{t('新密码')}<input name="password" type="password" placeholder={t('至少 8 位字符')} required minLength={8} /></label>
              <label>{t('确认新密码')}<input name="confirmPassword" type="password" placeholder={t('再次输入新密码')} required minLength={8} /></label>
              <button type="submit" className="primary-btn full" disabled={isLoading}>
                {isLoading ? t('重置中…') : t('重置密码')}
              </button>
              <button type="button" className="link-btn center" onClick={() => changeMode('login')}>{t('返回登录')}</button>
            </form>
          )}
        </div>
      </main>

      {/* 動態渲染的法律條款彈窗 */}
      {legalModal.isOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setLegalModal({ ...legalModal, isOpen: false })}>
          <div style={{ background: '#111827', borderRadius: '10px', width: 'min(560px, 90vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
            <div style={{ flexShrink: 0, padding: '18px 24px', borderBottom: '1px solid #1f2937', background: '#1a2332', borderRadius: '10px 10px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>{legalModal.title}</h2>
              <button style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }} type="button" title={t('关闭')} onClick={() => setLegalModal({ ...legalModal, isOpen: false })}>&#10005;</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {legalModal.isLoading ? (
                <p style={{ color: '#9ca3af', textAlign: 'center' }}>{t('内容加载中…')}</p>
              ) : (
                <div style={{ color: '#d1d5db', fontSize: '14px', lineHeight: 1.8, overflowWrap: 'break-word' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {legalModal.content || ''}
                  </ReactMarkdown>
                </div>
              )}
            </div>
            <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', padding: '14px 18px', borderTop: '1px solid #1f2937', background: '#1a2332', borderRadius: '0 0 10px 10px' }}>
              <button style={{ padding: '8px 28px', borderRadius: '6px', background: '#3b82f6', color: '#fff', border: 'none', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }} type="button" onClick={() => setLegalModal({ ...legalModal, isOpen: false })}>{t('我知道了')}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
