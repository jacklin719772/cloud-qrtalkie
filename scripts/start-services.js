import "dotenv/config";
import net from "node:net";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import * as mariadb from "mariadb";

const rootDir = process.cwd();
const apiPort = Number(process.env.API_PORT || 3001);
const appUrl = new URL(process.env.APP_URL || "http://127.0.0.1:5173");
const appPort = Number(appUrl.port || (appUrl.protocol === "https:" ? 443 : 80));
const appHost = appUrl.hostname || "127.0.0.1";
const dbHost = process.env.DB_HOST || "127.0.0.1";
const dbPort = Number(process.env.DB_PORT || 3306);
const nodeCommand = process.execPath;
const isRestart = process.argv.includes("--restart");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message) {
  console.log(`[start-services] ${message}`);
}

async function waitUntil(check, { label, timeoutMs = 30000, intervalMs = 1000 }) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await check()) return true;
    } catch (error) {
      lastError = error;
    }

    await wait(intervalMs);
  }

  if (lastError) {
    log(`${label} check timed out: ${lastError.message}`);
  }

  return false;
}

function canConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function killProcessOnPort(port, label) {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano | findstr :${port}`).toString();
      const pids = new Set();
      for (const line of output.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[1].endsWith(`:${port}`)) {
          const pid = parts[parts.length - 1];
          if (pid !== "0") pids.add(pid);
        }
      }
      for (const pid of pids) {
        log(`Killing ${label} process (PID ${pid}) on port ${port}...`);
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      }
    } else {
      try {
        const output = execSync(`lsof -t -i:${port}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
        if (output) {
          for (const pid of output.split("\n").filter(Boolean)) {
            log(`Killing ${label} process (PID ${pid}) on port ${port}...`);
            execSync(`kill -9 ${pid}`, { stdio: "ignore" });
          }
        }
      } catch {
        // Ignore if lsof finds no processes or is not installed
      }
    }
  } catch (err) {
    // Ignore other errors
  }
}

async function checkDatabase() {
  const pool = mariadb.createPool({
    host: dbHost,
    port: dbPort,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "true",
    connectionLimit: 1,
  });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query("SELECT VERSION() AS version");
    return rows[0]?.version || "unknown";
  } finally {
    if (connection) connection.release();
    await pool.end();
  }
}

function runDetached(command, args, { stdoutFile, stderrFile }) {
  const stdoutPath = path.join(rootDir, stdoutFile);
  const stderrPath = path.join(rootDir, stderrFile);
  const quotedArgs = args.map((arg) => `"${String(arg).replaceAll('"', '\\"')}"`).join(" ");
  const shellCommand = `"${command}" ${quotedArgs} >> "${stdoutPath}" 2>> "${stderrPath}"`;
  const child = spawn(shellCommand, {
    cwd: rootDir,
    detached: true,
    shell: true,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
  return child.pid;
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      shell: true,
      stdio: "ignore",
      windowsHide: true,
    });

    child.once("exit", (code) => resolve(code === 0));
    child.once("error", () => resolve(false));
  });
}

async function startDatabase() {
  if (process.env.DB_START_COMMAND) {
    log("Trying DB_START_COMMAND from .env...");
    await runCommand(process.env.DB_START_COMMAND, []);
  }

  if (await canConnect(dbHost, dbPort)) return;

  if (process.platform === "win32") {
    const serviceNames = [
      process.env.DB_SERVICE_NAME,
      "MariaDB",
      "mariadb",
      "MySQL",
      "mysql",
      "MySQL80",
    ].filter(Boolean);

    for (const serviceName of serviceNames) {
      log(`Trying Windows service: ${serviceName}...`);
      const command = `if (Get-Service -Name '${serviceName}' -ErrorAction SilentlyContinue) { Start-Service -Name '${serviceName}' -ErrorAction SilentlyContinue }`;
      await runCommand("powershell", ["-NoProfile", "-Command", command]);
      if (await canConnect(dbHost, dbPort)) return;
    }
  }
}

async function ensureDatabase() {
  if (isRestart) {
    log("Restarting database...");
    if (process.env.DB_RESTART_COMMAND) {
      log("Trying DB_RESTART_COMMAND from .env...");
      await runCommand(process.env.DB_RESTART_COMMAND, []);
    } else if (process.platform === "win32") {
      const serviceNames = [
        process.env.DB_SERVICE_NAME,
        "MariaDB",
        "mariadb",
        "MySQL",
        "mysql",
        "MySQL80",
      ].filter(Boolean);

      for (const serviceName of serviceNames) {
        log(`Trying Windows service restart: ${serviceName}...`);
        const command = `if (Get-Service -Name '${serviceName}' -ErrorAction SilentlyContinue) { Restart-Service -Name '${serviceName}' -Force -ErrorAction SilentlyContinue }`;
        await runCommand("powershell", ["-NoProfile", "-Command", command]);
      }
    }
    await wait(2000);
  }

  try {
    const version = await checkDatabase();
    log(`Database is ready: MariaDB ${version}`);
    return true;
  } catch {
    log(`Database is not reachable on ${dbHost}:${dbPort}; attempting to start it...`);
  }

  await startDatabase();

  const ready = await waitUntil(
    async () => {
      try {
        await checkDatabase();
        return true;
      } catch {
        return false;
      }
    },
    { label: "Database", timeoutMs: 45000 },
  );

  if (ready) {
    const version = await checkDatabase();
    log(`Database started: MariaDB ${version}`);
  } else {
    log("Database did not start automatically. Set DB_START_COMMAND or DB_SERVICE_NAME in .env if needed.");
  }

  return ready;
}

async function httpStatus(url) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    return response.status;
  } catch {
    return 0;
  }
}

async function ensureApi() {
  if (isRestart) {
    killProcessOnPort(apiPort, "API");
    await wait(1000);
  }

  const status = await httpStatus(`http://127.0.0.1:${apiPort}/api/health`);
  if (status === 200) {
    log(`API is ready on http://127.0.0.1:${apiPort} (status ${status})`);
    return true;
  }

  if (await canConnect("127.0.0.1", apiPort)) {
    log(`Port ${apiPort} is already in use, but API health check failed.`);
    return false;
  }

  const pid = runDetached(nodeCommand, ["server/index.js"], {
    stdoutFile: "api.out.log",
    stderrFile: "api.err.log",
  });
  log(`Starting API with PID ${pid}...`);

  const ready = await waitUntil(
    async () => (await httpStatus(`http://127.0.0.1:${apiPort}/api/health`)) === 200,
    { label: "API", timeoutMs: 30000 },
  );

  log(ready ? `API started on http://127.0.0.1:${apiPort}` : "API failed to start. Check api.err.log.");
  return ready;
}

async function ensureWeb() {
  if (isRestart) {
    killProcessOnPort(appPort, "Web app");
    await wait(1000);
  }

  const status = await httpStatus(appUrl.href);
  if (status > 0 && status < 500) {
    log(`Web app is ready on ${appUrl.href} (status ${status})`);
    return true;
  }

  if (await canConnect(appHost, appPort)) {
    log(`Port ${appPort} is already in use, but web health check failed.`);
    return false;
  }

  const pid = runDetached(nodeCommand, ["node_modules/vite/bin/vite.js", "--host", appHost], {
    stdoutFile: "vite.out.log",
    stderrFile: "vite.err.log",
  });
  log(`Starting web app with PID ${pid}...`);

  const ready = await waitUntil(
    async () => {
      const nextStatus = await httpStatus(appUrl.href);
      return nextStatus > 0 && nextStatus < 500;
    },
    { label: "Web app", timeoutMs: 30000 },
  );

  log(ready ? `Web app started on ${appUrl.href}` : "Web app failed to start. Check vite.err.log.");
  return ready;
}

const dbReady = await ensureDatabase();
const apiReady = dbReady ? await ensureApi() : false;
const webReady = await ensureWeb();

console.log("");
log(`Summary: database=${dbReady ? "ready" : "failed"}, api=${apiReady ? "ready" : "failed"}, web=${webReady ? "ready" : "failed"}`);

if (!dbReady || !apiReady || !webReady) {
  process.exitCode = 1;
}
