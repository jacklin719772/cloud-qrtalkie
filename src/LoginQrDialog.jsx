import React, { useState, useCallback, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Download, RefreshCw, Loader } from 'lucide-react';
import apiClient from './apiClient';

export default function LoginQrDialog({ isOpen, onClose, account }) {
  const [provisionUrl, setProvisionUrl] = useState('');
  const [expireAt, setExpireAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const fetchedRef = useRef(false);

  const fetchProvisionUrl = useCallback(async (isRenew = false) => {
    if (!account?.id) return;
    if (isRenew) setRenewing(true); else setLoading(true);
    setError('');
    try {
      const apiBasePath = '/tenant/sip-accounts';
      const res = await apiClient.get(`${apiBasePath}/${account.id}/provisioning-url`);
      if (res?.data?.provisionUrl) {
        setProvisionUrl(res.data.provisionUrl);
        setExpireAt(res.data.expireAt || null);
      } else {
        setError(res?.message || '未獲取到可用鏈接');
      }
    } catch (err) {
      setError(err.message || '獲取 provisioning 鏈接失敗');
    } finally {
      setLoading(false);
      setRenewing(false);
    }
  }, [account?.id]);

  useEffect(() => {
    if (isOpen && account?.id) {
      if (!fetchedRef.current) {
        fetchedRef.current = true;
        fetchProvisionUrl(false);
      }
    }
    if (!isOpen) {
      fetchedRef.current = false;
      setProvisionUrl('');
      setError('');
    }
  }, [isOpen, account?.id, fetchProvisionUrl]);

  const handleRenew = useCallback(() => {
    fetchProvisionUrl(true);
  }, [fetchProvisionUrl]);

  const handleCopyUrl = useCallback(async () => {
    if (!provisionUrl) return;
    try {
      await navigator.clipboard.writeText(provisionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement('input');
      input.value = provisionUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [provisionUrl]);

  const handleDownloadQr = useCallback(() => {
    const svg = document.querySelector('#login-qr-svg');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      canvas.width = 512; canvas.height = 512;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 512, 512);
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
      canvas.width = 512; canvas.height = 512;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(img, 0, 0, 512, 512);
      canvas.toBlob(async (blob) => {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } catch {}
      });
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }, []);

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483647, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)' }} />
      <div style={{ position: 'relative', width: '560px', maxWidth: '94vw', background: 'linear-gradient(160deg, #1a1f2e 0%, #111827 100%)', border: '1px solid rgba(75,85,99,0.4)', borderRadius: '16px', boxShadow: '0 25px 80px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '24px 28px 20px', borderBottom: '1px solid rgba(75,85,99,0.2)' }}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f3f4f6', whiteSpace: 'nowrap' }}>登錄二維碼</h2>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#9ca3af', whiteSpace: 'nowrap' }}>使用支援二維碼登錄的用戶端掃描二維碼完成登錄</p>
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280', whiteSpace: 'nowrap' }}>更新後將生成新的 URL 與二維碼</p>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
            <button onClick={onClose} style={{ width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: '#6b7280', cursor: 'pointer', fontSize: '18px' }}>✕</button>
            <button onClick={handleRenew} disabled={renewing} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 14px', borderRadius: '7px', border: '1px solid rgba(249,115,22,0.4)', background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(234,88,12,0.08))', color: '#f97316', fontSize: '12px', fontWeight: 600, cursor: renewing ? 'wait' : 'pointer', whiteSpace: 'nowrap', opacity: renewing ? 0.7 : 1 }}>
              <RefreshCw size={13} style={{ animation: renewing ? 'spin 1s linear infinite' : 'none' }} /> Renew
            </button>
          </div>
        </div>

        {/* QR Code Section */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '28px 0 20px', background: 'rgba(0,0,0,0.15)' }}>
          {loading ? (
            <div style={{ width: 232, height: 232, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader size={32} color="#6b7280" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : error ? (
            <div style={{ width: 232, height: 232, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#fca5a5', fontSize: 13, textAlign: 'center', padding: 20 }}>
              <span>⚠</span>
              <span>{error}</span>
            </div>
          ) : provisionUrl ? (
            <div style={{ background: '#ffffff', borderRadius: '12px', padding: '16px', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}>
              <QRCodeSVG id="login-qr-svg" value={provisionUrl} size={200} bgColor="#ffffff" fgColor="#000000" level="M" includeMargin={false} />
            </div>
          ) : null}
        </div>

        {/* QR Action Buttons */}
        {provisionUrl && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', padding: '0 28px 16px' }}>
            <button onClick={handleCopyQr} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px', borderRadius: '8px', border: '1px solid rgba(75,85,99,0.4)', background: 'rgba(55,65,81,0.4)', color: '#d1d5db', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}>
              <Copy size={14} /> 複製二維碼
            </button>
            <button onClick={handleDownloadQr} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px', borderRadius: '8px', border: '1px solid rgba(75,85,99,0.4)', background: 'rgba(55,65,81,0.4)', color: '#d1d5db', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}>
              <Download size={14} /> 下載二維碼
            </button>
          </div>
        )}

        {/* URL Section */}
        {provisionUrl && (
          <div style={{ padding: '20px 28px 24px', borderTop: '1px solid rgba(75,85,99,0.2)' }}>
            <div style={{ marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500, whiteSpace: 'nowrap' }}>登錄鏈接（僅可訪問一次）</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', background: 'rgba(26,35,50,0.8)', border: '1px solid rgba(55,65,81,0.5)', color: '#d1d5db', fontSize: '13px', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>{provisionUrl}</div>
              <button onClick={handleCopyUrl} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '10px 16px', borderRadius: '8px', border: '1px solid rgba(75,85,99,0.4)', background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(55,65,81,0.5)', color: copied ? '#4ade80' : '#d1d5db', fontSize: '12px', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <Copy size={14} /> {copied ? '已複製' : '複製鏈接'}
              </button>
            </div>
            <div style={{ marginTop: '8px' }}>
              <span style={{ fontSize: '11px', color: '#6b7280' }}>該鏈接僅可訪問一次{expireAt ? ` · 有效期至 ${new Date(expireAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</span>
            </div>
          </div>
        )}
      </div>
      <style>{'@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}
