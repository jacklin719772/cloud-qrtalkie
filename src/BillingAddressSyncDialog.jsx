import React, { forwardRef } from 'react';

const BillingAddressSyncDialog = forwardRef((props, ref) => {
  const closeDialog = () => {
    if (ref && ref.current) {
      ref.current.close();
    }
  };

  return (
    <dialog id="billing-address-sync-dialog" ref={ref}>
      <form method="dialog" className="dialog-card confirm-card">
        <div className="panel-head">
          <h2>同步帳單地址</h2>
          <button className="icon-btn" value="cancel" title="關閉" onClick={closeDialog}>x</button>
        </div>
        <p>是否同步修改租戶設定中的帳單地址資訊？</p>
        <menu className="form-actions">
          <button className="ghost-btn dialog-close" value="cancel" type="button" onClick={closeDialog}>取消</button>
          <button className="primary-btn" id="confirm-sync-billing-address" type="button">確定</button>
        </menu>
      </form>
    </dialog>
  );
});

export default BillingAddressSyncDialog;