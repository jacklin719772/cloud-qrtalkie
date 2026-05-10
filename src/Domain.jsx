import React from 'react';

export default function Domain() {
  return (
    <section className="view active" id="domain">
      <section className="billing-toolbar">
        <input type="search" placeholder="搜尋套餐名稱 / 訂單編號" />
        <div className="billing-filter-tabs" role="tablist" aria-label="套餐狀態篩選">
          <button className="selected" type="button">全部</button>
          <button type="button">生效中</button>
          <button type="button">即將過期</button>
          <button type="button">過期</button>
        </div>
        <div className="billing-toolbar-actions">
          <button className="ghost-btn" type="button">重置</button>
          <button className="primary-btn" type="button">查詢</button>
        </div>
      </section>

      <p className="form-message hidden" id="billing-message"></p>

      <div className="table-wrap billing-table-wrap">
        <table className="billing-table">
          <thead>
            <tr>
              <th>套餐名稱</th>
              <th>訂單狀態</th>
              <th>帳號數量</th>
              <th>增值服務</th>
              <th>租期</th>
              <th>生效日期</th>
              <th>到期日期</th>
              <th>套餐狀態</th>
              <th>支付方式</th>
              <th>付款日期</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="billing-order-table"></tbody>
        </table>
      </div>
      <div className="billing-pagination" id="billing-pagination"></div>
    </section>
  );
}