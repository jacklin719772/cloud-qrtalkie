import dotenv from "dotenv";
import {
  activateAccount,
  changeEmail,
  createAccount,
  deactivateAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  requestEmailChange,
  searchAccountByEmail,
  searchAccountBySip,
  sendProvisioningEmail,
  sendResetPasswordEmail,
  updateAccount,
  FlexisipAccountManagerError,
} from "../server/flexisipAccountManagerClient.js";

const envPath = "/opt/saas/.env.flexisip.test";
dotenv.config({ path: envPath, override: true, quiet: true });

const command = process.argv[2] || "";
const args = parseArgs(process.argv.slice(3));

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;

    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function redactSensitive(value) {
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (typeof value === "string" && /(password|passwd|api[-_ ]?key|secret|token)\s*=/i.test(value)) {
    return "[redacted]";
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("password") ||
        lowerKey.includes("api_key") ||
        lowerKey.includes("token") ||
        lowerKey.includes("secret") ||
        lowerKey === "custom_provisioning_entries"
      ) {
        return [key, item == null ? item : "[redacted]"];
      }
      return [key, redactSensitive(item)];
    }),
  );
}

function printJson(payload, exitCode = 0) {
  console.log(JSON.stringify(redactSensitive(payload), null, 2));
  process.exitCode = exitCode;
}

function printJsonUnsafe(payload, exitCode = 0) {
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = exitCode;
}

function requireArg(name) {
  const value = args[name];
  if (value === undefined || value === "") {
    printJson({ ok: false, error: `Missing required argument: --${name}` }, 1);
    return "";
  }
  return value;
}

function isConfirmed() {
  return args.confirm === "yes";
}

function maskToken(token) {
  const value = String(token || "");
  if (!value) return null;
  if (value.length <= 10) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 6)}***${value.slice(-4)}`;
}

function getFlexisipConfig() {
  return {
    baseUrl: String(process.env.FLEXISIP_ACCOUNT_MANAGER_BASE_URL || "http://account.qrtalkie.org/api").replace(/\/+$/, ""),
    apiKey: String(process.env.FLEXISIP_ACCOUNT_MANAGER_API_KEY || ""),
    timeoutMs: Number(process.env.FLEXISIP_ACCOUNT_MANAGER_TIMEOUT_MS || 10000),
  };
}

async function provisionAccount(id) {
  const config = getFlexisipConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : 10000);

  try {
    const response = await fetch(`${config.baseUrl}/accounts/${encodeURIComponent(id)}/provision`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": config.apiKey,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new FlexisipAccountManagerError(result?.message || `Flexisip Account Manager request failed with status ${response.status}.`, {
        status: response.status,
        method: "GET",
        path: `/accounts/${id}/provision`,
        responseBody: result,
      });
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function findProvisioningUrl(result) {
  return (
    result?.provisioning_url ||
    result?.provisioningUrl ||
    result?.provision_url ||
    result?.provisionUrl ||
    result?.url ||
    null
  );
}

function buildProvisioningUrl(account) {
  const token = account?.provisioning_token || "";
  if (!token) return null;

  const config = getFlexisipConfig();
  const base = new URL(config.baseUrl);
  const protocol = base.protocol || "http:";
  const host = account?.space?.host || base.host;

  return `${protocol}//${host}/provisioning/${encodeURIComponent(token)}`;
}

function dryRun(action, payload = {}) {
  printJson({
    ok: true,
    dryRun: true,
    action,
    message: "No request was sent. Add --confirm yes to execute this state-changing command.",
    payload,
  });
}

function serializeError(error) {
  if (error instanceof FlexisipAccountManagerError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      method: error.method,
      path: error.path,
      responseBody: error.responseBody,
    };
  }

  return {
    name: error?.name || "Error",
    message: error?.message || "Unknown error",
  };
}

async function run() {
  if (!command || command === "help" || command === "--help") {
    printJson({
      ok: true,
      commands: [
        "list",
        "get --id 123",
        "provisioning-url --id 123",
        "provision --id 123 --confirm yes",
        "search-sip --sip sip:xxxx@domain",
        "search-email --email xxx@example.com",
        "create --username test100001 --password Test123456 --domain qrtalkie.org --email test@example.com --phone +8613912340001 --display-name \"Test User\" --confirm yes",
        "activate --id 123 --confirm yes",
        "deactivate --id 123 --confirm yes",
        "delete --id 123 --confirm yes",
        "send-provisioning-email --id 123 --confirm yes",
        "send-reset-password-email --id 123 --confirm yes",
        "request-email-change --user-api-key USER_KEY --new-email new@example.com --confirm yes",
        "change-email --user-api-key USER_KEY --new-email new@example.com --code 1234 --confirm yes",
      ],
    });
    return;
  }

  try {
    if (command === "list") {
      printJson({ ok: true, command, result: await listAccounts() });
      return;
    }

    if (command === "get") {
      const id = requireArg("id");
      if (!id) return;
      printJson({ ok: true, command, id, result: await getAccount(id) });
      return;
    }

    if (command === "provisioning-url") {
      const id = requireArg("id");
      if (!id) return;
      const account = await getAccount(id);
      const token = account?.provisioning_token || "";
      const provisioningUrl = buildProvisioningUrl(account);

      printJsonUnsafe({
        ok: true,
        command,
        account: {
          id: account?.id ?? id,
          username: account?.username || null,
          domain: account?.domain || null,
          provisioning_token: maskToken(token),
          provisioning_token_expire_at: account?.provisioning_token_expire_at || null,
          provisioning_url: provisioningUrl,
          url_format_confirmed: !!provisioningUrl,
        },
      });
      return;
    }

    if (command === "provision") {
      const id = requireArg("id");
      if (!id) return;
      if (!isConfirmed()) {
        dryRun(command, {
          id,
          method: "GET",
          path: `/accounts/${id}/provision`,
          message: "This command generates a fresh provisioning_token. Add --confirm yes to execute.",
        });
        return;
      }

      const result = await provisionAccount(id);
      const token = result?.provisioning_token || "";
      const provisioningUrl = findProvisioningUrl(result);
      printJsonUnsafe({
        ok: true,
        command,
        account: {
          id: result?.id ?? id,
          username: result?.username || null,
          domain: result?.domain || null,
          provisioning_token: maskToken(token),
          provisioning_token_expire_at: result?.provisioning_token_expire_at || null,
          provisioning_url: provisioningUrl,
          note: provisioningUrl ? "Provisioning URL returned by API." : "API returned a provisioning token but no provisioning URL.",
        },
      });
      return;
    }

    if (command === "search-sip") {
      const sip = requireArg("sip");
      if (!sip) return;
      printJson({ ok: true, command, sip, result: await searchAccountBySip(sip) });
      return;
    }

    if (command === "search-email") {
      const email = requireArg("email");
      if (!email) return;
      printJson({ ok: true, command, email, result: await searchAccountByEmail(email) });
      return;
    }

    if (command === "create") {
      const username = requireArg("username");
      const password = requireArg("password");
      const domain = requireArg("domain");
      if (!username || !password || !domain) return;

      const payload = {
        username,
        password,
        domain,
        algorithm: args.algorithm || "SHA-256",
        activated: args.activated === "true",
      };
      if (args.email !== undefined) payload.email = args.email;
      if (args.phone !== undefined) payload.phone = args.phone;
      if (args["display-name"] !== undefined) payload.display_name = args["display-name"];

      if (!isConfirmed()) {
        dryRun(command, { ...payload, password: "[redacted]" });
        return;
      }

      printJson({ ok: true, command, result: await createAccount(payload) });
      return;
    }

    if (command === "activate") {
      const id = requireArg("id");
      if (!id) return;
      if (!isConfirmed()) {
        dryRun(command, { id });
        return;
      }
      printJson({ ok: true, command, id, result: await activateAccount(id) });
      return;
    }

    if (command === "deactivate") {
      const id = requireArg("id");
      if (!id) return;
      if (!isConfirmed()) {
        dryRun(command, { id });
        return;
      }
      printJson({ ok: true, command, id, result: await deactivateAccount(id) });
      return;
    }

    if (command === "delete") {
      const id = requireArg("id");
      if (!id) return;
      if (!isConfirmed()) {
        dryRun(command, { id });
        return;
      }
      printJson({ ok: true, command, id, result: await deleteAccount(id) });
      return;
    }

    if (command === "send-provisioning-email") {
      const id = requireArg("id");
      if (!id) return;
      if (!isConfirmed()) {
        dryRun(command, {
          id,
          method: "POST",
          path: `/accounts/${id}/send_provisioning_email`,
          sendsEmail: true,
        });
        return;
      }
      printJson({ ok: true, command, id, result: await sendProvisioningEmail(id) });
      return;
    }

    if (command === "send-reset-password-email") {
      const id = requireArg("id");
      if (!id) return;
      if (!isConfirmed()) {
        dryRun(command, {
          id,
          method: "POST",
          path: `/accounts/${id}/send_reset_password_email`,
          sendsEmail: true,
        });
        return;
      }
      printJson({ ok: true, command, id, result: await sendResetPasswordEmail(id) });
      return;
    }

    if (command === "request-email-change") {
      const userApiKey = requireArg("user-api-key");
      const newEmail = requireArg("new-email");
      if (!userApiKey || !newEmail) return;
      if (!isConfirmed()) {
        dryRun(command, {
          userApiKey: "[redacted]",
          newEmail,
          method: "POST",
          path: "/accounts/me/email/request",
          payload: { email: newEmail },
          sendsEmail: true,
        });
        return;
      }
      printJson({ ok: true, command, newEmail, result: await requestEmailChange(userApiKey, newEmail) });
      return;
    }

    if (command === "change-email") {
      const userApiKey = requireArg("user-api-key");
      const newEmail = requireArg("new-email");
      const code = requireArg("code");
      if (!userApiKey || !newEmail || !code) return;
      if (!isConfirmed()) {
        dryRun(command, {
          userApiKey: "[redacted]",
          newEmail,
          code,
          method: "POST",
          path: "/accounts/me/email",
          payload: { email: newEmail, code },
          sendsEmail: false,
        });
        return;
      }
      printJson({ ok: true, command, newEmail, result: await changeEmail(userApiKey, newEmail, code) });
      return;
    }

    if (command === "update") {
      const id = requireArg("id");
      if (!id) return;
      const payload = args.payload ? JSON.parse(args.payload) : {};
      if (args.username !== undefined) payload.username = args.username;
      if (args.password !== undefined) payload.password = args.password;
      if (args.algorithm !== undefined) payload.algorithm = args.algorithm;
      if (args.domain !== undefined) payload.domain = args.domain;
      if (args.email !== undefined) payload.email = args.email;
      if (args.phone !== undefined) payload.phone = args.phone;
      if (args["display-name"] !== undefined) payload.display_name = args["display-name"];
      if (args.activated !== undefined) payload.activated = args.activated === "true";
      if (args.admin !== undefined) payload.admin = args.admin === "true";
      if (args["dtmf-protocol"] !== undefined) payload.dtmf_protocol = args["dtmf-protocol"];
      if (!isConfirmed()) {
        dryRun(command, { id, payload });
        return;
      }
      printJson({ ok: true, command, id, result: await updateAccount(id, payload) });
      return;
    }

    printJson({ ok: false, error: `Unknown command: ${command}` }, 1);
  } catch (error) {
    printJson({ ok: false, command, error: serializeError(error) }, 1);
  }
}

await run();
