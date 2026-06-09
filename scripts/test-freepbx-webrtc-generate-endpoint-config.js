import "dotenv/config";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  addExtension,
  fetchExtension,
  getExtensionInputSchema,
  updateExtension,
} from "../server/freepbxApiClient.js";
import {
  FreepbxWebSessionClient,
  buildWebrtcFormUpdate,
  getFreepbxWebConfigForOutput,
  inspectWebrtcFormFields,
} from "../server/freepbxWebSessionClient.js";
import { verifyPjsipExtension } from "../server/asteriskCommandService.js";
import {
  buildFreepbxWebrtcExtensionPayloads,
  getFreepbxWebrtcPublicConfig,
} from "../server/freepbxWebrtcExtensionPayload.js";
import { getAsteriskPathConfig, getWebrtcRuntimeConfig } from "../server/webrtcTemplateLoader.js";

const execFileAsync = promisify(execFile);
const EXTENSION_PATTERN = /^\d+$/;
const DEFAULT_EXTENSION = "9513";
const WEBRTC_RUNTIME = getWebrtcRuntimeConfig();
const ASTERISK_PATHS = getAsteriskPathConfig();
const PRIMARY_REFERENCE_EXTENSION = WEBRTC_RUNTIME.referenceExtension;
const FALLBACK_REFERENCE_EXTENSION = WEBRTC_RUNTIME.fallbackReferenceExtension;
const REFERENCE_EXTENSIONS = [
  FALLBACK_REFERENCE_EXTENSION,
  PRIMARY_REFERENCE_EXTENSION,
].filter((value, index, array) => Boolean(value) && array.indexOf(value) === index);
const ENDPOINT_CONF = ASTERISK_PATHS.endpointConf;
const REPORT_PREFIX = "/tmp/freepbx-generated-endpoint";
const USED_TEST_EXTENSIONS = new Set(["9500", "9501", "9502", "9503", "9504", "9505", "9510", "9511", "9512"]);
const SENSITIVE_FIELD_PATTERN = /password|secret|token|csrf|session|cookie/i;

const TARGET_ENDPOINT_FIELDS = [
  "type",
  "aors",
  "auth",
  "disallow",
  "allow",
  "context",
  "callerid",
  "media_address",
  "direct_media",
  "transport",
  "aggregate_mwi",
  "use_avpf",
  "rtcp_mux",
  "bundle",
  "ice_support",
  "media_use_received_transport",
  "media_encryption",
  "timers",
  "media_encryption_optimistic",
  "refer_blind_progress",
  "rtp_timeout",
  "rtp_timeout_hold",
  "send_pai",
  "dtls_verify",
];

const GRAPHQL_FIELD_CANDIDATES = [
  "extensionId",
  "name",
  "tech",
  "email",
  "vmEnable",
  "maxContacts",
  "extPassword",
  "transport",
  "allow",
  "disallow",
  "mediaAddress",
  "directMedia",
  "aggregateMwi",
  "avpf",
  "rtcpMux",
  "bundle",
  "iceSupport",
  "mediaUseReceivedTransport",
  "mediaEncryption",
  "mediaEncryptionOptimistic",
  "timers",
  "referBlindProgress",
  "sendPai",
  "sendrpid",
  "dtlsVerify",
];

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

function getReportPath(extension, confirm) {
  return `${REPORT_PREFIX}-${extension}${confirm ? "" : "-dry-run"}-report.md`;
}

function assertValidExtension(extension) {
  if (!EXTENSION_PATTERN.test(String(extension || ""))) {
    const error = new Error("WebRTC账号必须为纯数字");
    error.code = "INVALID_WEBRTC_EXTENSION";
    throw error;
  }
}

function redactFieldName(name) {
  return SENSITIVE_FIELD_PATTERN.test(String(name || "")) ? "[REDACTED_FIELD_NAME]" : name;
}

function redactValue(name, value) {
  return SENSITIVE_FIELD_PATTERN.test(String(name || "")) ? "[REDACTED]" : value;
}

function redactApplied(applied) {
  return applied.map((item) => ({
    ...item,
    fieldName: redactFieldName(item.fieldName),
    value: redactValue(item.fieldName, item.value),
  }));
}

function parseSection(content, sectionName) {
  const lines = String(content || "").split(/\n/);
  const start = lines.findIndex((line) => line.trim() === `[${sectionName}]`);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\[[^\]]+\]\s*$/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start, end);
  const fields = {};
  for (const line of body.slice(1)) {
    const match = line.match(/^\s*([^;#][^=]*)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (SENSITIVE_FIELD_PATTERN.test(key)) continue;
    fields[key] = value;
  }
  return { sectionName, startLine: start + 1, endLine: end, body, fields };
}

function buildExpectedEndpointSection(extension, referenceFields) {
  const runtimeTransport = String(WEBRTC_RUNTIME.transport || process.env.FREEPBX_WEBRTC_TRANSPORT || "").trim();
  const runtimeMediaAddress = String(WEBRTC_RUNTIME.mediaAddress || process.env.FREEPBX_WEBRTC_MEDIA_ADDRESS || "").trim();
  const runtimeAllowedCodecs = String(WEBRTC_RUNTIME.allowedCodecsString || process.env.FREEPBX_WEBRTC_ALLOW_CODECS || "").trim();
  const runtimeContext = String(WEBRTC_RUNTIME.context || process.env.FREEPBX_WEBRTC_CONTEXT || "").trim();
  const fields = {
    ...referenceFields,
    aors: extension,
    auth: `${extension}-auth`,
    callerid: `訪客${extension} <${extension}>`,
  };
  fields.allow = runtimeAllowedCodecs || fields.allow || "";
  fields.disallow = "all";
  fields.context = fields.context || runtimeContext || "";
  fields.media_address = runtimeMediaAddress || fields.media_address || "";
  fields.direct_media = "no";
  fields.transport = runtimeTransport || fields.transport || "";
  fields.aggregate_mwi = "yes";
  fields.use_avpf = "yes";
  fields.rtcp_mux = "yes";
  fields.bundle = "yes";
  fields.ice_support = "yes";
  fields.media_use_received_transport = "yes";
  fields.media_encryption = "dtls";
  fields.timers = "no";
  fields.media_encryption_optimistic = "yes";
  fields.refer_blind_progress = "yes";
  fields.send_pai = "yes";
  fields.dtls_verify = fields.dtls_verify || "fingerprint";
  fields.rtp_timeout = fields.rtp_timeout || "30";
  fields.rtp_timeout_hold = fields.rtp_timeout_hold || "300";
  fields.type = "endpoint";

  const order = [
    "type",
    "aors",
    "auth",
    "disallow",
    "allow",
    "context",
    "callerid",
    "media_address",
    "direct_media",
    "transport",
    "aggregate_mwi",
    "use_avpf",
    "rtcp_mux",
    "bundle",
    "ice_support",
    "media_use_received_transport",
    "media_encryption",
    "timers",
    "media_encryption_optimistic",
    "refer_blind_progress",
    "rtp_timeout",
    "rtp_timeout_hold",
    "send_pai",
    "dtls_verify",
  ];

  const lines = [`[${extension}]`];
  for (const key of order) {
    if (fields[key] !== undefined && fields[key] !== "") lines.push(`${key}=${fields[key]}`);
  }
  return { fields, text: lines.join("\n") };
}

function compareFields(actualFields, expectedFields) {
  return TARGET_ENDPOINT_FIELDS.map((field) => {
    const expected = expectedFields[field] ?? "";
    const actual = actualFields?.[field] ?? "";
    return {
      field,
      expected,
      actual,
      passed: String(expected) === String(actual),
    };
  });
}

function graphqlSupport(schema) {
  const add = schema?.addExtensionInput || {};
  const update = schema?.updateExtensionInput || {};
  return GRAPHQL_FIELD_CANDIDATES.map((field) => ({
    field,
    addExtensionInput: Object.prototype.hasOwnProperty.call(add, field),
    updateExtensionInput: Object.prototype.hasOwnProperty.call(update, field),
    addType: add[field] || null,
    updateType: update[field] || null,
  }));
}

async function runReadOnly(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout: options.timeout || 15000,
    maxBuffer: 1024 * 1024,
  });
  return `${stdout || ""}${stderr || ""}`;
}

async function backupPjsipConfigs() {
  const output = await runReadOnly("node", ["scripts/backup-asterisk-pjsip-configs.js", "--confirm", "yes"], {
    timeout: 30000,
  });
  const backupDir = output.match(/Backup dir:\s*(\S+)/)?.[1] || "";
  const manifest = output.match(/Manifest:\s*(\S+)/)?.[1] || "";
  return { output, backupDir, manifest };
}

async function sudoFwconsoleReload() {
  return runReadOnly("sudo", ["fwconsole", "reload"], { timeout: 60000 });
}

async function coreShowChannels() {
  return runReadOnly("asterisk", ["-rx", "core show channels"], { timeout: 15000 });
}

async function chooseExtension(requested) {
  let candidate = String(requested || DEFAULT_EXTENSION);
  assertValidExtension(candidate);
  if (USED_TEST_EXTENSIONS.has(candidate)) candidate = String(Number(candidate) + 1);

  for (let i = 0; i < 20; i += 1) {
    const current = String(Number(candidate) + i);
    if (USED_TEST_EXTENSIONS.has(current)) continue;
    const existing = await fetchExtension(current);
    if (!existing) return { extension: current, existingExtensionSkipped: current !== String(requested || DEFAULT_EXTENSION) };
  }
  const error = new Error("No available numeric test extension found.");
  error.code = "FREEPBX_TEST_EXTENSION_UNAVAILABLE";
  throw error;
}

function markdownTable(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(row[column.key] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  return [header, sep, ...body].join("\n");
}

async function writeReport(reportPath, data) {
  const mappingRows = data.formMapping.map((item) => ({
    target: item.target,
    fieldName: item.fieldName || "未找到",
    desiredValue: item.desiredValue ?? "",
    confirmed: item.fieldName ? "yes" : "no",
    note: item.fieldName ? "FreePBX edit form contains this field" : "No matching field name found in form",
  }));
  const graphqlRows = data.graphqlSupport.map((item) => ({
    field: item.field,
    add: item.addExtensionInput ? `yes (${item.addType})` : "no",
    update: item.updateExtensionInput ? `yes (${item.updateType})` : "no",
  }));
  const endpointCompare = data.endpointComparison || [];
  const runtimeFailed = data.runtime?.failedChecks || [];
  const missingFormFields = data.formMapping.filter((item) => !item.fieldName).map((item) => item.target);
  const ineffectiveFields = endpointCompare.filter((item) => !item.passed).map((item) => item.field);
  const warningFields = Array.from(
    new Set([
      ...(data.runtime?.unsupportedOrUnverified || []).map((item) => item.field),
      ...missingFormFields,
    ]),
  );
  const content = `# FreePBX Generated Endpoint Config Test Report

## 1. Summary

- Time: ${new Date().toISOString()}
- Mode: ${data.confirm ? "real execution" : "dry-run"}
- Requested extension: ${data.requestedExtension}
- Actual extension: ${data.extension}
- Reference extensions: ${FALLBACK_REFERENCE_EXTENSION}, ${PRIMARY_REFERENCE_EXTENSION}
- Reference used for expected endpoint: ${PRIMARY_REFERENCE_EXTENSION}
- Directly modified Asterisk .conf files: false
- Directly wrote FreePBX database: false
- Directly wrote SaaS database: false
- Asterisk restart executed: false
- sudo fwconsole reload executed: ${data.reloadExecuted ? "true" : "false"}

## 2. Reference pjsip.endpoint.conf Sections

### ${FALLBACK_REFERENCE_EXTENSION}

\`\`\`ini
${data.referenceSections[FALLBACK_REFERENCE_EXTENSION]?.body?.join("\n") || "not found"}
\`\`\`

### ${PRIMARY_REFERENCE_EXTENSION}

\`\`\`ini
${data.referenceSections[PRIMARY_REFERENCE_EXTENSION]?.body?.join("\n") || "not found"}
\`\`\`

## 3. Target Expected Section

\`\`\`ini
${data.expectedSection.text}
\`\`\`

## 4. GraphQL Field Support

${markdownTable(graphqlRows, [
  { key: "field", label: "Field" },
  { key: "add", label: "addExtensionInput" },
  { key: "update", label: "updateExtensionInput" },
])}

## 5. FreePBX Web Form Field Mapping

- Web config: ${JSON.stringify(data.webConfig)}
- Reference form extension: ${data.referenceFormExtension}
- Form action: ${data.formMeta.formAction}
- Method: ${data.formMeta.method}
- Has CSRF token: ${data.formMeta.hasCsrfToken}
- Cookie/session/token values: not reported

${markdownTable(mappingRows, [
  { key: "target", label: "Target pjsip.endpoint.conf field" },
  { key: "fieldName", label: "FreePBX Web form field" },
  { key: "desiredValue", label: "Target value" },
  { key: "confirmed", label: "Confirmed" },
  { key: "note", label: "Note" },
])}

## 6. Planned / Applied Flow

1. Validate numeric extension.
2. Use GraphQL \`addExtension\` for base PJSIP extension.
3. Use GraphQL \`updateExtension\` for PJSIP registration password.
4. GET FreePBX Web extension edit form.
5. Override fixed WebRTC form fields on top of original form fields.
6. POST FreePBX Web form.
7. Execute \`sudo fwconsole reload\`.
8. Read generated \`/etc/asterisk/pjsip.endpoint.conf\` section.
9. Read Asterisk runtime endpoint.

Dry-run does not create the extension, does not submit the form, and does not reload.

## 7. Execution Result

- Existing extension skipped: ${data.existingExtensionSkipped ? "true" : "false"}
- Backup dir: ${data.backup?.backupDir || "not run"}
- Manifest: ${data.backup?.manifest || "not run"}
- Created via GraphQL: ${data.createdInFreepbx ? "true" : "false"}
- Password configured: ${data.pjsipPasswordConfigured ? "true" : "false"}
- Web form submitted: ${data.formSubmitted ? "true" : "false"}
- missingFormFields: ${missingFormFields.length ? missingFormFields.join(", ") : "none"}
- ineffectiveFields: ${ineffectiveFields.length ? ineffectiveFields.join(", ") : "none"}
- warningFields: ${warningFields.length ? warningFields.join(", ") : "none"}
- Reload output: ${data.reloadOutput ? data.reloadOutput.replace(/\n/g, " / ") : "not run"}

## 8. Generated Endpoint Section

\`\`\`ini
${data.generatedSection?.body?.join("\n") || "not generated/read in dry-run"}
\`\`\`

## 9. Comparison With Expected ${PRIMARY_REFERENCE_EXTENSION}-style Section

${endpointCompare.length ? markdownTable(endpointCompare.map((item) => ({
  field: item.field,
  expected: item.expected,
  actual: item.actual,
  passed: item.passed ? "yes" : "no",
})), [
  { key: "field", label: "Field" },
  { key: "expected", label: "Expected" },
  { key: "actual", label: "Actual" },
  { key: "passed", label: "Passed" },
]) : "Not run in dry-run."}

## 10. Runtime Verification

- endpointExists: ${data.runtime?.endpointExists ?? "not run"}
- authExists: ${data.runtime?.authExists ?? "not run"}
- aorExists: ${data.runtime?.aorExists ?? "not run"}
- runtime passed: ${data.runtime?.verified ?? data.runtime?.webrtcVerified ?? "not run"}
- failedFields: ${runtimeFailed.length ? runtimeFailed.join(", ") : "none/not run"}

## 11. Failed Fields

${data.failedFields?.length ? data.failedFields.map((field) => `- ${field}`).join("\n") : "- none/not run"}

## 12. Missing / Ineffective / Warning Fields

- missingFormFields: ${missingFormFields.length ? missingFormFields.join(", ") : "none"}
- ineffectiveFields: ${ineffectiveFields.length ? ineffectiveFields.join(", ") : "none"}
- warningFields: ${warningFields.length ? warningFields.join(", ") : "none"}

## 13. Next Recommendation

${data.confirm
  ? `Review failed fields. If generated endpoint config still does not match ${PRIMARY_REFERENCE_EXTENSION}, inspect exact FreePBX form field values accepted by the web UI before considering any custom post overlay.`
  : "Run with --confirm yes only after reviewing the target section and form field mapping. The real run will create the extension, submit the FreePBX Web form, and execute sudo fwconsole reload."}
`;
  await writeFile(reportPath, content, "utf8");
}

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

async function main() {
  const args = parseArgs(process.argv);
  const requestedExtension = String(args.extension || DEFAULT_EXTENSION);
  assertValidExtension(requestedExtension);
  const confirm = args.confirm === "yes";
  const ignoreActiveCalls = args["ignore-active-calls"] === "yes" || args["ignore-active-channels"] === "yes";
  const email = String(args.email || `${requestedExtension}@example.com`);

  const endpointConf = await readFile(ENDPOINT_CONF, "utf8");
  const referenceSections = Object.fromEntries(REFERENCE_EXTENSIONS.map((extension) => [extension, parseSection(endpointConf, extension)]));
  if (!referenceSections[PRIMARY_REFERENCE_EXTENSION]) {
    throw new Error(`Reference endpoint section [${PRIMARY_REFERENCE_EXTENSION}] was not found in pjsip.endpoint.conf.`);
  }

  const schema = await getExtensionInputSchema();
  const graphqlFields = graphqlSupport(schema);
  const { extension, existingExtensionSkipped } = await chooseExtension(requestedExtension);
  const reportPath = getReportPath(extension, confirm);
  const targetEmail = email.replace(requestedExtension, extension);
  const payloads = buildFreepbxWebrtcExtensionPayloads(extension, targetEmail, schema);
  const expectedSection = buildExpectedEndpointSection(extension, referenceSections[PRIMARY_REFERENCE_EXTENSION].fields);

  const webClient = new FreepbxWebSessionClient();
  const referenceFormExtension = PRIMARY_REFERENCE_EXTENSION;
  const referenceForm = await webClient.getExtensionForm(referenceFormExtension);
  const formMapping = inspectWebrtcFormFields(referenceForm.fieldNames).map((item) => ({
    ...item,
    fieldName: item.fieldName ? redactFieldName(item.fieldName) : null,
  }));
  const missingFormFields = formMapping.filter((item) => !item.fieldName).map((item) => item.target);
  const runtimeWarnings = [];

  const baseData = {
    confirm,
    requestedExtension,
    extension,
    existingExtensionSkipped,
    referenceSections,
    expectedSection,
    graphqlSupport: graphqlFields,
    webConfig: getFreepbxWebConfigForOutput(),
    referenceFormExtension,
    formMeta: {
      pageUrl: referenceForm.pageUrl,
      formAction: referenceForm.formAction,
      method: referenceForm.method,
      hasCsrfToken: referenceForm.hasCsrfToken,
    },
    formMapping,
    reloadExecuted: false,
    createdInFreepbx: false,
    pjsipPasswordConfigured: false,
    formSubmitted: false,
    backup: null,
    reloadOutput: "",
    generatedSection: null,
    endpointComparison: [],
    runtime: null,
    failedFields: [],
    missingFormFields: [],
    ineffectiveFields: [],
    warningFields: [],
  };

  if (!confirm) {
    await writeReport(reportPath, baseData);
    printJson({
      success: true,
      dryRun: true,
      extension,
      existingExtensionSkipped,
      actions: [
        `readReferenceEndpointSections(${FALLBACK_REFERENCE_EXTENSION},${PRIMARY_REFERENCE_EXTENSION})`,
        "inspectGraphqlInputSchema",
        `inspectFreepbxWebForm(${PRIMARY_REFERENCE_EXTENSION})`,
        "buildExpectedEndpointSection",
        "dryRunOnly(no create/no form submit/no reload)",
      ],
      graphqlSupported: graphqlFields.filter((field) => field.addExtensionInput || field.updateExtensionInput),
      graphqlUnsupportedTargets: graphqlFields.filter((field) => !field.addExtensionInput && !field.updateExtensionInput),
      webFormMapping: formMapping,
      expectedEndpointSection: expectedSection.text,
      addPayload: payloads.addPayload,
      updatePayload: payloads.updatePayloadForOutput,
      webrtcConfig: getFreepbxWebrtcPublicConfig(),
      missingFormFields,
      ineffectiveFields: [],
      warningFields: runtimeWarnings,
      reportPath,
    });
    return;
  }

  const backup = await backupPjsipConfigs();
  baseData.backup = backup;

  const existing = await fetchExtension(extension);
  if (existing) {
    throw new Error(`Extension ${extension} already exists before create.`);
  }

  const createResult = await addExtension(payloads.addPayload);
  baseData.createdInFreepbx = Boolean(createResult?.status);
  if (!createResult?.status) {
    throw new Error(createResult?.message || "FreePBX addExtension failed.");
  }

  const passwordUpdate = await updateExtension(extension, payloads.updatePayload);
  baseData.pjsipPasswordConfigured = Boolean(passwordUpdate?.status);
  if (!passwordUpdate?.status) {
    throw new Error(passwordUpdate?.message || "FreePBX updateExtension failed.");
  }

  const form = await webClient.getExtensionForm(extension);
  const update = buildWebrtcFormUpdate(form, extension);
  const submitResult = await webClient.submitExtensionForm(form, update.fields);
  if (submitResult.loginShown) {
    throw new Error("FreePBX returned login form after submit.");
  }
  baseData.formSubmitted = true;
  baseData.missingFormFields = update.missing.map((item) => item.target);

  const channels = await coreShowChannels();
  if (/active call|active channels/i.test(channels) && !ignoreActiveCalls) {
    throw new Error("Active channels detected. Re-run with --ignore-active-calls yes or --ignore-active-channels yes to reload anyway.");
  }

  baseData.reloadOutput = await sudoFwconsoleReload();
  baseData.reloadExecuted = true;

  const updatedEndpointConf = await readFile(ENDPOINT_CONF, "utf8");
  const generatedSection = parseSection(updatedEndpointConf, extension);
  baseData.generatedSection = generatedSection;
  baseData.endpointComparison = compareFields(generatedSection?.fields || {}, expectedSection.fields);
  baseData.failedFields = baseData.endpointComparison.filter((item) => !item.passed).map((item) => item.field);

  const runtime = await verifyPjsipExtension(extension, getFreepbxWebrtcPublicConfig());
  baseData.runtime = runtime;
  baseData.warningFields = runtime?.unsupportedOrUnverified?.map((item) => item.field) || [];
  baseData.ineffectiveFields = baseData.endpointComparison.filter((item) => !item.passed).map((item) => item.field);
  for (const field of runtime.failedChecks || []) {
    if (!baseData.failedFields.includes(`runtime:${field}`)) baseData.failedFields.push(`runtime:${field}`);
  }

  await writeReport(reportPath, baseData);
  printJson({
    success: true,
    extension,
    createdInFreepbx: baseData.createdInFreepbx,
    pjsipPasswordConfigured: baseData.pjsipPasswordConfigured,
    formSubmitted: baseData.formSubmitted,
    reloadExecuted: baseData.reloadExecuted,
    asteriskRestartExecuted: false,
    generatedEndpointMatchesExpected: baseData.endpointComparison.every((item) => item.passed),
    runtimeVerified: Boolean(runtime.verified || runtime.webrtcVerified),
    failedFields: baseData.failedFields,
    missingFormFields: baseData.missingFormFields || [],
    ineffectiveFields: baseData.ineffectiveFields || [],
    warningFields: baseData.warningFields || [],
    reportPath,
  });
}

main().catch(async (error) => {
  const extension = String(parseArgs(process.argv).extension || DEFAULT_EXTENSION);
  const reportPath = `${REPORT_PREFIX}-${extension}-error-report.md`;
  await writeFile(reportPath, `# FreePBX Generated Endpoint Config Test Error\n\n- Time: ${new Date().toISOString()}\n- Error code: ${error?.code || "ERROR"}\n- Message: ${error?.message || "Unknown error"}\n- Directly modified Asterisk .conf files: false\n- Asterisk restart executed: false\n`, "utf8");
  printJson({
    success: false,
    error: {
      code: error?.code || "FREEPBX_GENERATED_ENDPOINT_TEST_FAILED",
      message: error?.message || "FreePBX generated endpoint test failed.",
    },
    reportPath,
  });
  process.exitCode = 1;
});
