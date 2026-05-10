UPDATE billing_orders o
LEFT JOIN billing_payments p ON p.order_id = o.id
SET
  o.order_status = 'pending_payment',
  o.payment_status = 'unpaid'
WHERE o.payment_method = 'offline'
  AND o.order_status = 'payment_submitted'
  AND p.payment_proof_uploaded_at IS NULL
  AND p.paid_at IS NULL;
