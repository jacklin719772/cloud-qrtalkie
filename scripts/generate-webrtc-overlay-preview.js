import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { getWebrtcRuntimeConfig } from "../server/webrtcTemplateLoader.js";

const execFileAsync = promisify(execFile);
const EXTENSION_PATTERN = /^\d+$/;
const runtimeConfig = getWebrtcRuntimeConfig();
const STANDARD_EXTENSION = runtimeConfig.referenceExtension;
const DEFAULT_MEDIA_ADDRESS = runtimeConfig.mediaAddress;

const OUTPUT_FIELDS = [
  "transport",
  "allow_unauthenticated_options",
  "refer_blind_progress",
  "webrtc",
  "use_avpf",
  "ice_support",
  "rtcp_mux",
  "bundle",
  "dtls_auto_generate_cert",
  "dtls_setup",
  "dtls_verify",
  "media_encryption",
  "media_encryption_optimistic",
  "media_use_received_transport",
  "direct_media",
  "timers",
  "media_address",
  "rtp_timeout",
  "rtp_timeout_hold",
  "disallow",
  "allow",
  "aggregate_mwi",
  "asymmetric_rtp_codec",
  "mwi_subscribe_replaces_unsolicited",
  "mailboxes",
  "send_pai",
];

const EXCLUDED_FIELDS = [
  "auth",
  "aors",
  "callerid",
  "accountcode",
  "set_var",
  "contact_user",
  "from_user",
  "outbound_proxy",
];

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

function assertExtension(extension) {
  if (!EXTENSION_PATTERN.test(String(extension || ""))) {
    const error = new Error("INVALID_WEBRTC_EXTENSION");
    error.code = "INVALID_WEBRTC_EXTENSION";
    throw error;
  }
}

async function showEndpoint(extension) {
  assertExtension(extension);
  try {
    const { stdout, stderr } = await execFileAsync("asterisk", ["-rx", `pjsip show endpoint ${extension}`], {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    return `${stdout || ""}${stderr ? `\n${stderr}` : ""}`;
  } catch (error) {
    const output = `${error?.stdout || ""}${error?.stderr ? `\n${error.stderr}` : ""}`;
    return output || "";
  }
}

function endpointExists(output, extension) {
  const text = String(output || "");
  const lower = text.toLowerCase();
  if (!text.trim()) return false;
  if (lower.includes("not found") || lower.includes("unable to find")) return false;
  return text.includes(`Endpoint:  ${extension}/`);
}

function extractEndpointValues(output) {
  const values = {};
  const regex = /^\s*([a-zA-Z0-9_]+)\s*:\s*(.*?)\s*$/gm;
  for (const match of String(output || "").matchAll(regex)) {
    const key = match[1].trim();
    const value = match[2].trim();
    values[key] = value;
  }
  return values;
}

function normalizeBool(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["true", "yes", "1", "enabled"].includes(normalized)) return "yes";
  if (["false", "no", "0", "disabled"].includes(normalized)) return "no";
  return normalized;
}

function normalizeDtlsAutoGenerate(value) {
  return normalizeBool(value) === "yes" ? "yes" : "no";
}

function normalizeCodecAllow(value) {
  const codecs = String(value || "")
    .replace(/[()]/g, "")
    .split(/[|,&\s]+/)
    .map((codec) => codec.trim())
    .filter(Boolean);
  return codecs.length ? codecs.join(",") : "";
}

function overlayValuesFromStandard(values) {
  return {
    transport: values.transport || runtimeConfig.transport || "",
    allow_unauthenticated_options: normalizeBool(values.allow_unauthenticated_options || "yes"),
    refer_blind_progress: normalizeBool(values.refer_blind_progress || "yes"),
    webrtc: normalizeBool(values.webrtc || "yes"),
    use_avpf: normalizeBool(values.use_avpf || "yes"),
    ice_support: normalizeBool(values.ice_support || "yes"),
    rtcp_mux: normalizeBool(values.rtcp_mux || "yes"),
    bundle: normalizeBool(values.bundle || "yes"),
    dtls_auto_generate_cert: normalizeDtlsAutoGenerate(values.dtls_auto_generate_cert || "yes"),
    dtls_setup: values.dtls_setup || "actpass",
    dtls_verify: normalizeBool(values.dtls_verify || "yes"),
    media_encryption: values.media_encryption || "dtls",
    media_encryption_optimistic: normalizeBool(values.media_encryption_optimistic || "yes"),
    media_use_received_transport: normalizeBool(values.media_use_received_transport || "yes"),
    direct_media: normalizeBool(values.direct_media || "no"),
    timers: normalizeBool(values.timers || "no"),
    media_address: values.media_address || DEFAULT_MEDIA_ADDRESS,
    rtp_timeout: values.rtp_timeout || "0",
    rtp_timeout_hold: values.rtp_timeout_hold || "0",
    disallow: runtimeConfig.disallowCodecs || "all",
    allow: normalizeCodecAllow(values.allow || runtimeConfig.allowedCodecsString || ""),
    aggregate_mwi: normalizeBool(values.aggregate_mwi || "yes"),
    asymmetric_rtp_codec: normalizeBool(values.asymmetric_rtp_codec || "yes"),
    mwi_subscribe_replaces_unsolicited: normalizeBool(values.mwi_subscribe_replaces_unsolicited || "no"),
    mailboxes: "",
    send_pai: normalizeBool(values.send_pai || "yes"),
  };
}

function renderOverlay(extension, values) {
  const lines = [`; BEGIN SaaS WebRTC endpoint overlay ${extension}`, `[${extension}](+)`];
  for (const field of OUTPUT_FIELDS) {
    lines.push(`${field}=${values[field] ?? ""}`);
  }
  lines.push(`; END SaaS WebRTC endpoint overlay ${extension}`, "");
  return lines.join("\n");
}

function summarize(values) {
  return Object.fromEntries(OUTPUT_FIELDS.map((field) => [field, values[field] ?? ""]));
}

function diffSummary(standard, target) {
  const diffs = [];
  for (const field of OUTPUT_FIELDS) {
    const targetValue = field === "allow" ? normalizeCodecAllow(target[field]) : String(target[field] || "");
    const standardValue = String(standard[field] || "");
    if (targetValue !== standardValue) {
      diffs.push({ field, standard: standardValue, target: targetValue });
    }
  }
  return diffs;
}

function renderReport({
  extension,
  standardOutput,
  targetOutput,
  standardExists,
  targetExists,
  standardValues,
  targetValues,
  overlayValues,
  overlay,
}) {
  const standardSummary = summarize(overlayValues);
  const targetOverlayComparable = targetExists ? overlayValuesFromStandard(targetValues) : null;
  const diffs = targetExists ? diffSummary(overlayValues, targetOverlayComparable) : [];
  const fieldRows = OUTPUT_FIELDS.map((field) => {
    const source = standardValues[field] ? `${runtimeConfig.referenceExtension} runtime` : "recommended fallback";
    const note = {
      transport: "WebRTC WSS transport",
      allow: "Codec allow list converted to comma format",
      media_address: `Media address from ${runtimeConfig.referenceExtension} runtime, fallback to default if missing`,
      send_pai: "Business optional; confirm necessity",
      allow_unauthenticated_options: "Security boundary should be confirmed",
      mailboxes: `Forces empty mailbox to match ${runtimeConfig.referenceExtension}; affects voicemail/MWI`,
      refer_blind_progress: "Kept because current custom post standard uses it",
    }[field] || "Public WebRTC/PJSIP runtime parameter";
    return `| ${field} | ${overlayValues[field] ?? ""} | ${source} | ${note} |`;
  }).join("\n");

  const standardParamLines = OUTPUT_FIELDS.map((field) => `- ${field}: ${standardSummary[field] ?? ""}`).join("\n");
  const targetStatus = targetExists
    ? [
        "endpointExists: true",
        "",
        "当前关键参数：",
        "",
        ...OUTPUT_FIELDS.map((field) => `- ${field}: ${targetOverlayComparable[field] ?? ""}`),
        "",
        `与 ${runtimeConfig.referenceExtension} 的差异摘要：`,
        "",
        ...(diffs.length ? diffs.map((diff) => `- ${diff.field}: target=${diff.target || "(empty)"} standard=${diff.standard || "(empty)"}`) : ["- 无关键差异"]),
      ].join("\n")
    : "目标分机当前不存在或未加载到 Asterisk runtime，本次只生成预览。";

  return `# WebRTC Overlay Preview Report

## 1. 生成时间

${new Date().toISOString()}

## 2. 标准分机

${STANDARD_EXTENSION}

## 3. 目标分机

${extension}

## 4. 使用的只读命令

\`\`\`bash
asterisk -rx "pjsip show endpoint ${STANDARD_EXTENSION}"
asterisk -rx "pjsip show endpoint ${extension}"
\`\`\`

标准分机读取结果：${standardExists ? "存在" : "不存在或无法读取"}

目标分机读取结果：${targetExists ? "存在" : "不存在或未加载"}

## 5. ${STANDARD_EXTENSION} 关键参数摘要

${standardParamLines}

## 6. 目标分机当前状态

${targetStatus}

## 7. 生成的 overlay block

\`\`\`ini
${overlay.trimEnd()}
\`\`\`

## 8. 字段来源说明

| 字段 | 值 | 来源 | 说明 |
|---|---|---|---|
${fieldRows}

## 9. 排除字段说明

以下身份类字段没有写入 overlay preview：

${EXCLUDED_FIELDS.map((field) => `- ${field}`).join("\n")}

原因：

- 这些字段与具体分机身份、注册对象、呼叫身份或外部路由有关。
- 不能从标准模板分机复制到其他分机。
- 复制这些字段可能造成注册、呼叫或身份显示错误。

## 10. 风险提示

1. 本文件只是预览，没有写入 \`/etc/asterisk\`。
2. 真正写入前必须再次确认已有备份。
3. 写入后需要选择合适 reload 方式。
4. 不建议重启 Asterisk。
5. \`allow_unauthenticated_options=yes\` 需要确认安全边界。
6. \`send_pai=yes\` 是否业务必要需要确认。
7. \`mailboxes=\` 会影响 voicemail/MWI 行为。
8. 仅适用于 WebRTC 分机，不应套用到普通 PJSIP 分机。

## 11. 下一步建议

如果人工确认 preview 无误，可进入下一阶段：

1. 受控写入 \`/etc/asterisk/pjsip_custom_post.conf\`。
2. 写入前再次确认备份。
3. 使用 marker block upsert。
4. 原子写入。
5. Apply Config 或 pjsip reload。
6. 只读验证 endpoint 参数。

## 附：输出安全说明

- 未读取 auth secret。
- 未读取 AOR contact 详情到报告。
- 未输出 SIP 密码、API Key、token、cookie 或 secret。
- 标准 endpoint 原始输出长度：${standardOutput.length}
- 目标 endpoint 原始输出长度：${targetOutput.length}
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const extension = String(args.extension || "").trim();
  assertExtension(extension);

  const [standardOutput, targetOutput] = await Promise.all([
    showEndpoint(STANDARD_EXTENSION),
    showEndpoint(extension),
  ]);
  const standardExists = endpointExists(standardOutput, STANDARD_EXTENSION);
  if (!standardExists) {
    throw new Error("STANDARD_WEBRTC_ENDPOINT_NOT_FOUND");
  }

  const targetExists = endpointExists(targetOutput, extension);
  const standardValues = extractEndpointValues(standardOutput);
  const targetValues = targetExists ? extractEndpointValues(targetOutput) : {};
  const overlayValues = overlayValuesFromStandard(standardValues);
  const overlay = renderOverlay(extension, overlayValues);

  const overlayPath = `/tmp/webrtc-overlay-preview-${extension}.conf`;
  const reportPath = `/tmp/webrtc-overlay-preview-${extension}-report.md`;
  const report = renderReport({
    extension,
    standardOutput,
    targetOutput,
    standardExists,
    targetExists,
    standardValues,
    targetValues,
    overlayValues,
    overlay,
  });

  await writeFile(overlayPath, overlay, { mode: 0o600 });
  await writeFile(reportPath, report, { mode: 0o600 });

  console.log("Preview generated:");
  console.log(`Overlay: ${overlayPath}`);
  console.log(`Report: ${reportPath}`);
  console.log(`Standard extension: ${STANDARD_EXTENSION}`);
  console.log(`Target extension: ${extension}`);
  console.log(`Overlay parameters: ${OUTPUT_FIELDS.length}`);
  console.log("No /etc/asterisk files modified.");
  console.log("No reload executed.");
  console.log("No Asterisk restart executed.");
  console.log("No secrets read or output.");
}

main().catch((error) => {
  console.error(error?.code || error?.message || String(error));
  process.exitCode = 1;
});
