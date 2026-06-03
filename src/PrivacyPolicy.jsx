import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import apiClient from './apiClient';

export default function PrivacyPolicy() {
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  useEffect(() => {
    const fetchPolicy = async () => {
      setIsLoading(true);
      try {
        // 此處 API 端點為示範，請根據後端實際的路由進行調整
        const data = await apiClient.get('/admin/settings/privacy-policy');
        setContent(data?.content || '');
      } catch (err) {
        console.warn('Failed to load privacy policy:', err);
        // 若後端尚未建立預設資料可能回傳 404，此處忽略錯誤
      } finally {
        setIsLoading(false);
      }
    };
    fetchPolicy();
  }, []);

  useEffect(() => {
    // 动态添加专属的 mode class，以便复用背景渐变样式且不影响其他页面
    const mainElement = document.querySelector('.main');
    if (mainElement) {
      mainElement.classList.add('privacy-policy-mode');
    }
    return () => {
      if (mainElement) mainElement.classList.remove('privacy-policy-mode');
    };
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage({ type: '', text: '' });
    try {
      // 此處 API 端點為示範，請根據後端實際的路由進行調整
      await apiClient.put('/admin/settings/privacy-policy', { content });
      setMessage({ type: 'success', text: '隐私政策内容已保存成功。' });
      
      // 3秒后清除成功提示
      setTimeout(() => {
        setMessage({ type: '', text: '' });
      }, 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || '保存失败，请稍后重试。' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="view active settings-form-page" id="privacy-policy" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="tenant-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', paddingTop: '12px', paddingBottom: '12px' }}>
        <form className="panel" onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: '#111827', borderRadius: '8px', border: '1px solid #1f2937', overflow: 'hidden', margin: 0 }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column' }}>
            {isLoading ? (
              <p style={{ color: '#9ca3af', fontSize: '14px', textAlign: 'center', marginTop: '40px' }}>加载内容中...</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="在此输入您的隐私政策规范..."
                  style={{
                    flex: 1,
                    width: '100%',
                    minHeight: '300px',
                    padding: '16px',
                    borderRadius: '8px',
                    border: '1px solid #374151',
                    outline: 'none',
                    resize: 'none',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    lineHeight: '1.6',
                    backgroundColor: '#0f172a',
                    color: '#f3f4f6',
                    color: '#e5e7eb',
                    boxSizing: 'border-box'
                  }}
                  onFocus={e => e.target.style.borderColor = '#3b82f6'}
                  onBlur={e => e.target.style.borderColor = '#374151'}
                />
              </div>
            )}
          </div>
          
          <div style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid #1f2937', backgroundColor: '#1a2332', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            {message.text && (
              <p style={{ marginRight: 'auto', alignSelf: 'center', margin: 0, fontSize: '13px', color: message.type === 'error' ? '#ef4444' : '#10b981' }}>
                {message.text}
              </p>
            )}
            <button type="button" onClick={() => setIsPreviewOpen(true)} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#1e3a5f', color: '#93c5fd', border: '1px solid #2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}>
              预览
            </button>
            <button type="submit" disabled={isSaving || isLoading} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', cursor: (isSaving || isLoading) ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 500, opacity: (isSaving || isLoading) ? 0.7 : 1 }}>
              {isSaving ? '保存中...' : '保存更改'}
            </button>
          </div>
        </form>

        {isPreviewOpen && (
          <div className="modal-backdrop" style={{ zIndex: 9999 }} onClick={() => setIsPreviewOpen(false)}>
            <div className="dialog-card legal-card" onClick={e => e.stopPropagation()} style={{ backgroundColor: "#111827", width: 'min(800px, calc(100vw - 32px))', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: '24px' }}>
              <div className="panel-head" style={{ flexShrink: 0, paddingBottom: '16px', borderBottom: '1px solid #1f2937', marginBottom: '16px' }}>
                <h2 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6' }}>隐私政策预览</h2>
                <button className="icon-btn" type="button" title="关闭" onClick={() => setIsPreviewOpen(false)} style={{ border: 'none', background: 'transparent', fontSize: '20px', cursor: 'pointer', color: '#9ca3af' }}>x</button>
              </div>              <div className="legal-content policy-markdown-preview" style={{ overflowY: 'auto', flex: 1, color: '#e5e7eb' }}>
                {content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {content || ''}
                  </ReactMarkdown>
                ) : (
                  <span style={{ color: '#94a3b8' }}>暂无内容，请先在编辑区输入隐私政策。</span>
                )}
              </div>
              <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
                <button className="primary-btn" type="button" onClick={() => setIsPreviewOpen(false)}>关闭预览</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}