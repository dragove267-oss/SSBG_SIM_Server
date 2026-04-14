const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "game.db"));

// 유저 테이블
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
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    userId                  TEXT NOT NULL,
    date                    TEXT NOT NULL,
    exp_gained              INTEGER DEFAULT 0,
    academic_currency_gained INTEGER DEFAULT 0,
    extra_currency_gained   INTEGER DEFAULT 0,
    idle_currency_gained    INTEGER DEFAULT 0,
    play_minutes            INTEGER DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_reset_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    userId  TEXT NOT NULL,
    resetAt TEXT NOT NULL
  )
`);

module.exports = db;