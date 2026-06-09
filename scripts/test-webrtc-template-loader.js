import "dotenv/config";
import { getAsteriskPathConfig, getSaasAdminLoginConfig, getWebrtcRuntimeConfig } from "../server/webrtcTemplateLoader.js";

function output(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function main() {
  try {
    const runtime = getWebrtcRuntimeConfig();
    const asterisk = getAsteriskPathConfig();
    const saas = getSaasAdminLoginConfig();
    output({
      success: true,
      templatePath: runtime.templatePath,
      referenceExtension: runtime.referenceExtension,
      fallbackReferenceExtension: runtime.fallbackReferenceExtension,
      displayNamePrefix: runtime.displayNamePrefix,
      emailDomain: runtime.emailDomain,
      context: runtime.context,
      tech: runtime.tech,
      maxContacts: runtime.maxContacts,
      mediaAddress: runtime.mediaAddress,
      transport: runtime.transport,
      allowedCodecsString: runtime.allowedCodecsString,
      formAllowedCodecs: runtime.formAllowedCodecs,
      disallowCodecs: runtime.disallowCodecs,
      endpointCustomPostOverlay: runtime.endpointCustomPostOverlay,
      endpointGeneratedExpected: runtime.endpointGeneratedExpected,
      freepbxWeb: {
        baseUrl: process.env.FREEPBX_WEB_BASE_URL || process.env.FREEPBX_BASE_URL || "",
        pageTimeoutMs: Number(process.env.FREEPBX_WEB_PAGE_TIMEOUT_MS || 60000),
        submitTimeoutMs: Number(process.env.FREEPBX_WEB_SUBMIT_TIMEOUT_MS || 60000),
      },
      asterisk: {
        configDir: asterisk.configDir,
        endpointConf: asterisk.endpointConf,
        endpointCustomPostConf: asterisk.endpointCustomPostConf,
        customPostConf: asterisk.customPostConf,
        authConf: asterisk.authConf,
        aorConf: asterisk.aorConf,
        backupRoot: asterisk.backupRoot,
        asteriskBin: asterisk.asteriskBin,
        fwconsoleBin: asterisk.fwconsoleBin,
        reloadCommand: asterisk.reloadCommand,
      },
      saasAdminLogin: {
        baseUrl: saas.baseUrl,
        loginPath: saas.loginPath,
        timeoutMs: saas.timeoutMs,
        identifierField: saas.identifierField,
        hasUsername: Boolean(saas.username),
        hasPassword: Boolean(saas.password),
      },
    });
  } catch (error) {
    output({
      success: false,
      error: {
        code: error?.code || "WEBRTC_TEMPLATE_LOADER_FAILED",
        message: error?.message || "WebRTC 設定模板載入失敗",
        envName: error?.envName || undefined,
      },
    });
    process.exitCode = 1;
  }
}

main();
