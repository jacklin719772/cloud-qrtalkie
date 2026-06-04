import dotenv from "dotenv";
import {
  addContactToAccount,
  addContactToContactList,
  assignContactListToAccount,
  createContactList,
  deleteContactList,
  FlexisipContactBookError,
  getContactList,
  listAccountContacts,
  listContactLists,
  removeContactFromAccount,
  removeContactFromContactList,
  unassignContactListFromAccount,
  updateContactList,
} from "../server/flexisipContactBookClient.js";

dotenv.config({ path: "/opt/saas/.env.flexisip.test", override: true, quiet: true });

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
  if (typeof value === "string" && /(password|passwd|api[-_ ]?key|secret|token)\s*=/i.test(value)) return "[redacted]";
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
  if (error instanceof FlexisipContactBookError) {
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

function contactListPayload() {
  return {
    title: args.title || "",
    description: args.description || "",
  };
}

async function run() {
  if (!command || command === "help" || command === "--help") {
    printJson({
      ok: true,
      commands: [
        "list",
        "get --id 123",
        "create --title Friends --description Personal --confirm yes",
        "update --id 123 --title Friends --description Personal --confirm yes",
        "delete --id 123 --confirm yes",
        "account-contacts --account-id 123",
        "add-account-contact --account-id 123 --contact-id 456 --confirm yes",
        "remove-account-contact --account-id 123 --contact-id 456 --confirm yes",
        "add-account-to-list --contact-list-id 123 --account-id 456 --confirm yes",
        "add-list-contact --contact-list-id 123 --contact-id 456 --confirm yes",
        "remove-list-contact --contact-list-id 123 --contact-id 456 --confirm yes",
        "assign-list --account-id 123 --contact-list-id 456 --confirm yes",
        "unassign-list --account-id 123 --contact-list-id 456 --confirm yes",
      ],
    });
    return;
  }

  try {
    if (command === "list") {
      printJson({ ok: true, command, result: await listContactLists() });
      return;
    }

    if (command === "get") {
      const id = requireArg("id");
      if (!id) return;
      printJson({ ok: true, command, id, result: await getContactList(id) });
      return;
    }

    if (command === "account-contacts") {
      const accountId = requireArg("account-id");
      if (!accountId) return;
      printJson({ ok: true, command, accountId, result: await listAccountContacts(accountId) });
      return;
    }

    if (command === "create") {
      const payload = contactListPayload();
      if (!payload.title || !payload.description) {
        printJson({ ok: false, error: "Missing required arguments: --title and --description" }, 1);
        return;
      }
      if (!isConfirmed()) {
        dryRun(command, payload);
        return;
      }
      printJson({ ok: true, command, result: await createContactList(payload) });
      return;
    }

    if (command === "update") {
      const id = requireArg("id");
      if (!id) return;
      const payload = contactListPayload();
      if (!payload.title || !payload.description) {
        printJson({ ok: false, error: "Missing required arguments: --title and --description" }, 1);
        return;
      }
      if (!isConfirmed()) {
        dryRun(command, { id, payload });
        return;
      }
      printJson({ ok: true, command, id, result: await updateContactList(id, payload) });
      return;
    }

    if (command === "delete") {
      const id = requireArg("id");
      if (!id) return;
      if (!isConfirmed()) {
        dryRun(command, { id });
        return;
      }
      printJson({ ok: true, command, id, result: await deleteContactList(id) });
      return;
    }

    if (command === "add-account-contact") {
      const accountId = requireArg("account-id");
      const contactId = requireArg("contact-id");
      if (!accountId || !contactId) return;
      if (!isConfirmed()) {
        dryRun(command, { accountId, contactId });
        return;
      }
      printJson({ ok: true, command, accountId, contactId, result: await addContactToAccount(accountId, contactId) });
      return;
    }

    if (command === "remove-account-contact") {
      const accountId = requireArg("account-id");
      const contactId = requireArg("contact-id");
      if (!accountId || !contactId) return;
      if (!isConfirmed()) {
        dryRun(command, { accountId, contactId });
        return;
      }
      printJson({ ok: true, command, accountId, contactId, result: await removeContactFromAccount(accountId, contactId) });
      return;
    }

    if (command === "add-account-to-list") {
      const contactListId = requireArg("contact-list-id");
      const accountId = requireArg("account-id");
      if (!contactListId || !accountId) return;
      if (!isConfirmed()) {
        dryRun(command, { contactListId, accountId });
        return;
      }
      printJson({ ok: true, command, contactListId, accountId, result: await addContactToContactList(contactListId, accountId) });
      return;
    }

    if (command === "add-list-contact") {
      const contactListId = requireArg("contact-list-id");
      const contactId = requireArg("contact-id");
      if (!contactListId || !contactId) return;
      if (!isConfirmed()) {
        dryRun(command, { contactListId, contactId });
        return;
      }
      printJson({ ok: true, command, contactListId, contactId, result: await addContactToContactList(contactListId, contactId) });
      return;
    }

    if (command === "remove-list-contact") {
      const contactListId = requireArg("contact-list-id");
      const contactId = requireArg("contact-id");
      if (!contactListId || !contactId) return;
      if (!isConfirmed()) {
        dryRun(command, { contactListId, contactId });
        return;
      }
      printJson({ ok: true, command, contactListId, contactId, result: await removeContactFromContactList(contactListId, contactId) });
      return;
    }

    if (command === "assign-list") {
      const accountId = requireArg("account-id");
      const contactListId = requireArg("contact-list-id");
      if (!accountId || !contactListId) return;
      if (!isConfirmed()) {
        dryRun(command, { accountId, contactListId });
        return;
      }
      printJson({ ok: true, command, accountId, contactListId, result: await assignContactListToAccount(accountId, contactListId) });
      return;
    }

    if (command === "unassign-list") {
      const accountId = requireArg("account-id");
      const contactListId = requireArg("contact-list-id");
      if (!accountId || !contactListId) return;
      if (!isConfirmed()) {
        dryRun(command, { accountId, contactListId });
        return;
      }
      printJson({ ok: true, command, accountId, contactListId, result: await unassignContactListFromAccount(accountId, contactListId) });
      return;
    }

    printJson({ ok: false, error: `Unknown command: ${command}` }, 1);
  } catch (error) {
    printJson({ ok: false, command, error: serializeError(error) }, 1);
  }
}

await run();
