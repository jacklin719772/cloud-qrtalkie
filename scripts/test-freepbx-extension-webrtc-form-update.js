import "dotenv/config";
import { applyConfigAndWait } from "../server/freepbxApiClient.js";
import { verifyPjsipExtension } from "../server/asteriskCommandService.js";
import { getFreepbxWebrtcPublicConfig } from "../server/freepbxWebrtcExtensionPayload.js";
import {
  FreepbxWebSessionClient,
  buildWebrtcFormUpdate,
  getFreepbxWebConfigForOutput,
} from "../server/freepbxWebSessionClient.js";

const EXTENSION_PATTERN = /^\d+$/;
const SENSITIVE_FIELD_PATTERN = /password|secret|token|csrf|session|key/i;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function output(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function redactApplied(applied) {
  return applied.map((item) => ({
    ...item,
    fieldName: SENSITIVE_FIELD_PATTERN.test(item.fieldName) ? "[REDACTED_FIELD_NAME]" : item.fieldName,
    value: SENSITIVE_FIELD_PATTERN.test(item.fieldName) ? "[REDACTED]" : item.value,
  }));
}

async function main() {
  const args = parseArgs(process.argv);
  const extension = String(args.extension || "");
  if (!EXTENSION_PATTERN.test(extension)) {
    output({
      success: false,
      error: {
        code: "INVALID_WEBRTC_EXTENSION",
        message: "WebRTC账号必须为纯数字",
      },
    });
    process.exitCode = 1;
    return;
  }

  const confirm = args.confirm === "yes";
  const client = new FreepbxWebSessionClient();
  const form = await client.getExtensionForm(extension);
  const update = buildWebrtcFormUpdate(form, extension);
  const webrtcConfig = getFreepbxWebrtcPublicConfig();

  if (!confirm) {
    output({
      success: true,
      dryRun: true,
      extension,
      config: getFreepbxWebConfigForOutput(),
      pageUrl: form.pageUrl,
      formAction: form.formAction,
      method: form.method,
      hasCsrfToken: form.hasCsrfToken,
      actions: [
        "loginFreepbxWeb",
        "getExtensionEditForm",
        "parseOriginalFormFields",
        "overrideFixedWebrtcFields",
        "dryRunOnly(no submit without --confirm yes)",
      ],
      displayName: `訪客${extension}`,
      webrtcConfig,
      appliedFields: redactApplied(update.applied),
      missingFields: update.missing,
    });
    return;
  }

  const submitResult = await client.submitExtensionForm(form, update.fields);
  if (submitResult.loginShown) {
    output({
      success: false,
      error: {
        code: "FREEPBX_EXTENSION_FORM_SUBMIT_NOT_AUTHENTICATED",
        message: "FreePBX returned the login page after form submit.",
      },
      extension,
    });
    process.exitCode = 1;
    return;
  }

  const applyConfig = await applyConfigAndWait();
  if (!applyConfig.success) {
    output({
      success: false,
      error: {
        code: "APPLY_CONFIG_FAILED",
        message: applyConfig.message || "FreePBX Apply Config failed.",
      },
      extension,
      submitResult,
      applyConfig,
    });
    process.exitCode = 1;
    return;
  }

  const asterisk = await verifyPjsipExtension(extension, webrtcConfig);
  output({
    success: true,
    data: {
      extension,
      displayName: `訪客${extension}`,
      formSubmitted: true,
      submitStatus: submitResult.status,
      finalUrl: submitResult.finalUrl,
      appliedFields: redactApplied(update.applied),
      missingFields: update.missing,
      applyConfig,
      applyConfigSuccess: Boolean(applyConfig.success),
      verifiedInAsterisk: Boolean(asterisk.verified),
      asterisk,
      webrtcConfig,
    },
  });
}

main().catch((error) => {
  output({
    success: false,
    error: {
      code: error?.code || "FREEPBX_WEBRTC_FORM_UPDATE_FAILED",
      message: error?.message || "FreePBX WebRTC form update failed.",
      status: error?.status || undefined,
    },
    config: getFreepbxWebConfigForOutput(),
  });
  process.exitCode = 1;
});
