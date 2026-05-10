import React, { forwardRef } from 'react';

const CreateUserDialog = forwardRef((props, ref) => {
  const closeDialog = () => {
    if (ref && ref.current) {
      ref.current.close();
    }
  };

  return (
    <dialog id="create-user-dialog" ref={ref}>
      <form method="dialog" className="dialog-card user-register-card">
        <div className="panel-head">
          <h2>使用者註冊</h2>
          <button className="icon-btn dialog-close" type="button" title="關閉" onClick={closeDialog}>x</button>
        </div>
        <div className="user-form-grid">
          <label><span className="field-label">使用者名稱 <b>*</b></span><input id="new-username" placeholder="使用者名稱" required /></label>
          <label><span className="field-label">域名</span><select id="sip-domain-select"><option>sip.qrtalkie.org</option></select></label>
          <label><span className="field-label">顯示名稱</span><input placeholder="John Doe" /></label>
          <span></span>
          <label><span className="field-label">密碼 <b>*</b></span><input type="password" placeholder="密碼" required /><small>填寫以變更</small></label>
          <label><span className="field-label">確認密碼 <b>*</b></span><input type="password" placeholder="再次輸入密碼" required /><small aria-hidden="true"></small></label>
          <label><span className="field-label">電子郵件 <b>*</b></span><input type="email" placeholder="電子郵件" required /></label>
          <label><span className="field-label">電話號碼</span><input type="tel" placeholder="+12123123" /></label>
        </div>
        <section className="other-info">
          <h3>其他資訊</h3>
          <div className="toggle-grid">
            <label className="toggle-row">停用<input type="checkbox" role="switch" /></label>
            <label className="toggle-row">啟用<input type="checkbox" role="switch" defaultChecked /></label>
          </div>
        </section>
        <menu>
          <button className="ghost-btn dialog-close" type="button" onClick={closeDialog}>取消</button>
          <button className="primary-btn" value="default">建立使用者</button>
        </menu>
      </form>
    </dialog>
  );
});

export default CreateUserDialog;