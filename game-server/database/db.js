const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "game.db"));

// ================================================================
// 상수
// ================================================================
const INVENTORY_SLOT_COUNT = 80;
const INVENTORY_PAGE_SIZE  = 20;

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
    lastIdleCollect  TEXT DEFAULT (datetime('now')),
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

try {
  db.exec("ALTER TABLE school_snapshots ADD COLUMN lateCount INTEGER DEFAULT 0");
} catch (e) {}
try {
  db.exec("ALTER TABLE school_snapshots ADD COLUMN absentCount INTEGER DEFAULT 0");
} catch (e) {}

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
    UNIQUE(userId, slotIndex)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_item_options (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    inventoryId INTEGER NOT NULL REFERENCES user_inventory(id) ON DELETE CASCADE,
    optionCode  TEXT NOT NULL REFERENCES item_options(optionCode),
    value       REAL NOT NULL,
    UNIQUE(inventoryId, optionCode)
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

// ================================================================
// 상점 테이블
// ================================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS shop_definitions (
    shopId       TEXT PRIMARY KEY,
    itemCode     TEXT NOT NULL REFERENCES item_definitions(itemCode),
    currencyType TEXT NOT NULL CHECK(currencyType IN ('academicCurrency', 'extraCurrency', 'idleCurrency', 'exp')),
    price        INTEGER NOT NULL,
    createdAt    TEXT DEFAULT (datetime('now'))
  )
`);

// ================================================================
// 제작 테이블
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

// ================================================================
// 꿈상점 테이블
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

// ================================================================
// 서버 설정 테이블 (시간 오프셋 등)
// ================================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS server_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);
db.prepare(`INSERT OR IGNORE INTO server_config (key, value) VALUES ('time_offset_ms', '0')`).run();

// ================================================================
// Self-Healing Seeder
// ================================================================
try {
  const seedDone = db.prepare("SELECT COUNT(*) as count FROM item_definitions WHERE itemCode = '001' AND name = '공책'").get().count > 0
    && (db.prepare("SELECT cost2 FROM craft_definitions WHERE craftId = 'CRAFT_001'").get()?.cost2 || 0) > 0;
  if (!seedDone) {
    console.log("[DB] Seeding database...");

    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("DELETE FROM item_definition_options;");
    db.exec("DELETE FROM shop_definitions;");
    db.exec("DELETE FROM craft_definitions;");
    db.exec("DELETE FROM consumable_effects;");
    db.exec("DELETE FROM item_definitions;");
    db.exec("DELETE FROM item_options;");
    db.exec("PRAGMA foreign_keys = ON;");

    db.prepare(`
      INSERT INTO item_options (optionCode, name, description, valueType, defaultValue)
      VALUES
        ('CURRENCY_EXTRA_RATE',     'Extra 재화 배율',    'Extra 재화 획득량 배율 증가',    'multiplier', 1.0),
        ('CURRENCY_EXP_RATE',       'EXP 배율',           'EXP 획득량 배율 증가',           'multiplier', 1.0),
        ('CURRENCY_ACADEMIC_RATE',  'Academic 재화 배율', 'Academic 재화 획득량 배율 증가', 'multiplier', 1.0),
        ('CURRENCY_IDLE_RATE',      'Idle 재화 배율',     'Idle 재화 획득량 배율 증가',     'multiplier', 1.0),
        ('REWARD_ATTENDANCE_BONUS', '출석 보상 증가',     '출석 시 보상 추가 지급',         'flat',       0.0),
        ('REWARD_ASSIGNMENT_BONUS', '과제 보상 증가',     '과제 제출 시 보상 추가 지급',    'flat',       0.0),
        ('CURRENCY_EXP_FLAT',       'EXP 고정 증가',      '장착 시 EXP 획득량 고정 증가',   'flat',       0.0)
    `).run();

    const insertItem = db.prepare(`
      INSERT INTO item_definitions (itemCode, name, description, itemType, grade, cosmeticSlot)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    // 소모품 (0xx)
    const consumables = [
      { itemCode: "001", name: "공책",       desc: "꿈상점 등장 아이템 +1",          effect: "shop_add_item",   val: 1 },
      { itemCode: "002", name: "교과서",     desc: "꿈상점 등장 아이템 +1 or +2",    effect: "shop_add_item",   val: 2 },
      { itemCode: "003", name: "은색 책",    desc: "꿈상점 등장 아이템 +2",          effect: "shop_add_item",   val: 3 },
      { itemCode: "004", name: "금색 책",    desc: "꿈상점 등장 아이템 +2 or +3",    effect: "shop_add_item",   val: 4 },
      { itemCode: "005", name: "백과사전",   desc: "꿈상점 등장 아이템 +3",          effect: "shop_add_item",   val: 5 },
      { itemCode: "006", name: "안경",       desc: "꿈상점 구매 횟수 +1",            effect: "shop_add_buy",    val: 1 },
      { itemCode: "008", name: "나무 연필",   desc: "꿈상점 아이템 1가지 최소 중급",  effect: "shop_grade_mid",  val: 1 },
      { itemCode: "007", name: "선글라스",   desc: "꿈상점 구매 횟수 +2",            effect: "shop_add_buy",    val: 2 },
      { itemCode: "009", name: "은색 연필",   desc: "꿈상점 아이템 2가지 최소 중급",  effect: "shop_grade_mid",  val: 2 },
      { itemCode: "010", name: "금색 연필",   desc: "꿈상점 아이템 1가지 최소 상급",  effect: "shop_grade_high", val: 1 },
    ];
    for (const c of consumables) {
      insertItem.run(c.itemCode, c.name, c.desc, "Consumable", "basic", null);
      db.prepare("INSERT INTO consumable_effects (itemCode, effectType, value) VALUES (?, ?, ?)").run(c.itemCode, c.effect, c.val);
    }

    // 모자 (1xx)
    insertItem.run("100", "기본 모자",   "Academic x1.0", "Hat", "basic", "hat");
    insertItem.run("101", "하급 모자",   "Academic x1.1", "Hat", "low",   "hat");
    insertItem.run("102", "중급 모자",   "Academic x1.2", "Hat", "mid",   "hat");
    insertItem.run("103", "상급 모자",   "Academic x1.3", "Hat", "high",  "hat");
    insertItem.run("104", "최상급 모자", "Academic x1.5", "Hat", "top",   "hat");

    // 옷 (2xx)
    insertItem.run("200", "기본 옷",   "Extra x1.0", "Clothes", "basic", "clothes");
    insertItem.run("201", "하급 옷",   "Extra x1.1", "Clothes", "low",   "clothes");
    insertItem.run("202", "중급 옷",   "Extra x1.2", "Clothes", "mid",   "clothes");
    insertItem.run("203", "상급 옷",   "Extra x1.3", "Clothes", "high",  "clothes");
    insertItem.run("204", "최상급 옷", "Extra x1.5", "Clothes", "top",   "clothes");

    // 가방 (3xx)
    insertItem.run("300", "기본 가방",   "Idle x1.0", "Bag", "basic", "bag");
    insertItem.run("301", "하급 가방",   "Idle x1.1", "Bag", "low",   "bag");
    insertItem.run("302", "중급 가방",   "Idle x1.2", "Bag", "mid",   "bag");
    insertItem.run("303", "상급 가방",   "Idle x1.3", "Bag", "high",  "bag");
    insertItem.run("304", "최상급 가방", "Idle x1.5", "Bag", "top",   "bag");

    // 코스튬 기본 옵션 시딩
    const cosOpt = db.prepare("INSERT INTO item_definition_options (itemCode, optionCode, value) VALUES (?, ?, ?)");
    cosOpt.run("100", "CURRENCY_ACADEMIC_RATE", 1.0);
    cosOpt.run("101", "CURRENCY_ACADEMIC_RATE", 1.1);
    cosOpt.run("102", "CURRENCY_ACADEMIC_RATE", 1.2);
    cosOpt.run("103", "CURRENCY_ACADEMIC_RATE", 1.3);
    cosOpt.run("104", "CURRENCY_ACADEMIC_RATE", 1.5);
    cosOpt.run("200", "CURRENCY_EXTRA_RATE", 1.0);
    cosOpt.run("201", "CURRENCY_EXTRA_RATE", 1.1);
    cosOpt.run("202", "CURRENCY_EXTRA_RATE", 1.2);
    cosOpt.run("203", "CURRENCY_EXTRA_RATE", 1.3);
    cosOpt.run("204", "CURRENCY_EXTRA_RATE", 1.5);
    cosOpt.run("300", "CURRENCY_IDLE_RATE", 1.0);
    cosOpt.run("301", "CURRENCY_IDLE_RATE", 1.1);
    cosOpt.run("302", "CURRENCY_IDLE_RATE", 1.2);
    cosOpt.run("303", "CURRENCY_IDLE_RATE", 1.3);
    cosOpt.run("304", "CURRENCY_IDLE_RATE", 1.5);

    // 가구 (4xx)
    const themes = [
      { itemCode: "400", name: "나무 의자" },
      { itemCode: "401", name: "안락한 침대" },
      { itemCode: "402", name: "핑크 컴퓨터" },
      { itemCode: "403", name: "옷걸이" },
      { itemCode: "404", name: "다림질대" },
      { itemCode: "405", name: "선반" },
      { itemCode: "406", name: "소파" },
      { itemCode: "407", name: "가스레인지" },
      { itemCode: "408", name: "테이블" },
      { itemCode: "409", name: "세탁기" },
    ];
    for (const t of themes) {
      insertItem.run(t.itemCode, t.name, "EXP +50", "Theme", "basic", "theme");
      db.prepare("INSERT INTO item_definition_options (itemCode, optionCode, value) VALUES (?, 'CURRENCY_EXP_FLAT', 50.0)").run(t.itemCode);
    }

    // 프랜즈 (5xx)
    const friends = [
      { itemCode: "500", name: "한성냥이", desc: "Academic x2.0", optionCode: "CURRENCY_ACADEMIC_RATE" },
      { itemCode: "501", name: "꼬꼬&꾸꾸", desc: "Extra x2.0",   optionCode: "CURRENCY_EXTRA_RATE" },
      { itemCode: "502", name: "상찌",      desc: "Idle x2.0",    optionCode: "CURRENCY_IDLE_RATE" },
    ];
    for (const f of friends) {
      insertItem.run(f.itemCode, f.name, f.desc, "Friend", "basic", "friend");
      db.prepare("INSERT INTO item_definition_options (itemCode, optionCode, value) VALUES (?, ?, 2.0)").run(f.itemCode, f.optionCode);
    }

    // 상점 등록
    const shopDefs = [
      { shopId: "SHOP_001", itemCode: "001", price: 100 },
      { shopId: "SHOP_002", itemCode: "002", price: 200 },
      { shopId: "SHOP_003", itemCode: "003", price: 300 },
      { shopId: "SHOP_004", itemCode: "004", price: 400 },
      { shopId: "SHOP_005", itemCode: "005", price: 500 },
    ];
    for (const s of shopDefs) {
      db.prepare("INSERT INTO shop_definitions (shopId, itemCode, currencyType, price) VALUES (?, ?, 'exp', ?)").run(s.shopId, s.itemCode, s.price);
    }

    // 제작 레시피 등록 (멀티 재화 조합)
    const craftDefs = [
      {
        craftId: "CRAFT_001",
        itemCode: "006",
        currency1: "academicCurrency", cost1: 100,
        currency2: "extraCurrency",    cost2: 100,
        currency3: "idleCurrency",     cost3: 100
      },
      {
        craftId: "CRAFT_002",
        itemCode: "007",
        currency1: "academicCurrency", cost1: 300,
        currency2: "extraCurrency",    cost2: 200,
        currency3: "idleCurrency",     cost3: 200
      },
      {
        craftId: "CRAFT_003",
        itemCode: "008",
        currency1: "academicCurrency", cost1: 300,
        currency2: "extraCurrency",    cost2: 300,
        currency3: "idleCurrency",     cost3: 300
      },
      {
        craftId: "CRAFT_004",
        itemCode: "009",
        currency1: "academicCurrency", cost1: 200,
        currency2: "extraCurrency",    cost2: 300,
        currency3: "idleCurrency",     cost3: 200
      },
      {
        craftId: "CRAFT_005",
        itemCode: "010",
        currency1: "academicCurrency", cost1: 200,
        currency2: "extraCurrency",    cost2: 200,
        currency3: "idleCurrency",     cost3: 300
      }
    ];
    for (const c of craftDefs) {
      db.prepare(`
        INSERT INTO craft_definitions (craftId, itemCode, currencyType1, cost1, currencyType2, cost2, currencyType3, cost3)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(c.craftId, c.itemCode, c.currency1, c.cost1, c.currency2, c.cost2, c.currency3, c.cost3);
    }

    console.log("[DB] Seeding complete!");
  }
} catch (err) {
  console.error("[DB-Seeding] Seeding failed:", err.message);
}

module.exports = db;
module.exports.INVENTORY_SLOT_COUNT = INVENTORY_SLOT_COUNT;
module.exports.INVENTORY_PAGE_SIZE = INVENTORY_PAGE_SIZE;