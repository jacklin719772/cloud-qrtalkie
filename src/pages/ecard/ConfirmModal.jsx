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
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{title}</div>
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
            <div style={{ color: '#0f172a', lineHeight: 1.6 }}>{message}</div>
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
  background: 'rgba(15, 23, 42, 0.55)',
  backdropFilter: 'blur(6px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const panelStyle = {
  width: 'min(440px, 100%)',
  background: '#ffffff',
  borderRadius: 18,
  boxShadow: '0 24px 80px rgba(15, 23, 42, 0.24)',
  overflow: 'hidden',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: '1px solid #e2e8f0',
};

const bodyStyle = {
  padding: 20,
};

const footerStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 12,
  padding: '14px 20px 18px',
  borderTop: '1px solid #e2e8f0',
  background: '#f8fafc',
};

const secondaryButtonStyle = {
  padding: '10px 16px',
  borderRadius: 10,
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#334155',
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
  border: '1px solid #e2e8f0',
  background: '#ffffff',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#475569',
  cursor: 'pointer',
};

export default ConfirmModal;

