const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "game.db"));

// 기존 테이블

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

// 학사 테이블

// 과목별 출석 기록 (주차별)
db.exec(`
  CREATE TABLE IF NOT EXISTS academic_attendance (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    userId    TEXT NOT NULL,
    week      INTEGER NOT NULL,
    status    TEXT NOT NULL CHECK(status IN ('출석', '지각', '결석')),
    recordedAt TEXT DEFAULT (datetime('now')),
    UNIQUE(userId, week)
  )
`);

// 과제 제출 기록
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

// 학사 변동 로그 (언리얼 출력용)
// changeType: 'attendance' | 'assignment'
// detail: 변동 내용 텍스트 (예: "1주차 출석 → 지각 변경")
db.exec(`
  CREATE TABLE IF NOT EXISTS academic_change_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    userId     TEXT NOT NULL,
    changeType TEXT NOT NULL,
    detail     TEXT NOT NULL,
    deltaExtra    INTEGER DEFAULT 0,
    deltaExp      INTEGER DEFAULT 0,
    isRead     INTEGER DEFAULT 0,
    createdAt  TEXT DEFAULT (datetime('now'))
  )
`);

// 아이템 테이블
// 아이템 코드 (유물 종류 정의)
// rarity: 'common' | 'uncommon' | 'rare' | 'legendary'
db.exec(`
  CREATE TABLE IF NOT EXISTS item_definitions (
    itemCode    TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    rarity      TEXT NOT NULL DEFAULT 'common'
                CHECK(rarity IN ('common', 'uncommon', 'rare', 'legendary')),
    createdAt   TEXT DEFAULT (datetime('now'))
  )
`);

// 옵션 코드 (효과 종류 정의)
// optionType: 효과 식별자
// valueType: 'multiplier'(배율) | 'flat'(고정값) | 'chance'(확률)
// defaultValue: 기본 수치 (예: 1.2 = 20% 증가, 0.1 = 10% 확률 증가)
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

// 아이템↔옵션 연결 (아이템 하나에 옵션 여러 개 가능)
// value: 이 아이템에서의 실제 수치 (defaultValue 오버라이드)
db.exec(`
  CREATE TABLE IF NOT EXISTS item_definition_options (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    itemCode   TEXT NOT NULL REFERENCES item_definitions(itemCode),
    optionCode TEXT NOT NULL REFERENCES item_options(optionCode),
    value      REAL NOT NULL,
    UNIQUE(itemCode, optionCode)
  )
`);

// 유저 인벤토리 (가방 - 보유 유물 목록)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_inventory (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    userId     TEXT NOT NULL,
    itemCode   TEXT NOT NULL REFERENCES item_definitions(itemCode),
    obtainedAt TEXT DEFAULT (datetime('now')),
    UNIQUE(userId, itemCode)
  )
`);

// 기본 옵션 코드 초기 데이터 삽입
db.prepare(`
  INSERT OR IGNORE INTO item_options (optionCode, name, description, valueType, defaultValue)
  VALUES
    ('CURRENCY_EXTRA_RATE',     'Extra 재화 배율',         'Extra 재화 획득량 배율 증가',     'multiplier', 1.2),
    ('CURRENCY_EXP_RATE',       'EXP 배율',                'EXP 획득량 배율 증가',            'multiplier', 1.2),
    ('CURRENCY_ACADEMIC_RATE',  'Academic 재화 배율',      'Academic 재화 획득량 배율 증가',  'multiplier', 1.2),
    ('REWARD_ATTENDANCE_BONUS', '출석 보상 증가',          '출석 시 보상 추가 지급',          'flat',       50.0),
    ('REWARD_ASSIGNMENT_BONUS', '과제 보상 증가',          '과제 제출 시 보상 추가 지급',     'flat',       30.0),
    ('ITEM_DROP_RATE',          '아이템 획득 확률 증가',   '아이템 드롭 확률 증가',           'chance',     0.05),
    ('ITEM_RARE_RATE',          '희귀 아이템 확률 증가',   '희귀 등급 이상 드롭 확률 증가',   'chance',     0.03)
`).run();

module.exports = db;