import React from 'react';

export default function PurchasePlan() {
  return (
    <section className="view active" id="purchase-plan">
      <form className="purchase-page-form" id="purchase-page-form">
        <div className="purchase-form-body">
          <div className="purchase-side-label">選擇套餐：</div>
          <div className="purchase-plan-carousel">
            <button className="plan-nav-btn" data-plan-scroll="-1" type="button" aria-label="上一個套餐">‹</button>
            <div className="purchase-plan-options" id="purchase-plan-options">
              <label className="plan-choice selected">
                <input type="radio" name="planCode" value="pro" defaultChecked />
                <strong>Pro</strong>
                <span><i>$</i>9.99</span>
                <small>每月，年付</small>
                <em>100 個帳號</em>
                <b>標準通訊功能</b>
              </label>
              <label className="plan-choice">
                <input type="radio" name="planCode" value="business" />
                <strong>Business</strong>
                <span><i>$</i>14.99</span>
                <small>每月，年付</small>
                <em>150 個帳號</em>
                <b>含團隊管理</b>
              </label>
              <label className="plan-choice">
                <input type="radio" name="planCode" value="enterprise" />
                <strong>Enterprise</strong>
                <span><i>$</i>24.99</span>
                <small>每月，年付</small>
                <em>300 個帳號</em>
                <b>進階支援</b>
              </label>
              <label className="plan-choice">
                <input type="radio" name="planCode" value="ultimate" />
                <strong>Ultimate</strong>
                <span><i>$</i>39.99</span>
                <small>每月，年付</small>
                <em>500 個帳號</em>
                <b>完整功能</b>
              </label>
            </div>
            <button className="plan-nav-btn" data-plan-scroll="1" type="button" aria-label="下一個套餐">›</button>
          </div>

          <label className="purchase-side-label">購買數量：</label>
          <div className="number-stepper">
            <button type="button" data-step-target="purchaseQuantity" data-step="-1">-</button>
            <input name="purchaseQuantity" type="number" min="1" defaultValue="1" inputMode="numeric" />
            <button type="button" data-step-target="purchaseQuantity" data-step="1">+</button>
            <span>份</span>
          </div>

          <label className="purchase-side-label">購買時長：</label>
          <div className="number-stepper">
            <button type="button" data-step-target="purchaseMonths" data-step="-1">-</button>
            <input name="purchaseMonths" type="number" min="1" defaultValue="1" inputMode="numeric" />
            <button type="button" data-step-target="purchaseMonths" data-step="1">+</button>
            <span>月</span>
          </div>

          <label className="purchase-side-label">增值服務：</label>
          <div className="addon-service-list">
            <button className="addon-service-row" type="button" data-addon-code="ecard">
              <span>Ecard</span>
              <strong>USD 2.00 / 帳號 / 月</strong>
            </button>
            <button className="addon-service-row" type="button" data-addon-code="callcenter">
              <span>Call Center</span>
              <strong>USD 5.00 / 帳號 / 月</strong>
            </button>
          </div>

          <div className="purchase-side-label label-with-action">
            <span className="required-text">帳單地址：</span>
            <span className="label-action-row">
              <button className="link-btn hidden" id="cancel-purchase-billing-address" type="button">取消</button>
              <button className="link-btn" id="edit-purchase-billing-address" type="button">編輯</button>
            </span>
          </div>
          <div className="billing-address-line">
            <textarea id="purchase-billing-address" name="purchaseBillingAddress" rows="1" readOnly></textarea>
          </div>

          <label className="purchase-side-label">優惠碼：</label>
          <div className="coupon-entry">
            <input name="couponCode" placeholder="輸入優惠碼" />
            <button className="ghost-btn" id="apply-coupon-code" type="button">使用</button>
            <div className="coupon-summary hidden" id="coupon-summary"></div>
          </div>

          <section className="billing-detail-box span-content" aria-label="帳單明細">
            <div className="billing-detail-head">
              <strong>帳單明細</strong>
              <span>USD</span>
            </div>
            <div className="billing-detail-table">
              <div className="billing-detail-row billing-detail-header">
                <span>序號</span>
                <span>項目</span>
                <span>計算方式</span>
                <span>金額</span>
              </div>
              <div className="billing-detail-row">
                <span>1</span>
                <strong>Pro 套餐</strong>
                <span>USD 9.99 × 1份 × 1月</span>
                <b>USD 9.99</b>
              </div>
              <div className="billing-detail-row">
                <span>2</span>
                <strong>Ecard</strong>
                <span>USD 2.00 × 1份 × 1月</span>
                <b>USD 2.00</b>
              </div>
              <div className="billing-detail-row">
                <span>3</span>
                <strong>Call Center</strong>
                <span>USD 5.00 × 1份 × 1月</span>
                <b>USD 5.00</b>
              </div>
              <div className="billing-detail-row discount">
                <span>-</span>
                <strong>優惠折扣</strong>
                <span>SAVE20，20% 折扣</span>
                <b>- USD 3.40</b>
              </div>
            </div>
            <div className="billing-detail-total">
              <span>應支付金額</span>
              <strong>USD 13.59</strong>
            </div>
          </section>

          <label className="purchase-side-label required payment-label">支付方式：</label>
          <div className="payment-method-area">
            <div className="purchase-option-row payment-type-row">
              <button className="option-pill selected" data-payment-type="online" type="button">線上支付</button>
              <button className="option-pill" data-payment-type="offline" type="button">線下支付</button>
            </div>
            <div className="payment-logo-row" id="online-payment-logos" aria-label="支援的線上付款方式">
              <span className="payment-logo paypal">PayPal</span>
              <span className="payment-logo visa">VISA</span>
              <span className="payment-logo mastercard">Mastercard</span>
              <span className="payment-logo discover">DISCOVER</span>
              <span className="payment-logo amex">AMERICAN<br />EXPRESS</span>
            </div>
            <div className="offline-payment-info hidden" id="offline-payment-info">
              <p data-offline-payment="paymentNotice">線下付款後請及時上傳付款憑證截圖</p>
              <dl>
                <div><dt>收款單位</dt><dd data-offline-payment="payeeName">QRTalkie Cloud Limited</dd></div>
                <div><dt>開戶銀行</dt><dd data-offline-payment="bankName">HSBC Hong Kong</dd></div>
                <div><dt>銀行帳號</dt><dd data-offline-payment="bankAccountNo">123-456789-001</dd></div>
                <div><dt>聯絡人</dt><dd data-offline-payment="contactName">Billing Support</dd></div>
                <div><dt>聯絡電話</dt><dd data-offline-payment="contactPhone">+852 3000 8888</dd></div>
                <div><dt>電子信箱</dt><dd data-offline-payment="contactEmail">billing@qrtalkie.com</dd></div>
              </dl>
            </div>
          </div>
        </div>

        <div className="purchase-page-actions">
          <p className="form-message hidden" id="purchase-page-message"></p>
          <button className="primary-btn" type="submit">支付</button>
          <button className="ghost-btn" id="cancel-purchase-page" type="button">取消</button>
        </div>
      </form>
    </section>
  );
}