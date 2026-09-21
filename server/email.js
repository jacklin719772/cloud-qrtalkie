import nodemailer from "nodemailer";

function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
  };
}

function isSmtpConfigured(config) {
  return Boolean(config.host && config.port && config.user && config.pass && config.from);
}

async function sendMail({ to, subject, text }) {
  const smtp = getSmtpConfig();

  if (!isSmtpConfigured(smtp)) {
    return { sent: false, reason: "SMTP is not configured" };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  await transporter.sendMail({
    from: smtp.from,
    to,
    subject,
    text,
  });

  return { sent: true };
}

export async function queuePasswordResetEmail(connection, { email, resetUrl }) {
  const subject = "QRTalkie Cloud 密碼重設";
  const body = [
    "請點選以下連結重設您的密碼：",
    "",
    resetUrl,
    "",
    "若非您本人操作，請忽略此郵件。",
  ].join("\n");

  const result = await connection.query(
    `INSERT INTO email_outbox (recipient_email, subject, body)
     VALUES (?, ?, ?)`,
    [email, subject, body],
  );

  try {
    const delivery = await sendMail({ to: email, subject, text: body });

    if (delivery.sent) {
      await connection.query(
        `UPDATE email_outbox
         SET status = 'sent', sent_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [Number(result.insertId)],
      );
      console.log(`Password reset email sent to ${email}`);
      return { sent: true };
    }

    await connection.query(
      `UPDATE email_outbox
       SET status = 'failed'
       WHERE id = ?`,
      [Number(result.insertId)],
    );
    console.log(`Password reset email queued for ${email}: ${delivery.reason}`);
    return { sent: false, reason: delivery.reason };
  } catch (error) {
    await connection.query(
      `UPDATE email_outbox
       SET status = 'failed'
       WHERE id = ?`,
      [Number(result.insertId)],
    );
    console.error(`Password reset email failed for ${email}:`, error.message);
    return { sent: false, reason: error.message };
  }
}

export async function queueVerificationEmail(connection, { email, verificationUrl }) {
  const subject = "QRTalkie Cloud 電子郵件驗證";
  const body = [
    "請點選以下連結完成帳號驗證：",
    "",
    verificationUrl,
    "",
    "如果不是你本人操作，請忽略此郵件。",
  ].join("\n");

  const result = await connection.query(
    `INSERT INTO email_outbox (recipient_email, subject, body)
     VALUES (?, ?, ?)`,
    [email, subject, body],
  );

  try {
    const delivery = await sendMail({ to: email, subject, text: body });

    if (delivery.sent) {
      await connection.query(
        `UPDATE email_outbox
         SET status = 'sent', sent_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [Number(result.insertId)],
      );
      console.log(`Verification email sent to ${email}`);
      return;
    }

    console.log(`Verification email queued for ${email}: ${delivery.reason}`);
  } catch (error) {
    await connection.query(
      `UPDATE email_outbox
       SET status = 'failed'
       WHERE id = ?`,
      [Number(result.insertId)],
    );
    console.error(`Verification email failed for ${email}:`, error.message);
  }

  console.log(`Development verification link: ${verificationUrl}`);
}

export async function queueLoginEmailChangeCode(connection, { email, code }) {
  const subject = "QRTalkie Cloud 登入信箱驗證碼";
  const body = [
    "您的 QRTalkie Cloud 登入信箱修改驗證碼為：",
    "",
    code,
    "",
    "此驗證碼將於 10 分鐘後失效。若不是您本人操作，請忽略此郵件並檢查帳號安全。",
  ].join("\n");

  const result = await connection.query(
    `INSERT INTO email_outbox (recipient_email, subject, body)
     VALUES (?, ?, ?)`,
    [email, subject, body],
  );

  try {
    const delivery = await sendMail({ to: email, subject, text: body });

    if (delivery.sent) {
      await connection.query(
        `UPDATE email_outbox
         SET status = 'sent', sent_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [Number(result.insertId)],
      );
      return;
    }
  } catch (error) {
    await connection.query(
      `UPDATE email_outbox
       SET status = 'failed'
       WHERE id = ?`,
      [Number(result.insertId)],
    );
    console.error(`Login email change code failed for ${email}:`, error.message);
  }

  console.log(`Development login email change code for ${email}: ${code}`);
}

/**
 * 访客「聊天码」邮件：首次咨询后把码发给访客（屏幕已展示，邮件作为备份）。
 * 与其它 queue* 一致：先落 email_outbox，再尝试发送并回写状态。
 */
export async function queueVisitorResumeCodeEmail(connection, { email, code, agentName = "" }) {
  const subject = "QRTalkie 線上客服 · 您的諮詢碼";
  const body = [
    "您好，",
    "",
    `您與${agentName || "客服"}的線上諮詢已開始。這是您的諮詢碼：`,
    "",
    `    ${code}`,
    "",
    "下次換裝置或清除瀏覽器資料後，在諮詢頁輸入此碼即可繼續本次對話（請勿轉發給他人）。",
    "",
    "若您未發起諮詢，請忽略此郵件。",
  ].join("\n");

  const result = await connection.query(
    `INSERT INTO email_outbox (recipient_email, subject, body)
     VALUES (?, ?, ?)`,
    [email, subject, body],
  );

  try {
    const delivery = await sendMail({ to: email, subject, text: body });
    if (delivery.sent) {
      await connection.query(
        `UPDATE email_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [Number(result.insertId)],
      );
    }
    return delivery;
  } catch (error) {
    await connection.query(
      `UPDATE email_outbox SET status = 'failed', error_message = ? WHERE id = ?`,
      [String(error?.message || error).slice(0, 500), Number(result.insertId)],
    );
    return { sent: false, reason: error?.message || String(error) };
  }
}
