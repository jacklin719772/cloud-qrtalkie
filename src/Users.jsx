import React from 'react';

export default function Users({ onOpenCreateUser }) {
  return (
    <section className="view active" id="users">
      <div className="section-head">
        <div>
          <h2>SIP 使用者</h2>
          <p>建立、停用、重設密碼，並查看使用者目前註冊狀態。</p>
        </div>
        <div className="toolbar">
          <input type="search" placeholder="搜尋使用者名稱、SIP URI、信箱" />
          <button className="ghost-btn" type="button">匯入</button>
          <button className="primary-btn" id="open-create-user-2" type="button" onClick={onOpenCreateUser}>建立</button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>使用者</th>
              <th>SIP URI</th>
              <th>狀態</th>
              <th>裝置</th>
              <th>最近註冊</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="user-table"></tbody>
        </table>
      </div>
    </section>
  );
}