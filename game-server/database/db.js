const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "game.db"));

// ================================================================
// 상수
// ================================================================
const INVENTORY_SLOT_COUNT = 80;  // 가로5 x 세로4 x 4페이지
const INVENTORY_PAGE_SIZE  = 20;  // 한 페이지당 슬롯 수 (5x4)

// ================================================================
// 기존 테이블
// ================================================================

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

// ================================================================
// 학사 테이블
// ================================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS academic_attendance (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    userId     TEXT NOT NULL,
    week       INTEGER NOT NULL,
    status     TEXT NOT NULL CHECK(status IN ('출석', '지각', '조퇴', '결석', '미제출')),
    recordedAt TEXT DEFAULT (datetime('now')),
    UNIQUE(userId, week)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS academic_assignment (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    userId     TEXT NOT NULL,
    name       TEXT NOT NULL,
    status     TEXT NOT NULL CHECK(status IN ('제출', '미제출')),
    recordedAt TEXT DEFAULT (datetime('now')),
    UNIQUE(userId, name)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS academic_change_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    userId     TEXT NOT NULL,
    changeType TEXT NOT NULL,
    detail     TEXT NOT NULL,
    deltaExtra INTEGER DEFAULT 0,
    deltaExp   INTEGER DEFAULT 0,
    isRead     INTEGER DEFAULT 0,
    createdAt  TEXT DEFAULT (datetime('now'))
  )
`);

// ================================================================
// 아이템 정의 테이블
// itemType: 'Hat' | 'Bag' | 'Clothes' | 'Theme' | 'Friend' | 'Consumable' | 'relic'
// ================================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS item_definitions (
    itemCode     TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT DEFAULT '',
    itemType     TEXT NOT NULL
                 CHECK(itemType IN ('Hat', 'Bag', 'Clothes', 'Theme', 'Friend', 'Consumable')),
    grade        TEXT DEFAULT 'basic',
    cosmeticSlot TEXT,
    createdAt    TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS item_options (
    optionCode   TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT DEFAULT '',
    valueType    TEXT NOT NULL DEFAULT 'multiplier'
                 CHECK(valueType IN ('multiplier', 'flat', 'chance')),
    defaultValue REAL NOT NULL DEFAULT 1.0,
    createdAt    TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS item_definition_options (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    itemCode   TEXT NOT NULL REFERENCES item_definitions(itemCode),
    optionCode TEXT NOT NULL REFERENCES item_options(optionCode),
    value      REAL NOT NULL,
    UNIQUE(itemCode, optionCode)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS consumable_effects (
    itemCode   TEXT PRIMARY KEY REFERENCES item_definitions(itemCode),
    effectType TEXT NOT NULL,
    value      INTEGER NOT NULL DEFAULT 1
  )
`);

// ================================================================
// 가방 (user_inventory)
// ================================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS user_inventory (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    userId     TEXT NOT NULL,
    itemCode   TEXT NOT NULL REFERENCES item_definitions(itemCode),
    slotIndex  INTEGER NOT NULL CHECK(slotIndex >= 0 AND slotIndex < ${INVENTORY_SLOT_COUNT}),
    isEquipped INTEGER NOT NULL DEFAULT 0 CHECK(isEquipped IN (0, 1)),
    obtainedAt TEXT DEFAULT (datetime('now')),
    UNIQUE(userId, itemCode),
    UNIQUE(userId, slotIndex)
  )
`);

// ================================================================
// 도감 테이블
// ================================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS collection_definitions (
    collectionCode TEXT PRIMARY KEY,
    itemCode       TEXT NOT NULL REFERENCES item_definitions(itemCode),
    collectionType TEXT NOT NULL
                   CHECK(collectionType IN ('Hat', 'Bag', 'Clothes', 'Theme', 'Friend', 'Consumable')),
    name           TEXT NOT NULL,
    description    TEXT DEFAULT '',
    createdAt      TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_collection (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    userId         TEXT NOT NULL,
    collectionCode TEXT NOT NULL REFERENCES collection_definitions(collectionCode),
    isUnlocked     INTEGER NOT NULL DEFAULT 0 CHECK(isUnlocked IN (0, 1)),
    unlockedAt     TEXT,
    UNIQUE(userId, collectionCode)
  )
`);

// 구버전 초기화 구문 제거 (하단 Self-Healing Seeder가 일괄 수행)

//상점 테이블 
db.exec(`
  CREATE TABLE IF NOT EXISTS shop_definitions (
    shopId       TEXT PRIMARY KEY,
    itemCode     TEXT NOT NULL REFERENCES item_definitions(itemCode),
    currencyType TEXT NOT NULL CHECK(currencyType IN ('academicCurrency', 'extraCurrency', 'idleCurrency', 'exp')),
    price        INTEGER NOT NULL,
    createdAt    TEXT DEFAULT (datetime('now'))
  )
`);


// game-db.js에 추가할 craft_definitions 테이블
// db.exec() 블록에 추가하세요

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

// ================================================================
// 데이터베이스 자가 치유 및 자동 시딩 (Self-Healing Seeding)
// ================================================================
try {
  const seedDone = db.prepare("SELECT COUNT(*) as count FROM item_definitions WHERE itemCode = '001' AND name LIKE '%하늘책%'").get().count > 0;
  if (!seedDone) {
    console.log("[DB] Seeding database with fresh dictionary catalog...");
    
    // 외래 키 제약 조건 임시 해제 후 청소
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("DELETE FROM item_definition_options;");
    db.exec("DELETE FROM shop_definitions;");
    db.exec("DELETE FROM craft_definitions;");
    db.exec("DELETE FROM consumable_effects;");
    db.exec("DELETE FROM item_definitions;");
    db.exec("DELETE FROM item_options;");
    db.exec("PRAGMA foreign_keys = ON;");

    console.log("[DB-Seeding] Populating master options...");
    db.prepare(`
      INSERT INTO item_options (optionCode, name, description, valueType, defaultValue)
      VALUES
        ('CURRENCY_EXTRA_RATE',     'Extra 재화 배율',       'Extra 재화 획득량 배율 증가',    'multiplier', 1.0),
        ('CURRENCY_EXP_RATE',       'EXP 배율',              'EXP 획득량 배율 증가',           'multiplier', 1.0),
        ('CURRENCY_ACADEMIC_RATE',  'Academic 재화 배율',    'Academic 재화 획득량 배율 증가', 'multiplier', 1.0),
        ('CURRENCY_IDLE_RATE',      'Idle 재화 배율',        'Idle 재화 획득량 배율 증가',     'multiplier', 1.0),
        ('REWARD_ATTENDANCE_BONUS', '출석 보상 증가',        '출석 시 보상 추가 지급',         'flat',       0.0),
        ('REWARD_ASSIGNMENT_BONUS', '과제 보상 증가',        '과제 제출 시 보상 추가 지급',    'flat',       0.0),
        ('CURRENCY_EXP_FLAT',       'EXP 고정 증가',         '장착 시 EXP 획득량 고정 증가',   'flat',       0.0)
    `).run();

    const insertItem = db.prepare(`
      INSERT INTO item_definitions (itemCode, name, description, itemType, grade, cosmeticSlot)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    // 1. 소모품 (0xx)
    console.log("[DB-Seeding] Registering Consumables (0xx)...");
    const consumables = [
      { itemCode: "001", name: "Book_1 (하늘책)",     effect: "shop_add_item",   val: 1 },
      { itemCode: "002", name: "Book_2 (파란책)",     effect: "shop_add_item",   val: 2 },
      { itemCode: "003", name: "Book_3 (은색책)",     effect: "shop_add_item",   val: 3 },
      { itemCode: "004", name: "Book_4 (금색책)",     effect: "shop_add_item",   val: 4 },
      { itemCode: "005", name: "Book_5 (보라책)",     effect: "shop_add_item",   val: 5 },
      { itemCode: "006", name: "Glasses (안경)",      effect: "shop_add_buy",    val: 1 },
      { itemCode: "007", name: "Pen_1__1_ (오렌지펜)", effect: "shop_grade_mid",  val: 1 },
      { itemCode: "008", name: "Glasses2 (빛안경)",   effect: "shop_add_buy",    val: 2 },
      { itemCode: "009", name: "Pen_2_1_ (실버펜)",    effect: "shop_grade_mid",  val: 2 },
      { itemCode: "010", name: "Pen_3_1_ (골드펜)",    effect: "shop_grade_high", val: 1 },
    ];

    for (const c of consumables) {
      insertItem.run(c.itemCode, c.name, `${c.name} 소모품`, "Consumable", "basic", null);
      db.prepare("INSERT INTO consumable_effects (itemCode, effectType, value) VALUES (?, ?, ?)")
        .run(c.itemCode, c.effect, c.val);
    }

    // 2. 모자 (1xx)
    console.log("[DB-Seeding] Registering Hats (1xx)...");
    insertItem.run("100", "Cap (기본 모자)", "기본 파란 모자", "Hat", "basic", "hat");
    insertItem.run("101", "Cap1 (하급 모자)", "낮은 확률의 파란 모자", "Hat", "low", "hat");
    insertItem.run("102", "Cap2 (중급 모자)", "중간 확률의 황금 모자", "Hat", "mid", "hat");
    insertItem.run("103", "Cap3 (상급 모자)", "높은 확률의 초록 모자", "Hat", "high", "hat");
    insertItem.run("104", "Cap4 (최상급 모자)", "극악의 확률의 청록 모자", "Hat", "top", "hat");

    // 3. 옷 (2xx)
    console.log("[DB-Seeding] Registering Clothes (2xx)...");
    insertItem.run("200", "Clothes (기본 옷)", "기본 초록 티셔츠", "Clothes", "basic", "clothes");
    insertItem.run("201", "Cloth1 (하급 옷)", "낮은 확률의 파란 구체옷", "Clothes", "low", "clothes");
    insertItem.run("202", "Cloth2 (중급 옷)", "중간 확률의 황금 구체옷", "Clothes", "mid", "clothes");
    insertItem.run("203", "Cloth3 (상급 옷)", "높은 확률의 초록 구체옷", "Clothes", "high", "clothes");
    insertItem.run("204", "Cloth4 (최상급 옷)", "극악의 확률의 청록 구체옷", "Clothes", "top", "clothes");

    // 4. 가방 (3xx)
    console.log("[DB-Seeding] Registering Bags (3xx)...");
    insertItem.run("300", "Bag (기본 가방)", "기본 브라운 백팩", "Bag", "basic", "bag");
    insertItem.run("301", "B1_1_ (하급 가방)", "낮은 확률의 파란 가방", "Bag", "low", "bag");
    insertItem.run("302", "B2_1_ (중급 가방)", "중간 확률의 황금 가방", "Bag", "mid", "bag");
    insertItem.run("303", "B3_1_ (상급 가방)", "높은 확률의 초록 가방", "Bag", "high", "bag");
    insertItem.run("304", "B4_1_ (최상급 가방)", "극악의 확률의 청록 가방", "Bag", "top", "bag");

    // 5. 가구 (4xx)
    console.log("[DB-Seeding] Registering Themes (4xx)...");
    const themes = [
      { itemCode: "400", name: "Chair (나무 의자)" },
      { itemCode: "401", name: "Group_Bed (안락한 침대)" },
      { itemCode: "402", name: "Group_Computer (핑크 PC 컴퓨터)" },
      { itemCode: "403", name: "Group_Hanger" },
      { itemCode: "404", name: "Group_Iron" },
      { itemCode: "405", name: "Group_Shelf" },
      { itemCode: "406", name: "Group_Sofa" },
      { itemCode: "407", name: "Group_Stove" },
      { itemCode: "408", name: "Group_Table" },
      { itemCode: "409", name: "Group_Wash" }
    ];

    for (const t of themes) {
      insertItem.run(t.itemCode, t.name, `${t.name} 가구 테마`, "Theme", "basic", "theme");
      db.prepare("INSERT INTO item_definition_options (itemCode, optionCode, value) VALUES (?, 'CURRENCY_EXP_FLAT', 50.0)")
        .run(t.itemCode);
    }

    // 6. 프랜즈 (5xx)
    console.log("[DB-Seeding] Registering Friends (5xx)...");
    const friends = [
      { itemCode: "500", name: "Cat (고양이)" },
      { itemCode: "501", name: "Chicken (꼬꼬)" },
      { itemCode: "502", name: "Green2 (개구리)" },
    ];

    for (const f of friends) {
      insertItem.run(f.itemCode, f.name, `${f.name} 프랜즈 펫`, "Friend", "basic", "friend");
      
      const insertOption = db.prepare("INSERT INTO item_definition_options (itemCode, optionCode, value) VALUES (?, ?, ?)");
      insertOption.run(f.itemCode, "CURRENCY_ACADEMIC_RATE", 2.0);
      insertOption.run(f.itemCode, "CURRENCY_EXTRA_RATE", 2.0);
      insertOption.run(f.itemCode, "CURRENCY_IDLE_RATE", 2.0);
    }

    // 7. 상점 상품 등록 (책 5종 - EXP 소모)
    console.log("[DB-Seeding] Registering Shop items...");
    const shopDefs = [
      { shopId: "SHOP_001", itemCode: "001", price: 100 },
      { shopId: "SHOP_002", itemCode: "002", price: 200 },
      { shopId: "SHOP_003", itemCode: "003", price: 300 },
      { shopId: "SHOP_004", itemCode: "004", price: 400 },
      { shopId: "SHOP_005", itemCode: "005", price: 500 },
    ];
    for (const s of shopDefs) {
      db.prepare("INSERT INTO shop_definitions (shopId, itemCode, currencyType, price) VALUES (?, ?, 'exp', ?)")
        .run(s.shopId, s.itemCode, s.price);
    }

    // 8. 제작 레시피 등록 (안경, 필기구 5종)
    console.log("[DB-Seeding] Registering Craft Recipes...");
    const craftDefs = [
      { craftId: "CRAFT_001", itemCode: "006", currency1: "extraCurrency",    cost1: 100 },
      { craftId: "CRAFT_002", itemCode: "007", currency1: "academicCurrency", cost1: 200 },
      { craftId: "CRAFT_003", itemCode: "008", currency1: "extraCurrency",    cost1: 300 },
      { craftId: "CRAFT_004", itemCode: "009", currency1: "academicCurrency", cost1: 400 },
      { craftId: "CRAFT_005", itemCode: "010", currency1: "extraCurrency",    cost1: 500 },
    ];
    for (const c of craftDefs) {
      db.prepare("INSERT INTO craft_definitions (craftId, itemCode, currencyType1, cost1, cost2, cost3) VALUES (?, ?, ?, ?, 0, 0)")
        .run(c.craftId, c.itemCode, c.currency1, c.cost1);
    }

    console.log("[DB-Seeding] Seeding database complete!");
  }
} catch (err) {
  console.error("[DB-Seeding] Seeding failed:", err.message);
}

module.exports = db;
module.exports.INVENTORY_SLOT_COUNT = INVENTORY_SLOT_COUNT;
module.exports.INVENTORY_PAGE_SIZE = INVENTORY_PAGE_SIZE;
