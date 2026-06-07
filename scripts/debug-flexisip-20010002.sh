#!/bin/bash
# Flexisip 20010002 完整状态排查
set -e

# 加载环境变量
export $(grep -v '^#' /opt/saas/.env | xargs 2>/dev/null)

BASE="${FLEXISIP_ACCOUNT_MANAGER_BASE_URL:-http://account.qrtalkie.org/api}"
KEY="${FLEXISIP_ACCOUNT_MANAGER_API_KEY}"

echo "============================================"
echo "  排查 20010002 当前在 Flexisip 中的状态"
echo "  BASE: $BASE"
echo "============================================"

call() {
  local method="$1" path="$2" data="$3" label="$4"
  echo ""
  echo ">>> $label"
  echo ">>> $method $BASE$path"
  BODY=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE$path" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $KEY" \
    ${data:+-d "$data"} 2>&1)
  HTTP=$(echo "$BODY" | tail -1)
  JSON=$(echo "$BODY" | sed '$d')
  echo "<<< HTTP $HTTP"
  echo "$JSON" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  if isinstance(d,dict):
    for k in ['id','username','activated','blocked','message','errors']:
      if k in d: print(f'  {k}: {d[k]}')
  elif isinstance(d,list):
    print(f'  count: {len(d)}')
    for a in d[:3]:
      print(f'  id={a.get(\"id\")} username={a.get(\"username\")} activated={a.get(\"activated\")}')
except: print('  (raw):',repr(open(sys.stdin.fileno()).read()[:200]))
" 2>/dev/null || echo "$JSON" | head -3
  echo ""
}

# 1. 搜索 SIP
call "GET" "/accounts/20010002%40sip.qrtalkie.org/search" "" "1. searchAccountBySip(20010002@sip.qrtalkie.org)"

# 2. 搜索 Email
call "GET" "/accounts/20010002%40sip.qrtalkie.org/search-by-email" "" "2. searchAccountByEmail(20010002@sip.qrtalkie.org)"

# 3. 列出所有账号，搜索 20010002
echo ""
echo "===== 3. listAccounts 中搜索 20010002 ====="
curl -s -X GET "$BASE/accounts" -H "x-api-key: $KEY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
items=d if isinstance(d,list) else d.get('accounts',d.get('data',[]))
print(f'Total accounts: {len(items)}')
found=[a for a in items if str(a.get('username',''))=='20010002']
print(f'Found username=20010002: {len(found)}')
for a in found:
    print(f'  id={a.get(\"id\")} username={a.get(\"username\")} activated={a.get(\"activated\")} blocked={a.get(\"blocked\")}')
" 2>&1

# 4. 尝试用已知 id 获取
for id in 67 68 69 70 71 72 73 74 75; do
  call "GET" "/accounts/$id" "" "4. getAccount($id)"
done

# 5. 尝试创建 20010002 看完整错误
call "POST" "/accounts" '{"username":"20010002","sip":"sip:20010002@sip.qrtalkie.org","password":"Test123456!","algorithm":"SHA-256","display_name":"20010002","email":"20010002@sip.qrtalkie.org"}' "5. createAccount 20010002 测试"

# 6. 直接查 Flexisip 数据库
echo ""
echo "===== 6. 直接查 Flexisip 数据库 ====="
mysql -u "${FLEXISIP_DB_USERNAME:-flexisip}" -p"${FLEXISIP_DB_PASSWORD}" -h "${FLEXISIP_DB_HOST:-127.0.0.1}" "${FLEXISIP_DB_DATABASE:-flexisip}" -e "
SELECT 'accounts_tombstones:' as src, id, username, domain, created_at FROM accounts_tombstones WHERE username='20010002';
SELECT 'accounts (active):' as src, id, username, domain, activated, blocked FROM accounts WHERE username='20010002';
" 2>&1

# 7. 查本地 sip_users 表
echo ""
echo "===== 7. 本地 sip_users 表 ====="
mysql -u "${DB_USER:-qrtalkie}" -p"${DB_PASSWORD}" -h "${DB_HOST:-127.0.0.1}" "${DB_NAME:-qrtalkie_cloud}" -e "
SELECT id, username, sip_domain, flexisip_account_id, sync_status, deleted_in_flexisip_at
FROM sip_users WHERE username='20010002';
" 2>&1

echo ""
echo "============================================"
echo "  排查完成"
echo "============================================"
