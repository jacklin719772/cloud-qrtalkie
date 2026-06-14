import React from 'react';
import { PhoneOff, Video, VideoOff } from 'lucide-react';

const placeholderAvatar = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
    <rect width="160" height="160" rx="80" fill="#f1f5f9"/>
    <circle cx="80" cy="62" r="28" fill="#cbd5e1"/>
    <path d="M30 136c7-23 26-36 50-36s43 13 50 36" fill="#cbd5e1"/>
  </svg>
`);

function CallModal({
  isOpen,
  onClose,
  callStatus,
  isVideoCall,
  isLocalVideoActive,
  onToggleVideo,
  roomName,
  avatarUrl,
  videoRefs,
}) {
  if (!isOpen) return null;

  const localVideoRef = videoRefs?.localVideoRef;
  const remoteVideoRef = videoRefs?.remoteVideoRef;

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <div style={topBodyStyle}>
          <div style={avatarWrapStyle}>
            <img
              src={avatarUrl || placeholderAvatar}
              alt="avatar"
              style={avatarStyle}
              onError={(e) => { e.currentTarget.src = placeholderAvatar; }}
            />
          </div>
          <div style={nameStyle}>{roomName}</div>
          <div style={statusStyle}>{callStatus}</div>
        </div>

        {isVideoCall && (
          <div style={videoStageStyle}>
            <video ref={remoteVideoRef} autoPlay playsInline style={remoteVideoStyle} />
            <div style={selfPreviewStyle}>
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  opacity: isLocalVideoActive ? 1 : 0,
                  transition: 'opacity 0.35s ease',
                }}
              />
              {!isLocalVideoActive && (
                <div style={selfPreviewPlaceholderStyle}>
                  <VideoOff size={24} color="rgba(255,255,255,0.45)" />
                </div>
              )}
            </div>
          </div>
        )}

        <div style={footerStyle}>
          {isVideoCall && (
            <button
              type="button"
              onClick={onToggleVideo}
              style={{
                ...roundButtonStyle,
                background: isLocalVideoActive ? '#002B5B' : '#ffffff',
                border: isLocalVideoActive ? '2px solid #002B5B' : '2px solid #002B5B',
                color: isLocalVideoActive ? '#ffffff' : '#002B5B',
              }}
              aria-label="toggle-video"
            >
              {isLocalVideoActive ? <Video size={22} /> : <VideoOff size={22} />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={hangupButtonStyle}
            aria-label="hangup"
          >
            <PhoneOff size={22} />
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 180,
  background: 'rgba(0,0,0,0.64)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const panelStyle = {
  width: 'min(420px, 100%)',
  borderRadius: 24,
  overflow: 'hidden',
  background: 'linear-gradient(180deg, rgba(24,29,36,0.98), rgba(12,15,19,0.98))',
  boxShadow: '0 28px 80px rgba(0, 0, 0, 0.46)',
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid rgba(212, 175, 55, 0.18)',
};

const topBodyStyle = {
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
};

const avatarWrapStyle = {
  width: 80,
  height: 80,
  borderRadius: '50%',
  overflow: 'hidden',
  border: '4px solid rgba(241, 211, 122, 0.14)',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
  background: '#11151b',
  marginBottom: 14,
};

const avatarStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const nameStyle = {
  fontSize: 20,
  lineHeight: 1.3,
  fontWeight: 800,
  color: '#fff7df',
};

const statusStyle = {
  marginTop: 8,
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#f1d37a',
};

const videoStageStyle = {
  position: 'relative',
  width: '100%',
  background: '#0a0c10',
  aspectRatio: '16 / 9',
  overflow: 'hidden',
};

const remoteVideoStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  background: '#000000',
};

const selfPreviewStyle = {
  position: 'absolute',
  right: 10,
  bottom: 10,
  width: 96,
  height: 128,
  borderRadius: 14,
  overflow: 'hidden',
  background: '#000000',
  border: '1px solid rgba(212, 175, 55, 0.18)',
  boxShadow: '0 12px 26px rgba(0,0,0,0.28)',
};

const selfPreviewPlaceholderStyle = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#1f2937',
};

const footerStyle = {
  padding: '22px 24px',
  background: 'rgba(255,255,255,0.03)',
  display: 'flex',
  justifyContent: 'center',
  gap: 32,
};

const roundButtonStyle = {
  width: 56,
  height: 56,
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.24)',
  cursor: 'pointer',
  transition: 'transform 0.12s ease',
};

const hangupButtonStyle = {
  ...roundButtonStyle,
  background: 'linear-gradient(180deg, #7d1010, #4c0a0a)',
  border: '1px solid rgba(212, 175, 55, 0.22)',
  color: '#ffffff',
};

export default CallModal;
