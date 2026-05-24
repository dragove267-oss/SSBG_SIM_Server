// ================================================================
// 마이그레이션 스크립트
// ================================================================

const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "database", "game.db"));

console.log("[Migration] 시작...");

// ================================================================
// 1. item_definitions - grade 컬럼 추가
// ================================================================
try {
  db.exec(`ALTER TABLE item_definitions ADD COLUMN grade TEXT DEFAULT 'basic'`);
  console.log("[Migration] item_definitions.grade 컬럼 추가 완료");
} catch (e) {
  console.log("[Migration] item_definitions.grade 이미 존재:", e.message);
}

// ================================================================
// 2. dream_shop 테이블 생성
// ================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS dream_shop (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    userId       TEXT NOT NULL,
    date         TEXT NOT NULL,
    items        TEXT NOT NULL DEFAULT '[]',  -- JSON 배열: [{itemCode, grade, bought}]
    maxBuyCount  INTEGER NOT NULL DEFAULT 1,  -- 구매 가능 수
    usedBuyCount INTEGER NOT NULL DEFAULT 0,  -- 사용한 구매 수
    createdAt    TEXT DEFAULT (datetime('now')),
    UNIQUE(userId, date)
  )
`);
console.log("[Migration] dream_shop 테이블 생성 완료");

// ================================================================
// 3. 기본 아이템 등록 (유저 생성 시 자동 지급용)
// ================================================================
const defaultItems = [
  { itemCode: "HAT_000",     name: "기본 모자",  itemType: "Hat",     grade: "basic", cosmeticSlot: "hat" },
  { itemCode: "CLOTHES_000", name: "기본 옷",    itemType: "Clothes", grade: "basic", cosmeticSlot: "clothes" },
  { itemCode: "BAG_000",     name: "기본 가방",  itemType: "Bag",     grade: "basic", cosmeticSlot: "bag" },
];

const insertItem = db.prepare(`
  INSERT OR IGNORE INTO item_definitions (itemCode, name, itemType, grade, cosmeticSlot)
  VALUES (?, ?, ?, ?, ?)
`);

for (const item of defaultItems) {
  insertItem.run(item.itemCode, item.name, item.itemType, item.grade, item.cosmeticSlot);
}
console.log("[Migration] 기본 아이템 등록 완료 (HAT_000, CLOTHES_000, BAG_000)");

// ================================================================
// 4. consumable_effects 테이블 생성
// 소모품 효과 정의
// effectType:
//   shop_add_item    - 꿈상점 등장 아이템 수 증가
//   shop_add_buy     - 구매 가능 수 증가
//   shop_grade_mid   - 등장 코스튬 최소 중급 확정
//   shop_grade_high  - 등장 코스튬 최소 상급 확정
// ================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS consumable_effects (
    itemCode   TEXT PRIMARY KEY REFERENCES item_definitions(itemCode),
    effectType TEXT NOT NULL,
    value      INTEGER NOT NULL DEFAULT 1
  )
`);
console.log("[Migration] consumable_effects 테이블 생성 완료");

// ================================================================
// 5. 소모품 아이템 + 효과 등록
// 상점 소모품 5종 (0xx - exp 소모)
// 조합 소모품 5종 (0xx)
// ================================================================
const consumables = [
  // 상점 소모품 - 등장 아이템 수 증가
  { itemCode: "001", name: "등장 아이템 +1 (소)",   effectType: "shop_add_item", value: 1 },
  { itemCode: "002", name: "등장 아이템 +1~2 (중)", effectType: "shop_add_item", value: 2 },
  { itemCode: "003", name: "등장 아이템 +2 (대)",   effectType: "shop_add_item", value: 3 },
  { itemCode: "004", name: "등장 아이템 +2~3 (특)", effectType: "shop_add_item", value: 4 },
  { itemCode: "005", name: "등장 아이템 +3 (최)",   effectType: "shop_add_item", value: 5 },
  // 조합 소모품
  { itemCode: "006", name: "구매 +1",               effectType: "shop_add_buy",  value: 1 },
  { itemCode: "007", name: "중급 확정 1종",          effectType: "shop_grade_mid", value: 1 },
  { itemCode: "008", name: "구매 +2",               effectType: "shop_add_buy",  value: 2 },
  { itemCode: "009", name: "중급 확정 2종",          effectType: "shop_grade_mid", value: 2 },
  { itemCode: "010", name: "상급 확정 1종",          effectType: "shop_grade_high", value: 1 },
];

const insertConsumable = db.prepare(`
  INSERT OR IGNORE INTO item_definitions (itemCode, name, itemType, grade)
  VALUES (?, ?, 'Consumable', 'basic')
`);
const insertEffect = db.prepare(`
  INSERT OR IGNORE INTO consumable_effects (itemCode, effectType, value)
  VALUES (?, ?, ?)
`);

for (const c of consumables) {
  insertConsumable.run(c.itemCode, c.name);
  insertEffect.run(c.itemCode, c.effectType, c.value);
}
console.log("[Migration] 소모품 아이템 + 효과 등록 완료");

console.log("[Migration] 완료!");
db.close();