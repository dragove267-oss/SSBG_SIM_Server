const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "game.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    userId           TEXT PRIMARY KEY,
    academicCurrency INTEGER DEFAULT 0,
    extraCurrency    INTEGER DEFAULT 0,
    idleCurrency     INTEGER DEFAULT 0,
    exp              INTEGER DEFAULT 0,
    updatedAt        TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS login_snapshots (
    userId           TEXT PRIMARY KEY,
    academicCurrency INTEGER DEFAULT 0,
    extraCurrency    INTEGER DEFAULT 0,
    idleCurrency     INTEGER DEFAULT 0,
    exp              INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS school_snapshots (
    userId          TEXT PRIMARY KEY,
    attendanceCount INTEGER DEFAULT 0,
    assignmentCount INTEGER DEFAULT 0,
    updatedAt       TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_play_log (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    userId                   TEXT NOT NULL,
    date                     TEXT NOT NULL,
    exp_gained               INTEGER DEFAULT 0,
    academic_currency_gained INTEGER DEFAULT 0,
    extra_currency_gained    INTEGER DEFAULT 0,
    idle_currency_gained     INTEGER DEFAULT 0,
    play_minutes             INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_reset_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    userId  TEXT NOT NULL,
    resetAt TEXT NOT NULL
  )
`);

//  아이템 목록
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    itemId       TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    currencyType TEXT NOT NULL,
    price        INTEGER NOT NULL,
    description  TEXT DEFAULT ''
  )
`);

//  유저 보유 아이템
db.exec(`
  CREATE TABLE IF NOT EXISTS user_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    userId     TEXT NOT NULL,
    itemId     TEXT NOT NULL,
    quantity   INTEGER DEFAULT 1,
    obtainedAt TEXT DEFAULT (datetime('now')),
    UNIQUE(userId, itemId)
  )
`);

//  재화 소모 이력
db.exec(`
  CREATE TABLE IF NOT EXISTS spend_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    userId       TEXT NOT NULL,
    currencyType TEXT NOT NULL,
    amount       INTEGER NOT NULL,
    reason       TEXT DEFAULT '',
    spentAt      TEXT DEFAULT (datetime('now'))
  )
`);

module.exports = db;