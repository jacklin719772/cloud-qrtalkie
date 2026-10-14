// 试用账号模块：保留租户（is_system=1「產品試用」）定位辅助
// 保留租户由迁移 087 幂等创建；此处缓存 id 供各查询排除与删除守卫使用
import { pool } from "./db.js";

let cachedReservedTenantId = null;

export async function getReservedTrialTenantId(connection = null) {
  if (cachedReservedTenantId) return cachedReservedTenantId;
  const runner = connection || pool;
  const rows = await runner.query("SELECT id FROM tenants WHERE is_system = 1 LIMIT 1");
  const id = rows[0] ? Number(rows[0].id) : null;
  if (id) cachedReservedTenantId = id;
  return id;
}

export async function isReservedTrialTenant(tenantId) {
  const reservedId = await getReservedTrialTenantId();
  return Boolean(reservedId) && Number(tenantId) === reservedId;
}
