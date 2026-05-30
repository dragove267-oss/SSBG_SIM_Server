// 기존 user_inventory 아이템의 옵션을 user_item_options로 마이그레이션
// 또한 user_inventory에서 UNIQUE(userId, itemCode) 제약 제거
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "database", "game.db"));

console.log("[Migration] 인스턴스별 아이템 옵션 마이그레이션 시작...\n");

// 1. user_item_options 테이블 생성 (없으면)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_item_options (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    inventoryId INTEGER NOT NULL REFERENCES user_inventory(id) ON DELETE CASCADE,
    optionCode  TEXT NOT NULL REFERENCES item_options(optionCode),
    value       REAL NOT NULL,
    UNIQUE(inventoryId, optionCode)
  )
`);
console.log("[1/3] user_item_options 테이블 확인/생성 완료");

// 2. user_inventory에서 UNIQUE(userId, itemCode) 제약 제거
const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_inventory'").get();
if (schema && schema.sql.includes("UNIQUE(userId, itemCode)")) {
  console.log("[2/3] user_inventory UNIQUE(userId, itemCode) 제약 제거 중...");
  
  const data = db.prepare("SELECT * FROM user_inventory").all();
  
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("DROP TABLE user_inventory;");
  db.exec(`
    CREATE TABLE user_inventory (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      userId     TEXT NOT NULL,
      itemCode   TEXT NOT NULL REFERENCES item_definitions(itemCode),
      slotIndex  INTEGER NOT NULL CHECK(slotIndex >= 0 AND slotIndex < 80),
      isEquipped INTEGER NOT NULL DEFAULT 0 CHECK(isEquipped IN (0, 1)),
      obtainedAt TEXT DEFAULT (datetime('now')),
      UNIQUE(userId, slotIndex)
    )
  `);
  
  const insert = db.prepare(`
    INSERT INTO user_inventory (id, userId, itemCode, slotIndex, isEquipped, obtainedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const row of data) {
    insert.run(row.id, row.userId, row.itemCode, row.slotIndex, row.isEquipped, row.obtainedAt);
  }
  db.exec("PRAGMA foreign_keys = ON;");
  
  console.log(`  → ${data.length}개 인벤토리 항목 마이그레이션 완료`);
} else {
  console.log("[2/3] user_inventory UNIQUE 제약 이미 제거됨 (스킵)");
}

// 3. 기존 인벤토리 아이템의 기본 옵션을 user_item_options로 복사
const inventoryItems = db.prepare("SELECT id, itemCode FROM user_inventory").all();
let copied = 0;
let skipped = 0;

const tx = db.transaction(() => {
  for (const inv of inventoryItems) {
    // 이미 user_item_options에 있으면 스킵
    const existing = db.prepare(
      "SELECT COUNT(*) as count FROM user_item_options WHERE inventoryId = ?"
    ).get(inv.id);
    
    if (existing.count > 0) {
      skipped++;
      continue;
    }

    // item_definition_options에서 기본 옵션 복사
    const baseOptions = db.prepare(
      "SELECT optionCode, value FROM item_definition_options WHERE itemCode = ?"
    ).all(inv.itemCode);
    
    for (const opt of baseOptions) {
      db.prepare(
        "INSERT OR IGNORE INTO user_item_options (inventoryId, optionCode, value) VALUES (?, ?, ?)"
      ).run(inv.id, opt.optionCode, opt.value);
    }
    
    if (baseOptions.length > 0) copied++;
  }
});
tx();

console.log(`[3/3] 옵션 복사 완료: ${copied}개 복사, ${skipped}개 스킵 (이미 존재)`);

// 검증
const total = db.prepare("SELECT COUNT(*) as count FROM user_item_options").get().count;
console.log(`\n[완료] user_item_options 총 ${total}개 레코드`);

db.close();
