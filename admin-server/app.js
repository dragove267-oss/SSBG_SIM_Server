const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3001;
const GAME_SERVER_URL = "http://localhost:3000";

// DB 경로 설정
const dbPath = path.join(__dirname, "..", "game-server", "database", "game.db");
const schoolDbPath = path.join(__dirname, "..", "school-server", "database", "school.db");

let db, schoolDb;

function connectDBs() {
    try {
        db = new Database(dbPath);
        schoolDb = new Database(schoolDbPath);
        
        // 1. 게임 서버용 기본 테이블 및 컬럼 생성 (studentId 포함)
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                userId           TEXT PRIMARY KEY,
                studentId        TEXT UNIQUE DEFAULT NULL,
                academicCurrency INTEGER DEFAULT 0,
                extraCurrency    INTEGER DEFAULT 0,
                idleCurrency     INTEGER DEFAULT 0,
                exp              INTEGER DEFAULT 0,
                updatedAt        TEXT DEFAULT (datetime('now'))
            )
        `);
        
        db.exec(`
            CREATE TABLE IF NOT EXISTS item_definitions (
                itemCode    TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT DEFAULT '',
                itemType    TEXT NOT NULL DEFAULT 'relic',
                cosmeticSlot TEXT,
                createdAt   TEXT DEFAULT (datetime('now'))
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

        // 기초 데이터 (아이템 옵션) 삽입
        db.prepare(`
            INSERT OR IGNORE INTO item_options (optionCode, name, description, valueType, defaultValue)
            VALUES
                ('CURRENCY_EXTRA_RATE',     'Extra 재화 배율',       'Extra 재화 획득량 배율 증가',    'multiplier', 1.2),
                ('CURRENCY_EXP_RATE',       'EXP 배율',              'EXP 획득량 배율 증가',           'multiplier', 1.2),
                ('CURRENCY_ACADEMIC_RATE',  'Academic 재화 배율',    'Academic 재화 획득량 배율 증가', 'multiplier', 1.2),
                ('REWARD_ATTENDANCE_BONUS', '출석 보상 증가',        '출석 시 보상 추가 지급',         'flat',       50.0),
                ('REWARD_ASSIGNMENT_BONUS', '과제 보상 증가',        '과제 제출 시 보상 추가 지급',    'flat',       30.0)
        `).run();

        // 2. 학사 서버용 테이블 생성
        schoolDb.exec(`
            CREATE TABLE IF NOT EXISTS attendance (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                studentId  TEXT NOT NULL,
                week       INTEGER NOT NULL,
                status     TEXT NOT NULL CHECK(status IN ('출석', '지각', '조퇴', '결석', '미제출')),
                recordedAt TEXT DEFAULT (datetime('now')),
                UNIQUE(studentId, week)
            )
        `);
        
        schoolDb.exec(`
            CREATE TABLE IF NOT EXISTS assignment (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                studentId  TEXT NOT NULL,
                name       TEXT NOT NULL,
                status     TEXT NOT NULL CHECK(status IN ('제출', '미제출')),
                recordedAt TEXT DEFAULT (datetime('now')),
                UNIQUE(studentId, name)
            )
        `);
        
        console.log("[Admin] Databases connected and fully initialized with schema.");
    } catch (err) { console.error("[Admin] DB 연결/초기화 실패:", err.message); }
}
connectDBs();

// 보상 동기화 함수
async function triggerRewardSyncByStudentId(studentId, type) {
    try {
        const user = db.prepare("SELECT userId FROM users WHERE studentId = ?").get(studentId);
        if (user) {
            await axios.post(`${GAME_SERVER_URL}/api/admin/apply-reward`, { userId: user.userId, type });
            console.log(`[Admin-Sync] 보상 동기화 요청 (${type}): ${user.userId}`);
        }
    } catch (err) { console.error(`[Admin-Sync] 동기화 실패: ${err.message}`); }
}

async function triggerRewardSyncByUserId(userId, type) {
    try {
        await axios.post(`${GAME_SERVER_URL}/api/admin/apply-reward`, { userId, type });
        console.log(`[Admin-Sync] 보상 동기화 요청 (${type}): ${userId}`);
    } catch (err) { console.error(`[Admin-Sync] 동기화 실패: ${err.message}`); }
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

// --- Routes ---

app.get("/", (req, res) => {
    let userCount = 0; let recentLogs = [];
    try {
        userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
        recentLogs = db.prepare("SELECT * FROM spend_log ORDER BY spentAt DESC LIMIT 5").all();
    } catch (e) {}
    res.render("index", { userCount, recentLogs, page: 'dashboard' });
});

app.get("/users", (req, res) => {
    const search = req.query.search || "";
    let users = [];
    try {
        if (search) users = db.prepare("SELECT * FROM users WHERE userId LIKE ? OR studentId LIKE ?").all(`%${search}%`, `%${search}%`);
        else users = db.prepare("SELECT * FROM users").all();
    } catch (e) {}
    res.render("users", { users, search, page: 'users' });
});

app.get("/users/:userId", (req, res) => {
    const { userId } = req.params;
    try {
        const user = db.prepare("SELECT * FROM users WHERE userId = ?").get(userId);
        if (!user) return res.status(404).render("error", { message: "유저를 찾을 수 없습니다." });
        let inventory = [], collections = [];
        try { inventory = db.prepare(`SELECT ui.*, id.name, id.itemType FROM user_inventory ui JOIN item_definitions id ON ui.itemCode = id.itemCode WHERE ui.userId = ? ORDER BY ui.slotIndex ASC`).all(userId); } catch (e) {}
        try { collections = db.prepare(`SELECT cd.*, IFNULL(uc.isUnlocked, 0) as isUnlocked, uc.unlockedAt FROM collection_definitions cd LEFT JOIN user_collection uc ON cd.collectionCode = uc.collectionCode AND uc.userId = ?`).all(userId); } catch (e) {}
        res.render("user-detail", { user, inventory, collections, page: 'users' });
    } catch (err) { res.status(500).send(err.message); }
});

app.post("/users/:userId/update", (req, res) => {
    const { userId } = req.params;
    const { studentId, academicCurrency, extraCurrency, idleCurrency, exp } = req.body;
    try {
        db.prepare(`UPDATE users SET studentId = ?, academicCurrency = ?, extraCurrency = ?, idleCurrency = ?, exp = ?, updatedAt = datetime('now') WHERE userId = ?`).run(studentId || null, academicCurrency, extraCurrency, idleCurrency, exp, userId);
        res.redirect(`/users/${userId}?success=true`);
    } catch (err) { res.status(500).send(err.message); }
});

// --- 학사 데이터 관리 ---

app.get("/academic", (req, res) => {
    try {
        // 1. 학사 서버에서 학번 리스트 및 요약 정보 조회
        const students = schoolDb.prepare(`
            SELECT studentId, 
            (SELECT COUNT(*) FROM attendance WHERE studentId = s.studentId AND status = '출석') as attCount,
            (SELECT COUNT(*) FROM assignment WHERE studentId = s.studentId AND status = '제출') as asgnCount
            FROM (SELECT DISTINCT studentId FROM attendance UNION SELECT DISTINCT studentId FROM assignment) s
        `).all();

        // 2. 게임 서버 DB에서 학번-유저 매핑 정보 가져오기
        const mappings = db.prepare("SELECT userId, studentId FROM users WHERE studentId IS NOT NULL").all();
        const mappingMap = {};
        mappings.forEach(m => { mappingMap[m.studentId] = m.userId; });

        // 3. 데이터 결합
        const studentsWithUser = students.map(s => ({
            ...s,
            userId: mappingMap[s.studentId] || null
        }));

        res.render("academic", { students: studentsWithUser, page: 'academic' });
    } catch (e) { 
        console.error("[Admin] 학사 목록 조회 에러:", e.message);
        res.render("academic", { students: [], page: 'academic' }); 
    }
});

app.get("/academic/:studentId", (req, res) => {
    const { studentId } = req.params;
    try {
        const attendance = schoolDb.prepare("SELECT * FROM attendance WHERE studentId = ? ORDER BY week ASC").all(studentId);
        const assignments = schoolDb.prepare("SELECT * FROM assignment WHERE studentId = ? ORDER BY id ASC").all(studentId);
        const mappedUser = db.prepare("SELECT userId FROM users WHERE studentId = ?").get(studentId);
        res.render("academic-detail", { studentId, attendance, assignments, mappedUser, page: 'academic' });
    } catch (err) { res.status(500).send(err.message); }
});

app.post("/academic/:studentId/attendance/add", async (req, res) => {
    const { studentId } = req.params; const { week, status } = req.body;
    try {
        schoolDb.prepare("INSERT INTO attendance (studentId, week, status) VALUES (?, ?, ?)").run(studentId, week, status);
        await triggerRewardSyncByStudentId(studentId, 'attendance');
        res.redirect(`/academic/${studentId}?success=added`);
    } catch (err) { res.status(500).send(err.message); }
});

app.post("/academic/:studentId/attendance/update", async (req, res) => {
    const { studentId } = req.params; const { id, status } = req.body;
    try {
        schoolDb.prepare("UPDATE attendance SET status = ? WHERE id = ? AND studentId = ?").run(status, id, studentId);
        if (status === '출석') await triggerRewardSyncByStudentId(studentId, 'attendance');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/academic/:studentId/attendance/delete", async (req, res) => {
    const { studentId } = req.params; const { id } = req.body;
    try {
        schoolDb.prepare("DELETE FROM attendance WHERE id = ? AND studentId = ?").run(id, studentId);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/academic/:studentId/assignment/add", async (req, res) => {
    const { studentId } = req.params; const { name, status } = req.body;
    try {
        schoolDb.prepare("INSERT INTO assignment (studentId, name, status) VALUES (?, ?, ?)").run(studentId, name, status);
        await triggerRewardSyncByStudentId(studentId, 'assignment');
        res.redirect(`/academic/${studentId}?success=added`);
    } catch (err) { res.status(500).send(err.message); }
});

app.post("/academic/:studentId/assignment/update", async (req, res) => {
    const { studentId } = req.params; const { id, status } = req.body;
    try {
        schoolDb.prepare("UPDATE assignment SET status = ? WHERE id = ? AND studentId = ?").run(status, id, studentId);
        if (status === '제출') await triggerRewardSyncByStudentId(studentId, 'assignment');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/academic/:studentId/assignment/delete", async (req, res) => {
    const { studentId } = req.params; const { id } = req.body;
    try {
        schoolDb.prepare("DELETE FROM assignment WHERE id = ? AND studentId = ?").run(id, studentId);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/academic/add-student", (req, res) => {
    const { studentId } = req.body;
    try {
        schoolDb.prepare("INSERT OR IGNORE INTO attendance (studentId, week, status) VALUES (?, 0, '결석')").run(studentId);
        res.redirect(`/academic/${studentId}`);
    } catch (err) { res.status(500).send(err.message); }
});

// --- 인벤토리 및 도감 ---

app.post("/users/:userId/inventory/add", (req, res) => {
    const { userId } = req.params;
    const { itemCode, slotIndex } = req.body;
    try {
        db.prepare("INSERT INTO user_inventory (userId, itemCode, slotIndex, isEquipped) VALUES (?, ?, ?, 0)").run(userId, itemCode, slotIndex);
        res.redirect(`/users/${userId}?success=item_added`);
    } catch (err) { res.status(500).send(err.message); }
});

app.post("/users/:userId/inventory/delete", (req, res) => {
    const { userId } = req.params;
    const { id } = req.body;
    try {
        db.prepare("DELETE FROM user_inventory WHERE id = ? AND userId = ?").run(id, userId);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/users/:userId/collection/save", (req, res) => {
    const { userId } = req.params;
    const { unlockedCodes } = req.body;
    try {
        const transaction = db.transaction(() => {
            db.prepare("DELETE FROM user_collection WHERE userId = ?").run(userId);
            if (unlockedCodes && unlockedCodes.length > 0) {
                const insert = db.prepare("INSERT INTO user_collection (userId, collectionCode, isUnlocked, unlockedAt) VALUES (?, ?, 1, datetime('now'))");
                for (const code of unlockedCodes) insert.run(userId, code);
            }
        });
        transaction();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 로그 및 시스템 ---

app.get("/logs", (req, res) => {
    try {
        const spendLogs = db.prepare("SELECT * FROM spend_log ORDER BY spentAt DESC LIMIT 100").all();
        const playLogs = db.prepare("SELECT * FROM daily_play_log ORDER BY id DESC LIMIT 100").all();
        const academicLogs = db.prepare("SELECT * FROM academic_change_log ORDER BY createdAt DESC LIMIT 100").all();
        res.render("logs", { spendLogs, playLogs, academicLogs, page: 'logs' });
    } catch (e) { res.render("logs", { spendLogs: [], playLogs: [], academicLogs: [], page: 'logs' }); }
});

app.get("/system", (req, res) => res.render("system", { page: 'system' }));

app.post("/system/reset-db", (req, res) => {
    const fs = require("fs");
    try {
        db.close(); schoolDb.close();
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        if (fs.existsSync(schoolDbPath)) fs.unlinkSync(schoolDbPath);
        setTimeout(() => process.exit(0), 1000);
        res.json({ success: true, message: "DB 초기화 완료. 서버가 재시작됩니다." });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Admin Dashboard running on http://localhost:${PORT}`));
