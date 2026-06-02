const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3001;
const GAME_SERVER_URL = "http://localhost:3000";

const dbPath = path.join(__dirname, "..", "game-server", "database", "game.db");
const schoolDbPath = path.join(__dirname, "..", "school-server", "database", "school.db");

let db, schoolDb;

function connectDBs() {
    try {
        db = new Database(dbPath);
        schoolDb = new Database(schoolDbPath);

        // 게임 서버용 테이블 (studentId 컬럼 제거)
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

        // check item_definitions schema to prevent 'relic' / 'Relic' CHECK constraint issues from game-server
        let recreateItemDefinitions = false;
        try {
            const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='item_definitions'").get();
            if (schema && (schema.sql.includes("'Relic'") || schema.sql.includes("'relic'"))) {
                recreateItemDefinitions = true;
            }
        } catch (e) {}

        if (recreateItemDefinitions) {
            try {
                console.log("[Admin] Mismatched item_definitions schema ('relic' constraint) detected. Recreating table...");
                const data = db.prepare("SELECT * FROM item_definitions").all();
                db.exec("PRAGMA foreign_keys = OFF;");
                db.exec("DROP TABLE item_definitions");
                db.exec(`
                    CREATE TABLE item_definitions (
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
                const insert = db.prepare("INSERT OR REPLACE INTO item_definitions (itemCode, name, description, itemType, grade, cosmeticSlot, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)");
                for (const row of data) {
                    if (row.itemType === 'Relic' || row.itemType === 'relic') continue;
                    insert.run(row.itemCode, row.name, row.description, row.itemType, row.grade || 'basic', row.cosmeticSlot, row.createdAt);
                }
                db.exec("PRAGMA foreign_keys = ON;");
                console.log("[Admin] Recreated item_definitions table successfully and migrated data.");
            } catch (err) {
                console.error("[Admin] item_definitions 스키마 변경 실패:", err.message);
            }
        } else {
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
        }


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
            CREATE TABLE IF NOT EXISTS spend_log (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                userId       TEXT NOT NULL,
                currencyType TEXT NOT NULL,
                amount       INTEGER NOT NULL,
                reason       TEXT DEFAULT '',
                spentAt      TEXT DEFAULT (datetime('now'))
            )
        `);

        // 어드민 쿼리에 필요한 추가 테이블들 안전하게 자동 생성
        db.exec(`
            CREATE TABLE IF NOT EXISTS user_inventory (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                userId     TEXT NOT NULL,
                itemCode   TEXT NOT NULL REFERENCES item_definitions(itemCode),
                slotIndex  INTEGER NOT NULL CHECK(slotIndex >= 0 AND slotIndex < 80),
                isEquipped INTEGER NOT NULL DEFAULT 0 CHECK(isEquipped IN (0, 1)),
                obtainedAt TEXT DEFAULT (datetime('now')),
                UNIQUE(userId, slotIndex)
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
            CREATE TABLE IF NOT EXISTS item_definition_options (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                itemCode   TEXT NOT NULL REFERENCES item_definitions(itemCode),
                optionCode TEXT NOT NULL REFERENCES item_options(optionCode),
                value      REAL NOT NULL,
                UNIQUE(itemCode, optionCode)
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

        db.exec(`
            CREATE TABLE IF NOT EXISTS shop_definitions (
                shopId       TEXT PRIMARY KEY,
                itemCode     TEXT NOT NULL REFERENCES item_definitions(itemCode),
                currencyType TEXT NOT NULL CHECK(currencyType IN ('academicCurrency', 'extraCurrency', 'idleCurrency', 'exp')),
                price        INTEGER NOT NULL,
                createdAt    TEXT DEFAULT (datetime('now'))
            )
        `);

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

        db.prepare(`
            INSERT OR IGNORE INTO item_options (optionCode, name, description, valueType, defaultValue)
            VALUES
                ('CURRENCY_EXTRA_RATE',     'Extra 재화 배율',       'Extra 재화 획득량 배율 증가',    'multiplier', 1.2),
                ('CURRENCY_EXP_RATE',       'EXP 배율',              'EXP 획득량 배율 증가',           'multiplier', 1.2),
                ('CURRENCY_ACADEMIC_RATE',  'Academic 재화 배율',    'Academic 재화 획득량 배율 증가', 'multiplier', 1.2),
                ('CURRENCY_IDLE_RATE',      'Idle 재화 배율',        'Idle 재화 획득량 배율 증가',     'multiplier', 1.2),
                ('REWARD_ATTENDANCE_BONUS', '출석 보상 증가',        '출석 시 보상 추가 지급',         'flat',       50.0),
                ('REWARD_ASSIGNMENT_BONUS', '과제 보상 증가',        '과제 제출 시 보상 추가 지급',    'flat',       30.0),
                ('ITEM_DROP_RATE',          '아이템 획득 확률 증가', '아이템 드롭 확률 증가',          'chance',     0.05),
                ('ITEM_RARE_RATE',          '희귀 아이템 확률 증가', '희귀 등급 이상 드롭 확률 증가', 'chance',     0.03),
                ('CONSUMABLE_EXTRA_RATE',   '소모성 Extra 배율',     '소모 시 Extra 재화 배율 증가',   'multiplier', 1.5),
                ('CONSUMABLE_EXP_RATE',     '소모성 EXP 배율',       '소모 시 EXP 배율 증가',          'multiplier', 1.5),
                ('CURRENCY_EXP_FLAT',       'EXP 고정 증가',         '장착 시 EXP 획득량 고정 증가',   'flat',       0.0)
        `).run();

        db.exec(`
            CREATE TABLE IF NOT EXISTS server_config (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `);
        db.prepare(`INSERT OR IGNORE INTO server_config (key, value) VALUES ('time_offset_ms', '0')`).run();

        // 학사 서버용 테이블 (studentId → userId 통일)
        schoolDb.exec(`
            CREATE TABLE IF NOT EXISTS attendance (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                userId     TEXT NOT NULL,
                week       INTEGER NOT NULL,
                status     TEXT NOT NULL CHECK(status IN ('출석', '지각', '조퇴', '결석', '미제출')),
                recordedAt TEXT DEFAULT (datetime('now')),
                UNIQUE(userId, week)
            )
        `);

        schoolDb.exec(`
            CREATE TABLE IF NOT EXISTS assignment (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                userId     TEXT NOT NULL,
                name       TEXT NOT NULL,
                status     TEXT NOT NULL CHECK(status IN ('제출', '미제출')),
                recordedAt TEXT DEFAULT (datetime('now')),
                UNIQUE(userId, name)
            )
        `);

        console.log("[Admin] Databases connected and initialized.");
        ensureSuperAccount();
    } catch (err) {
        console.error("[Admin] DB 연결/초기화 실패:", err.message);
    }
}

function ensureSuperAccount() {
    try {
        if (!db || !schoolDb) return;

        // 1. users 테이블에 슈퍼 계정 추가
        db.prepare(`
            INSERT OR REPLACE INTO users (userId, academicCurrency, extraCurrency, idleCurrency, exp)
            VALUES ('0000', 10000, 10000, 10000, 10000)
        `).run();

        // 2. 인벤토리 초기화 후 모든 아이템 채워넣기
        db.prepare("DELETE FROM user_inventory WHERE userId = '0000'").run();
        
        const items = db.prepare("SELECT itemCode FROM item_definitions").all();
        const insertInventory = db.prepare(`
            INSERT INTO user_inventory (userId, itemCode, slotIndex, isEquipped)
            VALUES ('0000', ?, ?, 0)
        `);

        let slotIndex = 0;
        for (const item of items) {
            if (slotIndex >= 80) break; // 최대 슬롯 80개 제한
            const result = insertInventory.run(item.itemCode, slotIndex);
            const inventoryId = result.lastInsertRowid;

            // 기본 옵션 복사
            const baseOptions = db.prepare(
                "SELECT optionCode, value FROM item_definition_options WHERE itemCode = ?"
            ).all(item.itemCode);

            for (const opt of baseOptions) {
                db.prepare(`
                    INSERT OR IGNORE INTO user_item_options (inventoryId, optionCode, value)
                    VALUES (?, ?, ?)
                `).run(inventoryId, opt.optionCode, opt.value);
            }

            slotIndex++;
        }

        // 3. 학교서버 학사 테이블에 슈퍼 계정 추가하여 학번 검증 통과하도록 설정
        schoolDb.prepare(`
            INSERT OR IGNORE INTO attendance (userId, week, status)
            VALUES ('0000', 0, '결석')
        `).run();

        console.log(`[Admin] Super account '0000' successfully seeded with ${slotIndex} items and 10000 currencies.`);
    } catch (err) {
        console.error("[Admin] Super account seeding failed:", err.message);
    }
}

connectDBs();

// 보상 동기화 함수 (userId로 통일)
async function triggerRewardSync(userId, type) {
    try {
        await axios.post(`${GAME_SERVER_URL}/api/admin/apply-reward`, { userId, type });
        console.log(`[Admin-Sync] 보상 동기화 요청 (${type}): ${userId}`);
    } catch (err) {
        console.error(`[Admin-Sync] 동기화 실패: ${err.message}`);
    }
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

// ================================================================
// 대시보드
// ================================================================

app.get("/", (req, res) => {
    let userCount = 0, recentLogs = [];
    try {
        userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
        recentLogs = db.prepare("SELECT * FROM spend_log ORDER BY spentAt DESC LIMIT 5").all();
    } catch (e) {}
    res.render("index", { userCount, recentLogs, page: "dashboard" });
});

// ================================================================
// 유저 관리
// ================================================================

app.get("/users", (req, res) => {
    const search = req.query.search || "";
    let users = [];
    try {
        if (search) {
            users = db.prepare("SELECT * FROM users WHERE userId LIKE ?").all(`%${search}%`);
        } else {
            users = db.prepare("SELECT * FROM users").all();
        }
    } catch (e) {}
    res.render("users", { users, search, page: "users" });
});

app.get("/users/:userId", (req, res) => {
    const { userId } = req.params;
    try {
        const user = db.prepare("SELECT * FROM users WHERE userId = ?").get(userId);
        if (!user) return res.status(404).render("error", { message: "유저를 찾을 수 없습니다." });

        let inventory = [], collections = [];
        try {
            inventory = db.prepare(`
                SELECT ui.*, id.name, id.itemType
                FROM user_inventory ui
                JOIN item_definitions id ON ui.itemCode = id.itemCode
                WHERE ui.userId = ? ORDER BY ui.slotIndex ASC
            `).all(userId);
            for (const inv of inventory) {
                inv.options = db.prepare(`
                    SELECT uio.optionCode, uio.value, io.name, io.valueType, io.description
                    FROM user_item_options uio
                    JOIN item_options io ON uio.optionCode = io.optionCode
                    WHERE uio.inventoryId = ?
                `).all(inv.id);
            }
        } catch (e) {}
        try {
            collections = db.prepare(`
                SELECT id.itemCode AS collectionCode, id.name, id.itemType,
                       CASE WHEN ui.itemCode IS NOT NULL THEN 1 ELSE 0 END AS isUnlocked,
                       ui.obtainedAt AS unlockedAt
                FROM item_definitions id
                LEFT JOIN user_inventory ui ON id.itemCode = ui.itemCode AND ui.userId = ?
                WHERE id.itemType IN ('Hat', 'Bag', 'Clothes', 'Theme', 'Friend', 'Consumable')
                ORDER BY id.itemCode ASC
            `).all(userId);
            for (const col of collections) {
                col.options = db.prepare(`
                    SELECT ido.optionCode, ido.value, io.name, io.valueType, io.description
                    FROM item_definition_options ido
                    JOIN item_options io ON ido.optionCode = io.optionCode
                    WHERE ido.itemCode = ?
                `).all(col.collectionCode);
            }
        } catch (e) {}

        res.render("user-detail", { user, inventory, collections, page: "users" });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// studentId 필드 제거
app.post("/users/:userId/update", (req, res) => {
    const { userId } = req.params;
    const { academicCurrency, extraCurrency, idleCurrency, exp } = req.body;
    try {
        db.prepare(`
            UPDATE users
            SET academicCurrency = ?, extraCurrency = ?, idleCurrency = ?, exp = ?,
                updatedAt = datetime('now')
            WHERE userId = ?
        `).run(academicCurrency, extraCurrency, idleCurrency, exp, userId);
        res.redirect(`/users/${userId}?success=true`);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// ================================================================
// 학사 데이터 관리 (userId 기준으로 통일)
// ================================================================

app.get("/academic", (req, res) => {
    try {
        // userId 기준으로 조회
        const rows = schoolDb.prepare(`
            SELECT userId,
                (SELECT COUNT(*) FROM attendance WHERE userId = s.userId AND status = '출석') as attCount,
                (SELECT COUNT(*) FROM assignment WHERE userId = s.userId AND status = '제출') as asgnCount
            FROM (
                SELECT DISTINCT userId FROM attendance
                UNION
                SELECT DISTINCT userId FROM assignment
            ) s
        `).all();

        // EJS에서 studentId를 기대하므로 매핑
        const students = rows.map(r => ({ ...r, studentId: r.userId }));

        res.render("academic", { students, page: "academic" });
    } catch (e) {
        console.error("[Admin] 학사 목록 조회 에러:", e.message);
        res.render("academic", { students: [], page: "academic" });
    }
});

app.get("/academic/:userId", (req, res) => {
    const { userId } = req.params;
    try {
        const attendance = schoolDb.prepare(
            "SELECT * FROM attendance WHERE userId = ? ORDER BY week ASC"
        ).all(userId);
        const assignments = schoolDb.prepare(
            "SELECT * FROM assignment WHERE userId = ? ORDER BY id ASC"
        ).all(userId);

        // 게임 DB에서 유저 존재 여부만 확인
        const mappedUser = db.prepare("SELECT userId FROM users WHERE userId = ?").get(userId);

        res.render("academic-detail", { 
            studentId: userId, 
            userId, 
            attendance, 
            assignments, 
            mappedUser, 
            page: "academic" 
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post("/academic/:userId/attendance/add", async (req, res) => {
    const { userId } = req.params;
    const { week, status } = req.body;
    try {
        schoolDb.prepare(
            "INSERT INTO attendance (userId, week, status) VALUES (?, ?, ?)"
        ).run(userId, week, status);
        await triggerRewardSync(userId, "attendance");
        res.redirect(`/academic/${userId}?success=added`);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post("/academic/:userId/attendance/update", async (req, res) => {
    const { userId } = req.params;
    const { id, status } = req.body;
    try {
        const record = schoolDb.prepare("SELECT week FROM attendance WHERE id = ?").get(id);
        
        schoolDb.prepare(
            "UPDATE attendance SET status = ? WHERE id = ? AND userId = ?"
        ).run(status, id, userId);

        if (record) {
            db.prepare(`
                INSERT INTO academic_attendance (userId, week, status)
                VALUES (?, ?, ?)
                ON CONFLICT(userId, week) DO UPDATE SET status = excluded.status, recordedAt = datetime('now')
            `).run(userId, record.week, status);
        }

        await triggerRewardSync(userId, "attendance");
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/academic/:userId/attendance/delete", async (req, res) => {
    const { userId } = req.params;
    const { id } = req.body;
    try {
        const record = schoolDb.prepare("SELECT week FROM attendance WHERE id = ? AND userId = ?").get(id, userId);
        
        schoolDb.prepare(
            "DELETE FROM attendance WHERE id = ? AND userId = ?"
        ).run(id, userId);

        if (record) {
            db.prepare("DELETE FROM academic_attendance WHERE userId = ? AND week = ?").run(userId, record.week);
        }

        await triggerRewardSync(userId, "attendance");
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/academic/:userId/assignment/add", async (req, res) => {
    const { userId } = req.params;
    const { name, status } = req.body;
    try {
        schoolDb.prepare(
            "INSERT INTO assignment (userId, name, status) VALUES (?, ?, ?)"
        ).run(userId, name, status);
        await triggerRewardSync(userId, "assignment");
        res.redirect(`/academic/${userId}?success=added`);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post("/academic/:userId/assignment/update", async (req, res) => {
    const { userId } = req.params;
    const { id, status } = req.body;
    try {
        const record = schoolDb.prepare("SELECT name FROM assignment WHERE id = ?").get(id);

        schoolDb.prepare(
            "UPDATE assignment SET status = ? WHERE id = ? AND userId = ?"
        ).run(status, id, userId);

        if (record) {
            db.prepare(`
                INSERT INTO academic_assignment (userId, name, status)
                VALUES (?, ?, ?)
                ON CONFLICT(userId, name) DO UPDATE SET status = excluded.status, recordedAt = datetime('now')
            `).run(userId, record.name, status);
        }

        await triggerRewardSync(userId, "assignment");
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/academic/:userId/assignment/delete", async (req, res) => {
    const { userId } = req.params;
    const { id } = req.body;
    try {
        const record = schoolDb.prepare("SELECT name FROM assignment WHERE id = ? AND userId = ?").get(id, userId);

        schoolDb.prepare(
            "DELETE FROM assignment WHERE id = ? AND userId = ?"
        ).run(id, userId);

        if (record) {
            db.prepare("DELETE FROM academic_assignment WHERE userId = ? AND name = ?").run(userId, record.name);
        }

        await triggerRewardSync(userId, "assignment");
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 학번 추가 (userId 기준)
app.post("/academic/add-student", (req, res) => {
    const { studentId } = req.body;
    try {
        schoolDb.prepare(
            "INSERT OR IGNORE INTO attendance (userId, week, status) VALUES (?, 0, '결석')"
        ).run(studentId);
        res.redirect(`/academic/${studentId}`);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// ================================================================
// 인벤토리 및 도감
// ================================================================

app.post("/users/:userId/inventory/add", (req, res) => {
    const { userId } = req.params;
    const { itemCode, slotIndex } = req.body;
    try {
        // 아이템 코드 유효성 검증
        const itemExists = db.prepare("SELECT 1 FROM item_definitions WHERE itemCode = ?").get(itemCode);
        if (!itemExists) {
            return res.send("<script>alert('존재하지 않는 아이템 코드입니다. 아이템 도감에 먼저 등록해주세요.'); history.back();</script>");
        }

        db.prepare(
            "INSERT INTO user_inventory (userId, itemCode, slotIndex, isEquipped) VALUES (?, ?, ?, 0)"
        ).run(userId, itemCode, slotIndex);
        res.redirect(`/users/${userId}?success=item_added`);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post("/users/:userId/inventory/delete", (req, res) => {
    const { userId } = req.params;
    const { id } = req.body;
    try {
        db.prepare("DELETE FROM user_item_options WHERE inventoryId = ?").run(id);
        db.prepare("DELETE FROM user_inventory WHERE id = ? AND userId = ?").run(id, userId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 인스턴스별 옵션 수정
app.post("/users/:userId/inventory/:inventoryId/option", (req, res) => {
    const { userId, inventoryId } = req.params;
    const { optionCode, value } = req.body;
    try {
        // 인벤토리 소유 확인
        const inv = db.prepare("SELECT * FROM user_inventory WHERE id = ? AND userId = ?").get(inventoryId, userId);
        if (!inv) return res.status(404).json({ error: "인벤토리 아이템을 찾을 수 없습니다." });

        db.prepare(`
            INSERT OR REPLACE INTO user_item_options (inventoryId, optionCode, value)
            VALUES (?, ?, ?)
        `).run(inventoryId, optionCode, parseFloat(value));
        res.json({ success: true, inventoryId, optionCode, value: parseFloat(value) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 인스턴스 옵션 삭제
app.post("/users/:userId/inventory/:inventoryId/option/delete", (req, res) => {
    const { userId, inventoryId } = req.params;
    const { optionCode } = req.body;
    try {
        const inv = db.prepare("SELECT * FROM user_inventory WHERE id = ? AND userId = ?").get(inventoryId, userId);
        if (!inv) return res.status(404).json({ error: "인벤토리 아이템을 찾을 수 없습니다." });

        db.prepare("DELETE FROM user_item_options WHERE inventoryId = ? AND optionCode = ?").run(inventoryId, optionCode);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/users/:userId/collection/save", (req, res) => {
    const { userId } = req.params;
    const { unlockedCodes } = req.body;
    try {
        const transaction = db.transaction(() => {
            // 1. Get current inventory itemCodes
            const currentInventory = db.prepare("SELECT itemCode, slotIndex FROM user_inventory WHERE userId = ?").all(userId);
            const currentCodes = currentInventory.map(i => i.itemCode);
            
            // 2. Identify codes to add and codes to remove
            const targetCodes = unlockedCodes || [];
            const codesToAdd = targetCodes.filter(code => !currentCodes.includes(code));
            
            const collectionTypes = ['Hat', 'Bag', 'Clothes', 'Theme', 'Friend', 'Consumable'];
            const codesToRemove = currentInventory.filter(item => {
                const itemDef = db.prepare("SELECT itemType FROM item_definitions WHERE itemCode = ?").get(item.itemCode);
                return itemDef && collectionTypes.includes(itemDef.itemType) && !targetCodes.includes(item.itemCode);
            });
            
            // 3. Remove unchecked items from inventory
            if (codesToRemove.length > 0) {
                const deleteStmt = db.prepare("DELETE FROM user_inventory WHERE userId = ? AND itemCode = ?");
                for (const item of codesToRemove) {
                    deleteStmt.run(userId, item.itemCode);
                }
            }
            
            // 4. Add checked items to inventory
            if (codesToAdd.length > 0) {
                // Find empty slots
                const usedSlots = db.prepare("SELECT slotIndex FROM user_inventory WHERE userId = ?").all(userId).map(r => r.slotIndex);
                let emptySlots = [];
                for (let i = 0; i < 80; i++) {
                    if (!usedSlots.includes(i) && !emptySlots.includes(i)) {
                        emptySlots.push(i);
                    }
                }
                
                const insertStmt = db.prepare("INSERT INTO user_inventory (userId, itemCode, slotIndex, isEquipped) VALUES (?, ?, ?, 0)");
                for (let i = 0; i < codesToAdd.length; i++) {
                    if (i < emptySlots.length) {
                        insertStmt.run(userId, codesToAdd[i], emptySlots[i]);
                    } else {
                        throw new Error("인벤토리가 가득 차서 도감 아이템을 추가할 수 없습니다.");
                    }
                }
            }
        });
        transaction();
        res.json({ success: true });
    } catch (err) {
        console.error("Save collection error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ================================================================
// 아이템 도감 관리
// ================================================================

app.get("/items", (req, res) => {
    try {
        const items = db.prepare("SELECT * FROM item_definitions ORDER BY createdAt DESC").all();
        for (const item of items) {
            item.options = db.prepare(`
                SELECT ido.optionCode, ido.value, io.name, io.valueType, io.description
                FROM item_definition_options ido
                JOIN item_options io ON ido.optionCode = io.optionCode
                WHERE ido.itemCode = ?
            `).all(item.itemCode);
        }
        res.render("items", { items, page: "items" });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post("/items/add", (req, res) => {
    const { itemCode, name, description, itemType, cosmeticSlot } = req.body;
    try {
        db.prepare(`
            INSERT INTO item_definitions (itemCode, name, description, itemType, cosmeticSlot)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(itemCode) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                itemType = excluded.itemType,
                cosmeticSlot = excluded.cosmeticSlot
        `).run(itemCode, name, description || "", itemType, cosmeticSlot || null);
        res.redirect("/items?success=added");
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post("/items/delete", (req, res) => {
    const { itemCode } = req.body;
    try {
        const transaction = db.transaction(() => {
            // 연관된 옵션 설정 삭제
            db.prepare("DELETE FROM item_definition_options WHERE itemCode = ?").run(itemCode);
            // 유저 인벤토리에서 해당 아이템 삭제
            db.prepare("DELETE FROM user_inventory WHERE itemCode = ?").run(itemCode);
            // 상점 등록 정보 삭제
            db.prepare("DELETE FROM shop_definitions WHERE itemCode = ?").run(itemCode);
            // 제작 레시피 삭제
            db.prepare("DELETE FROM craft_definitions WHERE itemCode = ?").run(itemCode);
            // 도감 마스터 삭제
            db.prepare("DELETE FROM item_definitions WHERE itemCode = ?").run(itemCode);
        });
        transaction();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ================================================================
// 로그 및 시스템
// ================================================================

app.get("/logs", (req, res) => {
    try {
        const spendLogs    = db.prepare("SELECT * FROM spend_log ORDER BY spentAt DESC LIMIT 100").all();
        const playLogs     = db.prepare("SELECT * FROM daily_play_log ORDER BY id DESC LIMIT 100").all();
        const academicLogs = db.prepare("SELECT * FROM academic_change_log ORDER BY createdAt DESC LIMIT 100").all();
        res.render("logs", { spendLogs, playLogs, academicLogs, page: "logs" });
    } catch (e) {
        res.render("logs", { spendLogs: [], playLogs: [], academicLogs: [], page: "logs" });
    }
});

app.get("/system", (req, res) => res.render("system", { page: "system" }));

// 현재 서버 시간(오프셋 적용) 조회
app.get("/system/server-time", (req, res) => {
    try {
        const row = db.prepare("SELECT value FROM server_config WHERE key = 'time_offset_ms'").get();
        const offsetMs = row ? parseInt(row.value, 10) : 0;
        const serverNow = new Date(Date.now() + offsetMs);
        res.json({ success: true, serverTime: serverNow.toISOString(), offsetMs, realTime: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 특정 날짜/시간으로 서버 시간 설정
app.post("/system/set-server-time", (req, res) => {
    try {
        const { targetDatetime } = req.body; // ISO string or "YYYY-MM-DDTHH:mm"
        const target = new Date(targetDatetime);
        if (isNaN(target.getTime())) return res.status(400).json({ error: "잘못된 날짜 형식입니다." });
        const offsetMs = target.getTime() - Date.now();
        db.prepare("INSERT OR REPLACE INTO server_config (key, value) VALUES ('time_offset_ms', ?)").run(String(offsetMs));
        res.json({ success: true, serverTime: target.toISOString(), offsetMs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 서버 시간 실제 시간으로 초기화
app.post("/system/reset-server-time", (req, res) => {
    try {
        db.prepare("INSERT OR REPLACE INTO server_config (key, value) VALUES ('time_offset_ms', '0')").run();
        res.json({ success: true, serverTime: new Date().toISOString(), offsetMs: 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.post("/system/reset-db", (req, res) => {
    const { exec } = require("child_process");
    
    try {
        // 1. 트랜잭션을 통해 유저 관련 테이블 및 로그성 데이터만 선별 삭제
        const deleteGameUserData = db.transaction(() => {
            const dynamicTables = [
                "users",
                "login_snapshots",
                "school_snapshots",
                "daily_play_log",
                "daily_reset_log",
                "spend_log",
                "academic_attendance",
                "academic_assignment",
                "academic_change_log",
                "user_inventory",
                "user_collection",
                "dream_shop"
            ];
            
            for (const table of dynamicTables) {
                const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
                if (tableExists) {
                    db.prepare(`DELETE FROM "${table}"`).run();
                    db.prepare("DELETE FROM sqlite_sequence WHERE name=?").run(table);
                }
            }
        });

        const deleteSchoolUserData = schoolDb.transaction(() => {
            const dynamicTables = [
                "attendance",
                "assignment"
            ];
            
            for (const table of dynamicTables) {
                const tableExists = schoolDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
                if (tableExists) {
                    schoolDb.prepare(`DELETE FROM "${table}"`).run();
                    schoolDb.prepare("DELETE FROM sqlite_sequence WHERE name=?").run(table);
                }
            }
        });

        // 삭제 트랜잭션 실행
        deleteGameUserData();
        deleteSchoolUserData();
        
        // 슈퍼 계정 데이터 다시 생성
        ensureSuperAccount();

        console.log("[Admin] 유저 데이터 및 로그 초기화 완료 (아이템 도감 및 기본 설정 정보 보존)");

        // 2. 타 서버(game, school) 중지 시도 (PM2 환경) 후 인메모리 완전 초기화를 위해 프로세스 안전 재시작
        exec("pm2 stop game-server school-server", (stopErr) => {
            if (stopErr) console.warn("[Admin] 타 서버 중지 중 경고 (이미 중지되었을 수 있음):", stopErr.message);

            try {
                // 현재 DB 연결 닫기
                db.close();
                schoolDb.close();

                res.json({ success: true, message: "유저 데이터 초기화 완료 (아이템 도감 정보 보존). 서버가 곧 재시작됩니다." });
            } catch (err) {
                console.error("[Admin] DB 닫기 실패:", err.message);
                res.status(500).json({ error: "DB 초기화 진행 중 오류가 발생했습니다: " + err.message });
            } finally {
                // 3. 1초 뒤 모든 서버 재시작 (PM2가 admin-server도 다시 살림)
                setTimeout(() => {
                    exec("pm2 start game-server school-server", () => {
                        process.exit(0);
                    });
                }, 1000);
            }
        });
    } catch (err) {
        console.error("[Admin] 초기화 루틴 치명적 에러:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Admin Dashboard running on http://localhost:${PORT}`));