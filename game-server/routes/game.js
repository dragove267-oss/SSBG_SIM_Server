const express = require("express");
const axios = require("axios");
const router = express.Router();
const db = require("../database/db");
const userService = require("../services/userService");
const { getOrCreateUser, applySchoolReward, spendCurrency, gainCurrency, purchaseItem, getUserItems, getSpendLog } = require("../services/userService");

// 1. 학교서버 → 게임서버 웹훅
router.post("/school-webhook", (req, res) => {
  const { userId, attendanceCount, assignmentCount } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "userId required" });
  }

  try {
    const result = applySchoolReward(userId, attendanceCount, assignmentCount);
    res.json({
      success: true,
      user: result.user,
      delta: result.delta,
      hasChange: result.hasChange
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. 클라이언트 로그인
router.post("/login", (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "userId required" });
  }

  try {
    const user = getOrCreateUser(userId);

    let lastSnapshot = null;
    try {
      lastSnapshot = db.prepare(
        "SELECT * FROM login_snapshots WHERE userId = ?"
      ).get(userId);
    } catch (e) {
      console.log("snapshot table 없음 or 오류:", e.message);
    }

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
    } catch (e) {
      console.log("snapshot 저장 실패:", e.message);
    }

    res.json({
      success: true,
      user: user,   // 기존 웹/대시보드용
      Data: user,   // 언리얼 블루프린트용
      delta: delta, // 기존 웹용
      Delta: delta, // 언리얼 블루프린트용
      hasChange: hasChange
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3. 재화 차감 요청
router.post("/spend-currency", (req, res) => {
  const { userId, currencyType, amount } = req.body;

  if (!userId || !currencyType || amount == null) {
    return res.status(400).json({ error: "userId, currencyType, amount required" });
  }

  try {
    const result = spendCurrency(userId, currencyType, amount);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3.5. 재화 획득 요청
router.post("/currency/gain", (req, res) => {
  const { userId, currencyType, amount } = req.body;

  if (!userId || !currencyType || amount == null) {
    return res.status(400).json({ success: false, error: "userId, currencyType, amount required" });
  }

  try {
    const result = userService.gainCurrency(userId, currencyType, amount);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. 유저 상태 조회
router.get("/user/:userId", (req, res) => {
  const { userId } = req.params;

  try {
    const user = getOrCreateUser(userId);
    res.json({ success: true, user: user, Data: user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. 하루 정산
router.post("/daily-summary", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  try {
    const now = new Date();
    const nextReset = new Date(now);
    nextReset.setUTCHours(6, 0, 0, 0);
    if (now.getUTCHours() >= 6) {
      nextReset.setUTCDate(nextReset.getUTCDate() + 1);
    }

    const user = getOrCreateUser(userId);

    let playStats = {
      totalExp: 0, totalAcademicCurrency: 0,
      totalExtraCurrency: 0, totalIdleCurrency: 0, playTime: 0
    };
    try {
      playStats = db.prepare(`
        SELECT
          COALESCE(SUM(exp_gained), 0)                AS totalExp,
          COALESCE(SUM(academic_currency_gained), 0)  AS totalAcademicCurrency,
          COALESCE(SUM(extra_currency_gained), 0)     AS totalExtraCurrency,
          COALESCE(SUM(idle_currency_gained), 0)      AS totalIdleCurrency,
          COALESCE(SUM(play_minutes), 0)              AS playTime
        FROM daily_play_log
        WHERE userId = ? AND date = date('now')
      `).get(userId);
    } catch (e) {
      console.log("daily_play_log 오류:", e.message);
    }

    res.json({
      success: true,
      user: user,
      Data: user,
      time: {
        summaryAt:         now.toISOString(),
        nextResetAt:       nextReset.toISOString(),
        secondsUntilReset: Math.floor((nextReset - now) / 1000),
      },
      todayStats: {
        expGained:              playStats.totalExp,
        academicCurrencyGained: playStats.totalAcademicCurrency,
        extraCurrencyGained:    playStats.totalExtraCurrency,
        idleCurrencyGained:     playStats.totalIdleCurrency,
        playTimeMinutes:        playStats.playTime,
      }
    });
  } catch (err) {
    console.error("DAILY SUMMARY ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 6. 정산 완료 처리
router.post("/daily-reset", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  try {
    const alreadyReset = db.prepare(`
      SELECT * FROM daily_reset_log
      WHERE userId = ? AND date(resetAt) = date('now')
    `).get(userId);

    if (alreadyReset) {
      const user = getOrCreateUser(userId);
      return res.json({
        success: false,
        message: "Already reset today",
        user: user,
        Data: user
      });
    }

    // 학교서버에서 최신 데이터 가져오기
    const attendanceRes = await axios.get(`http://localhost:4000/attendance?userId=${userId}`);
    const assignmentRes = await axios.get(`http://localhost:4000/assignment?userId=${userId}`);

    const attendanceCount = attendanceRes.data.attendance.filter(a => a.status === "출석").length;
    const assignmentCount = assignmentRes.data.assignment.filter(a => a.status === "제출").length;

    const result = applySchoolReward(userId, attendanceCount, assignmentCount);

    db.prepare(
      "INSERT INTO daily_reset_log (userId, resetAt) VALUES (?, datetime('now'))"
    ).run(userId);

    res.json({
      success: true,
      user: result.user,
      Data: result.user,
      delta: result.delta,
      Delta: result.delta,
      hasChange: result.hasChange,
      readyForDreamShop: true
    });

  } catch (err) {
    console.error("DAILY RESET ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 7. 아이템 구매
router.post("/purchase", (req, res) => {
  const { userId, itemId } = req.body;
  if (!userId || !itemId) {
    return res.status(400).json({ error: "userId, itemId required" });
  }

  try {
    const result = purchaseItem(userId, itemId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. 보유 아이템 조회
router.get("/items/:userId", (req, res) => {
  try {
    const items = getUserItems(req.params.userId);
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. 소모 이력 조회
router.get("/spend-log/:userId", (req, res) => {
  try {
    const log = getSpendLog(req.params.userId);
    res.json({ success: true, log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. 아이템 등록 (관리자용)
router.post("/admin/item", (req, res) => {
  const { itemId, name, currencyType, price, description } = req.body;
  const validTypes = ["academicCurrency", "extraCurrency", "idleCurrency", "exp"];

  if (!itemId || !name || !validTypes.includes(currencyType) || price == null) {
    return res.status(400).json({ error: "itemId, name, currencyType, price required" });
  }

  try {
    db.prepare(`
      INSERT INTO items (itemId, name, currencyType, price, description)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(itemId) DO UPDATE SET
        name         = excluded.name,
        currencyType = excluded.currencyType,
        price        = excluded.price,
        description  = excluded.description
    `).run(itemId, name, currencyType, price, description || "");

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. [Admin] 유저 리스트 조회
router.get("/admin/users", (req, res) => {
  try {
    const users = db.prepare("SELECT * FROM users ORDER BY updatedAt DESC").all();
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12. [Admin] 유저 데이터 직접 수정 (값 덮어쓰기)
router.post("/admin/user/set-stats", (req, res) => {
  const { userId, stats } = req.body; // stats: { academicCurrency, extraCurrency, idleCurrency, exp }
  
  if (!userId || !stats) {
    return res.status(400).json({ success: false, error: "userId and stats required" });
  }

  try {
    const stmt = db.prepare(`
      UPDATE users 
      SET academicCurrency = ?, 
          extraCurrency = ?, 
          idleCurrency = ?, 
          exp = ?,
          updatedAt = datetime('now')
      WHERE userId = ?
    `);
    
    const result = stmt.run(
      stats.academicCurrency,
      stats.extraCurrency,
      stats.idleCurrency,
      stats.exp,
      userId
    );

    if (result.changes > 0) {
      const updatedUser = db.prepare("SELECT * FROM users WHERE userId = ?").get(userId);
      res.json({ success: true, user: updatedUser });
    } else {
      res.status(404).json({ success: false, error: "User not found" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;