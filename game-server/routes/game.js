const express = require("express");
const axios = require("axios");
const router = express.Router();
const db = require("../database/db");
const userService = require("../services/userService");
const {
  getOrCreateUser,
  applySchoolReward,
  spendCurrency,
  gainCurrency,
  purchaseItem,
  getUserItems,
  getSpendLog,
  getAcademicLog,
  syncAttendanceRecords,
  syncAssignmentRecords,
  addItemToInventory,
  equipItem,
  unequipItem,
  getInventory,
  getInventoryByType,
  getEquippedItems,
  getItemOptions,
  getUserAllOptions,
  unlockCollection,
  getCollection,
  VALID_ITEM_TYPES
} = require("../services/userService");

// ================================================================
// 헬퍼
// ================================================================

function getSecondsUntilReset() {
  const now = new Date();
  const nextReset = new Date(now);
  nextReset.setUTCHours(6, 0, 0, 0);
  if (now.getUTCHours() >= 6) nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  return Math.floor((nextReset - now) / 1000);
}

function isResetDoneToday(userId) {
  const row = db.prepare(`
    SELECT * FROM daily_reset_log
    WHERE userId = ? AND date(resetAt) = date('now')
  `).get(userId);
  return !!row;
}

// ================================================================
// 학교 웹훅
// ================================================================

router.post("/school-webhook", (req, res) => {
  const { userId, attendanceCount, assignmentCount } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });
  try {
    const result = applySchoolReward(userId, attendanceCount, assignmentCount);
    res.json({ success: true, user: result.user, delta: result.delta, hasChange: result.hasChange });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 로그인 (학번 검증 포함)
// ================================================================

router.post("/login", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  try {
    // 학교서버에서 학번 검증
    try {
      const verifyRes = await axios.post("http://localhost:4000/verify-student", { userId });
      if (!verifyRes.data.success) {
        return res.status(401).json({ success: false, message: "등록되지 않은 학번입니다." });
      }
    } catch (verifyErr) {
      // 학교서버 다운 시 경고만 남기고 계속 진행
      console.warn("[Login] 학교서버 검증 실패 - 스킵:", verifyErr.message);
    }

    const user = getOrCreateUser(userId);

    let lastSnapshot = null;
    try {
      lastSnapshot = db.prepare("SELECT * FROM login_snapshots WHERE userId = ?").get(userId);
    } catch (e) { console.log("snapshot 오류:", e.message); }

    const delta = {
      academicCurrency: lastSnapshot ? user.academicCurrency - lastSnapshot.academicCurrency : 0,
      extraCurrency:    lastSnapshot ? user.extraCurrency    - lastSnapshot.extraCurrency    : 0,
      idleCurrency:     lastSnapshot ? user.idleCurrency     - lastSnapshot.idleCurrency     : 0,
      exp:              lastSnapshot ? user.exp              - lastSnapshot.exp              : 0,
    };
    const hasChange = Object.values(delta).some(v => v > 0);

    try {
      db.prepare(`
        INSERT INTO login_snapshots (userId, academicCurrency, extraCurrency, idleCurrency, exp)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(userId) DO UPDATE SET
          academicCurrency = excluded.academicCurrency,
          extraCurrency    = excluded.extraCurrency,
          idleCurrency     = excluded.idleCurrency,
          exp              = excluded.exp
      `).run(userId, user.academicCurrency, user.extraCurrency, user.idleCurrency, user.exp);
    } catch (e) { console.log("snapshot 저장 실패:", e.message); }

    res.json({
      success: true,
      user, Data: {
        academicCurrency: user.academicCurrency,
        extraCurrency:    user.extraCurrency,
        idleCurrency:     user.idleCurrency,
        exp:              user.exp,
        userId:           user.userId
      },
      delta, Delta: delta, hasChange,
      resetDoneToday:    isResetDoneToday(userId),
      secondsUntilReset: getSecondsUntilReset()
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 재화
// ================================================================

router.post("/spend-currency", (req, res) => {
  const { userId, currencyType, amount } = req.body;
  if (!userId || !currencyType || amount == null)
    return res.status(400).json({ error: "userId, currencyType, amount required" });
  try {
    res.json(spendCurrency(userId, currencyType, amount));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/currency/gain", (req, res) => {
  const { userId, currencyType, amount } = req.body;
  if (!userId || !currencyType || amount == null)
    return res.status(400).json({ success: false, error: "userId, currencyType, amount required" });
  try {
    res.json(userService.gainCurrency(userId, currencyType, amount));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================================================
// 유저 상태
// ================================================================

router.get("/user/:userId", (req, res) => {
  try {
    const user = getOrCreateUser(req.params.userId);
    res.json({ success: true, user, Data: user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 정산
// ================================================================

router.post("/daily-summary", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });
  try {
    const user = getOrCreateUser(userId);
    let playStats = { totalExp: 0, totalAcademicCurrency: 0, totalExtraCurrency: 0, totalIdleCurrency: 0, playTime: 0 };
    try {
      playStats = db.prepare(`
        SELECT
          COALESCE(SUM(exp_gained), 0)                AS totalExp,
          COALESCE(SUM(academic_currency_gained), 0)  AS totalAcademicCurrency,
          COALESCE(SUM(extra_currency_gained), 0)     AS totalExtraCurrency,
          COALESCE(SUM(idle_currency_gained), 0)      AS totalIdleCurrency,
          COALESCE(SUM(play_minutes), 0)              AS playTime
        FROM daily_play_log WHERE userId = ? AND date = date('now')
      `).get(userId);
    } catch (e) { console.log("daily_play_log 오류:", e.message); }

    res.json({
      success: true, user, Data: user,
      resetDoneToday:    isResetDoneToday(userId),
      secondsUntilReset: getSecondsUntilReset(),
      todayStats: {
        expGained:              playStats.totalExp,
        academicCurrencyGained: playStats.totalAcademicCurrency,
        extraCurrencyGained:    playStats.totalExtraCurrency,
        idleCurrencyGained:     playStats.totalIdleCurrency,
        playTimeMinutes:        playStats.playTime,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/daily-reset", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });
  try {
    if (isResetDoneToday(userId)) {
      const user = getOrCreateUser(userId);
      return res.json({ success: false, message: "Already reset today", user, Data: user,
        resetDoneToday: true, secondsUntilReset: getSecondsUntilReset() });
    }

    // userId로 학교서버 조회 통일
    const attendanceRes = await axios.get(`http://localhost:4000/attendance?userId=${userId}`);
    const assignmentRes = await axios.get(`http://localhost:4000/assignment?userId=${userId}`);
    const attendanceList = attendanceRes.data.attendance;
    const assignmentList = assignmentRes.data.assignment;

    syncAttendanceRecords(userId, attendanceList);
    syncAssignmentRecords(userId, assignmentList);

    const attendanceCount = attendanceList.filter(a => a.status === "출석").length;
    const assignmentCount = assignmentList.filter(a => a.status === "제출").length;
    const result = applySchoolReward(userId, attendanceCount, assignmentCount);

    db.prepare("INSERT INTO daily_reset_log (userId, resetAt) VALUES (?, datetime('now'))").run(userId);

    res.json({
      success: true, user: result.user, Data: result.user,
      delta: result.delta, Delta: result.delta, hasChange: result.hasChange,
      resetDoneToday: true, secondsUntilReset: getSecondsUntilReset(), readyForDreamShop: true
    });
  } catch (err) {
    console.error("DAILY RESET ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 서버 시간
// ================================================================

router.get("/server-time", (req, res) => {
  const now = new Date();
  res.json({
    utcHour: now.getUTCHours(), utcDay: now.getUTCDate(),
    utcMonth: now.getUTCMonth() + 1, utcYear: now.getUTCFullYear(),
    secondsUntilReset: getSecondsUntilReset()
  });
});

// ================================================================
// 학사 로그
// ================================================================

router.get("/academic-log/:userId", (req, res) => {
  try {
    res.json({ success: true, logs: getAcademicLog(req.params.userId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 인벤토리
// ================================================================

router.get("/inventory/:userId", (req, res) => {
  try {
    res.json({ success: true, items: getInventory(req.params.userId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?type=Hat|Bag|Clothes|Theme|Friend|Consumable|relic (없으면 전체)
router.get("/inventory/:userId/tab", (req, res) => {
  const { type } = req.query;
  if (type && !VALID_ITEM_TYPES.includes(type))
    return res.status(400).json({ error: `type must be one of: ${VALID_ITEM_TYPES.join(", ")}` });
  try {
    res.json({ success: true, items: getInventoryByType(req.params.userId, type || null) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/inventory/:userId/equipped", (req, res) => {
  try {
    res.json({ success: true, items: getEquippedItems(req.params.userId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/inventory/add", (req, res) => {
  const { userId, itemCode } = req.body;
  if (!userId || !itemCode)
    return res.status(400).json({ error: "userId, itemCode required" });
  try {
    res.json(addItemToInventory(userId, itemCode));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/inventory/equip", (req, res) => {
  const { userId, itemCode } = req.body;
  if (!userId || !itemCode)
    return res.status(400).json({ error: "userId, itemCode required" });
  try {
    res.json(equipItem(userId, itemCode));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/inventory/unequip", (req, res) => {
  const { userId, itemCode } = req.body;
  if (!userId || !itemCode)
    return res.status(400).json({ error: "userId, itemCode required" });
  try {
    res.json(unequipItem(userId, itemCode));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 아이템 옵션
// ================================================================

router.get("/item-options/:itemCode", (req, res) => {
  try {
    res.json({ success: true, options: getItemOptions(req.params.itemCode) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/user-options/:userId", (req, res) => {
  try {
    res.json({ success: true, options: getUserAllOptions(req.params.userId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 도감
// ================================================================

router.get("/collection/:userId", (req, res) => {
  const { type } = req.query;
  if (type && !VALID_ITEM_TYPES.includes(type))
    return res.status(400).json({ error: `type must be one of: ${VALID_ITEM_TYPES.join(", ")}` });
  try {
    res.json({ success: true, entries: getCollection(req.params.userId, type || null) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 어드민
// ================================================================

router.post("/admin/item-definition", (req, res) => {
  const { itemCode, name, description, itemType, cosmeticSlot } = req.body;
  if (!itemCode || !name || !VALID_ITEM_TYPES.includes(itemType))
    return res.status(400).json({ error: `itemCode, name, itemType(${VALID_ITEM_TYPES.join("/")}) required` });

  try {
    db.prepare(`
      INSERT INTO item_definitions (itemCode, name, description, itemType, cosmeticSlot)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(itemCode) DO UPDATE SET
        name = excluded.name, description = excluded.description,
        itemType = excluded.itemType, cosmeticSlot = excluded.cosmeticSlot
    `).run(itemCode, name, description || "", itemType, cosmeticSlot || null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/admin/item-option", (req, res) => {
  const { itemCode, optionCode, value } = req.body;
  if (!itemCode || !optionCode || value == null)
    return res.status(400).json({ error: "itemCode, optionCode, value required" });

  try {
    const itemDef = db.prepare("SELECT * FROM item_definitions WHERE itemCode = ?").get(itemCode);
    if (!itemDef) return res.status(404).json({ error: "Item not found" });

    const optDef = db.prepare("SELECT * FROM item_options WHERE optionCode = ?").get(optionCode);
    if (!optDef) return res.status(404).json({ error: "Option not found" });

    db.prepare(`
      INSERT INTO item_definition_options (itemCode, optionCode, value)
      VALUES (?, ?, ?)
      ON CONFLICT(itemCode, optionCode) DO UPDATE SET value = excluded.value
    `).run(itemCode, optionCode, value);

    res.json({ success: true, itemCode, optionCode, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/admin/collection-definition", (req, res) => {
  const { collectionCode, itemCode, collectionType, name, description } = req.body;
  if (!collectionCode || !itemCode || !VALID_ITEM_TYPES.includes(collectionType) || !name)
    return res.status(400).json({ error: "collectionCode, itemCode, collectionType, name required" });

  try {
    db.prepare(`
      INSERT INTO collection_definitions (collectionCode, itemCode, collectionType, name, description)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(collectionCode) DO UPDATE SET
        itemCode = excluded.itemCode, collectionType = excluded.collectionType,
        name = excluded.name, description = excluded.description
    `).run(collectionCode, itemCode, collectionType, name, description || "");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/admin/users", (req, res) => {
  try {
    res.json({ success: true, users: db.prepare("SELECT * FROM users ORDER BY updatedAt DESC").all() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/admin/user/set-stats", (req, res) => {
  const { userId, stats } = req.body;
  if (!userId || !stats)
    return res.status(400).json({ success: false, error: "userId and stats required" });

  try {
    const result = db.prepare(`
      UPDATE users SET academicCurrency = ?, extraCurrency = ?, idleCurrency = ?, exp = ?,
        updatedAt = datetime('now') WHERE userId = ?
    `).run(stats.academicCurrency, stats.extraCurrency, stats.idleCurrency, stats.exp, userId);

    if (result.changes > 0) {
      res.json({ success: true, user: db.prepare("SELECT * FROM users WHERE userId = ?").get(userId) });
    } else {
      res.status(404).json({ success: false, error: "User not found" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// admin/apply-reward를 index.js에서 game.js로 이동
router.post("/admin/apply-reward", async (req, res) => {
  const { userId, type } = req.body;
  console.log(`[Admin-Sync] 보상 동기화 요청: ${userId} (${type})`);

  try {
    // 학교서버에서 최신 데이터 가져와서 로컬 DB 동기화
    const attendanceRes = await axios.get(`http://localhost:4000/attendance?userId=${userId}`);
    const assignmentRes = await axios.get(`http://localhost:4000/assignment?userId=${userId}`);

    syncAttendanceRecords(userId, attendanceRes.data.attendance);
    syncAssignmentRecords(userId, assignmentRes.data.assignment);

    // 현재 실제 유효한 개수 파악
    const currentAttendance = db.prepare(
      "SELECT COUNT(*) as count FROM academic_attendance WHERE userId = ? AND status = '출석'"
    ).get(userId).count;
    const currentAssignment = db.prepare(
      "SELECT COUNT(*) as count FROM academic_assignment WHERE userId = ? AND status = '제출'"
    ).get(userId).count;

    // 해당 타입 스냅샷을 현재보다 1 작게 강제 조정 (보상 1회 트리거)
    if (type === "attendance") {
      db.prepare("INSERT OR IGNORE INTO school_snapshots (userId, attendanceCount, assignmentCount) VALUES (?, 0, 0)").run(userId);
      db.prepare("UPDATE school_snapshots SET attendanceCount = ? WHERE userId = ?")
        .run(Math.max(0, currentAttendance - 1), userId);
    } else if (type === "assignment") {
      db.prepare("INSERT OR IGNORE INTO school_snapshots (userId, attendanceCount, assignmentCount) VALUES (?, 0, 0)").run(userId);
      db.prepare("UPDATE school_snapshots SET assignmentCount = ? WHERE userId = ?")
        .run(Math.max(0, currentAssignment - 1), userId);
    }

    const result = applySchoolReward(userId, currentAttendance, currentAssignment);
    console.log(`[Admin-Sync] 완료: ${userId}, 보상지급: ${result.hasChange}`);

    res.json({ success: true, hasChange: result.hasChange, delta: result.delta });
  } catch (err) {
    console.error("[Admin-Sync] 실패:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;