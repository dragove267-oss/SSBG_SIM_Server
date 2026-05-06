const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "school.db"));

// 학사 데이터 테이블 생성 (학번 studentId 기준)
db.exec(`
  CREATE TABLE IF NOT EXISTS attendance (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    studentId  TEXT NOT NULL,
    week       INTEGER NOT NULL,
    status     TEXT NOT NULL CHECK(status IN ('출석', '지각', '결석')),
    recordedAt TEXT DEFAULT (datetime('now')),
    UNIQUE(studentId, week)
  );

  CREATE TABLE IF NOT EXISTS assignment (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    studentId  TEXT NOT NULL,
    name       TEXT NOT NULL,
    status     TEXT NOT NULL CHECK(status IN ('제출', '미제출')),
    recordedAt TEXT DEFAULT (datetime('now')),
    UNIQUE(studentId, name)
  );
`);

module.exports = db;
