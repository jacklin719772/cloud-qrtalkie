import React, { forwardRef } from 'react';

const PaymentProofDialog = forwardRef((props, ref) => {
  const closeDialog = () => {
    if (ref && ref.current) {
      ref.current.close();
    }
  };

  return (
    <dialog id="payment-proof-dialog" ref={ref}>
      <form className="dialog-card payment-proof-card" id="payment-proof-form">
        <div className="panel-head">
          <h2>支付凭证</h2>
          <button className="icon-btn dialog-close" type="button" title="关闭" onClick={closeDialog}>x</button>
        </div>
        <div className="payment-proof-body">
          <div className="payment-proof-layout">
            <section className="proof-upload-panel">
              <div className="proof-upload-area" id="proof-upload-area" tabIndex="0">
                <input id="payment-proof-file" name="proofFile" type="file" accept="image/png,image/jpeg,image/webp" capture="environment" hidden />
                <div className="proof-upload-empty">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 16V8m0 0-3 3m3-3 3 3M5 17.5a4 4 0 0 1 .8-7.92 6 6 0 0 1 11.64 1.57A3.5 3.5 0 0 1 17.5 18H16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <p>拖放截图到这里，或 <button className="link-btn" id="choose-payment-proof" type="button">选择文件</button></p>
                  <small>支持 PNG、JPG、WEBP，最大 8MB，也可以直接 Ctrl+V 粘贴截图</small>
                </div>
                <div className="proof-preview" id="payment-proof-preview">
                  <button className="proof-image-remove" id="clear-payment-proof" type="button" title="删除图片">x</button>
                  <img alt="付款凭证预览" />
                </div>
              </div>
            </section>

            <aside className="payment-proof-fields">
              <label><span>应付金额</span><input name="payableAmount" readOnly /></label>
              <label><span>实付金额 <b>*</b></span><input name="actualAmount" type="number" min="0.01" step="0.01" inputMode="decimal" required /></label>
              <label><span>付款日期 <b>*</b></span><input name="paymentDate" type="date" required /></label>
            </aside>
          </div>
          <div className="proof-upload-progress hidden" id="payment-proof-progress">
            <span>上传进度</span>
            <progress max="100" value="0"></progress>
            <b>0%</b>
          </div>
          <p className="form-message hidden" id="payment-proof-message"></p>
        </div>
        <menu className="form-actions">
          <button className="ghost-btn dialog-close" type="button" onClick={closeDialog}>取消</button>
          <button className="primary-btn" type="submit">保存</button>
        </menu>
      </form>
    </dialog>
  );
});

export default PaymentProofDialog;