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

describe('0006_listing_language_and_grade', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('gives every existing listing English and no grade, without touching its other columns', () => {
    applyMigrations(db, { through: '0005' });
    db.exec(`INSERT INTO servers (id, created_at, updated_at) VALUES ('s1', 1, 1)`);
    db.prepare(
      `INSERT INTO listings
         (server_id, user_id, username, intent, accepts, card_name, card_name_normalized,
          market_url, condition, price_cents, expires_at, created_at, updated_at)
       VALUES ('s1', 'u1', 'alice', 'have', 'cash', 'Black Lotus', 'black lotus',
               'https://manapool.com/card/lea/232/black-lotus', 'nm', 4500000, 10, 1, 1)`,
    ).run();

    applyMigrations(db, { from: '0006' });

    expect(
      db
        .prepare(
          `SELECT card_name AS cardName, market_url AS marketUrl, condition, price_cents AS priceCents,
                  language, grading_company AS gradingCompany, grade FROM listings`,
        )
        .all(),
    ).toEqual([
      {
        cardName: 'Black Lotus',
        marketUrl: 'https://manapool.com/card/lea/232/black-lotus',
        condition: 'nm',
        priceCents: 4500000,
        language: 'en',
        gradingCompany: null,
        grade: null,
      },
    ]);
  });

  it('defaults the language of a new listing to English and refuses a null one', () => {
    applyMigrations(db);
    db.exec(`INSERT INTO servers (id, created_at, updated_at) VALUES ('s1', 1, 1)`);
    const insert = (language: string | null) =>
      db
        .prepare(
          `INSERT INTO listings
             (server_id, user_id, username, intent, accepts, language, card_name,
              card_name_normalized, expires_at, created_at, updated_at)
           VALUES ('s1', 'u1', 'alice', 'have', 'cash', ?, 'x', 'x', 10, 1, 1)`,
        )
        .run(language);
    insert('ja');
    expect(() => insert(null)).toThrow(/NOT NULL/);
    db.exec(
      `INSERT INTO listings (server_id, user_id, username, intent, accepts, card_name,
         card_name_normalized, expires_at, created_at, updated_at)
       VALUES ('s1', 'u2', 'bob', 'have', 'cash', 'y', 'y', 10, 1, 1)`,
    );
    expect(
      (
        db.prepare('SELECT language FROM listings ORDER BY id').all() as Array<{ language: string }>
      ).map((row) => row.language),
    ).toEqual(['ja', 'en']);
  });
});

describe('0007_catalog_tables', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  const columns = (table: string) =>
    (db.pragma(`table_info(${table})`) as Array<{ name: string; pk: number }>).map(
      (column) => column.name,
    );

  it('adds the three catalog tables and leaves the rest alone', () => {
    applyMigrations(db, { through: '0006' });
    db.exec(`INSERT INTO servers (id, created_at, updated_at) VALUES ('s1', 1, 1)`);
    db.exec(
      `INSERT INTO listings (server_id, user_id, username, intent, accepts, card_name,
         card_name_normalized, expires_at, created_at, updated_at)
       VALUES ('s1', 'u1', 'alice', 'have', 'cash', 'Black Lotus', 'black lotus', 10, 1, 1)`,
    );

    applyMigrations(db, { from: '0007' });

    expect(columns('catalog_sets')).toEqual(
      expect.arrayContaining(['game', 'language', 'id', 'name', 'code', 'release_date', 'etag']),
    );
    expect(columns('catalog_items')).toEqual(
      expect.arrayContaining([
        'game',
        'kind',
        'language',
        'id',
        'name',
        'base_normalized',
        'number',
      ]),
    );
    expect(columns('catalog_sync_meta')).toEqual(['source', 'fingerprint', 'synced_at']);
    expect(db.prepare('SELECT card_name FROM listings').all()).toEqual([
      { card_name: 'Black Lotus' },
    ]);
  });

  it('keys a product by game, kind, language and id, so the same id can exist per kind or language', () => {
    applyMigrations(db);
    const insert = (kind: string, language: string, id: string) =>
      db
        .prepare(
          `INSERT INTO catalog_items
             (game, kind, language, id, name, name_normalized, base_normalized, set_id, updated_at)
           VALUES ('pokemon', ?, ?, ?, 'x', 'x', 'x', '1', 1)`,
        )
        .run(kind, language, id);
    insert('card', 'en', '100');
    expect(() => insert('card', 'en', '100')).toThrow(/UNIQUE|PRIMARY KEY/);
    expect(() => insert('sealed', 'en', '100')).not.toThrow();
    expect(() => insert('card', 'ja', '100')).not.toThrow();
  });

  it('keys a set by game, language and id, and defaults its code to empty', () => {
    applyMigrations(db);
    const insert = (language: string) =>
      db
        .prepare(
          `INSERT INTO catalog_sets (game, language, id, name, updated_at)
           VALUES ('pokemon', ?, '23228', 'Obsidian Flames', 1)`,
        )
        .run(language);
    insert('en');
    expect(() => insert('en')).toThrow(/UNIQUE|PRIMARY KEY/);
    expect(() => insert('ja')).not.toThrow();
    expect(db.prepare(`SELECT code, supplemental FROM catalog_sets LIMIT 1`).get()).toEqual({
      code: '',
      supplemental: 0,
    });
  });

  it('has one sync-meta row per source', () => {
    applyMigrations(db);
    db.exec(`INSERT INTO catalog_sync_meta (source, fingerprint, synced_at) VALUES ('a', 'x', 1)`);
    expect(() =>
      db.exec(
        `INSERT INTO catalog_sync_meta (source, fingerprint, synced_at) VALUES ('a', 'y', 2)`,
      ),
    ).toThrow(/UNIQUE|PRIMARY KEY/);
    expect(() =>
      db.exec(
        `INSERT INTO catalog_sync_meta (source, fingerprint, synced_at) VALUES ('b', 'y', 2)`,
      ),
    ).not.toThrow();
  });
});

describe('0008_catalog_sets_import_version', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('marks the sets an earlier importer wrote as version 0, so they are imported again', () => {
    applyMigrations(db, { through: '0007' });
    db.exec(
      `INSERT INTO catalog_sets (game, language, id, name, etag, updated_at)
       VALUES ('pokemon', 'en', '23228', 'Obsidian Flames', '"obf-1"', 1)`,
    );

    applyMigrations(db, { from: '0008' });

    expect(db.prepare(`SELECT name, etag, import_version FROM catalog_sets`).all()).toEqual([
      { name: 'Obsidian Flames', etag: '"obf-1"', import_version: 0 },
    ]);
  });

  it('defaults the version of a set inserted without one to 0', () => {
    applyMigrations(db);
    db.exec(
      `INSERT INTO catalog_sets (game, language, id, name, updated_at)
       VALUES ('pokemon', 'en', '1', 'X', 1)`,
    );
    expect(db.prepare(`SELECT import_version FROM catalog_sets`).get()).toEqual({
      import_version: 0,
    });
  });
});
