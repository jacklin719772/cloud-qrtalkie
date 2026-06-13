import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Mail, Phone, UserRound, Headphones, Video, LoaderCircle } from 'lucide-react';
import apiClient from '../../apiClient';
import CallModal from './CallModal';
import ConfirmModal from './ConfirmModal';
import { ensureJsSIPLoaded } from './loadJsSIP';

const JS_SIP_CALL_CDN_NOTE = 'JsSIP 由前端在用戶點擊呼叫時動態載入。';

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
    media: data?.media || {},
    template: data?.template || {},
    tenantName: data?.tenantName || '',
  };
}

export default function ECardVisitorPage({ slug }) {
  const [loading, setLoading] = useState(true);
  const [errorInfo, setErrorInfo] = useState(null);
  const [ecardData, setEcardData] = useState(null);
  const [publicData, setPublicData] = useState(null);

  const [callStatus, setCallStatus] = useState('');
  const [registrationStatus, setRegistrationStatus] = useState('unregistered');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [isVideoCall, setIsVideoCall] = useState(false);
  const [isLocalVideoActive, setIsLocalVideoActive] = useState(false);
  const [isSystemReady, setIsSystemReady] = useState(false);
  const [isPreparingCall, setIsPreparingCall] = useState(false);
  const [callBusy, setCallBusy] = useState(false);

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

  const pageImage = useMemo(() => {
    if (!ecardData?.avatar) return '';
    return toAbsoluteAssetUrl(ecardData.avatar);
  }, [ecardData?.avatar]);

  useEffect(() => {
    let cancelled = false;

    async function loadPublicData() {
      setLoading(true);
      setErrorInfo(null);
      setEcardData(null);
      setPublicData(null);
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
      cleanupCallResources();
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
  }

  function cleanupActiveCall() {
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
    setRegistrationStatus('unregistered');
    activeCallStartedRef.current = false;
    candidateBufferRef.current = [];
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

  async function prepareCallSession(video) {
    const res = await apiClient.post(`/ecard/public/${slug}/call-session`);
    if (!res?.success) {
      throw new Error(res?.message || '呼叫配置建立失敗，請稍後再試');
    }
    const data = res.data || {};
    if (!data?.webAccount || !data?.credential?.value || !data?.wssUrl || !data?.webrtcDomain || !data?.targetSipUri) {
      throw new Error('呼叫配置建立失敗，請稍後再試');
    }
    callSessionRef.current = data;
    iceServersRef.current = Array.isArray(data.iceServers) ? data.iceServers : [];
    setIsVideoCall(Boolean(video && data.enableVideo));
    return data;
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
    if (isPreparingCall || callBusy) return;

    setCallBusy(true);
    setIsVideoCall(Boolean(video));
    setCallStatus('準備中...');
    try {
      await prepareCallSession(video);
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
    if (!callSession) {
      setErrorInfo({ code: 'ECARD_CALL_SESSION_FAILED', message: '呼叫配置建立失敗，請稍後再試' });
      return;
    }

    setIsConfirmOpen(false);
    setIsCallModalOpen(true);
    setCallStatus('呼叫中...');
    callStartTimeRef.current = Date.now();

    const JsSIP = await ensureJsSIPLoaded();
    if (!JsSIP) {
      setErrorInfo({ code: 'ECARD_CALL_SESSION_FAILED', message: '呼叫配置建立失敗，請稍後再試' });
      handleHangup();
      return;
    }

    const socket = new JsSIP.WebSocketInterface(callSession.wssUrl);
    const uaInstance = new JsSIP.UA({
      sockets: [socket],
      uri: `sip:${callSession.webAccount}@${callSession.webrtcDomain}`,
      password: callSession.credential.value,
      register: true,
    });

    uaRef.current = uaInstance;
    activeCallStartedRef.current = false;

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

    uaInstance.on('registered', () => {
      setRegistrationStatus('registered');
      injectSdpPatch(uaInstance, callSession.sipServerPublicIp);
      if (!activeCallStartedRef.current) {
        activeCallStartedRef.current = true;
        try {
          currentSessionRef.current = uaInstance.call(targetUri, options);
        } catch {
          handleHangup();
        }
      }
    });

    uaInstance.on('unregistered', () => {
      setRegistrationStatus('unregistered');
    });
    uaInstance.on('registrationFailed', () => {
      setRegistrationStatus('unregistered');
      handleHangup();
    });

    uaInstance.start();
  }

  const publicStatus = publicData?.publicStatus || {};
  const canVoice = Boolean(publicData?.callCapabilities?.voice && publicData?.callCapabilities?.webrtc);
  const canVideo = Boolean(publicData?.callCapabilities?.video && publicData?.callCapabilities?.webrtc);
  const displayAvatar = pageImage || '';

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
      <div style={errorPageStyle}>
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
    <div style={pageStyle}>
      <div style={shellStyle}>
        <div style={leftPanelStyle}>
          <h1 style={nameStyle}>{ecardData.name}</h1>

          <div style={infoBlockStyle}>
            <div style={infoRowStyle}>
              <UserRound size={18} color="#475569" />
              <span style={infoLabelStyle}>職務：</span>
              <span style={infoValueStyle}>{ecardData.duty || '—'}</span>
            </div>
          </div>

          <div style={mobileAvatarWrapStyle}>
            <div style={mobileAvatarOuterStyle}>
              <img
                src={displayAvatar}
                alt={ecardData.name}
                style={mobileAvatarStyle}
                onError={(e) => { e.currentTarget.src = fallbackAvatar; }}
              />
              <div style={{ ...statusDotStyle, background: registrationStatus === 'registered' ? '#22c55e' : '#ef4444' }} />
            </div>
          </div>

          <div style={infoBlockStyle}>
            <div style={infoRowStyle}>
              <Phone size={18} color="#475569" />
              <span style={contactTextStyle}>{`${ecardData.sipAccount || '—'}@${ecardData.sipAccountInfo?.domain || ''}`}</span>
            </div>
            <div style={infoRowStyle}>
              <Mail size={18} color="#475569" />
              <span style={contactTextStyle}>{ecardData.email || '—'}</span>
            </div>
          </div>

          <div style={buttonGroupStyle}>
            <button
              type="button"
              onClick={() => handleCallClick(false)}
              disabled={!canVoice || callBusy}
              style={{
                ...callButtonStyle,
                background: canVoice && !callBusy ? '#000000' : '#d1d5db',
                color: canVoice && !callBusy ? '#ffffff' : '#6b7280',
                cursor: canVoice && !callBusy ? 'pointer' : 'not-allowed',
              }}
            >
              <Headphones size={18} style={{ marginRight: 8 }} />
              語音呼叫
            </button>
            <button
              type="button"
              onClick={() => handleCallClick(true)}
              disabled={!canVideo || callBusy}
              style={{
                ...callButtonStyle,
                background: canVideo && !callBusy ? '#000000' : '#d1d5db',
                color: canVideo && !callBusy ? '#ffffff' : '#6b7280',
                cursor: canVideo && !callBusy ? 'pointer' : 'not-allowed',
              }}
            >
              <Video size={18} style={{ marginRight: 8 }} />
              視頻呼叫
            </button>
          </div>
        </div>

        <div style={rightPanelStyle}>
          <div style={desktopAvatarOuterStyle}>
            <img
              src={displayAvatar}
              alt={ecardData.name}
              style={desktopAvatarStyle}
              onError={(e) => { e.currentTarget.src = fallbackAvatar; }}
            />
            <div style={{ ...statusDotStyle, top: 16, right: 16, background: registrationStatus === 'registered' ? '#22c55e' : '#ef4444' }} />
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
  background: '#ffffff',
  color: '#475569',
};

const errorPageStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#ffffff',
  padding: 24,
};

const errorCardStyle = {
  width: 'min(440px, 100%)',
  borderRadius: 20,
  border: '1px solid #e2e8f0',
  boxShadow: '0 20px 54px rgba(15, 23, 42, 0.08)',
  padding: 28,
  textAlign: 'center',
};

const errorIconWrapStyle = {
  width: 60,
  height: 60,
  borderRadius: '50%',
  margin: '0 auto 18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(239, 68, 68, 0.1)',
  color: '#ef4444',
};

const errorTitleStyle = {
  fontSize: 20,
  lineHeight: 1.4,
  fontWeight: 800,
  color: '#0f172a',
};

const errorMessageStyle = {
  marginTop: 12,
  fontSize: 14,
  lineHeight: 1.8,
  color: '#475569',
};

const errorHintStyle = {
  marginTop: 10,
  fontSize: 12,
  lineHeight: 1.7,
  color: '#64748b',
};

const pageStyle = {
  minHeight: '100vh',
  background: '#ffffff',
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'center',
  color: '#333333',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const shellStyle = {
  width: '100%',
  maxWidth: 960,
  display: 'flex',
  flexDirection: 'row',
  background: '#ffffff',
};

const leftPanelStyle = {
  flex: '1 1 0%',
  padding: 24,
};

const rightPanelStyle = {
  flex: '1 1 0%',
  padding: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f8fafc',
};

const nameStyle = {
  fontSize: 'clamp(30px, 4vw, 40px)',
  lineHeight: 1.2,
  fontWeight: 800,
  color: '#111827',
  margin: '0 0 24px',
};

const infoBlockStyle = {
  marginBottom: 24,
  display: 'grid',
  gap: 14,
};

const infoRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 24,
  flexWrap: 'wrap',
};

const infoLabelStyle = {
  color: '#475569',
  fontWeight: 600,
};

const infoValueStyle = {
  color: '#1f2937',
  fontSize: 16,
};

const contactTextStyle = {
  color: '#1f2937',
  fontSize: 16,
  wordBreak: 'break-word',
};

const buttonGroupStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  marginTop: 24,
};

const callButtonStyle = {
  width: '100%',
  padding: '16px 18px',
  borderRadius: 14,
  fontWeight: 800,
  fontSize: 16,
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'transform 0.15s ease, background 0.15s ease',
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
  border: '6px solid #ffffff',
  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)',
  overflow: 'hidden',
  position: 'relative',
  background: '#f8fafc',
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
  border: '6px solid #ffffff',
  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)',
  overflow: 'hidden',
  position: 'relative',
  background: '#f8fafc',
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
  border: '4px solid #ffffff',
  boxShadow: '0 2px 6px rgba(15, 23, 42, 0.12)',
  position: 'absolute',
  right: 6,
  bottom: 6,
};

