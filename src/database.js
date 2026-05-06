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
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    service_channel_id TEXT,
    service_channel_set_by TEXT,
    service_channel_set_at TEXT,
    history_size INTEGER
  );
`);

try {
  db.run(`
    ALTER TABLE guild_settings ADD COLUMN history_size INTEGER;
  `);
} catch (error) {
  if (!String(error.message).includes('duplicate column name')) {
    throw error;
  }
}

persist();

function persist() {
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
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

export function setHistorySize({ guildId, historySize }) {
  db.run(
    `
      INSERT INTO guild_settings (guild_id, history_size)
      VALUES (?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        history_size = excluded.history_size;
    `,
    [guildId, historySize],
  );

  persist();
}

export function getHistorySize({ guildId }) {
  const result = db.exec(
    `
      SELECT history_size
      FROM guild_settings
      WHERE guild_id = ?
      LIMIT 1;
    `,
    [guildId],
  );

  if (result.length === 0 || result[0].values.length === 0) {
    return 15;
  }

  const historySize = Number(result[0].values[0][0]);
  return Number.isInteger(historySize) && historySize > 0 ? historySize : 15;
}
