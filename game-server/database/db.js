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
    status     TEXT NOT NULL CHECK(status IN ('출석', '지각', '결석')),
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
// itemType: 'Hat' | 'Bag' | 'Clothes' | 'Theme' | 'Friend' | 'Consumable'
// ================================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS item_definitions (
    itemCode    TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    itemType    TEXT NOT NULL DEFAULT 'Consumable'
                CHECK(itemType IN ('Hat', 'Bag', 'Clothes', 'Theme', 'Friend', 'Consumable')),
    createdAt   TEXT DEFAULT (datetime('now'))
  )
`);

// 옵션 코드
// valueType: 'multiplier'(배율) | 'flat'(고정값) | 'chance'(확률)
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

// 아이템↔옵션 연결 (옵션 여러 개 가능)
db.exec(`
  CREATE TABLE IF NOT EXISTS item_definition_options (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    itemCode   TEXT NOT NULL REFERENCES item_definitions(itemCode),
    optionCode TEXT NOT NULL REFERENCES item_options(optionCode),
    value      REAL NOT NULL,
    UNIQUE(itemCode, optionCode)
  )
`);

// ================================================================
// 가방 (user_inventory)
// slotIndex: 0~79 (총 80칸, 페이지당 20칸)
// isEquipped: 0=미장착, 1=장착 (Hat/Bag/Clothes/Theme/Friend 사용)
//   같은 itemType은 1개만 장착 가능 (서비스 로직에서 체크)
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
// collectionType: 'Hat' | 'Bag' | 'Clothes' | 'Theme' | 'Friend' | 'Consumable'
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
// 기본 옵션 코드 초기 데이터
// ================================================================
db.prepare(`
  INSERT OR IGNORE INTO item_options (optionCode, name, description, valueType, defaultValue)
  VALUES
    ('CURRENCY_EXTRA_RATE',     'Extra 재화 배율',       'Extra 재화 획득량 배율 증가',    'multiplier', 1.2),
    ('CURRENCY_EXP_RATE',       'EXP 배율',              'EXP 획득량 배율 증가',           'multiplier', 1.2),
    ('CURRENCY_ACADEMIC_RATE',  'Academic 재화 배율',    'Academic 재화 획득량 배율 증가', 'multiplier', 1.2),
    ('REWARD_ATTENDANCE_BONUS', '출석 보상 증가',        '출석 시 보상 추가 지급',         'flat',       50.0),
    ('REWARD_ASSIGNMENT_BONUS', '과제 보상 증가',        '과제 제출 시 보상 추가 지급',    'flat',       30.0),
    ('ITEM_DROP_RATE',          '아이템 획득 확률 증가', '아이템 드롭 확률 증가',          'chance',     0.05),
    ('ITEM_RARE_RATE',          '희귀 아이템 확률 증가', '희귀 등급 이상 드롭 확률 증가', 'chance',     0.03),
    ('CONSUMABLE_EXTRA_RATE',   '소모성 Extra 배율',     '소모 시 Extra 재화 배율 증가',   'multiplier', 1.5),
    ('CONSUMABLE_EXP_RATE',     '소모성 EXP 배율',       '소모 시 EXP 배율 증가',          'multiplier', 1.5)
`).run();

module.exports = db;
module.exports.INVENTORY_SLOT_COUNT = INVENTORY_SLOT_COUNT;
module.exports.INVENTORY_PAGE_SIZE  = INVENTORY_PAGE_SIZE;