import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import apiClient from './apiClient';
import tosTemplate from '../TERMS_OF_SERVICE.md?raw';

export default function TermsOfService() {
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  useEffect(() => {
    const fetchTerms = async () => {
      setIsLoading(true);
      try {
        const data = await apiClient.get('/admin/settings/terms-of-service');
        setContent(data?.content || '');
      } catch (err) {
        console.warn('Failed to load terms of service:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTerms();
  }, []);

  useEffect(() => {
    const mainElement = document.querySelector('.main');
    if (mainElement) {
      mainElement.classList.add('terms-of-service-mode');
    }
    return () => {
      if (mainElement) mainElement.classList.remove('terms-of-service-mode');
    };
  }, []);

  const handleImportTemplate = () => { if (!content.trim() || window.confirm('导入模板将覆盖当前内容，确定继续？')) { setContent(tosTemplate); } };

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage({ type: '', text: '' });
    try {
      await apiClient.put('/admin/settings/terms-of-service', { content });
      setMessage({ type: 'success', text: '服务条款内容已保存成功。' });
      setTimeout(() => { setMessage({ type: '', text: '' }); }, 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || '保存失败，请稍后重试。' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="view active settings-form-page" id="terms-of-service" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
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
                  placeholder="在此输入您的服务条款规范..."
                  style={{
                    flex: 1, width: '100%', minHeight: '240px',
                    padding: '16px', borderRadius: '8px',
                    border: '1px solid #374151', outline: 'none', resize: 'none',
                    fontSize: '14px', fontFamily: 'inherit', lineHeight: '1.6',
                    backgroundColor: '#0f172a', color: '#ffffff', boxSizing: 'border-box'
                  }}
                  onFocus={e => e.target.style.borderColor = '#3b82f6'}
                  onBlur={e => e.target.style.borderColor = '#374151'}
                />
              </div>
            )}
          </div>
          <div style={{ flexShrink: 0, padding: '16px 24px', borderTop: '1px solid #1f2937', backgroundColor: '#111827', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            {message.text && (
              <p style={{ marginRight: 'auto', alignSelf: 'center', margin: 0, fontSize: '13px', color: message.type === 'error' ? '#ef4444' : '#10b981' }}>{message.text}</p>
            )}
            <button type="button" onClick={handleImportTemplate} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#1e3a5f', color: '#93c5fd', border: '1px solid #2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}>导入模板</button>
            <button type="button" onClick={() => setIsPreviewOpen(true)} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#1e3a5f', color: '#93c5fd', border: '1px solid #2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}>预览</button>
            <button type="submit" disabled={isSaving || isLoading} style={{ padding: '8px 24px', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', cursor: (isSaving || isLoading) ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 500, opacity: (isSaving || isLoading) ? 0.7 : 1 }}>{isSaving ? '保存中...' : '保存更改'}</button>
          </div>
        </form>

        {isPreviewOpen && (
          <div className="modal-backdrop" style={{ zIndex: 9999 }} onClick={() => setIsPreviewOpen(false)}>
            <div className="dialog-card legal-card" onClick={e => e.stopPropagation()} style={{ backgroundColor: '#111827', width: 'min(800px, calc(100vw - 32px))', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: '24px' }}>
              <div className="panel-head" style={{ flexShrink: 0, paddingBottom: '16px', borderBottom: '1px solid #1f2937', marginBottom: '16px' }}>
                <h2 style={{ margin: 0, fontSize: '18px', color: '#f3f4f6' }}>服务条款预览</h2>
                <button className="icon-btn" type="button" title="关闭" onClick={() => setIsPreviewOpen(false)} style={{ border: 'none', background: 'transparent', fontSize: '20px', cursor: 'pointer', color: '#9ca3af' }}>x</button>
              </div>
              <div className="legal-content policy-markdown-preview" style={{ overflowY: 'auto', flex: 1, color: '#e5e7eb' }}>
                <style>{`
                  .policy-markdown-preview * { color: #e5e7eb !important; }
                  .policy-markdown-preview h1, .policy-markdown-preview h2, .policy-markdown-preview h3,
                  .policy-markdown-preview h4, .policy-markdown-preview h5, .policy-markdown-preview h6 { color: #f3f4f6 !important; }
                  .policy-markdown-preview a { color: #93c5fd !important; }
                  .policy-markdown-preview a:hover { color: #ffffff !important; }
                  .policy-markdown-preview strong, .policy-markdown-preview b { color: #ffffff !important; }
                  .policy-markdown-preview code { color: #fbbf24 !important; background: #1f2937 !important; padding: 2px 6px; border-radius: 4px; }
                  .policy-markdown-preview blockquote { border-left: 3px solid #374151; padding-left: 12px; margin-left: 0; }
                  .policy-markdown-preview hr { border-color: #374151; }
                  .policy-markdown-preview table { border-collapse: collapse; width: 100%; }
                  .policy-markdown-preview th, .policy-markdown-preview td { border: 1px solid #374151; padding: 8px 12px; text-align: left; }
                  .policy-markdown-preview th { background: #1a2332; }
                `}</style>
                {content ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || ''}</ReactMarkdown>
                ) : (
                  <span style={{ color: '#94a3b8' }}>暂无内容，请先在编辑区输入服务条款。</span>
                )}
              </div>
              <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #1f2937' }}>
                <button className="primary-btn" type="button" onClick={() => setIsPreviewOpen(false)}>关闭预览</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
