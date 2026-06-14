import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Mail, Phone, UserRound, Headphones, Video, LoaderCircle, RefreshCw, Info } from 'lucide-react';
import apiClient from '../../apiClient';
import CallModal from './CallModal';
import ConfirmModal from './ConfirmModal';
import { ensureJsSIPLoaded } from './loadJsSIP';
import './ecardVisitorTheme.css';

function isValidSlug(slug) {
  return typeof slug === 'string' && /^[A-Za-z0-9_-]+$/.test(String(slug).trim());
}

function safeDateOnly(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function toAbsoluteAssetUrl(url) {
  if (!url) return '';
  const value = String(url).trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
  return `${window.location.origin}${value.startsWith('/') ? '' : '/'}${value}`;
}

function mapPublicDataToCard(data) {
  return {
    name: data?.profile?.name || '',
    duty: data?.profile?.duty || '',
    email: data?.profile?.email || '',
    address: data?.profile?.address || data?.profile?.contactAddress || data?.profile?.addressText || '',
    avatar: data?.profile?.avatarUrl || data?.media?.avatarUrl || '',
    phone: data?.profile?.phone || '',
    sipAccount: data?.callConfigSummary?.sipAccount || '',
    sipAccountInfo: {
      domain: data?.callConfigSummary?.sipDomain || '',
    },
    webrtcAccount: data?.callConfigSummary?.webAccount || '',
    webrtcAccountInfo: {
      domain: data?.callConfigSummary?.webrtcDomain || '',
      password: '',
    },
    publicStatus: data?.publicStatus || {},
    callCapabilities: data?.callCapabilities || {},
    callConfigSummary: data?.callConfigSummary || {},
    enableVideoCall: data?.enableVideoCall !== false,
    sipRegistrationStatus: data?.sipRegistrationStatus || 'unknown',
    media: data?.media || {},
    template: data?.template || {},
    tenantName: data?.tenantName || '',
  };
}

function safeSecretSummary(value) {
  const text = String(value || '').trim();
  let hashPrefix = '';
  if (text) {
    try {
      const bytes = new TextEncoder().encode(text);
      let hash = 2166136261;
      for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 16777619);
      }
      hashPrefix = (`00000000${(hash >>> 0).toString(16)}`).slice(-8);
    } catch {
      hashPrefix = '';
    }
  }
  return {
    present: Boolean(text),
    length: text.length,
    hashPrefix,
  };
}

export default function ECardVisitorPage({ slug }) {
  const [loading, setLoading] = useState(true);
  const [errorInfo, setErrorInfo] = useState(null);
  const [ecardData, setEcardData] = useState(null);
  const [publicData, setPublicData] = useState(null);

  const [callStatus, setCallStatus] = useState('');
  const [registrationStatus, setRegistrationStatus] = useState('registering');
  const [registrationMessage, setRegistrationMessage] = useState('帳號註冊中...');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [isVideoCall, setIsVideoCall] = useState(false);
  const [isLocalVideoActive, setIsLocalVideoActive] = useState(false);
  const [isSystemReady, setIsSystemReady] = useState(false);
  const [isPreparingCall, setIsPreparingCall] = useState(false);
  const [callBusy, setCallBusy] = useState(false);
  const [isReRegistering, setIsReRegistering] = useState(false);
  const [isSipRefreshing, setIsSipRefreshing] = useState(false);

  const uaRef = useRef(null);
  const currentSessionRef = useRef(null);
  const callSessionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const originalSendRef = useRef(null);
  const tempPcRef = useRef(null);
  const candidateBufferRef = useRef([]);
  const iceServersRef = useRef([]);
  const callStartTimeRef = useRef(0);
  const callTypeRef = useRef('voice');
  const activeCallStartedRef = useRef(false);
  const iceTimeoutRef = useRef(null);
  const autoRegisterStartedRef = useRef(false);
  const isPageUnmountingRef = useRef(false);
  const registeringRef = useRef(false);

  const pageImage = useMemo(() => {
    if (!ecardData?.avatar) return '';
    return toAbsoluteAssetUrl(ecardData.avatar);
  }, [ecardData?.avatar]);

  const companyName = ecardData?.tenantName || 'QRTalkie';

  useEffect(() => {
    let cancelled = false;

    async function loadPublicData() {
      setLoading(true);
      setErrorInfo(null);
      setEcardData(null);
      setPublicData(null);
      callSessionRef.current = null;
      iceServersRef.current = [];
      currentSessionRef.current = null;
      activeCallStartedRef.current = false;
      setRegistrationStatus('registering');
      setRegistrationMessage('帳號註冊中...');
      autoRegisterStartedRef.current = false;
      registeringRef.current = false;
      cleanupCallResources();
      cleanupRegistrationUa();
      try {
        const res = await apiClient.get(`/ecard/public/${slug}`);
        if (cancelled) return;
        if (!res?.success) {
          setErrorInfo({
            code: res?.code || 'ECARD_NOT_FOUND',
            message: res?.message || '電子名片不存在或不可用',
          });
          return;
        }
        setPublicData(res.data || null);
        setEcardData(mapPublicDataToCard(res.data || {}));
      } catch (err) {
        if (cancelled) return;
        setErrorInfo({
          code: err?.code || err?.data?.code || 'ECARD_NOT_FOUND',
          message: err?.data?.message || err?.message || '電子名片不存在或不可用',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (!isValidSlug(slug)) {
      setLoading(false);
      setErrorInfo({ code: 'INVALID_ECARD_SLUG', message: '查詢參數格式不正確' });
      return () => { cancelled = true; };
    }

    loadPublicData();
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    return () => {
      isPageUnmountingRef.current = true;
      cleanupPageResources();
    };
  }, []);

  function cleanupCallResources() {
    if (iceTimeoutRef.current) {
      clearTimeout(iceTimeoutRef.current);
      iceTimeoutRef.current = null;
    }
    if (tempPcRef.current) {
      try { tempPcRef.current.close(); } catch {}
      tempPcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
      localStreamRef.current = null;
    }
    candidateBufferRef.current = [];
    setIsPreparingCall(false);
    setIsConfirmOpen(false);
    setCallBusy(false);
  }

  function cleanupCurrentCall() {
    if (iceTimeoutRef.current) {
      clearTimeout(iceTimeoutRef.current);
      iceTimeoutRef.current = null;
    }
    if (currentSessionRef.current) {
      try { currentSessionRef.current.terminate(); } catch {}
      currentSessionRef.current = null;
    }
    if (uaRef.current) {
      try { uaRef.current.stop(); } catch {}
      uaRef.current = null;
    }
    if (tempPcRef.current) {
      try { tempPcRef.current.close(); } catch {}
      tempPcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
      localStreamRef.current = null;
    }
    setIsCallModalOpen(false);
    setIsLocalVideoActive(false);
    setCallStatus('');
    activeCallStartedRef.current = false;
    candidateBufferRef.current = [];
    setCallBusy(false);
  }

  function cleanupRegistrationUa() {
    if (uaRef.current) {
      try { uaRef.current.stop(); } catch {}
      uaRef.current = null;
    }
    registeringRef.current = false;
  }

  function cleanupPageResources() {
    cleanupCurrentCall();
    cleanupCallResources();
    cleanupRegistrationUa();
  }

  function markRegistrationFailed() {
    if (isPageUnmountingRef.current) return;
    setRegistrationStatus('failed');
    setRegistrationMessage('帳號忙，請稍後刷新重試');
    cleanupRegistrationUa();
  }

  function injectSdpPatch(uaInstance, serverIp) {
    if (!uaInstance?.transport || originalSendRef.current) return;
    originalSendRef.current = uaInstance.transport.send;
    uaInstance.transport.send = function patchedSend(...args) {
      if (args[0]?.body && serverIp) {
        let body = args[0].body;
        if (body.includes('127.0.0.1') || body.includes('0.0.0.0')) {
          body = body
            .replace(/IN IP4 (127\.0\.0\.1|0\.0\.0\.0)/g, `IN IP4 ${serverIp}`)
            .replace(/c=IN IP4 (127\.0\.0\.1|0\.0\.0\.0)/g, `c=IN IP4 ${serverIp}`);
          args[0].body = body;
        }
      }
      return originalSendRef.current.apply(this, args);
    };
  }

  function applyCodecPreferences(pc) {
    if (!pc || !window.RTCRtpSender?.getCapabilities) return;
    const audioTransceiver = pc.getTransceivers().find((t) => t.sender?.track?.kind === 'audio' || t.receiver?.track?.kind === 'audio');
    if (!audioTransceiver) return;
    try {
      const audioCaps = window.RTCRtpSender.getCapabilities('audio');
      const pcmuCodec = audioCaps?.codecs?.find((c) => String(c.mimeType).toLowerCase() === 'audio/pcmu');
      const dtmfCodec = audioCaps?.codecs?.find((c) => String(c.mimeType).toLowerCase().includes('telephone-event'));
      if (pcmuCodec && dtmfCodec) audioTransceiver.setCodecPreferences([pcmuCodec, dtmfCodec]);
    } catch {}
  }

  function bindRemoteAudio(pc) {
    if (!pc) return;
    try {
      const audioReceiver = pc.getReceivers().find((r) => r.track && r.track.kind === 'audio');
      if (!audioReceiver?.track) return;
      const audioEl = document.getElementById('remoteAudio');
      if (!audioEl) return;
      const stream = new MediaStream([audioReceiver.track]);
      audioEl.srcObject = stream;
      audioEl.play().catch(() => {});
    } catch {}
  }

  async function upgradeToVideo() {
    const session = currentSessionRef.current;
    if (!session || session.connection?.signalingState !== 'stable') {
      setTimeout(upgradeToVideo, 500);
      return;
    }

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 20 },
      });
      const pc = session.connection;
      const videoTrack = videoStream.getVideoTracks()[0];
      if (localStreamRef.current && videoTrack) localStreamRef.current.addTrack(videoTrack);
      if (videoTrack) pc.addTrack(videoTrack, localStreamRef.current || videoStream);
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      setIsLocalVideoActive(true);
      applyCodecPreferences(pc);
      setTimeout(() => {
        session.renegotiate({
          useAudio: true,
          useVideo: true,
          rtcOfferConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: true },
        });
      }, 500);
      setTimeout(() => bindRemoteAudio(pc), 3500);
    } catch {
      // 不顯示敏感錯誤細節
    }
  }

  function handleHangup() {
    cleanupActiveCall();
    cleanupCallResources();
  }

  function handleToggleVideo() {
    const videoTrack = localStreamRef.current?.getVideoTracks?.()[0];
    if (!videoTrack) return;
    const next = !videoTrack.enabled;
    videoTrack.enabled = next;
    setIsLocalVideoActive(next);
  }

  async function prepareCallSession() {
    const res = await apiClient.post(`/ecard/public/${slug}/call-session`);
    if (!res?.success) {
      throw new Error(res?.message || '呼叫配置建立失敗，請稍後再試');
    }
    const data = res.data || {};
    if (!data?.webAccount || !data?.credential?.value || !data?.wssUrl || !data?.webrtcDomain || !data?.targetSipUri) {
      throw new Error('呼叫配置建立失敗，請稍後再試');
    }
    const credentialSummary = safeSecretSummary(data?.credential?.value);
    console.log('[ECardVisitor] call-session summary', {
      success: true,
      webAccount: data?.webAccount || '',
      webrtcDomain: data?.webrtcDomain || '',
      wssUrl: data?.wssUrl || '',
      targetSipUri: data?.targetSipUri || '',
      credentialPresent: credentialSummary.present,
      credentialLength: credentialSummary.length,
      credentialHashPrefix: credentialSummary.hashPrefix,
      iceServersCount: Array.isArray(data?.iceServers) ? data.iceServers.length : 0,
    });
    callSessionRef.current = data;
    iceServersRef.current = Array.isArray(data.iceServers) ? data.iceServers : [];
    return data;
  }

  async function startRegistration({ forceRefresh = false } = {}) {
    if (registeringRef.current) {
      console.log('[ECardVisitor] auto register step: skipped', {
        reason: 'registering in progress',
      });
      return;
    }
    if (uaRef.current && !forceRefresh) {
      console.log('[ECardVisitor] auto register step: skipped', {
        reason: 'ua already exists',
      });
      return;
    }
    if (forceRefresh) {
      cleanupCurrentCall();
      cleanupRegistrationUa();
      callSessionRef.current = null;
      iceServersRef.current = [];
      currentSessionRef.current = null;
      activeCallStartedRef.current = false;
      autoRegisterStartedRef.current = false;
    } else if (autoRegisterStartedRef.current) {
      console.log('[ECardVisitor] auto register step: skipped', {
        reason: 'already started',
      });
      return;
    }
    autoRegisterStartedRef.current = true;
    registeringRef.current = true;
    if (forceRefresh) setIsReRegistering(true);
    setRegistrationStatus('registering');
    setRegistrationMessage('帳號註冊中...');

    try {
      console.log('[ECardVisitor] auto register step: call-session ok');
      const callSession = await prepareCallSession();
      if (isPageUnmountingRef.current) return;

      console.log('[ECardVisitor] auto register step: before load JsSIP');
      const JsSIP = await ensureJsSIPLoaded();
      if (!JsSIP) {
        throw new Error('JsSIP 載入失敗');
      }
      console.log('[ECardVisitor] auto register step: after load JsSIP');

      const passwordSummary = safeSecretSummary(callSession?.credential?.value);
      console.log('[ECardVisitor] auto register step: before create UA', {
        uri: `sip:${callSession.webAccount}@${callSession.webrtcDomain}`,
        authorizationUser: callSession.webAccount || '',
        socketsCount: 1,
        wssUrl: callSession.wssUrl || '',
        passwordPresent: passwordSummary.present,
        passwordLength: passwordSummary.length,
        credentialHashPrefix: passwordSummary.hashPrefix,
      });
      const socket = new JsSIP.WebSocketInterface(callSession.wssUrl);
      const uaInstance = new JsSIP.UA({
        sockets: [socket],
        uri: `sip:${callSession.webAccount}@${callSession.webrtcDomain}`,
        password: callSession.credential.value,
        register: true,
      });
      console.log('[ECardVisitor] auto register step: UA create');

      uaRef.current = uaInstance;
      activeCallStartedRef.current = false;

      uaInstance.on('connected', () => {
        if (isPageUnmountingRef.current) return;
        console.log('[ECardVisitor] JsSIP connected', {
          webAccount: callSession.webAccount || '',
          webrtcDomain: callSession.webrtcDomain || '',
          wssUrl: callSession.wssUrl || '',
        });
        if (registrationStatus !== 'registered') {
          setRegistrationStatus('registering');
          setRegistrationMessage('帳號註冊中...');
        }
      });

      uaInstance.on('registered', () => {
        if (isPageUnmountingRef.current) return;
        console.log('[ECardVisitor] JsSIP registered', {
          webAccount: callSession.webAccount || '',
          webrtcDomain: callSession.webrtcDomain || '',
        });
        setRegistrationStatus('registered');
        setRegistrationMessage('');
        injectSdpPatch(uaInstance, callSession.sipServerPublicIp);
      });

      uaInstance.on('unregistered', () => {
        if (isPageUnmountingRef.current) return;
        console.log('[ECardVisitor] JsSIP unregistered', {
          webAccount: callSession.webAccount || '',
          webrtcDomain: callSession.webrtcDomain || '',
        });
        setRegistrationStatus('failed');
        setRegistrationMessage('帳號忙，請稍後刷新重試');
        cleanupRegistrationUa();
      });

      uaInstance.on('registrationFailed', (event) => {
        if (isPageUnmountingRef.current) return;
        console.log('[ECardVisitor] JsSIP registrationFailed', {
          webAccount: callSession.webAccount || '',
          webrtcDomain: callSession.webrtcDomain || '',
          cause: event?.cause || '',
          statusCode: event?.response?.status_code || '',
          reasonPhrase: event?.response?.reason_phrase || '',
        });
        setRegistrationStatus('failed');
        setRegistrationMessage('帳號忙，請稍後刷新重試');
        cleanupRegistrationUa();
      });

      uaInstance.on('disconnected', () => {
        if (isPageUnmountingRef.current) return;
        console.log('[ECardVisitor] JsSIP disconnected', {
          webAccount: callSession.webAccount || '',
          webrtcDomain: callSession.webrtcDomain || '',
        });
        setRegistrationStatus('failed');
        setRegistrationMessage('帳號忙，請稍後刷新重試');
        cleanupRegistrationUa();
      });

      console.log('[ECardVisitor] auto register step: before ua.start');
      uaInstance.start();
      console.log('[ECardVisitor] auto register step: ua.start called');
    } catch (err) {
      if (isPageUnmountingRef.current) return;
      console.log('[ECardVisitor] auto register catch', {
        name: err?.name || '',
        message: err?.message || '',
        stack: String(err?.stack || '')
          .split('\n')
          .slice(0, 4)
          .join(' | '),
      });
      markRegistrationFailed();
    } finally {
      registeringRef.current = false;
      setIsReRegistering(false);
    }
  }

  async function handleRetryRegister() {
    console.log('[ECardVisitor] manual retry register clicked', {
      currentStatus: registrationStatus,
    });
    await startRegistration({ forceRefresh: true });
  }

  function handleDebugEntry() {
    console.log('[ECardVisitor] debug entry clicked', {
      slug,
      hasCard: Boolean(ecardData),
      registrationStatus,
      callCapabilities: {
        voice: Boolean(publicData?.callCapabilities?.voice),
        video: Boolean(publicData?.callCapabilities?.video),
        webrtc: Boolean(publicData?.callCapabilities?.webrtc),
      },
    });
  }

  async function prepareLocalMediaAndIce() {
    setIsPreparingCall(true);
    setIsSystemReady(false);
    candidateBufferRef.current = [];
    if (iceTimeoutRef.current) {
      clearTimeout(iceTimeoutRef.current);
      iceTimeoutRef.current = null;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStreamRef.current = stream;

    const tempPc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    tempPcRef.current = tempPc;
    stream.getTracks().forEach((track) => tempPc.addTrack(track, stream));

    let hasRelay = false;
    iceTimeoutRef.current = setTimeout(() => {
      if (!isSystemReady) setIsSystemReady(true);
    }, 3000);

    tempPc.onicecandidate = (event) => {
      if (event.candidate) {
        candidateBufferRef.current.push(event.candidate);
        if (String(event.candidate.candidate || '').includes('typ relay') && !hasRelay) {
          hasRelay = true;
          if (iceTimeoutRef.current) {
            clearTimeout(iceTimeoutRef.current);
            iceTimeoutRef.current = null;
          }
          setIsSystemReady(true);
        }
      }
    };

    const offer = await tempPc.createOffer();
    await tempPc.setLocalDescription(offer);
  }

  async function handleCallClick(video) {
    if (!ecardData?.publicStatus?.enabled) return;
    if (!publicData?.callCapabilities?.webrtc) return;
    if (video && !publicData?.callCapabilities?.video) return;
    if (!video && !publicData?.callCapabilities?.voice) return;
    if (registrationStatus !== 'registered') return;
    if (isPreparingCall || callBusy) return;
    if (!callSessionRef.current || !uaRef.current) return;

    setCallBusy(true);
    setIsVideoCall(Boolean(video && callSessionRef.current?.enableVideo));
    setCallStatus('準備中...');
    try {
      await prepareLocalMediaAndIce();
      setIsConfirmOpen(true);
    } catch (err) {
      cleanupCallResources();
      setErrorInfo({
        code: err?.code || 'ECARD_CALL_SESSION_FAILED',
        message: err?.message || '呼叫配置建立失敗，請稍後再試',
      });
    } finally {
      setCallBusy(false);
      setIsPreparingCall(false);
    }
  }

  async function handleConfirmCall() {
    const callSession = callSessionRef.current;
    const uaInstance = uaRef.current;
    if (!callSession || !uaInstance || registrationStatus !== 'registered') {
      setErrorInfo({ code: 'ECARD_CALL_SESSION_FAILED', message: '呼叫配置建立失敗，請稍後再試' });
      return;
    }

    setIsConfirmOpen(false);
    setIsCallModalOpen(true);
    setCallStatus('呼叫中...');
    callStartTimeRef.current = Date.now();

    const targetUri = callSession.targetSipUri;
    const options = {
      mediaStream: localStreamRef.current,
      pcConfig: {
        iceServers: iceServersRef.current,
        iceTransportPolicy: 'all',
        iceCandidatePoolSize: 0,
      },
      eventHandlers: {
        icecandidate: (data) => {
          const { candidate, ready } = data;
          if (candidate?.candidate?.includes('typ relay')) {
            ready?.();
            return;
          }
          if (!window.__ecardIceReadyTimer) {
            window.__ecardIceReadyTimer = setTimeout(() => {
              ready?.();
              window.__ecardIceReadyTimer = null;
            }, 1000);
          }
        },
        connecting: () => {},
        progress: () => {
          setCallStatus('正在響鈴...');
          const pc = currentSessionRef.current?.connection;
          if (pc && candidateBufferRef.current.length > 0) {
            candidateBufferRef.current.forEach((cand) => {
              pc.addIceCandidate(cand).catch(() => {});
            });
            candidateBufferRef.current = [];
          }
        },
        ringing: () => {
          setCallStatus('正在響鈴...');
        },
        peerconnection: (e) => {
          const pc = e.peerconnection;
          applyCodecPreferences(pc);
          pc.onicegatheringstatechange = () => {};
          pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'connected') {
              bindRemoteAudio(pc);
            }
          };
          pc.ontrack = (event) => {
            if (event.track.kind === 'video' && remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = new MediaStream([event.track]);
            }
          };
        },
        accepted: () => {
          setCallStatus('通話中');
        },
        confirmed: () => {
          setCallStatus('通話中');
          if (isVideoCall) setTimeout(upgradeToVideo, 4500);
        },
        failed: () => {
          handleHangup();
        },
        ended: () => {
          handleHangup();
        },
      },
    };

    if (!activeCallStartedRef.current) {
      activeCallStartedRef.current = true;
      try {
        currentSessionRef.current = uaInstance.call(targetUri, options);
      } catch {
        handleHangup();
      }
    }
  }

  const publicStatus = publicData?.publicStatus || {};
  const canVoice = Boolean(publicData?.callCapabilities?.voice && publicData?.callCapabilities?.webrtc);
  const canVideo = Boolean(publicData?.callCapabilities?.video && publicData?.callCapabilities?.webrtc && ecardData?.enableVideoCall);
  const displayAvatar = pageImage || '';

  useEffect(() => {
    if (loading || errorInfo || !ecardData || !publicData) return;
    if (!publicStatus.enabled) return;
    if (autoRegisterStartedRef.current || uaRef.current || registrationStatus === 'registered') return;
    startRegistration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, errorInfo, ecardData, publicData, slug, publicStatus.enabled, registrationStatus]);

  if (loading) {
    return (
      <div style={loadingStyle}>
        <LoaderCircle size={24} className="spin" />
        <div style={{ marginTop: 14, color: '#475569', fontSize: 15, fontWeight: 600 }}>載入中...</div>
      </div>
    );
  }

  if (errorInfo || !ecardData) {
    return (
      <div style={errorPageStyle}>
        <div style={errorCardStyle}>
          <div style={errorIconWrapStyle}>
            <AlertTriangle size={34} />
          </div>
          <div style={errorTitleStyle}>電子名片暫時無法使用</div>
          <div style={errorMessageStyle}>{errorInfo?.message || '電子名片不存在或不可用'}</div>
          <div style={errorHintStyle}>請確認訪問鏈接是否正確，或稍後再試。</div>
        </div>
      </div>
    );
  }

  if (!publicStatus.enabled) {
    return (
      <div className="ecard-visitor-page" style={errorPageStyle}>
        <div style={errorCardStyle}>
          <div style={errorIconWrapStyle}>
            <AlertTriangle size={34} />
          </div>
          <div style={errorTitleStyle}>
            {publicStatus.expired ? '此電子名片已過期' : '此電子名片目前未啟用'}
          </div>
          <div style={errorMessageStyle}>
            {publicStatus.expired ? '請聯繫管理員重新啟用或更新有效期。' : '請聯繫管理員確認名片狀態。'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ecard-visitor-page" style={pageStyle}>
      <div className="ecard-shell">
        <div className="ecard-shellHeader">
          <div className="ecard-brandTitle">
            <div className="ecard-brandMark" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 5.5H18M4 11H18M4 16.5H12" stroke="#F1D37A" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div className="ecard-brandName">QRTalkie Ecard</div>
              <div className="ecard-brandSub">Secure visitor page · voice / video calling enabled</div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDebugEntry}
            className="ecard-debugButton"
            title="Debug"
            aria-label="debug-entry"
          >
            <Info size={18} />
          </button>
        </div>

        <div className="ecard-shellBody">
          <div className="ecard-leftPanel">
            <div className="ecard-profileTop">
              <div className="ecard-avatarWrap">
                <img
                  src={displayAvatar}
                  alt={ecardData.name}
                  className="ecard-avatar"
                  onError={(e) => { e.currentTarget.src = fallbackAvatar; }}
                />
                <div className="ecard-avatarRing" />
              </div>
              <div className="ecard-profileMain">
                <h1 className="ecard-name" style={nameStyle}>{ecardData.name}</h1>
                <div className="ecard-duty">{ecardData.duty || '—'}</div>
                <div className="ecard-company"><b>{companyName}</b></div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <div className="ecard-statusCard ecard-statusCard-inline" style={{ flex: 1 }}>
                <div className="ecard-statusHead">
                  <div>
                    <div className="ecard-statusTitle">Web 账号状态</div>
                    <div className="ecard-statusSub">已注册后可进行语音 / 视频呼叫</div>
                  </div>
                  <div className="ecard-statusActions">
                    <div
                      className={`ecard-statusDot ${registrationStatus === 'registered' ? 'is-ok' : 'is-bad'}`}
                      title={registrationStatus === 'registered' ? '已注册' : '未注册 / 失败'}
                    />
                    <button
                      type="button"
                      onClick={handleRetryRegister}
                      disabled={registrationStatus === 'registering' || isReRegistering}
                      title={registrationStatus === 'registered' ? '重新註冊' : registrationStatus === 'registering' ? '正在註冊...' : '重新嘗試註冊'}
                      aria-label="retry-registration"
                      className="ecard-refreshButton"
                      style={{
                        ...retryButtonDesktopStyle,
                        opacity: registrationStatus === 'registering' || isReRegistering ? 0.45 : registrationStatus === 'registered' ? 0.9 : 1,
                        cursor: registrationStatus === 'registering' || isReRegistering ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <RefreshCw size={15} className={registrationStatus === 'registering' || isReRegistering ? 'spin' : ''} />
                    </button>
                  </div>
                </div>
                <div className={`ecard-statusPill ${registrationStatus === 'registered' ? 'is-ok' : 'is-bad'}`}>
                  {registrationStatus === 'registered' ? '已註冊' : registrationStatus === 'registering' ? '註冊中' : '註冊失敗'}
                </div>
              </div>

              <div className="ecard-statusCard ecard-statusCard-inline" style={{ flex: 1 }}>
                <div className="ecard-statusHead">
                  <div>
                    <div className="ecard-statusTitle">SIP 账号状态</div>
                    <div className="ecard-statusSub">{ecardData.sipAccount || '—'}</div>
                  </div>
                  <div className="ecard-statusActions">
                    <div
                      className={`ecard-statusDot ${ecardData.sipRegistrationStatus === 'online' ? 'is-ok' : ecardData.sipRegistrationStatus === 'offline' ? 'is-bad' : 'is-warn'}`}
                      title={ecardData.sipRegistrationStatus === 'online' ? '在線' : ecardData.sipRegistrationStatus === 'offline' ? '離線' : '未知'}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (isSipRefreshing) return;
                        setIsSipRefreshing(true);
                        try {
                          const res = await apiClient.get(`/ecard/public/${slug}`);
                          if (res?.data?.sipRegistrationStatus) {
                            setEcardData(prev => ({ ...prev, sipRegistrationStatus: res.data.sipRegistrationStatus }));
                          }
                        } catch {} finally { setIsSipRefreshing(false); }
                      }}
                      disabled={isSipRefreshing}
                      title="重新獲取 SIP 狀態"
                      className="ecard-refreshButton"
                      style={{
                        opacity: isSipRefreshing ? 0.45 : 0.9,
                        cursor: isSipRefreshing ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <RefreshCw size={15} className={isSipRefreshing ? 'spin' : ''} />
                    </button>
                  </div>
              </div>
              <div className={`ecard-statusPill ${ecardData.sipRegistrationStatus === 'online' ? 'is-ok' : ecardData.sipRegistrationStatus === 'offline' ? 'is-bad' : 'is-warn'}`}>
                {ecardData.sipRegistrationStatus === 'online' ? 'SIP 在線' : ecardData.sipRegistrationStatus === 'offline' ? 'SIP 離線' : 'SIP 未知'}
              </div>
            </div>
            </div>

            {registrationStatus !== 'registered' && (
              <div className="ecard-registrationMessage" style={{
                marginTop: 2,
                marginBottom: 4,
                fontSize: 13,
                lineHeight: 1.6,
                color: registrationStatus === 'failed' ? '#fca5a5' : '#d6c59c',
                fontWeight: 600,
              }}>
                {registrationMessage}
              </div>
            )}

            <div className="ecard-contactGrid" style={infoBlockStyle}>
              <div className="ecard-contactItem">
                <div className="ecard-contactLabel">手機</div>
                <div className="ecard-contactValue">{ecardData.phone || '—'}</div>
              </div>
              <div className="ecard-contactItem">
                <div className="ecard-contactLabel">郵箱</div>
                <div className="ecard-contactValue">{ecardData.email || '—'}</div>
              </div>
              <div className="ecard-contactItem">
                <div className="ecard-contactLabel">地址</div>
                <div className="ecard-contactValue">{ecardData.address || '未填寫'}</div>
              </div>
              <div className="ecard-contactItem">
                <div className="ecard-contactLabel">SIP 目標</div>
                <div className="ecard-contactValue ecard-sipTarget">{ecardData.sipAccount || '—'}</div>
              </div>
            </div>

            <div className="ecard-callButtons" style={buttonGroupStyle}>
              <button
                type="button"
                onClick={() => handleCallClick(false)}
                disabled={!canVoice || callBusy || registrationStatus !== 'registered'}
                className="ecard-callButton ecard-callButton-voice"
                style={{
                  ...callButtonStyle,
                  background: canVoice && !callBusy && registrationStatus === 'registered'
                    ? 'linear-gradient(180deg, #7d1010 0%, #4c0a0a 100%)'
                    : 'linear-gradient(180deg, #343941 0%, #23272f 100%)',
                  color: canVoice && !callBusy && registrationStatus === 'registered' ? '#fff4dd' : '#8a93a3',
                  cursor: canVoice && !callBusy && registrationStatus === 'registered' ? 'pointer' : 'not-allowed',
                }}
              >
                <Headphones size={18} style={{ marginRight: 8 }} />
                語音呼叫
              </button>
              <button
                type="button"
                onClick={() => handleCallClick(true)}
                disabled={!canVideo || callBusy || registrationStatus !== 'registered'}
                className="ecard-callButton ecard-callButton-video"
                style={{
                  ...callButtonStyle,
                  background: canVideo && !callBusy && registrationStatus === 'registered'
                    ? 'linear-gradient(180deg, #7d1010 0%, #4c0a0a 100%)'
                    : 'linear-gradient(180deg, #343941 0%, #23272f 100%)',
                  color: canVideo && !callBusy && registrationStatus === 'registered' ? '#fff4dd' : '#8a93a3',
                  cursor: canVideo && !callBusy && registrationStatus === 'registered' ? 'pointer' : 'not-allowed',
                }}
              >
                <Video size={18} style={{ marginRight: 8 }} />
                視頻呼叫
              </button>
            </div>
          </div>

        </div>
      </div>

      <audio id="remoteAudio" autoPlay style={{ display: 'none' }} />

      <ConfirmModal
        isOpen={isConfirmOpen}
        onClose={() => {
          cleanupCallResources();
        }}
        onConfirm={handleConfirmCall}
        title="發起呼叫"
        type="info"
        confirmText={isSystemReady ? '確認呼叫' : '優化網路'}
        confirmDisabled={!isSystemReady}
        cancelText="取消"
        message={`確定要呼叫此電子名片的${isVideoCall ? '視頻' : '語音'}通話嗎？`}
      />

      <CallModal
        isOpen={isCallModalOpen}
        onClose={handleHangup}
        onToggleVideo={handleToggleVideo}
        callStatus={callStatus || '呼叫中...'}
        isVideoCall={isVideoCall}
        isLocalVideoActive={isLocalVideoActive}
        roomName={ecardData.name}
        avatarUrl={displayAvatar}
        videoRefs={{ remoteVideoRef, localVideoRef }}
      />
    </div>
  );
}

const fallbackAvatar = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
    <rect width="320" height="320" rx="160" fill="#f1f5f9"/>
    <circle cx="160" cy="122" r="56" fill="#cbd5e1"/>
    <path d="M64 288c14-46 52-72 96-72s82 26 96 72" fill="#cbd5e1"/>
  </svg>
`);

const loadingStyle = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'radial-gradient(circle at top left, rgba(212, 175, 55, 0.10), transparent 30%), linear-gradient(180deg, #08090b 0%, #0d1116 100%)',
  color: '#f1d37a',
};

const errorPageStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'radial-gradient(circle at top left, rgba(212, 175, 55, 0.10), transparent 30%), linear-gradient(180deg, #08090b 0%, #0d1116 100%)',
  padding: 24,
};

const errorCardStyle = {
  width: 'min(440px, 100%)',
  borderRadius: 24,
  border: '1px solid rgba(212, 175, 55, 0.18)',
  boxShadow: '0 20px 54px rgba(0, 0, 0, 0.34)',
  padding: 28,
  textAlign: 'center',
  background: 'linear-gradient(180deg, rgba(24,29,36,0.98), rgba(12,15,19,0.98))',
};

const errorIconWrapStyle = {
  width: 60,
  height: 60,
  borderRadius: '50%',
  margin: '0 auto 18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(239, 83, 80, 0.12)',
  color: '#ffb5b5',
};

const errorTitleStyle = {
  fontSize: 20,
  lineHeight: 1.4,
  fontWeight: 800,
  color: '#fff7df',
};

const errorMessageStyle = {
  marginTop: 12,
  fontSize: 14,
  lineHeight: 1.8,
  color: '#c8bfae',
};

const errorHintStyle = {
  marginTop: 10,
  fontSize: 12,
  lineHeight: 1.7,
  color: '#8b8f96',
};

const pageStyle = {
  minHeight: '100vh',
  background: 'radial-gradient(circle at top left, rgba(212, 175, 55, 0.10), transparent 30%), radial-gradient(circle at bottom right, rgba(125, 16, 16, 0.18), transparent 26%), linear-gradient(180deg, #08090b 0%, #0b0d10 36%, #0d1116 100%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#f5efe3',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  padding: '8px 12px',
  overflow: 'hidden',
};

const shellStyle = {
  width: '100%',
  maxWidth: 1040,
  display: 'block',
  margin: '0 auto',
};

const leftPanelStyle = {
  flex: '1 1 0%',
  padding: 0,
  borderRadius: 0,
  border: 'none',
  background: 'transparent',
};

const rightPanelStyle = {
  flex: '1 1 0%',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 0,
  border: 'none',
  background: 'transparent',
};

const nameStyle = {
  fontSize: 'clamp(22px, 1.9vw, 30px)',
  lineHeight: 1.08,
  fontWeight: 900,
  color: '#fff7df',
  margin: 0,
};

const infoBlockStyle = {
  marginBottom: 0,
  display: 'grid',
  gap: 8,
};

const infoRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 24,
  flexWrap: 'wrap',
};

const infoLabelStyle = {
  color: '#8b8f96',
  fontWeight: 700,
};

const infoValueStyle = {
  color: '#f5efe3',
  fontSize: 14,
};

const contactTextStyle = {
  color: '#f5efe3',
  fontSize: 14,
  wordBreak: 'break-word',
};

const buttonGroupStyle = {
  display: 'flex',
  flexDirection: 'row',
  gap: 8,
  marginTop: 0,
};

const callButtonStyle = {
  width: '100%',
  padding: '8px 14px',
  borderRadius: 12,
  fontWeight: 800,
  fontSize: 13,
  border: '1px solid rgba(212, 175, 55, 0.22)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'transform 0.15s ease, background 0.15s ease',
  boxShadow: '0 8px 18px rgba(125, 16, 16, 0.14)',
};

const mobileAvatarWrapStyle = {
  display: 'flex',
  justifyContent: 'center',
  marginBottom: 24,
};

const mobileAvatarOuterStyle = {
  width: 112,
  height: 112,
  borderRadius: '50%',
  border: '6px solid rgba(241, 211, 122, 0.14)',
  boxShadow: '0 14px 28px rgba(0, 0, 0, 0.26)',
  overflow: 'hidden',
  position: 'relative',
  background: '#11151b',
};

const statusActionWrapStyle = {
  position: 'absolute',
  right: 4,
  bottom: 4,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const statusActionDesktopWrapStyle = {
  position: 'absolute',
  top: 12,
  right: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const retryButtonStyle = {
  width: 20,
  height: 20,
  borderRadius: '50%',
  border: '1px solid rgba(212, 175, 55, 0.22)',
  background: 'rgba(125, 16, 16, 0.14)',
  color: '#f1d37a',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 1px 4px rgba(0,0,0,0.16)',
};

const retryButtonDesktopStyle = {
  ...retryButtonStyle,
  width: 22,
  height: 22,
};

const mobileAvatarStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const desktopAvatarOuterStyle = {
  width: 256,
  height: 256,
  borderRadius: 18,
  border: '6px solid rgba(241, 211, 122, 0.14)',
  boxShadow: '0 14px 28px rgba(0, 0, 0, 0.26)',
  overflow: 'hidden',
  position: 'relative',
  background: '#11151b',
};

const desktopAvatarStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const statusDotStyle = {
  width: 24,
  height: 24,
  borderRadius: '50%',
  border: '4px solid rgba(12,15,19,0.98)',
  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.18)',
  position: 'absolute',
  right: 6,
  bottom: 6,
};
