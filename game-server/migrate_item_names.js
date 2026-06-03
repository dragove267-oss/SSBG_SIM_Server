// 기존 DB의 아이템 이름을 유저 요청 명칭으로 업데이트하는 마이그레이션 스크립트
// 실행: node migrate_item_names.js
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "database", "game.db"));

const updates = [
  { itemCode: "001", name: "공책" },
  { itemCode: "002", name: "교과서" },
  { itemCode: "003", name: "은색 책" },
  { itemCode: "004", name: "금색 책" },
  { itemCode: "005", name: "백과사전" },
  { itemCode: "006", name: "안경" },
  { itemCode: "007", name: "선글라스" },
  { itemCode: "008", name: "나무 연필" },
  { itemCode: "009", name: "은색 연필" },
  { itemCode: "010", name: "금색 연필" }
];

const stmt = db.prepare("UPDATE item_definitions SET name = ? WHERE itemCode = ?");
const tx = db.transaction(() => {
  for (const u of updates) {
    const result = stmt.run(u.name, u.itemCode);
    console.log(`[${u.itemCode}] ${result.changes > 0 ? "✓" : "✗"} → ${u.name}`);
  }
});
tx();
console.log("\nDone! All consumable item names updated.");
db.close();
