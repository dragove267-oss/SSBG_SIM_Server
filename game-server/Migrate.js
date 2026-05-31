// ================================================================
// 마이그레이션 스크립트
// 실행: node migrate.js
// 위치: game-server/ 폴더에서 실행
// ================================================================

const db = require("./database/db");

console.log("[Migration] 시작...");


// ================================================================
// 0. users 테이블 - lastIdleCollect 컬럼 추가
// ================================================================
try {
  db.exec(`ALTER TABLE users ADD COLUMN lastIdleCollect TEXT DEFAULT (datetime('now'))`);
  console.log("[Migration] users.lastIdleCollect 컬럼 추가 완료");
} catch (e) {
  console.log("[Migration] users.lastIdleCollect 이미 존재 (skip)");
}


// ================================================================
// 1. item_definitions - grade 컬럼 추가
// ================================================================
try {
  db.exec(`ALTER TABLE item_definitions ADD COLUMN grade TEXT DEFAULT 'basic'`);
  console.log("[Migration] item_definitions.grade 컬럼 추가 완료");
} catch (e) {
  console.log("[Migration] item_definitions.grade 이미 존재 (skip)");
}

// ================================================================
// 2. dream_shop 테이블 생성
// ================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS dream_shop (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    userId       TEXT NOT NULL,
    date         TEXT NOT NULL,
    items        TEXT NOT NULL DEFAULT '[]',
    maxBuyCount  INTEGER NOT NULL DEFAULT 1,
    usedBuyCount INTEGER NOT NULL DEFAULT 0,
    createdAt    TEXT DEFAULT (datetime('now')),
    UNIQUE(userId, date)
  )
`);
console.log("[Migration] dream_shop 테이블 생성 완료");

// ================================================================
// 3. consumable_effects 테이블 생성
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
// 4. 기본 아이템 등록 (HAT_000, CLOTHES_000, BAG_000)
// ================================================================
const defaultItems = [
  { itemCode: "HAT_000",     name: "기본 모자",  itemType: "Hat",     grade: "basic", cosmeticSlot: "hat"     },
  { itemCode: "CLOTHES_000", name: "기본 옷",    itemType: "Clothes", grade: "basic", cosmeticSlot: "clothes" },
  { itemCode: "BAG_000",     name: "기본 가방",  itemType: "Bag",     grade: "basic", cosmeticSlot: "bag"     },
];

const insertItem = db.prepare(`
  INSERT OR IGNORE INTO item_definitions (itemCode, name, itemType, grade, cosmeticSlot)
  VALUES (?, ?, ?, ?, ?)
`);
for (const item of defaultItems) {
  insertItem.run(item.itemCode, item.name, item.itemType, item.grade, item.cosmeticSlot);
}
console.log("[Migration] 기본 아이템 등록 완료");

// ================================================================
// 5. 소모품 아이템 + 효과 등록 (아이템 코드 규칙: 0xx)
// 상점 소모품 5종 - 꿈상점 등장 아이템 수 증가
// 조합 소모품 5종 - 구매 수 증가 / 등급 보장
// ================================================================
const consumables = [
  // 상점 소모품
  { itemCode: "001", name: "아이템 +1 (소)",      effectType: "shop_add_item",   value: 1 },
  { itemCode: "002", name: "아이템 +1~2 (중)",    effectType: "shop_add_item",   value: 2 },
  { itemCode: "003", name: "아이템 +2 (대)",      effectType: "shop_add_item",   value: 3 },
  { itemCode: "004", name: "아이템 +2~3 (특)",    effectType: "shop_add_item",   value: 4 },
  { itemCode: "005", name: "아이템 +3 (최)",      effectType: "shop_add_item",   value: 5 },
  // 조합 소모품
  { itemCode: "006", name: "구매 +1",             effectType: "shop_add_buy",    value: 1 },
  { itemCode: "007", name: "중급 확정 1종",        effectType: "shop_grade_mid",  value: 1 },
  { itemCode: "008", name: "구매 +2",             effectType: "shop_add_buy",    value: 2 },
  { itemCode: "009", name: "중급 확정 2종",        effectType: "shop_grade_mid",  value: 2 },
  { itemCode: "010", name: "상급 확정 1종",        effectType: "shop_grade_high", value: 1 },
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

// ================================================================
// 6. 상점에 소모품 등록 (exp 소모)
// ================================================================
// 기존 테이블에 exp CHECK 없는 경우 재생성
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shop_definitions_new (
      shopId       TEXT PRIMARY KEY,
      itemCode     TEXT NOT NULL REFERENCES item_definitions(itemCode),
      currencyType TEXT NOT NULL CHECK(currencyType IN ('academicCurrency', 'extraCurrency', 'idleCurrency', 'exp')),
      price        INTEGER NOT NULL,
      createdAt    TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`INSERT OR IGNORE INTO shop_definitions_new SELECT * FROM shop_definitions`);
  db.exec(`DROP TABLE IF EXISTS shop_definitions`);
  db.exec(`ALTER TABLE shop_definitions_new RENAME TO shop_definitions`);
  console.log("[Migration] shop_definitions 재생성 완료 (exp 추가)");
} catch (e) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shop_definitions (
      shopId       TEXT PRIMARY KEY,
      itemCode     TEXT NOT NULL REFERENCES item_definitions(itemCode),
      currencyType TEXT NOT NULL CHECK(currencyType IN ('academicCurrency', 'extraCurrency', 'idleCurrency', 'exp')),
      price        INTEGER NOT NULL,
      createdAt    TEXT DEFAULT (datetime('now'))
    )
  `);
  console.log("[Migration] shop_definitions 신규 생성 완료");
}

const shopItems = [
  { shopId: "SHOP_001", itemCode: "001", currencyType: "exp", price: 100 },
  { shopId: "SHOP_002", itemCode: "002", currencyType: "exp", price: 200 },
  { shopId: "SHOP_003", itemCode: "003", currencyType: "exp", price: 300 },
  { shopId: "SHOP_004", itemCode: "004", currencyType: "exp", price: 400 },
  { shopId: "SHOP_005", itemCode: "005", currencyType: "exp", price: 500 },
];

const insertShop = db.prepare(`
  INSERT OR IGNORE INTO shop_definitions (shopId, itemCode, currencyType, price)
  VALUES (?, ?, ?, ?)
`);
for (const s of shopItems) {
  insertShop.run(s.shopId, s.itemCode, s.currencyType, s.price);
}
console.log("[Migration] 상점 소모품 등록 완료");

// ================================================================
// 7. 조합 레시피 등록
// ================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS craft_definitions (
    craftId       TEXT PRIMARY KEY,
    itemCode      TEXT NOT NULL REFERENCES item_definitions(itemCode),
    currencyType1 TEXT NOT NULL CHECK(currencyType1 IN ('academicCurrency', 'extraCurrency', 'idleCurrency')),
    cost1         INTEGER NOT NULL,
    currencyType2 TEXT CHECK(currencyType2 IN ('academicCurrency', 'extraCurrency', 'idleCurrency')),
    cost2         INTEGER DEFAULT 0,
    currencyType3 TEXT CHECK(currencyType3 IN ('academicCurrency', 'extraCurrency', 'idleCurrency')),
    cost3         INTEGER DEFAULT 0,
    createdAt     TEXT DEFAULT (datetime('now'))
  )
`);

const craftItems = [
  { craftId: "CRAFT_001", itemCode: "006", currencyType1: "extraCurrency",    cost1: 100 },
  { craftId: "CRAFT_002", itemCode: "007", currencyType1: "academicCurrency", cost1: 200 },
  { craftId: "CRAFT_003", itemCode: "008", currencyType1: "extraCurrency",    cost1: 300 },
  { craftId: "CRAFT_004", itemCode: "009", currencyType1: "academicCurrency", cost1: 400 },
  { craftId: "CRAFT_005", itemCode: "010", currencyType1: "extraCurrency",    cost1: 500 },
];

const insertCraft = db.prepare(`
  INSERT OR IGNORE INTO craft_definitions (craftId, itemCode, currencyType1, cost1, currencyType2, cost2, currencyType3, cost3)
  VALUES (?, ?, ?, ?, NULL, 0, NULL, 0)
`);
for (const c of craftItems) {
  insertCraft.run(c.craftId, c.itemCode, c.currencyType1, c.cost1);
}
console.log("[Migration] 조합 레시피 등록 완료");

console.log("[Migration] 전체 완료!");

// ================================================================
// 8. CURRENCY_EXP_FLAT 옵션 코드 추가 (가구 EXP +50 고정)
// ================================================================
db.prepare(`
  INSERT OR IGNORE INTO item_options (optionCode, name, description, valueType, defaultValue)
  VALUES ('CURRENCY_EXP_FLAT', 'EXP 고정 증가', '가구 장착 시 EXP 획득량 고정 증가', 'flat', 50.0)
`).run();
console.log("[Migration] CURRENCY_EXP_FLAT 옵션 추가 완료");

db.close();