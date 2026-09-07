import type { DB, QueryResult } from '@op-engineering/op-sqlite';
import { open } from '@op-engineering/op-sqlite';
import logger from '../../utils/logger';
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from './schema';

const DB_NAME = 'elebook_field.sqlite';

let db: DB | null = null;

/** Throws if initDatabase() has not run yet -- callers should never hit this in production. */
export function getDb(): DB {
  if (!db) {
    throw new Error(
      '[Database] initDatabase() must be called before any read/write -- ' +
        'call it once during app startup, before the wildlife store hydrates.',
    );
  }
  return db;
}

/**
 * Opens the local database and applies any migrations not yet recorded in
 * `PRAGMA user_version`. Safe to call multiple times -- a second call is a
 * cheap no-op once the version matches.
 */
export async function initDatabase(): Promise<void> {
  db = open({ name: DB_NAME });

  // journal_mode is a connection-level pragma, not a transactional
  // statement -- must run outside db.transaction().
  await db.execute('PRAGMA journal_mode = WAL;');

  const versionResult: QueryResult = await db.execute('PRAGMA user_version;');
  const appliedVersion = Number(versionResult.rows[0]?.user_version ?? 0);

  if (appliedVersion >= CURRENT_SCHEMA_VERSION) {
    return;
  }

  for (let version = appliedVersion + 1; version <= CURRENT_SCHEMA_VERSION; version++) {
    const statements = MIGRATIONS[version];
    if (!statements) {
      continue;
    }
    await db.transaction(async (tx) => {
      for (const statement of statements) {
        await tx.execute(statement);
      }
      await tx.execute(`PRAGMA user_version = ${version};`);
    });
    logger.log(`[Database] Applied migration to schema version ${version}`);
  }
}

/** Test-only escape hatch: drops the cached connection so a fresh initDatabase() reopens it. */
export function __resetDatabaseForTests(): void {
  db = null;
}
