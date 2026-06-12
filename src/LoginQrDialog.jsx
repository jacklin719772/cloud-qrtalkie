import React, { useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Download, RefreshCw } from 'lucide-react';

const mockLoginQrData = {
  provisionUrl: 'https://account.qrtalkie.org/provisioning/I22B5kUt',
  expireText: '該鏈接僅可訪問一次',
  qrStatus: 'active',
  updatedAt: '2026-06-12 19:30:00',
};

function generateMockUrl() {
  const rand = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `https://account.qrtalkie.org/provisioning/${rand}`;
}

export default function LoginQrDialog({ isOpen, onClose, account }) {
  const initialUrl = account
    ? `https://account.qrtalkie.org/provisioning/${account.username || 'default'}`
    : mockLoginQrData.provisionUrl;

  const [data, setData] = useState({ ...mockLoginQrData, provisionUrl: initialUrl });
  const [copied, setCopied] = useState(false);

  const handleRenew = useCallback(() => {
    const newUrl = account
      ? `https://account.qrtalkie.org/provisioning/${account.username || 'default'}/${generateMockUrl().split('/').pop()}`
      : generateMockUrl();
    setData({
      provisionUrl: newUrl,
      expireText: '該鏈接僅可訪問一次',
      qrStatus: 'active',
      updatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    });
  }, []);

  const handleCopyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(data.provisionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const input = document.createElement('input');
      input.value = data.provisionUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [data.provisionUrl]);

  const handleDownloadQr = useCallback(() => {
    const svg = document.querySelector('#login-qr-svg');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      canvas.width = 512;
      canvas.height = 512;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(img, 0, 0, 512, 512);
      const link = document.createElement('a');
      link.download = `login-qrcode-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }, []);

  const handleCopyQr = useCallback(() => {
    const svg = document.querySelector('#login-qr-svg');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = async () => {
      canvas.width = 512;
      canvas.height = 512;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(img, 0, 0, 512, 512);
      canvas.toBlob(async (blob) => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob }),
          ]);
        } catch {
          // fallback not needed for image copy
        }
      });
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }, []);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2147483647,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(2px)',
      }} />

      {/* Dialog */}
      <div style={{
        position: 'relative',
        width: '560px', maxWidth: '94vw',
        background: 'linear-gradient(160deg, #1a1f2e 0%, #111827 100%)',
        border: '1px solid rgba(75, 85, 99, 0.4)',
        borderRadius: '16px',
        boxShadow: '0 25px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255,255,255,0.03) inset',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          padding: '24px 28px 20px',
          borderBottom: '1px solid rgba(75, 85, 99, 0.2)',
        }}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f3f4f6', lineHeight: 1.3, whiteSpace: 'nowrap' }}>
                登錄二維碼
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af', lineHeight: 1.4, whiteSpace: 'nowrap' }}>
                使用支援二維碼登錄的用戶端掃描二維碼完成登錄
              </p>
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                更新後將生成新的 URL 與二維碼
              </p>
            </div>
          </div>

          {/* Close & Renew */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
            <button onClick={onClose} style={{
              width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '6px', border: 'none', background: 'transparent', color: '#6b7280',
              cursor: 'pointer', fontSize: '18px',
            }}>
              ✕
            </button>
            <button onClick={handleRenew} style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '6px 14px', borderRadius: '7px',
              border: '1px solid rgba(249, 115, 22, 0.4)',
              background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.15), rgba(234, 88, 12, 0.08))',
              color: '#f97316', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}>
              <RefreshCw size={13} /> Renew
            </button>
          </div>
        </div>

        {/* QR Code Section */}
        <div style={{
          display: 'flex', justifyContent: 'center',
          padding: '28px 0 20px',
          background: 'rgba(0,0,0,0.15)',
        }}>
          <div style={{
            background: '#ffffff', borderRadius: '12px', padding: '16px',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.3)',
          }}>
            <QRCodeSVG
              id="login-qr-svg"
              value={data.provisionUrl}
              size={200}
              bgColor="#ffffff"
              fgColor="#000000"
              level="M"
              includeMargin={false}
            />
          </div>
        </div>

        {/* QR Action Buttons */}
        <div style={{
          display: 'flex', justifyContent: 'center', gap: '10px',
          padding: '0 28px 16px',
        }}>
          <button onClick={handleCopyQr} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '8px',
            border: '1px solid rgba(75, 85, 99, 0.4)',
            background: 'rgba(55, 65, 81, 0.4)',
            color: '#d1d5db', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
          }}>
            <Copy size={14} /> 複製二維碼
          </button>
          <button onClick={handleDownloadQr} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '8px',
            border: '1px solid rgba(75, 85, 99, 0.4)',
            background: 'rgba(55, 65, 81, 0.4)',
            color: '#d1d5db', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
          }}>
            <Download size={14} /> 下載二維碼
          </button>
        </div>

        {/* URL Section */}
        <div style={{
          padding: '20px 28px 24px',
          borderTop: '1px solid rgba(75, 85, 99, 0.2)',
        }}>
          <div style={{ marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500 }}>
              登錄鏈接（仅可访问一次）
            </span>
          </div>
          <div style={{
            display: 'flex', gap: '8px',
          }}>
            <div style={{
              flex: 1, padding: '10px 14px', borderRadius: '8px',
              background: 'rgba(26, 35, 50, 0.8)', border: '1px solid rgba(55, 65, 81, 0.5)',
              color: '#d1d5db', fontSize: '13px', fontFamily: 'monospace',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center',
            }}>
              {data.provisionUrl}
            </div>
            <button onClick={handleCopyUrl} style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '10px 16px', borderRadius: '8px',
              border: '1px solid rgba(75, 85, 99, 0.4)',
              background: copied ? 'rgba(34, 197, 94, 0.15)' : 'rgba(55, 65, 81, 0.5)',
              color: copied ? '#4ade80' : '#d1d5db', fontSize: '12px', fontWeight: 500,
              cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.2s',
            }}>
              <Copy size={14} />
              {copied ? '已複製' : '複製鏈接'}
            </button>
          </div>
          <div style={{ marginTop: '8px' }}>
            <span style={{ fontSize: '11px', color: '#6b7280' }}>
              {data.expireText} · 更新于 {data.updatedAt}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
