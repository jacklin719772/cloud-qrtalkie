ALTER TABLE billing_payment_methods
  ADD COLUMN IF NOT EXISTS icon_url VARCHAR(255) NULL AFTER logo_class;

UPDATE billing_payment_methods
SET icon_url = '/payment-method-icons/paypal.svg'
WHERE method_code = 'paypal' AND (icon_url IS NULL OR icon_url = '');

UPDATE billing_payment_methods
SET icon_url = '/payment-method-icons/visa.svg'
WHERE method_code = 'visa' AND (icon_url IS NULL OR icon_url = '');

UPDATE billing_payment_methods
SET icon_url = '/payment-method-icons/mastercard.svg'
WHERE method_code = 'mastercard' AND (icon_url IS NULL OR icon_url = '');

UPDATE billing_payment_methods
SET icon_url = '/payment-method-icons/discover.svg'
WHERE method_code = 'discover' AND (icon_url IS NULL OR icon_url = '');

UPDATE billing_payment_methods
SET icon_url = '/payment-method-icons/amex.svg'
WHERE method_code = 'amex' AND (icon_url IS NULL OR icon_url = '');
