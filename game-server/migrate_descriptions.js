// 기존 DB의 아이템 description을 간결한 포맷으로 업데이트하는 마이그레이션 스크립트
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "database", "game.db"));

const updates = [
  // 소모품
  { itemCode: "001", desc: "꿈상점 등장 아이템 +1" },
  { itemCode: "002", desc: "꿈상점 등장 아이템 +1 or +2" },
  { itemCode: "003", desc: "꿈상점 등장 아이템 +2" },
  { itemCode: "004", desc: "꿈상점 등장 아이템 +2 or +3" },
  { itemCode: "005", desc: "꿈상점 등장 아이템 +3" },
  { itemCode: "006", desc: "꿈상점 구매 횟수 +1" },
  { itemCode: "007", desc: "꿈상점 아이템 1가지 최소등급 중급" },
  { itemCode: "008", desc: "꿈상점 구매 횟수 +2" },
  { itemCode: "009", desc: "꿈상점 아이템 2가지 최소등급 중급" },
  { itemCode: "010", desc: "꿈상점 아이템 1가지 최소등급 상급" },
  // 모자
  { itemCode: "100", desc: "Academic x1.0" },
  { itemCode: "101", desc: "Academic x1.1" },
  { itemCode: "102", desc: "Academic x1.2" },
  { itemCode: "103", desc: "Academic x1.3" },
  { itemCode: "104", desc: "Academic x1.5" },
  // 옷
  { itemCode: "200", desc: "Extra x1.0" },
  { itemCode: "201", desc: "Extra x1.1" },
  { itemCode: "202", desc: "Extra x1.2" },
  { itemCode: "203", desc: "Extra x1.3" },
  { itemCode: "204", desc: "Extra x1.5" },
  // 가방
  { itemCode: "300", desc: "Idle x1.0" },
  { itemCode: "301", desc: "Idle x1.1" },
  { itemCode: "302", desc: "Idle x1.2" },
  { itemCode: "303", desc: "Idle x1.3" },
  { itemCode: "304", desc: "Idle x1.5" },
  // 가구
  { itemCode: "400", desc: "EXP +50" },
  { itemCode: "401", desc: "EXP +50" },
  { itemCode: "402", desc: "EXP +50" },
  { itemCode: "403", desc: "EXP +50" },
  { itemCode: "404", desc: "EXP +50" },
  { itemCode: "405", desc: "EXP +50" },
  { itemCode: "406", desc: "EXP +50" },
  { itemCode: "407", desc: "EXP +50" },
  { itemCode: "408", desc: "EXP +50" },
  { itemCode: "409", desc: "EXP +50" },
  // 프랜즈
  { itemCode: "500", desc: "Academic x2.0" },
  { itemCode: "501", desc: "Extra x2.0" },
  { itemCode: "502", desc: "Idle x2.0" },
];

const stmt = db.prepare("UPDATE item_definitions SET description = ? WHERE itemCode = ?");
const tx = db.transaction(() => {
  for (const u of updates) {
    const result = stmt.run(u.desc, u.itemCode);
    console.log(`[${u.itemCode}] ${result.changes > 0 ? "✓" : "✗"} → ${u.desc}`);
  }
});
tx();
console.log("\nDone! All descriptions updated.");
