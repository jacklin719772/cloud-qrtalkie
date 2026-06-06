import * as mariadb from "mariadb";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3306;
const DEFAULT_DATABASE = "flexisip";

export class FlexisipTombstoneError extends Error {
  constructor(message, { code = "FLEXISIP_TOMBSTONE_ERROR", status = 500, cause = null } = {}) {
    super(message);
    this.name = "FlexisipTombstoneError";
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

function getConfig() {
  const password = String(process.env.FLEXISIP_DB_PASSWORD || "");
  if (!password) {
    throw new FlexisipTombstoneError("Flexisip database password is not configured.", {
      code: "FLEXISIP_DB_NOT_CONFIGURED",
      status: 500,
    });
  }

  return {
    host: process.env.FLEXISIP_DB_HOST || DEFAULT_HOST,
    port: Number(process.env.FLEXISIP_DB_PORT || DEFAULT_PORT),
    database: process.env.FLEXISIP_DB_DATABASE || DEFAULT_DATABASE,
    user: process.env.FLEXISIP_DB_USERNAME || "flexisip",
    password,
  };
}

async function createConnection() {
  const config = getConfig();
  return mariadb.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  });
}

export async function releaseAccountTombstone({ username, domain }) {
  let connection;
  try {
    connection = await createConnection();
    await connection.beginTransaction();

    const activeRows = await connection.query(
      `SELECT id, username, domain
       FROM accounts
       WHERE username = ? AND domain = ?
       LIMIT 1
       FOR UPDATE`,
      [username, domain],
    );

    if (activeRows.length > 0) {
      await connection.rollback();
      throw new FlexisipTombstoneError("An active Flexisip account already exists for this username and domain.", {
        code: "FLEXISIP_ACTIVE_ACCOUNT_EXISTS",
        status: 409,
      });
    }

    const tombstoneRows = await connection.query(
      `SELECT id, username, domain, created_at, updated_at
       FROM accounts_tombstones
       WHERE username = ? AND domain = ?
       LIMIT 1
       FOR UPDATE`,
      [username, domain],
    );

    const tombstone = tombstoneRows[0];
    if (!tombstone) {
      await connection.rollback();
      return {
        released: false,
        username,
        domain,
        message: "Tombstone not found.",
      };
    }

    await connection.query(
      `DELETE FROM accounts_tombstones
       WHERE id = ?`,
      [Number(tombstone.id)],
    );

    await connection.commit();
    return {
      released: true,
      id: Number(tombstone.id),
      username,
      domain,
      createdAt: tombstone.created_at || null,
      updatedAt: tombstone.updated_at || null,
    };
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (error instanceof FlexisipTombstoneError) throw error;
    throw new FlexisipTombstoneError("Failed to release Flexisip account tombstone.", {
      cause: error,
    });
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}
