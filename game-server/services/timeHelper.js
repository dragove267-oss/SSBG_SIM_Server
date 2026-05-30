const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "..", "database", "game.db"));

/**
 * 서버 시간 오프셋(ms)을 적용한 현재 Date 반환
 */
function getServerTime() {
  try {
    const row = db.prepare("SELECT value FROM server_config WHERE key = 'time_offset_ms'").get();
    const offset = row ? parseInt(row.value, 10) : 0;
    return new Date(Date.now() + offset);
  } catch {
    return new Date();
  }
}

/**
 * "YYYY-MM-DD" 형태의 오늘 날짜 (서버 오프셋 적용)
 */
function getServerToday() {
  return getServerTime().toISOString().slice(0, 10);
}

module.exports = { getServerTime, getServerToday };
