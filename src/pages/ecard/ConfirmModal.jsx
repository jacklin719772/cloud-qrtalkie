import React from 'react';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = '確認操作',
  message = '確定要繼續嗎？',
  confirmText = '確認',
  cancelText = '取消',
  type = 'danger',
  confirmDisabled = false,
}) {
  if (!isOpen) return null;

  const palette = {
    danger: {
      icon: <AlertTriangle size={28} strokeWidth={2.2} />,
      badgeBg: 'rgba(239, 68, 68, 0.1)',
      badgeBorder: 'rgba(239, 68, 68, 0.2)',
      badgeColor: '#ef4444',
      confirmBg: '#ef4444',
    },
    warning: {
      icon: <AlertCircle size={28} strokeWidth={2.2} />,
      badgeBg: 'rgba(245, 158, 11, 0.1)',
      badgeBorder: 'rgba(245, 158, 11, 0.2)',
      badgeColor: '#f59e0b',
      confirmBg: '#f59e0b',
    },
    info: {
      icon: <Info size={28} strokeWidth={2.2} />,
      badgeBg: 'rgba(59, 130, 246, 0.1)',
      badgeBorder: 'rgba(59, 130, 246, 0.2)',
      badgeColor: '#3b82f6',
      confirmBg: '#3b82f6',
    },
  }[type] || {
    icon: <AlertTriangle size={28} strokeWidth={2.2} />,
    badgeBg: 'rgba(239, 68, 68, 0.1)',
    badgeBorder: 'rgba(239, 68, 68, 0.2)',
    badgeColor: '#ef4444',
    confirmBg: '#ef4444',
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f5efe3' }}>{title}</div>
          <button type="button" onClick={onClose} style={iconButtonStyle} aria-label="close">
            <X size={18} />
          </button>
        </div>
        <div style={bodyStyle}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 16px',
            borderRadius: 14,
            background: palette.badgeBg,
            border: `1px solid ${palette.badgeBorder}`,
            color: palette.badgeColor,
          }}>
            <div style={{ flexShrink: 0 }}>{palette.icon}</div>
            <div style={{ color: '#f5efe3', lineHeight: 1.6 }}>{message}</div>
          </div>
        </div>
        <div style={footerStyle}>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>
            {cancelText}
          </button>
          <button
            type="button"
            onClick={() => { if (!confirmDisabled) onConfirm?.(); }}
            disabled={confirmDisabled}
            style={{
              ...primaryButtonStyle,
              background: confirmDisabled ? '#94a3b8' : palette.confirmBg,
              cursor: confirmDisabled ? 'not-allowed' : 'pointer',
              opacity: confirmDisabled ? 0.65 : 1,
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 200,
  background: 'rgba(0, 0, 0, 0.64)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const panelStyle = {
  width: 'min(440px, 100%)',
  background: 'linear-gradient(180deg, rgba(24,29,36,0.98), rgba(12,15,19,0.98))',
  borderRadius: 22,
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.42)',
  overflow: 'hidden',
  border: '1px solid rgba(212, 175, 55, 0.18)',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: '1px solid rgba(212, 175, 55, 0.14)',
};

const bodyStyle = {
  padding: 20,
};

const footerStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 12,
  padding: '14px 20px 18px',
  borderTop: '1px solid rgba(212, 175, 55, 0.14)',
  background: 'rgba(255,255,255,0.03)',
};

const secondaryButtonStyle = {
  padding: '10px 16px',
  borderRadius: 10,
  border: '1px solid rgba(212, 175, 55, 0.18)',
  background: '#11151b',
  color: '#f5efe3',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const primaryButtonStyle = {
  padding: '10px 16px',
  borderRadius: 10,
  border: 'none',
  color: '#ffffff',
  fontSize: 14,
  fontWeight: 700,
};

const iconButtonStyle = {
  width: 34,
  height: 34,
  borderRadius: 10,
  border: '1px solid rgba(212, 175, 55, 0.18)',
  background: '#11151b',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#f1d37a',
  cursor: 'pointer',
};

export default ConfirmModal;
