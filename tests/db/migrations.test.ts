import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../helpers/migrations.js';

describe('0005_rename_market_columns', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('renames the listing columns in place and keeps existing data', () => {
    applyMigrations(db, { through: '0004' });
    db.exec(`INSERT INTO servers (id, created_at, updated_at) VALUES ('s1', 1, 1)`);
    const insert = db.prepare(
      `INSERT INTO listings
         (server_id, user_id, username, intent, accepts, card_name, card_name_normalized,
          manapool_url, kind, sealed_uuid, expires_at, created_at, updated_at)
       VALUES ('s1', 'u1', 'alice', 'have', 'cash', ?, ?, ?, ?, ?, 10, 1, 1)`,
    );
    insert.run(
      'Black Lotus',
      'black lotus',
      'https://manapool.com/card/lea/232/black-lotus',
      'card',
      null,
    );
    insert.run(
      'Bloomburrow Bundle',
      'bloomburrow bundle',
      'https://manapool.com/sealed/blb/bundle',
      'sealed',
      'ec99d990-704c-5ad3-ae7f-f1dbc5fd5ceb',
    );

    applyMigrations(db, { from: '0005' });

    const columns = (db.pragma('table_info(listings)') as Array<{ name: string }>).map(
      (column) => column.name,
    );
    expect(columns).toContain('market_url');
    expect(columns).toContain('catalog_id');
    expect(columns).not.toContain('manapool_url');
    expect(columns).not.toContain('sealed_uuid');

    const rows = db
      .prepare(
        'SELECT card_name AS cardName, market_url AS marketUrl, catalog_id AS catalogId FROM listings ORDER BY id',
      )
      .all();
    expect(rows).toEqual([
      {
        cardName: 'Black Lotus',
        marketUrl: 'https://manapool.com/card/lea/232/black-lotus',
        catalogId: null,
      },
      {
        cardName: 'Bloomburrow Bundle',
        marketUrl: 'https://manapool.com/sealed/blb/bundle',
        catalogId: 'ec99d990-704c-5ad3-ae7f-f1dbc5fd5ceb',
      },
    ]);
  });

  it('leaves card_cache.manapool_url alone', () => {
    applyMigrations(db);
    const columns = (db.pragma('table_info(card_cache)') as Array<{ name: string }>).map(
      (column) => column.name,
    );
    expect(columns).toContain('manapool_url');
    expect(columns).not.toContain('market_url');
  });
});
