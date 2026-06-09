import "dotenv/config";
import { getSaasAdminToken } from "../server/saasAdminAuthClient.js";

const EXTENSION_PATTERN = /^\d+$/;
const SENSITIVE_FIELD_PATTERN = /password|secret|token|csrf|session|cookie|api[_-]?key/i;

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function output(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function redactText(value) {
  return SENSITIVE_FIELD_PATTERN.test(String(value || "")) ? "[REDACTED]" : value;
}

function redactStep(step) {
  return {
    ...step,
    label: redactText(step.label),
    message: redactText(step.message),
    details: step.details || {},
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const extension = String(args.extension || "").trim();
  if (!EXTENSION_PATTERN.test(extension)) {
    output({
      success: false,
      error: {
        code: "INVALID_WEBRTC_EXTENSION",
        message: "WebRTC 帳號必須為純數字",
      },
    });
    process.exitCode = 1;
    return;
  }

  let token;
  try {
    token = await getSaasAdminToken();
  } catch (error) {
    output({
      success: false,
      error: {
        code: error?.code || "SAAS_ADMIN_AUTH_FAILED",
        message: error?.message || "SaaS 管理員 Token 獲取失敗",
      },
    });
    process.exitCode = 1;
    return;
  }

  const saasBaseUrl = String(process.env.SAAS_API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!saasBaseUrl) {
    output({
      success: false,
      error: {
        code: "SAAS_API_BASE_URL_MISSING",
        message: "SaaS API 基礎位址未設定",
      },
    });
    process.exitCode = 1;
    return;
  }
  const response = await fetch(`${saasBaseUrl}/api/pbx/webrtc-accounts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      extension,
      email: `${extension}@example.com`,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  const steps = Array.isArray(payload?.data?.steps) ? payload.data.steps.map(redactStep) : [];
  const summary = {
    success: Boolean(payload?.success),
    message: redactText(payload?.message || ""),
    error: payload?.error
      ? {
          code: payload.error.code,
          message: redactText(payload.error.message || ""),
        }
      : null,
    data: payload?.data
      ? {
          extension: payload.data.extension,
          displayName: redactText(payload.data.displayName),
          createdInFreepbx: payload.data.createdInFreepbx,
          pjsipPasswordConfigured: payload.data.pjsipPasswordConfigured,
          webFormSubmitted: payload.data.webFormSubmitted,
          firstReloadExecuted: payload.data.firstReloadExecuted,
          generatedEndpointVerified: payload.data.generatedEndpointVerified,
          endpointCustomPostWritten: payload.data.endpointCustomPostWritten,
          secondReloadExecuted: payload.data.secondReloadExecuted,
          runtimeVerified: payload.data.runtimeVerified,
          baselineVerified: payload.data.baselineVerified,
          rollbackExecuted: payload.data.rollbackExecuted,
          rollbackSuccess: payload.data.rollbackSuccess,
          asteriskRestartExecuted: payload.data.asteriskRestartExecuted,
          backupDir: payload.data.backupDir,
          reportPath: payload.data.reportPath,
          failedFields: payload.data.failedFields || [],
          warningFields: payload.data.warningFields || [],
          steps,
        }
      : null,
  };

  output(summary);
  process.exitCode = response.ok && payload?.success ? 0 : 1;
}

main().catch((error) => {
  output({
    success: false,
    error: {
      code: error?.code || "WEBRTC_ACCOUNT_API_TEST_FAILED",
      message: "WebRTC 帳號建立測試失敗",
    },
  });
  process.exitCode = 1;
});
