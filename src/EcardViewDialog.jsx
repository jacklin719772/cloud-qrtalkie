import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// 電子名片詳情彈窗：loadData 返回 { imageUrl, accessUrl }（由調用方按數據源實現）
export default function EcardViewDialog({ open, onClose, loadData }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copyMessage, setCopyMessage] = useState({ type: '', text: '' });
  const loadRef = useRef(loadData);
  loadRef.current = loadData;

  useEffect(() => {
    if (!open) {
      setData(null);
      setCopyMessage({ type: '', text: '' });
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setData(null);
    setCopyMessage({ type: '', text: '' });
    (async () => {
      try {
        const result = await loadRef.current?.();
        if (!cancelled) setData(result || null);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  function showCopyMessage(message) {
    setCopyMessage(message);
    window.setTimeout(() => {
      setCopyMessage((current) => (current.text === message.text ? { type: '', text: '' } : current));
    }, 5000);
  }

  async function copyAccessLink() {
    const url = data?.accessUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showCopyMessage({ type: 'success', text: '訪問連結已複製。' });
    } catch {
      showCopyMessage({ type: 'error', text: '複製失敗，請手動選取複製。' });
    }
  }

  async function copyImage() {
    const imageUrl = data?.imageUrl;
    if (!imageUrl) return;
    try {
      const response = await fetch(imageUrl, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('IMAGE_FETCH_FAILED');
      const blob = await response.blob();
      // 統一經畫布轉為真正的 PNG 再寫入剪貼板（下載接口對 jpg 縮圖也聲明為 PNG）
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      showCopyMessage({ type: 'success', text: '名片圖片已複製。' });
    } catch {
      showCopyMessage({ type: 'error', text: '複製圖片失敗，請在圖片上右鍵另存。' });
    }
  }

  if (!open) return null;

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 2147483646, backgroundColor: 'rgba(15, 23, 42, 0.36)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div id="ecard-view-dialog" style={{ width: 'min(720px, calc(100% - 32px))', backgroundColor: '#111827', borderRadius: '8px', boxShadow: '0 24px 80px rgba(15, 23, 42, 0.22)', overflow: 'hidden', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <style>{`
          #ecard-view-dialog ::-webkit-scrollbar { width: 8px; height: 8px; }
          #ecard-view-dialog ::-webkit-scrollbar-track { background: #111827; }
          #ecard-view-dialog ::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; }
          #ecard-view-dialog ::-webkit-scrollbar-corner { background: #111827; }
        `}</style>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #1f2937', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>電子名片詳情</h3>
          <button type="button" onClick={onClose} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }}>✕</button>
        </div>
        <div style={{ overflow: 'auto', flex: 1, padding: '18px', scrollbarWidth: 'thin', scrollbarColor: '#374151 #111827' }}>
          {isLoading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>載入中...</div>
          ) : !data ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>無法讀取電子名片</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'center', padding: '8px', borderRadius: '8px', border: '1px solid #1f2937', backgroundColor: '#0f172a' }}>
                {data.imageUrl ? (
                  <img src={data.imageUrl} alt="電子名片" style={{ maxWidth: '100%', maxHeight: '52vh', objectFit: 'contain', borderRadius: '6px' }} />
                ) : (
                  <div style={{ padding: '48px 0', color: '#64748b', fontSize: '13px' }}>尚未生成名片圖片（可點「去配置」在電子名片頁生成）</div>
                )}
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 500, color: '#9ca3af' }}>訪客訪問連結</span>
                <input value={data.accessUrl || '-'} readOnly style={{ padding: '10px', borderRadius: '6px', border: '1px solid #1f2937', outline: 'none', backgroundColor: '#1a2332', color: '#9ca3af' }} />
              </label>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', padding: '14px 18px', backgroundColor: '#1a2332', borderTop: '1px solid #1f2937', flexShrink: 0 }}>
          {copyMessage.text && <span style={{ marginRight: 'auto', fontSize: '13px', color: copyMessage.type === 'error' ? '#fca5a5' : '#4ade80' }}>{copyMessage.text}</span>}
          <button
            type="button"
            disabled={!data?.imageUrl}
            onClick={copyImage}
            style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #4b5563', background: '#374151', color: data?.imageUrl ? '#d1d5db' : '#6b7280', fontSize: '13px', cursor: data?.imageUrl ? 'pointer' : 'not-allowed' }}
          >複製圖片</button>
          <button
            type="button"
            disabled={!data?.accessUrl}
            onClick={copyAccessLink}
            style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #4b5563', background: '#374151', color: data?.accessUrl ? '#d1d5db' : '#6b7280', fontSize: '13px', cursor: data?.accessUrl ? 'pointer' : 'not-allowed' }}
          >複製連結</button>
          <button type="button" onClick={onClose} style={{ padding: '8px 20px', borderRadius: '6px', border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', fontSize: '13px', cursor: 'pointer' }}>關閉</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
