const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "school.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS attendance (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    userId     TEXT NOT NULL,
    week       INTEGER NOT NULL,
    status     TEXT NOT NULL CHECK(status IN ('출석', '지각', '조퇴', '결석', '미제출')),
    recordedAt TEXT DEFAULT (datetime('now')),
    UNIQUE(userId, week)
  );

  CREATE TABLE IF NOT EXISTS assignment (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    userId     TEXT NOT NULL,
    name       TEXT NOT NULL,
    status     TEXT NOT NULL CHECK(status IN ('제출', '미제출')),
    recordedAt TEXT DEFAULT (datetime('now')),
    UNIQUE(userId, name)
  );
`);

module.exports = db;