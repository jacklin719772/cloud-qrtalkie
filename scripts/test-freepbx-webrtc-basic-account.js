import "dotenv/config";
import {
  addExtension,
  applyConfigAndWait,
  fetchExtension,
  getExtensionInputSchema,
  getFreepbxConfigForDryRun,
  updateExtension,
} from "../server/freepbxApiClient.js";
import { verifyPjsipExtension } from "../server/asteriskCommandService.js";
import { buildFreepbxWebrtcExtensionPayloads } from "../server/freepbxWebrtcExtensionPayload.js";

const EXTENSION_PATTERN = /^\d+$/;

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

  const email = String(args.email || `${extension}@example.com`);
  const confirm = args.confirm === "yes";
  const schema = await getExtensionInputSchema();
  const {
    displayName,
    addPayload,
    updatePayload,
    updatePayloadForOutput,
    webrtcConfig,
    unsupportedByGraphql,
    appliedFieldMappings,
  } = buildFreepbxWebrtcExtensionPayloads(extension, email, schema);

  if (!confirm) {
    output({
      success: true,
      dryRun: true,
      config: getFreepbxConfigForDryRun(),
      actions: [
        "fetchExtension",
        "addExtension",
        "updateExtension(extPassword redacted + WebRTC fields)",
        "doReload(apply config)",
        "verifyPjsipExtension",
        "verifyWebrtcEndpointParameters",
      ],
      extension,
      displayName,
      webrtcConfig,
      addPayload,
      updatePayload: updatePayloadForOutput,
      supportedGraphqlFields: {
        addExtensionInput: Object.keys(schema.addExtensionInput),
        updateExtensionInput: Object.keys(schema.updateExtensionInput),
      },
      appliedFieldMappings,
      unsupportedByGraphql,
    });
    return;
  }

  const existing = await fetchExtension(extension);
  if (existing) {
    output({
      success: false,
      error: {
        code: "FREEPBX_EXTENSION_ALREADY_EXISTS",
        message: "该WebRTC账号已存在",
      },
      extension,
    });
    process.exitCode = 1;
    return;
  }

  const createResult = await addExtension(addPayload);
  if (!createResult?.status) {
    output({
      success: false,
      error: {
        code: "FREEPBX_EXTENSION_CREATE_FAILED",
        message: createResult?.message || "FreePBX创建基础PJSIP分机失败",
      },
      extension,
    });
    process.exitCode = 1;
    return;
  }

  let passwordUpdate = null;
  try {
    passwordUpdate = await updateExtension(extension, updatePayload);
  } catch (error) {
    passwordUpdate = {
      status: false,
      message: "PJSIP注册密码或WebRTC参数更新失败",
    };
  }
  if (!passwordUpdate?.status) {
    output({
      success: false,
      error: {
        code: "FREEPBX_EXTENSION_WEBRTC_UPDATE_FAILED",
        message: passwordUpdate?.message || "PJSIP注册密码或WebRTC参数更新失败",
      },
      data: {
        extension,
        tech: "pjsip",
        createdInFreepbx: true,
        pjsipPasswordConfigured: false,
        freepbxWebrtcFieldsUpdated: false,
        passwordUpdateMessage: passwordUpdate?.message || null,
        unsupportedByGraphql,
      },
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
      data: {
        extension,
        tech: "pjsip",
        createdInFreepbx: true,
        pjsipPasswordConfigured: true,
        passwordUpdateMessage: passwordUpdate?.message || null,
        applyConfig,
      },
    });
    process.exitCode = 1;
    return;
  }

  const asterisk = await verifyPjsipExtension(extension, webrtcConfig);
  output({
    success: true,
    data: {
      extension,
      tech: "pjsip",
      displayName,
      createdInFreepbx: true,
      pjsipPasswordConfigured: Boolean(passwordUpdate?.status),
      freepbxWebrtcFieldsUpdated: appliedFieldMappings.length > 0,
      passwordUpdateMessage: passwordUpdate?.message || null,
      webrtcConfig,
      appliedFieldMappings,
      unsupportedByGraphql,
      applyConfig,
      applyConfigSuccess: Boolean(applyConfig.success),
      verifiedInAsterisk: asterisk.verified,
      asterisk,
      message: asterisk.verified
        ? "WebRTC基础账号已创建，请登录Incredible PBX后台确认。"
        : asterisk.endpointExists && asterisk.authExists && asterisk.aorExists
          ? "账号已创建并已执行 Apply Config，endpoint/auth/aor 已存在，但 WebRTC 关键参数未通过运行态检查。"
          : "账号已创建并已执行 Apply Config，但 Asterisk runtime 暂未验证到 endpoint/auth/aor，请手工检查。",
    },
  });
}

main().catch((error) => {
  output({
    success: false,
    error: {
      code: error?.code || "FREEPBX_WEBRTC_BASIC_TEST_FAILED",
      message: error?.message || "FreePBX WebRTC basic account test failed.",
      status: error?.status || undefined,
      responseBody: error?.responseBody || undefined,
    },
  });
  process.exitCode = 1;
});
