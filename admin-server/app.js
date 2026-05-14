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

        db.exec(`
            CREATE TABLE IF NOT EXISTS item_definitions (
                itemCode     TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                description  TEXT DEFAULT '',
                itemType     TEXT NOT NULL DEFAULT 'relic',
                cosmeticSlot TEXT,
                createdAt    TEXT DEFAULT (datetime('now'))
            )
        `);

        db.exec(`
            CREATE TABLE IF NOT EXISTS item_options (
                optionCode   TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                description  TEXT DEFAULT '',
                valueType    TEXT NOT NULL DEFAULT 'multiplier',
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

        db.prepare(`
            INSERT OR IGNORE INTO item_options (optionCode, name, description, valueType, defaultValue)
            VALUES
                ('CURRENCY_EXTRA_RATE',     'Extra 재화 배율',       'Extra 재화 획득량 배율 증가',    'multiplier', 1.2),
                ('CURRENCY_EXP_RATE',       'EXP 배율',              'EXP 획득량 배율 증가',           'multiplier', 1.2),
                ('CURRENCY_ACADEMIC_RATE',  'Academic 재화 배율',    'Academic 재화 획득량 배율 증가', 'multiplier', 1.2),
                ('REWARD_ATTENDANCE_BONUS', '출석 보상 증가',        '출석 시 보상 추가 지급',         'flat',       50.0),
                ('REWARD_ASSIGNMENT_BONUS', '과제 보상 증가',        '과제 제출 시 보상 추가 지급',    'flat',       30.0)
        `).run();

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
    } catch (err) {
        console.error("[Admin] DB 연결/초기화 실패:", err.message);
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
        } catch (e) {}
        try {
            collections = db.prepare(`
                SELECT cd.*, IFNULL(uc.isUnlocked, 0) as isUnlocked, uc.unlockedAt
                FROM collection_definitions cd
                LEFT JOIN user_collection uc ON cd.collectionCode = uc.collectionCode AND uc.userId = ?
            `).all(userId);
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
        const students = schoolDb.prepare(`
            SELECT userId,
                (SELECT COUNT(*) FROM attendance WHERE userId = s.userId AND status = '출석') as attCount,
                (SELECT COUNT(*) FROM assignment WHERE userId = s.userId AND status = '제출') as asgnCount
            FROM (
                SELECT DISTINCT userId FROM attendance
                UNION
                SELECT DISTINCT userId FROM assignment
            ) s
        `).all();

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
        const gameUser = db.prepare("SELECT userId FROM users WHERE userId = ?").get(userId);

        res.render("academic-detail", { userId, attendance, assignments, gameUser, page: "academic" });
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
        schoolDb.prepare(
            "UPDATE attendance SET status = ? WHERE id = ? AND userId = ?"
        ).run(status, id, userId);
        if (status === "출석") await triggerRewardSync(userId, "attendance");
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/academic/:userId/attendance/delete", async (req, res) => {
    const { userId } = req.params;
    const { id } = req.body;
    try {
        schoolDb.prepare(
            "DELETE FROM attendance WHERE id = ? AND userId = ?"
        ).run(id, userId);
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
        schoolDb.prepare(
            "UPDATE assignment SET status = ? WHERE id = ? AND userId = ?"
        ).run(status, id, userId);
        if (status === "제출") await triggerRewardSync(userId, "assignment");
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/academic/:userId/assignment/delete", async (req, res) => {
    const { userId } = req.params;
    const { id } = req.body;
    try {
        schoolDb.prepare(
            "DELETE FROM assignment WHERE id = ? AND userId = ?"
        ).run(id, userId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 학번 추가 (userId 기준)
app.post("/academic/add-student", (req, res) => {
    const { userId } = req.body;
    try {
        schoolDb.prepare(
            "INSERT OR IGNORE INTO attendance (userId, week, status) VALUES (?, 0, '결석')"
        ).run(userId);
        res.redirect(`/academic/${userId}`);
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
        db.prepare("DELETE FROM user_inventory WHERE id = ? AND userId = ?").run(id, userId);
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
            db.prepare("DELETE FROM user_collection WHERE userId = ?").run(userId);
            if (unlockedCodes && unlockedCodes.length > 0) {
                const insert = db.prepare(
                    "INSERT INTO user_collection (userId, collectionCode, isUnlocked, unlockedAt) VALUES (?, ?, 1, datetime('now'))"
                );
                for (const code of unlockedCodes) insert.run(userId, code);
            }
        });
        transaction();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
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

app.post("/system/reset-db", (req, res) => {
    const fs = require("fs");
    try {
        db.close();
        schoolDb.close();
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        if (fs.existsSync(schoolDbPath)) fs.unlinkSync(schoolDbPath);
        setTimeout(() => process.exit(0), 1000);
        res.json({ success: true, message: "DB 초기화 완료. 서버가 재시작됩니다." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Admin Dashboard running on http://localhost:${PORT}`));