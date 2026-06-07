import "dotenv/config";
import {
  FreepbxWebSessionClient,
  getFreepbxWebConfigForOutput,
  inspectWebrtcFormFields,
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

function safeFieldName(name) {
  return SENSITIVE_FIELD_PATTERN.test(name) ? "[REDACTED_FIELD_NAME]" : name;
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

  const client = new FreepbxWebSessionClient();
  const form = await client.getExtensionForm(extension);
  const fieldNames = form.fieldNames;
  const targetFields = inspectWebrtcFormFields(fieldNames);

  output({
    success: true,
    extension,
    config: getFreepbxWebConfigForOutput(),
    pageUrl: form.pageUrl,
    formAction: form.formAction,
    method: form.method,
    hasCsrfToken: form.hasCsrfToken,
    fields: fieldNames.map(safeFieldName),
    webrtcTargets: targetFields.map((field) => ({
      ...field,
      fieldName: field.fieldName ? safeFieldName(field.fieldName) : null,
    })),
    foundWebrtcFields: targetFields
      .filter((field) => field.fieldName)
      .map((field) => ({ target: field.target, fieldName: safeFieldName(field.fieldName) })),
    missingWebrtcFields: targetFields
      .filter((field) => !field.fieldName)
      .map((field) => ({ target: field.target })),
  });
}

main().catch((error) => {
  output({
    success: false,
    error: {
      code: error?.code || "FREEPBX_EXTENSION_FORM_INSPECT_FAILED",
      message: error?.message || "FreePBX extension form inspect failed.",
      status: error?.status || undefined,
    },
    config: getFreepbxWebConfigForOutput(),
  });
  process.exitCode = 1;
});
