import React from 'react';

export default function Registrations() {
  return (
    <section className="view active" id="registrations">
      <div className="section-head">
        <div>
          <h2>註冊狀態</h2>
          <p>查看 REGISTER 結果、Contact、傳輸協定和到期時間。</p>
        </div>
      </div>
      <div className="registration-list" id="registration-list"></div>
    </section>
  );
}