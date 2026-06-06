#!/bin/bash
# Flexisip 软删除排查脚本
set -e

# 加载环境变量
export $(grep -v '^#' /opt/saas/.env | xargs 2>/dev/null)

BASE="${FLEXISIP_ACCOUNT_MANAGER_BASE_URL:-http://account.qrtalkie.org/api}"
KEY="${FLEXISIP_ACCOUNT_MANAGER_API_KEY}"

echo "============================================"
echo "  Flexisip 软删除排查"
echo "  BASE: $BASE"
echo "  KEY:  ${KEY:0:6}...${KEY: -6}"
echo "============================================"

call() {
  local method="$1" path="$2" data="$3" label="$4"
  echo ""
  echo ">>> $label"
  echo ">>> $method $BASE$path"
  if [ -n "$data" ]; then
    echo ">>> BODY: $data"
    curl -s -w "\n<<< HTTP %{http_code}" -X "$method" "$BASE$path" \
      -H "Content-Type: application/json" \
      -H "x-api-key: $KEY" \
      -d "$data" 2>&1
  else
    curl -s -w "\n<<< HTTP %{http_code}" -X "$method" "$BASE$path" \
      -H "x-api-key: $KEY" 2>&1
  fi
  echo ""
}

# 1. listAccounts - 总数 + 抽样
echo ""
echo "===== 1. listAccounts ====="
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE/accounts" -H "x-api-key: $KEY")
HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
echo "HTTP: $HTTP"
echo "Body length: $(echo "$BODY" | wc -c)"
echo "First 5 accounts:"
echo "$BODY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
items=d if isinstance(d,list) else d.get('accounts',d.get('data',[]))
print(f'Total: {len(items)}')
for a in items[:5]:
    print(f'  id={a.get(\"id\")} username={a.get(\"username\")} activated={a.get(\"activated\")} blocked={a.get(\"blocked\")}')
if len(items)>5:
    print('  ...')
    for a in items[-5:]:
        print(f'  id={a.get(\"id\")} username={a.get(\"username\")} activated={a.get(\"activated\")} blocked={a.get(\"blocked\")}')
# 搜索 username=20010002
found=[a for a in items if str(a.get('username',''))=='20010002']
print(f'Search for username=20010002: found {len(found)}')
for a in found:
    print(json.dumps(a,indent=2)[:500])
" 2>&1 || echo "PARSE FAILED: $BODY" | head -5

# 2. listAccounts with query params
call "GET" "/accounts?username=20010002" "" "2a. listAccounts?username=20010002"
call "GET" "/accounts?search=20010002" "" "2b. listAccounts?search=20010002"
call "GET" "/accounts?q=20010002" "" "2c. listAccounts?q=20010002"
call "GET" "/accounts?filter=20010002" "" "2d. listAccounts?filter=20010002"

# 3. getAccount by known ID 67
call "GET" "/accounts/67" "" "3. getAccount(67)"

# 4. getAccount by username
call "GET" "/accounts/20010002" "" "4. getAccount(20010002) - username as ID"

# 5. Search for possible trash/deleted endpoints
for ep in "/accounts/deleted" "/accounts/trash" "/accounts/trashed" "/accounts/inactive" "/accounts/blocked"; do
  call "GET" "$ep" "" "5. $ep"
done

# 6. Try DELETE again on id 67 to see response
call "DELETE" "/accounts/67" "" "6. DELETE /accounts/67 again"

# 7. Try PATCH / restore
call "PATCH" "/accounts/67" '{"activated":true}' "7a. PATCH /accounts/67 (activate)"
call "POST" "/accounts/67/restore" "" "7b. POST /accounts/67/restore"
call "POST" "/accounts/67/activate" "" "7c. POST /accounts/67/activate"

# 8. Check if there's a different auth header needed
echo ""
echo "===== 8. Try with 'From' header ====="
curl -s -w "\n<<< HTTP %{http_code}" -X GET "$BASE/accounts/67" \
  -H "From: admin@qrtalkie.org" \
  -H "x-api-key: $KEY" 2>&1
echo ""

echo ""
echo "============================================"
echo "  排查完成"
echo "============================================"
