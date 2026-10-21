import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Landing from '../Landing';
import apiClient from './apiClient';
import './landing-redesign.css';

const slides = [
  { img: '/assets/landing/001.jpg', subtitle: '私有化部署・專屬即時通訊解決方案', lines: ['專屬私有部署', '解鎖無限可能'] },
  { img: '/assets/landing/002.jpg', subtitle: 'QRTalkie 全終端融合通訊平台', lines: ['打破設備邊界', '全終端一體互聯'] },
  { img: '/assets/landing/003.jpg', subtitle: 'QRTalkie 專屬電子名片', lines: ['掃碼即通', '訪客交流安全便捷'] },
  { img: '/assets/landing/004.jpg', subtitle: 'QRTalkie 全終端融合通訊平台', lines: ['打破設備邊界', '全終端一體互聯'] },
  { img: '/assets/landing/005.jpg', subtitle: '企業專屬 AI 助手', lines: ['靈活定制', '私有化部署的超級智囊'] },
  { img: '/assets/landing/006.jpg', subtitle: 'QRTalkie 7×24h 智能語音客服', lines: ['開頁即講', '全天候智能語音應答'] },
];

const features = [
  { title: '私有部署', desc: '資料主權自掌', icon: <><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></> },
  { title: '融合通讯', desc: '跨平台多設備全面支持', icon: <><rect x="2" y="2" width="6" height="6" /><rect x="16" y="2" width="6" height="6" /><rect x="9" y="16" width="6" height="6" /><line x1="5" y1="8" x2="5" y2="16" /><line x1="19" y1="8" x2="19" y2="16" /><line x1="5" y1="16" x2="12" y2="16" /><line x1="19" y1="16" x2="12" y2="16" /></> },
  { title: '电子名片', desc: '跨界互聯·安全無憂', icon: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><path d="M3 14h7v7H3z" /></> },
  { title: '设备远控', desc: '遠距設備智能操控', icon: <><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" /></> },
  { title: 'AI助手', desc: '高效生產力引擎', icon: <><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></> },
  { title: '客服中心', desc: '24hr客服 訂單不漏接', icon: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /> },
];

const contentSlides = [
  {
    title: '内部即时通讯', img: '/assets/landing/content-im.jpg', logo: ['QRTalkie', 'Secure Messaging'],
    paragraphs: [
      'QRTalkie 让团队沟通更高效：消息、通话、文件与任务在同一个平台完成。',
      '支持私有化部署与端到端加密，重要信息只在企业自己的网络中流转。',
      '无论是跨部门协作还是远程办公，都能保持沟通顺畅、信息可追溯。',
    ],
  },
  {
    title: '高清视讯会议', img: '/assets/landing/content-vc.jpg', logo: ['QRTalkie', 'Video Conference'],
    paragraphs: [
      '打破地域限制，实现全球团队无缝协作。我们的视讯会议功能提供影院级的高清画质与低延迟音频，',
      '让每一次远程沟通都如同面对面般真实。支持屏幕共享、实时标注与会议录制，',
      '大幅提升团队决策效率，让沟通创造价值。',
    ],
  },
  {
    title: '远距设备管控', img: '/assets/landing/content-device.jpg', logo: ['QRTalkie', 'IoT Control'],
    paragraphs: [
      '通过 QRTalkie 的物联网整合能力，您可以随时随地监控和管理您的智能设备。',
      '无论是办公室的空调、灯光，还是工厂的传感器，一切尽在掌握。',
      '我们提供安全的远程控制通道，确保您的设备数据不被泄露，运行状态实时可见。',
    ],
  },
  {
    title: '外部访客交流', img: '/assets/landing/content-visitor.jpg', logo: ['QRTalkie', 'Visitor Access'],
    paragraphs: [
      '为外部合作伙伴和访客提供安全、便捷的临时通讯通道。',
      '无需下载额外软件，通过扫码即可加入安全会话。支持文件安全传输与阅后即焚功能，',
      '确保商业机密在跨组织交流中绝对安全，让合作更加顺畅无忧。',
    ],
  },
  {
    title: '定制AI助手', img: '/assets/landing/content-ai.jpg', logo: ['QRTalkie', 'AI Assistant'],
    paragraphs: [
      '内置强大的大语言模型，为您打造专属的企业知识大脑。',
      'AI 助手可以自动总结会议记录、快速检索企业内部文档、甚至协助撰写专业报告。',
      '它将繁琐的日常工作自动化，让每一位员工都拥有超级生产力，专注于更具创造性的工作。',
    ],
  },
  {
    title: '呼叫转接&合并', img: '/assets/landing/content-call.jpg', logo: ['QRTalkie', 'Call Management'],
    paragraphs: [
      '专业的企业级通讯管理功能，满足复杂业务场景需求。',
      '支持一键呼叫转接、多方通话合并与静音管理。无论是客服中心的繁忙调度，',
      '还是高管的跨国多方会议，都能轻松应对，确保每一次通话都专业、高效。',
    ],
  },
  {
    title: '数据加密传输', img: '/assets/landing/content-security.jpg', logo: ['QRTalkie', 'Bank-Grade Security'],
    paragraphs: [
      '安全是 QRTalkie 的基石。我们采用银行级的端到端加密技术（E2EE），',
      '确保您的每一条消息、每一次通话、每一份文件在传输过程中都坚不可摧。',
      '支持私有化部署，数据主权完全归属企业，彻底杜绝第三方数据泄露风险。',
    ],
  },
];

const scenarios = [
  { title: '智慧办公 / Smart Office', img: '/assets/landing/scenario-office.jpg', textFirst: true, paragraphs: ['打造无缝协作的现代化办公环境。通过 QRTalkie，员工可以在一个平台上完成即时沟通、高清视频会议、文件共享与任务分配。', '结合 AI 助手功能，自动整理会议纪要并生成待办事项，让团队告别低效沟通，专注于核心业务创新，大幅提升整体运营效率。'] },
  { title: '智慧社区 / Smart Community', img: '/assets/landing/scenario-community.jpg', textFirst: false, paragraphs: ['为高端住宅与智慧社区提供安全、便捷的邻里沟通与物业服务通道。居民可通过 APP 与物业进行即时报修、缴费咨询。', '访客通过扫码即可与业主进行高清视频对讲，并获取临时通行权限。全方位保障社区安全，提升居住幸福感与科技感。'] },
  { title: '智慧医疗 / Smart Healthcare', img: '/assets/landing/scenario-healthcare.jpg', textFirst: true, paragraphs: ['赋能医疗机构，实现医患之间的高效、安全互动。支持远程问诊、电子处方流转与检查报告的安全推送。', '严格的端到端加密确保患者隐私数据绝对安全。同时，内部医护人员可通过专属频道进行紧急病例讨论，争分夺秒挽救生命。'] },
  { title: '智慧零售 / Smart Retail', img: '/assets/landing/scenario-retail.jpg', textFirst: false, paragraphs: ['重塑线上线下融合的消费体验。门店导购可通过 QRTalkie 与总部实时同步库存、价格与促销信息。', '顾客扫码即可添加专属导购，享受一对一的 VIP 咨询服务与售后支持。通过私域流量的精细化运营，有效提升客户复购率与品牌忠诚度。'] },
];

const conceptFeatures = [
  { no: '01', title: '私有部署', desc: '数据留在企业自有环境，安全、合规与数据主权自主掌控。' },
  { no: '02', title: '融合通信', desc: '手机、桌面与 Web 消息同步，高清语音视频随时接入。' },
  { no: '03', title: '安全加密', desc: '消息、通话与文件全程加密，敏感信息不出企业。' },
  { no: '04', title: '电子名片', desc: '一张可定制的数字名片，扫码即可联系与分享。' },
  { no: '05', title: '呼叫中心', desc: '坐席、在线交流、留言与呼叫转接/合并统一管理，咨询不漏接。' },
  { no: '06', title: '设备管理', desc: '门禁、门锁等终端统一接入，远程控制与运行状态实时可见。' },
  { no: '07', title: 'AI 助手', desc: '企业私有知识问答与 7×24 智能语音应答，服务办公双提效。' },
  { no: '08', title: '云管理平台', desc: '账号、订单、通话与运营数据集中管理，经营状态一目了然。' },
];

const conceptMobileFeatures = [
  { no: '01', title: '私有部署', desc: '数据主权自主掌控。' },
  { no: '02', title: '融合通信', desc: '多端同步，语音视频随时接入。' },
  { no: '03', title: '安全加密', desc: '消息与通话全程加密。' },
  { no: '04', title: '电子名片', desc: '扫码即联，随时分享。' },
  { no: '05', title: '呼叫中心', desc: '坐席、转接与留言统一管理。' },
  { no: '06', title: '设备管理', desc: '终端统一接入，远程可控。' },
  { no: '07', title: 'AI 助手', desc: '私有知识问答与智能语音应答。' },
  { no: '08', title: '云管理平台', desc: '账号、订单与运营一屏掌握。' },
];

const FOOTER_DEFAULTS = {
  brandTitle: 'QRTalkie',
  brandSubtitleEn: 'Secure Instant Messaging & IoT App',
  brandSubtitleZh: '安全即时通讯与物联网应用',
  address: '台中市西區五權西四街57號3樓',
  email: 'qtalkie@gmail.com',
  desktopDownloadUrl: '',
  androidDownloadUrl: '',
  iosDownloadUrl: '',
  desktopVersion: '',
  androidVersion: '',
  iosVersion: '',
  copyright: '© 2026 QRTalkie. All Rights Reserved.',
  privacyUrl: '#',
};

function absoluteDownloadUrl(url) {
  const text = String(url || '');
  if (!text) return '';
  return text.startsWith('/') ? `${window.location.origin}${text}` : text;
}

function useLandingViewport() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'QRTalkie - Secure Instant Messaging & IoT App';
    document.documentElement.classList.add('qrt-landing-active');
    return () => {
      document.title = previousTitle;
      document.documentElement.classList.remove('qrt-landing-active');
      document.body.classList.remove('qrt-modal-open');
    };
  }, []);
}

export default function LandingRedesign() {
  useLandingViewport();
  const initialAuth = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get('verifyEmailToken') || params.get('resetPasswordToken'));
  }, []);
  const [slideIndex, setSlideIndex] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);
  const [contentIndex, setContentIndex] = useState(0);
  const [contentPaused, setContentPaused] = useState(false);
  const [showBackTop, setShowBackTop] = useState(false);
  const [authOpen, setAuthOpen] = useState(initialAuth);
  const [authSuccess, setAuthSuccess] = useState(false);
  const [enterError, setEnterError] = useState('');
  const [entered, setEntered] = useState(false);
  const [legalViewer, setLegalViewer] = useState({ open: false, title: '', content: '', loading: false });
  const [trialNotice, setTrialNotice] = useState('');
  const trialNoticeTimer = useRef(null);
  const [footerSettings, setFooterSettings] = useState(FOOTER_DEFAULTS);
  const [qrModal, setQrModal] = useState(null);

  useEffect(() => {
    if (carouselPaused) return undefined;
    const timer = window.setInterval(() => {
      setSlideIndex((index) => (index + 1) % slides.length);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [carouselPaused]);

  useEffect(() => {
    if (contentPaused) return undefined;
    const timer = window.setInterval(() => {
      setContentIndex((index) => (index + 1) % contentSlides.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [contentPaused]);

  useEffect(() => {
    const onScroll = () => setShowBackTop(window.scrollY > 300);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('qrt-modal-open', authOpen);
    return () => document.body.classList.remove('qrt-modal-open');
  }, [authOpen]);

  useEffect(() => () => {
    if (trialNoticeTimer.current) window.clearTimeout(trialNoticeTimer.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient.get('/public/settings/homepage-footer')
      .then((data) => {
        if (!cancelled && data?.settings) {
          setFooterSettings({ ...FOOTER_DEFAULTS, ...data.settings });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const showTrialNotice = (message) => {
    setTrialNotice(message);
    if (trialNoticeTimer.current) window.clearTimeout(trialNoticeTimer.current);
    trialNoticeTimer.current = window.setTimeout(() => setTrialNotice(''), 6000);
  };

  const openAuth = (event) => {
    event?.preventDefault();
    setAuthOpen(true);
    setAuthSuccess(false);
    setEnterError('');
    setEntered(false);
  };

  const closeAuth = () => {
    setAuthOpen(false);
    setAuthSuccess(false);
    setEnterError('');
    setEntered(false);
    setTrialNotice('');
    if (trialNoticeTimer.current) {
      window.clearTimeout(trialNoticeTimer.current);
      trialNoticeTimer.current = null;
    }
  };

  const handleAuthSuccess = () => {
    setAuthSuccess(true);
    setEnterError('');
  };

  const openQrModal = (platform, version, url) => {
    if (!url) return;
    setQrModal({ platform, version: version || '', url });
  };

  const closeQrModal = () => setQrModal(null);

  const openLegal = async (type) => {
    const title = type === 'privacy' ? '隱私權政策' : '會員服務條款';
    const endpoint = type === 'privacy' ? '/public/settings/privacy-policy' : '/public/settings/terms-of-service';
    setLegalViewer({ open: true, title, content: '', loading: true });
    try {
      const data = await apiClient.get(endpoint);
      setLegalViewer({ open: true, title, content: data?.content || '暫無內容，請聯絡管理員。', loading: false });
    } catch {
      setLegalViewer({ open: true, title, content: '內容載入失敗，請稍後再試。', loading: false });
    }
  };

  const handleEnterPlatform = () => {
    try {
      const token = localStorage.getItem('qrtalkieAdminToken') || sessionStorage.getItem('qrtalkieAdminToken');
      const userType = localStorage.getItem('qrtalkieUserType') || sessionStorage.getItem('qrtalkieUserType');
      if (!token) {
        setEnterError('登入狀態已失效，請重新登入。');
        return;
      }
      localStorage.setItem('qrtalkieHandoffToken', token);
      localStorage.setItem('qrtalkieHandoffExpiresAt', String(Date.now() + 5 * 60 * 1000));
      if (userType) localStorage.setItem('qrtalkieHandoffUserType', userType);
      else localStorage.removeItem('qrtalkieHandoffUserType');
      setEntered(true);
      setEnterError('');
    } catch {
      setEnterError('無法保存登入狀態，請重試。');
    }
  };

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div className="qrt-landing" id="qrt-top">
      <div className="qrt-marketing">
      <header className="qrt-site-header">
        <div className="qrt-logo-area">
          <img src="/assets/landing/QRTalkie-Logo.png" alt="QRTalkie Logo" className="qrt-logo-img" />
        </div>
        <nav>
          <ul>
            <li><a href="#qrt-top" onClick={(e) => { e.preventDefault(); scrollTop(); }}>首页</a></li>
            <li><a href="#design-philosophy">产品介绍</a></li>
            <li><a href="#scenarios">解决方案</a></li>
            <li><a href="#footer">资源下载</a></li>
            <li><a href="#" onClick={openAuth}>云管理平台</a></li>
          </ul>
        </nav>
      </header>

      <main>
        <section
          className="qrt-banner-carousel"
          onMouseEnter={() => setCarouselPaused(true)}
          onMouseLeave={() => setCarouselPaused(false)}
        >
          {slides.map((slide, index) => (
            <div key={slide.img} className={`qrt-carousel-slide${index === slideIndex ? ' active' : ''}`}>
              <img src={slide.img} alt={`Banner ${index + 1}`} />
              <div className="qrt-banner-content">
                <p className="qrt-banner-subtitle">{slide.subtitle}</p>
                {slide.lines.map((line) => <h1 key={line} className="qrt-banner-title">{line}</h1>)}
              </div>
            </div>
          ))}
          <button type="button" className="qrt-carousel-btn qrt-prev-btn" onClick={() => setSlideIndex((i) => (i - 1 + slides.length) % slides.length)}>&#10094;</button>
          <button type="button" className="qrt-carousel-btn qrt-next-btn" onClick={() => setSlideIndex((i) => (i + 1) % slides.length)}>&#10095;</button>
        </section>

        <div
          className="qrt-feature-nav-bar"
          onMouseEnter={() => setCarouselPaused(true)}
          onMouseLeave={() => setCarouselPaused(false)}
        >
          {features.map((feature, index) => (
            <button
              key={feature.title}
              type="button"
              className={`qrt-feature-item${index === slideIndex ? ' active' : ''}`}
              onClick={() => setSlideIndex(index)}
            >
              <svg className="qrt-feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{feature.icon}</svg>
              <span className="qrt-feature-title">{feature.title}</span>
              <span className="qrt-feature-desc">{feature.desc}</span>
            </button>
          ))}
        </div>

        <section className="qrt-brand-concept" id="design-philosophy">
          <h2 className="qrt-section-title">设计理念</h2>
          <p className="qrt-section-subtitle">Design Philosophy</p>
          <div className="qrt-concept-visual qrt-concept-desktop" style={{ backgroundImage: "url('/assets/landing/why05.jpg')" }}>
            <div className="qrt-concept-grid">
              {conceptFeatures.map((item) => (
                <div className="qrt-concept-item" key={item.no}>
                  <div className="qrt-concept-copy">
                    <span className="qrt-concept-number">{item.no}</span>
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="qrt-concept-visual qrt-concept-mobile" style={{ backgroundImage: "url('/assets/landing/why07.jpg')" }}>
            <div className="qrt-concept-grid">
              {conceptMobileFeatures.map((item) => (
                <div className="qrt-concept-item" key={item.no}>
                  <div className="qrt-concept-copy">
                    <span className="qrt-concept-number">{item.no}</span>
                    <h3>{item.title}</h3>
                    <p>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="qrt-integrated-block">
          <div className="qrt-container">
            <div className="qrt-block-header">
              <h2>All IN One</h2>
              <p>一個平台，满足各类沟通协作需求</p>
              <div className="qrt-block-divider"></div>
            </div>
            <div
              className="qrt-block-tags"
              onMouseEnter={() => setContentPaused(true)}
              onMouseLeave={() => setContentPaused(false)}
            >
              {contentSlides.map((slide, index) => (
                <button
                  key={slide.title}
                  type="button"
                  className={`qrt-tag-item${index === contentIndex ? ' active' : ''}`}
                  onClick={() => setContentIndex(index)}
                >
                  <h3>{slide.title}</h3>
                </button>
              ))}
            </div>
            <div
              className="qrt-content-viewport"
              onMouseEnter={() => setContentPaused(true)}
              onMouseLeave={() => setContentPaused(false)}
            >
              <div className="qrt-content-track" style={{ transform: `translateX(-${contentIndex * 100}%)` }}>
                {contentSlides.map((slide) => (
                  <div className="qrt-content-slide" key={slide.title}>
                    <div className="qrt-content-image">
                      <img src={slide.img} alt={slide.title} />
                      <div className="qrt-slide-title">{slide.title}</div>
                      <div className="qrt-slide-logo">{slide.logo[0]}<br />{slide.logo[1]}</div>
                    </div>
                    <div className="qrt-content-text">
                      <h4>{slide.title}</h4>
                      {slide.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="qrt-scenarios-block" id="scenarios">
          <div className="qrt-container">
            <div className="qrt-scenarios-header">
              <h2 className="qrt-section-title">丰富应用场景</h2>
              <p className="qrt-section-subtitle">Rich Application Scenarios</p>
            </div>
            {scenarios.map((scenario) => (
              <div key={scenario.title} className={`qrt-scenario-item${scenario.textFirst ? ' text-first-mobile' : ''}`}>
                <div className="qrt-scenario-text">
                  <h3>{scenario.title}</h3>
                  {scenario.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </div>
                <div className="qrt-scenario-img">
                  <img src={scenario.img} alt={scenario.title} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="qrt-site-footer" id="footer" style={{ backgroundImage: "url('/assets/landing/footer-bg.jpg')" }}>
        <div className="qrt-container qrt-footer-content">
          <div className="qrt-footer-col qrt-brand-info">
            <h3>{footerSettings.brandTitle}</h3>
            <p>{footerSettings.brandSubtitleEn}</p>
            <p>{footerSettings.brandSubtitleZh}</p>
          </div>
          <div className="qrt-footer-col qrt-quick-links">
            <h4>快速链接</h4>
            <ul>
              <li><a href="#qrt-top" onClick={(e) => { e.preventDefault(); scrollTop(); }}>首页</a></li>
              <li><a href="#design-philosophy">产品介绍</a></li>
              <li><a href="#scenarios">解决方案</a></li>
              <li><a href="#footer">资源下载</a></li>
              <li><a href="#" onClick={openAuth}>云管理平台</a></li>
            </ul>
          </div>
          <div className="qrt-footer-col qrt-contact-info">
            <h4>联系我们</h4>
            <p>地址：{footerSettings.address || '-'}</p>
            <p>✉️ 邮箱：{footerSettings.email ? <a href={`mailto:${footerSettings.email}`}>{footerSettings.email}</a> : '-'}</p>
          </div>
          <div className="qrt-footer-col qrt-download-col">
            <h4>资源下载</h4>
            <div className="qrt-download-item">
              <a
                href={footerSettings.desktopDownloadUrl || '#'}
                className="qrt-desktop-download"
                onClick={(e) => { if (!footerSettings.desktopDownloadUrl) e.preventDefault(); }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                <span className="qrt-dl-text"><span className="qrt-dl-title">桌面版 (Windows)</span><span className="qrt-dl-sub">{footerSettings.desktopVersion ? `v${footerSettings.desktopVersion} · 点击下载` : '点击下载'}</span></span>
              </a>
            </div>
            <div className="qrt-download-item">
              <a
                className="qrt-qr-download-item"
                href={footerSettings.androidDownloadUrl || '#'}
                target={footerSettings.androidDownloadUrl ? '_blank' : undefined}
                rel="noopener noreferrer"
                onClick={(e) => { e.preventDefault(); openQrModal('Android', footerSettings.androidVersion, footerSettings.androidDownloadUrl); }}
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                <div className="qrt-qr-mini">
                  {footerSettings.androidDownloadUrl ? (
                    <QRCodeSVG value={absoluteDownloadUrl(footerSettings.androidDownloadUrl)} size={60} bgColor="#ffffff" fgColor="#0f172a" level="M" />
                  ) : (
                    <div className="qrt-qr-placeholder-mini"></div>
                  )}
                </div>
                <div className="qrt-qr-download-text"><span className="qrt-platform-name">Android</span><span className="qrt-scan-tip">{footerSettings.androidDownloadUrl ? '点击获取Android二维码' : '暂无可用二维码'}</span></div>
              </a>
            </div>
            <div className="qrt-download-item">
              <a
                className="qrt-qr-download-item"
                href={footerSettings.iosDownloadUrl || '#'}
                target={footerSettings.iosDownloadUrl ? '_blank' : undefined}
                rel="noopener noreferrer"
                onClick={(e) => { e.preventDefault(); openQrModal('iOS', footerSettings.iosVersion, footerSettings.iosDownloadUrl); }}
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                <div className="qrt-qr-mini">
                  {footerSettings.iosDownloadUrl ? (
                    <QRCodeSVG value={absoluteDownloadUrl(footerSettings.iosDownloadUrl)} size={60} bgColor="#ffffff" fgColor="#0f172a" level="M" />
                  ) : (
                    <div className="qrt-qr-placeholder-mini"></div>
                  )}
                </div>
                <div className="qrt-qr-download-text"><span className="qrt-platform-name">iOS</span><span className="qrt-scan-tip">{footerSettings.iosDownloadUrl ? '点击获取iOS二维码' : '暂无可用二维码'}</span></div>
              </a>
            </div>
          </div>
        </div>
        <div className="qrt-footer-bottom">
          <div className="qrt-container">
            <p>{footerSettings.copyright} | <a href={footerSettings.privacyUrl || '#'} onClick={(e) => { if (!footerSettings.privacyUrl || footerSettings.privacyUrl === '#') e.preventDefault(); }}>隐私政策</a></p>
          </div>
        </div>
      </footer>

      <div className="qrt-float-tools">
        <button type="button" className="qrt-float-btn" onClick={openAuth}><i>📞</i><span>电话咨询</span></button>
        <button type="button" className="qrt-float-btn" onClick={openAuth}><i>💬</i><span>企微客服</span></button>
      </div>
      <button type="button" id="qrt-back-to-top" className={`qrt-back-to-top-btn${showBackTop ? ' show' : ''}`} aria-label="回到顶部" onClick={scrollTop}>↑</button>
      </div>

      {authOpen && (
        <div className="qrt-auth-modal" role="dialog" aria-modal="true" aria-label="云管理平台登录" onMouseDown={(e) => { if (e.target === e.currentTarget) closeAuth(); }}>
          <div className="qrt-auth-dialog">
            <div className="qrt-auth-left">
              <img src="/assets/landing/login02.jpg" alt="QRTalkie Cloud" />
              <div className="qrt-auth-left-text">
                <span className="qrt-auth-left-kicker">歡迎使用</span>
                <strong>QRTalkie雲管理平台</strong>
              </div>
            </div>
            <div className="qrt-auth-right">
              <button type="button" className="qrt-auth-close" onClick={closeAuth} aria-label="關閉">×</button>
              <div className="qrt-auth-brand">
                <img src="/assets/landing/QRTalkie-Logo.png" alt="QRTalkie" />
              </div>
              {authSuccess ? (
                <div className="qrt-auth-success">
                  <h2>登入成功</h2>
                  <p>管理平台將在新分頁開啟，官網會保留在目前分頁。</p>
                  <a
                    className="qrt-enter-platform"
                    href="/"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleEnterPlatform}
                  >
                    進入管理平台
                  </a>
                  {entered && <p className="qrt-auth-hint">已在新分頁開啟管理平台。</p>}
                  {enterError && <p className="qrt-auth-error">{enterError}</p>}
                  <p className="qrt-auth-legal-note">
                    確認登錄表明您已閱讀並同意
                    <button type="button" className="qrt-legal-link" onClick={() => openLegal('terms')}>《會員服務條款》</button>
                    和
                    <button type="button" className="qrt-legal-link" onClick={() => openLegal('privacy')}>《隱私權政策》</button>
                  </p>
                  <button type="button" className="qrt-auth-secondary" onClick={closeAuth}>留在官網</button>
                </div>
              ) : (
                <Landing embedded onLogin={handleAuthSuccess} onTrialUnavailable={showTrialNotice} />
              )}
            </div>
            {trialNotice && <div className="qrt-auth-notice" role="status">{trialNotice}</div>}
          </div>
        </div>
      )}

      {legalViewer.open && (
        <div
          className="qrt-legal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={legalViewer.title}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setLegalViewer((v) => ({ ...v, open: false })); }}
        >
          <div className="qrt-legal-dialog">
            <div className="qrt-legal-header">
              <h2>{legalViewer.title}</h2>
              <button type="button" className="qrt-legal-close" aria-label="關閉" onClick={() => setLegalViewer((v) => ({ ...v, open: false }))}>×</button>
            </div>
            <div className="qrt-legal-body">
              {legalViewer.loading ? (
                <p className="qrt-legal-loading">內容載入中...</p>
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{legalViewer.content || ''}</ReactMarkdown>
              )}
            </div>
            <div className="qrt-legal-footer">
              <button type="button" className="qrt-legal-confirm" onClick={() => setLegalViewer((v) => ({ ...v, open: false }))}>我知道了</button>
            </div>
          </div>
        </div>
      )}

      {qrModal && (
        <div
          className="qrt-qr-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`${qrModal.platform} 安裝二維碼`}
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeQrModal(); }}
        >
          <div className="qrt-qr-dialog">
            <button type="button" className="qrt-qr-close" onClick={closeQrModal} aria-label="關閉">×</button>
            <h3>{qrModal.platform} 安裝二維碼</h3>
            {qrModal.version && <p className="qrt-qr-version">版本 v{qrModal.version}</p>}
            <div className="qrt-qr-large">
              <QRCodeSVG value={absoluteDownloadUrl(qrModal.url)} size={300} bgColor="#ffffff" fgColor="#0f172a" level="M" />
            </div>
            <p className="qrt-qr-scan-tip">扫码安装</p>
          </div>
        </div>
      )}
    </div>
  );
}
