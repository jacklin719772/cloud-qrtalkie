#!/bin/bash
# 试用到正式订单——回退脚本（测试阶段专用，可重复复测同一操作）
# 用法: bash trial-order-rollback.sh <orderId>
# 作用: 在一个事务内还原该订单涉及的全部状态，并删除订单本身：
#   1) 试用转正的账号：sip_users/权益/名片/AI/Web配对 全部还原为试用态；trial_assignments 置回 active
#   2) 本单从库存补配的账号：SIP/Web 还原为库存（tenant_id=NULL）
#   3) 删除订单及其明细/付款/状态历史/保留清单/相关通知
# 回退后可重新执行「试用管理 → 正式購買 → 提交 → 审核」完整流程
set -euo pipefail

ORDER_ID="${1:-}"
if ! [[ "$ORDER_ID" =~ ^[0-9]+$ ]]; then
  echo "用法: bash trial-order-rollback.sh <orderId>"
  exit 1
fi

MYSQL="mysql -uqrtalkie -pLin1971wn719772 qrtalkie_cloud"

# 事务前先取出涉及试用记录，供回退后核对
TRIAL_IDS=$($MYSQL -N -e "SELECT GROUP_CONCAT(id) FROM trial_assignments WHERE converted_order_id = ${ORDER_ID}" 2>/dev/null)
RETAINED_TRIAL_IDS=$($MYSQL -N -e "SELECT GROUP_CONCAT(trial_assignment_id) FROM billing_order_retained_accounts WHERE order_id = ${ORDER_ID} AND trial_assignment_id IS NOT NULL" 2>/dev/null)
CHECK_IDS="${TRIAL_IDS:-}"
if [ -z "$CHECK_IDS" ] && [ -n "$RETAINED_TRIAL_IDS" ]; then CHECK_IDS="$RETAINED_TRIAL_IDS"; fi

echo "== 回退前状态 =="
$MYSQL -t -e "
SELECT o.id, o.order_no, o.order_type, o.order_status, o.tenant_id
FROM billing_orders o WHERE o.id = ${ORDER_ID};
SELECT r.sip_user_id, r.source, r.status, r.username, ta.status AS trial_status, ta.converted_order_id
FROM billing_order_retained_accounts r
LEFT JOIN trial_assignments ta ON ta.id = r.trial_assignment_id
WHERE r.order_id = ${ORDER_ID};
SELECT ta.id AS trial_id, ta.sip_user_id, ta.status, ta.converted_order_id
FROM trial_assignments ta WHERE ta.converted_order_id = ${ORDER_ID};
" 2>/dev/null

$MYSQL 2>/dev/null <<SQL
SET @orderId = ${ORDER_ID};
SET @reservedTenantId = (SELECT id FROM tenants WHERE is_system = 1 ORDER BY id LIMIT 1);
SET @orderTenantId = (SELECT tenant_id FROM billing_orders WHERE id = @orderId);

START TRANSACTION;

-- 1) 转正过的试用账号：还原试用态（依赖 converted_order_id 关联，必须在清引用之前执行）
UPDATE sip_users u
JOIN trial_assignments ta ON ta.sip_user_id = u.id AND ta.converted_order_id = @orderId
SET u.tenant_id = @reservedTenantId,
    u.service_expires_at = ta.expires_at,
    u.status = 'active',
    u.reviewed_at = NULL,
    u.reviewed_by_platform_admin_id = NULL;

UPDATE tenant_sip_account_entitlements e
JOIN trial_assignments ta ON ta.sip_user_id = e.sip_user_id AND ta.converted_order_id = @orderId
SET e.tenant_id = @reservedTenantId,
    e.current_order_id = ta.batch_order_id,
    e.status = 'active',
    e.service_starts_at = ta.started_at,
    e.service_expires_at = ta.expires_at;

UPDATE tenant_ecards ec
JOIN trial_assignments ta ON ta.sip_user_id = ec.sip_user_id AND ta.converted_order_id = @orderId
SET ec.tenant_id = @reservedTenantId;

UPDATE ai_bot_account_entitlements a
JOIN trial_assignments ta ON ta.sip_user_id = a.sip_user_id AND ta.converted_order_id = @orderId
SET a.expires_at = CONCAT(ta.expires_at, ' 23:59:59');

UPDATE web_users w
JOIN tenant_web_account_entitlements we ON we.web_user_id = w.id
JOIN trial_assignments ta ON ta.sip_user_id = we.sip_user_id AND ta.converted_order_id = @orderId
SET w.tenant_id = @reservedTenantId,
    w.service_expires_at = ta.expires_at;

UPDATE tenant_web_account_entitlements we
JOIN trial_assignments ta ON ta.sip_user_id = we.sip_user_id AND ta.converted_order_id = @orderId
SET we.tenant_id = @reservedTenantId,
    we.current_order_id = ta.batch_order_id,
    we.status = 'active',
    we.service_starts_at = ta.started_at,
    we.service_expires_at = ta.expires_at;

-- 2) 本单从库存补配的账号（非本单转正的试用）：SIP 回库
-- 判据改为「不是被本单转正的试用账号」（历史已回收的试用记录不影响回库）
UPDATE sip_users u
JOIN billing_order_sip_accounts b ON b.sip_user_id = u.id AND b.order_id = @orderId
SET u.tenant_id = NULL,
    u.service_expires_at = NULL,
    u.status = 'active',
    u.reviewed_at = NULL,
    u.reviewed_by_platform_admin_id = NULL
WHERE u.tenant_id = @orderTenantId
  AND NOT EXISTS (
    SELECT 1 FROM trial_assignments ta
    WHERE ta.sip_user_id = u.id AND ta.converted_order_id = @orderId
  );

DELETE e FROM tenant_sip_account_entitlements e
JOIN billing_order_sip_accounts b ON b.sip_user_id = e.sip_user_id AND b.order_id = @orderId
WHERE e.first_order_id = @orderId
  AND NOT EXISTS (
    SELECT 1 FROM trial_assignments ta
    WHERE ta.sip_user_id = e.sip_user_id AND ta.converted_order_id = @orderId
  );

-- 2b) 本单从库存补配的 Web：回库并清理权益行（同样以「非本单转正」为判据）
UPDATE web_users w
JOIN tenant_web_account_entitlements we ON we.web_user_id = w.id
SET w.tenant_id = NULL,
    w.service_expires_at = NULL
WHERE we.current_order_id = @orderId
  AND NOT EXISTS (
    SELECT 1 FROM trial_assignments ta
    WHERE ta.sip_user_id = we.sip_user_id AND ta.converted_order_id = @orderId
  );

DELETE we FROM tenant_web_account_entitlements we
WHERE we.current_order_id = @orderId
  AND NOT EXISTS (
    SELECT 1 FROM trial_assignments ta
    WHERE ta.sip_user_id = we.sip_user_id AND ta.converted_order_id = @orderId
  );

-- 3) 试用记录复位（必须在删除订单之前：converted_order_id 外键 ON DELETE SET NULL 会先清零导致漏复位）
UPDATE trial_assignments
SET status = 'active', converted_order_id = NULL
WHERE converted_order_id = @orderId;

-- 4) 清订单与关联数据
DELETE FROM billing_order_retained_accounts WHERE order_id = @orderId;
DELETE FROM billing_order_sip_accounts WHERE order_id = @orderId;
DELETE FROM billing_order_web_accounts WHERE order_id = @orderId;
DELETE FROM billing_order_status_history WHERE order_id = @orderId;
DELETE FROM billing_order_items WHERE order_id = @orderId;
DELETE FROM billing_payments WHERE order_id = @orderId;
DELETE FROM notification_receipts WHERE event_id IN (
  SELECT id FROM notification_events WHERE scope_type = 'billing_order' AND scope_id = @orderId
);
DELETE FROM notification_events WHERE scope_type = 'billing_order' AND scope_id = @orderId;
DELETE FROM billing_orders WHERE id = @orderId;

COMMIT;
SQL

echo "== 回退后状态 =="
$MYSQL -t -e "SELECT COUNT(*) AS order_remaining FROM billing_orders WHERE id = ${ORDER_ID};" 2>/dev/null
if [ -n "$CHECK_IDS" ]; then
  $MYSQL -t -e "
  SELECT ta.id AS trial_id, ta.sip_user_id, ta.status, ta.converted_order_id,
         u.tenant_id AS sip_tenant, DATE_FORMAT(u.service_expires_at, '%Y-%m-%d') AS expires
  FROM trial_assignments ta JOIN sip_users u ON u.id = ta.sip_user_id
  WHERE ta.id IN (${CHECK_IDS});
  " 2>/dev/null
fi
echo "提示: 订单 ${ORDER_ID} 已删除；涉及试用账号的 status 应回到 active、sip_tenant 应回到保留租户。"
echo "可重新执行「试用管理 → 正式購買 → 提交 → 审核」复测同一操作。"
