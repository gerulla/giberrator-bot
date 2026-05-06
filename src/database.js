import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';

const dbPath = process.env.GIBERRATOR_DB_PATH ?? 'data/giberrator.sqlite';
const dbDir = path.dirname(dbPath);

fs.mkdirSync(dbDir, { recursive: true });

const SQL = await initSqlJs();
export const db = fs.existsSync(dbPath)
  ? new SQL.Database(fs.readFileSync(dbPath))
  : new SQL.Database();

db.run(`
  CREATE TABLE IF NOT EXISTS tracked_users (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, user_id)
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    service_channel_id TEXT,
    service_channel_set_by TEXT,
    service_channel_set_at TEXT
  );
`);

persist();

function persist() {
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

export function addTrackedUser({ guildId, userId, createdBy }) {
  db.run(
    `
      INSERT OR IGNORE INTO tracked_users (guild_id, user_id, created_by)
      VALUES (?, ?, ?);
    `,
    [guildId, userId, createdBy],
  );

  const wasAdded = db.getRowsModified() > 0;
  persist();
  return wasAdded;
}

export function removeTrackedUser({ guildId, userId }) {
  db.run(
    `
      DELETE FROM tracked_users
      WHERE guild_id = ? AND user_id = ?;
    `,
    [guildId, userId],
  );

  const wasRemoved = db.getRowsModified() > 0;
  persist();
  return wasRemoved;
}

export function isTrackedUser({ guildId, userId }) {
  const result = db.exec(
    `
      SELECT 1
      FROM tracked_users
      WHERE guild_id = ? AND user_id = ?
      LIMIT 1;
    `,
    [guildId, userId],
  );

  return result.length > 0 && result[0].values.length > 0;
}

export function listTrackedUsers({ guildId }) {
  const result = db.exec(
    `
      SELECT user_id
      FROM tracked_users
      WHERE guild_id = ?
      ORDER BY created_at ASC;
    `,
    [guildId],
  );

  if (result.length === 0) {
    return [];
  }

  return result[0].values.map(([userId]) => userId);
}

export function setServiceChannel({ guildId, channelId, setBy }) {
  db.run(
    `
      INSERT INTO guild_settings (
        guild_id,
        service_channel_id,
        service_channel_set_by,
        service_channel_set_at
      )
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(guild_id) DO UPDATE SET
        service_channel_id = excluded.service_channel_id,
        service_channel_set_by = excluded.service_channel_set_by,
        service_channel_set_at = excluded.service_channel_set_at;
    `,
    [guildId, channelId, setBy],
  );

  persist();
}

export function getServiceChannel({ guildId }) {
  const result = db.exec(
    `
      SELECT service_channel_id
      FROM guild_settings
      WHERE guild_id = ?
      LIMIT 1;
    `,
    [guildId],
  );

  if (result.length === 0 || result[0].values.length === 0) {
    return null;
  }

  return result[0].values[0][0];
}
