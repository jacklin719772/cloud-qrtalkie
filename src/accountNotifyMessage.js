// 賬號開通通知文案（訂閱帳號管理 / 試用帳號管理共用模板）
export function buildAccountNotifyMessage({
  username,
  webAccount,
  password,
  isTrial = false,
  periodLabel = '訂閱期',
  periodStart = '',
  periodEnd = '',
  ecardAccessUrl = '',
  ecardImageUrl = '',
}) {
  const lines = [
    `您好，已為您開通 QRTalkie ${isTrial ? '試用' : ''}帳號：`,
    '',
    `▸ 帳號：${username || '-'}${webAccount ? `（Web 帳號：${webAccount}）` : ''}`,
    `▸ 密碼：${password || '（請與管理員確認）'}`,
    `▸ ${periodLabel}：${periodStart || '-'} ~ ${periodEnd || '-'}`,
  ];
  if (ecardAccessUrl) lines.push(`▸ 電子名片（訪問）：${ecardAccessUrl}`);
  if (ecardImageUrl) lines.push(`▸ 名片圖片：${ecardImageUrl}`);
  lines.push(
    '',
    '使用步驟：',
    '1. 前往雲平台 https://cloud.qrtalkie.org，使用上述帳號登入並修改密碼；',
    '2. 於平台下載並安裝 App；',
    '3. 開啟 App，使用該帳號與新密碼登入即可開始使用。',
    '',
    '如需協助，請隨時與我們聯繫。',
  );
  return lines.join('\n');
}
