# Presence 状态订阅问题解决方案（org / cn Flexisip）

日期：2026-11-13
影响：App 联系人列表中"自建同域联系人"（通过「添加到联系人」加入）不显示在线状态

## 一、现象

- 联系人列表里，通讯录名单（AM 通讯录）成员能显示状态
- 通过「添加到联系人」加入的同域账号（只写入 `contacts` 表）**一直不显示状态**
- 发布方正常（`PUBLISH` 内容为 `basic=open` + `pidfonline:online`，服务器每次 `200 Ok`）

## 二、根因（两层）

### 1. RLS 成员来源不包含自建联系人

Flexisip presence 的 RLS 成员由 `[presence-server] rls-database-request` 决定，原查询只取
`account_contacts_list` + `contacts_list_contact`（**通讯录名单**）。

而 App 的「添加到联系人」（同域）写入的是 `contacts` 表（账号↔账号），两者不是同一份数据，
所以自建联系人**永远不在订阅成员里**，状态无从下发。

### 2. 即使进入成员，也要求"双方互订阅"

Flexisip 源码 `src/presence/presentity/presentity-manager.cc`：

```cpp
if (!listener->extendedNotifyEnabled()) {
    auto toListener = toPresenceInfo->findPresenceInfoListener(presenceInfo);
    if (toListener != nullptr) {          // 只有 A 订阅 B 且 B 也订阅 A 时才成立
        listener->enableExtendedNotify(true);
        ...
    }
}
```

- 不满足"互订阅"时，该成员的 pidf 被替换为默认空文档：
  `<note xml:lang="en">No presence information available yet</note>`
- 单向添加的联系人因此拿不到真实状态（日志中体现为 `Presence info (non-extended) added to list`）

## 三、改动（org 服务器 `/etc/flexisip/flexisip.conf`）

### 3.1 `[presence-server] rls-database-request`

改为「通讯录名单 ∪ 自建联系人」的并集（每个占位符只出现一次，放在外层 where 过滤）：

```sql
select distinct sip from (
  select concat('sip:', ac.username, '@', ac.domain) as sip, sub.username as su, sub.domain as sd
    from account_contacts_list acl
    join contacts_list_contact clc on clc.contacts_list_id = acl.contacts_list_id
    join accounts ac on ac.id = clc.contact_id
    join accounts sub on sub.id = acl.account_id
  union all
  select concat('sip:', c.username, '@', c.domain) as sip, sub.username as su, sub.domain as sd
    from contacts ct
    join accounts sub on sub.id = ct.account_id
    join accounts c on c.id = ct.contact_id
) t where concat('sip:', t.su, '@', t.sd) = :from and length(:to) > 0
```

> 注意：命名参数 `:from` / `:to` 不能在同一语句里出现多次（Flexisip 替换/绑定会出问题，
> 曾导致整条订阅查不到成员、所有联系人状态消失）。

### 3.2 `[presence-server] bypass-condition`

```
bypass-condition=LinphoneSDK
```

- 客户端 SUBSCRIBE 的 `User-Agent` 含该子串时，`bypass=true` →
  `extendedNotifyEnabled() = mExtendedNotify || mBypassEnabled` 为真
- 从而**不再要求双方互订阅**，单向添加的联系人也下发真实状态（日志变为 `Presence info (extended)`）
- 我方 UA：Android `QRTalkieAndroid/10.0.27 (…) LinphoneSDK/5.5.21 …`，
  iOS `LinphoneiOS/6.0.5 Beta (iPhone) LinphoneSDK/5.5.0`，均含 `LinphoneSDK`

## 四、生效步骤

```bash
systemctl stop flexisip-presence
systemctl start flexisip-presence
# 客户端需重新注册/重开 App 以重建订阅（RLS 成员在订阅建立时解析）
```

## 四之一、cn 服务器（218.95.39.186，Flexisip 2.4.4）

与 org 的差异：cn 的 `rls-database-request` **返回两列**（username, domain），且用 `:from like ...` 匹配。
已按同等语义改为：

```sql
select distinct u.username, u.domain from (
  select ac.username as username, ac.domain as domain, sub.username as su, sub.domain as sd
    from account_contacts_list acl
    join contacts_list_contact clc on clc.contacts_list_id = acl.contacts_list_id
    join accounts ac on ac.id = clc.contact_id
    join accounts sub on sub.id = acl.account_id
  union all
  select c.username as username, c.domain as domain, sub.username as su, sub.domain as sd
    from contacts ct
    join accounts sub on sub.id = ct.account_id
    join accounts c on c.id = ct.contact_id
) u where :from like concat('%', u.su, '@', u.sd, '%') and length(:to) > 0
```

并在 `[presence-server]` 增加 `bypass-condition=LinphoneSDK`。
- 备份：`/etc/flexisip/flexisip.conf.bak-presence-20261113`
- 已执行 `systemctl stop/start flexisip-presence`（2026-11-13 03:41:11）
- 已验证 `contacts` 表存在（cn 库 `flexisip.contacts`），测试账号 10010004 查询返回 `admin` + `10010004`


## 五、验证方法与结果（org，2026-11-13 03:31）

抓 `presence → proxy` 出向连接的 NOTIFY 并解压（multipart/related + deflate）：

- 发给 50010003 的 NOTIFY：
  - 成员 `50011942` → `open`（修改前为 `noinfo`）
  - 成员 `50010013` → `open`
- presence 日志：`Presence info (extended) added to list … entity [sip:50011942@…]`（03:31:39）
- 设备侧：vivo（50010003）联系人列表中 50011942 显示在线

## 六、回滚

| 备份 | 内容 |
|---|---|
| `/etc/flexisip/flexisip.conf.bak-rls-20261112` | 原始配置（改动前） |
| `/etc/flexisip/flexisip.conf.bak-rls2-20261112` | 改 RLS 查询前 |
| `/etc/flexisip/flexisip.conf.bak-bypass-20261113` | 加 bypass-condition 前 |
| `/etc/flexisip/flexisip.conf.bak-logdebug-20261113` | 开 debug 日志前 |

回滚后同样执行 `systemctl stop/start flexisip-presence`。

## 七、注意事项

1. **隐私语义**：`bypass-condition` 会让"单向添加"也能看到对方状态（不再要求对方也把你加入名单）。
   这是产品决策，需知会复核。
2. **重启影响**：重启 presence 会清空订阅，客户端需重连重建（几秒到数分钟）。
   单独重启 presence 若出现"全部状态消失且不恢复"，可连 `flexisip-proxy` 一起重启。
3. **调试日志**：`[global] log-level=debug` 会快速增长日志，排查完必须改回 `error`。
