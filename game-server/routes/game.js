const express = require("express");
const axios = require("axios");
const router = express.Router();
const db = require("../database/db");
const { getServerTime, getServerToday } = require("../services/timeHelper");
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
  equipConsumable,
  unequipItem,
  getInventory,
  getInventoryByType,
  getEquippedItems,
  getItemOptions,
  getUserAllOptions,
  unlockCollection,
  getCollection,
  getUnlockedItemCodes,
  generateDreamShop,
  getDreamShop,
  buyDreamShopItem,
  craftItem,
  findRecipe,
  getShop,
  buyItem,
  VALID_ITEM_TYPES
} = require("../services/userService");

// ================================================================
// 헬퍼
// ================================================================

function getSecondsUntilReset() {
  const now = getServerTime();
  const nextReset = new Date(now);
  nextReset.setUTCHours(6, 0, 0, 0);
  if (now.getUTCHours() >= 6) nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  return Math.floor((nextReset - now) / 1000);
}

function isResetDoneToday(userId) {
  const today = getServerToday();
  const row = db.prepare(`
    SELECT * FROM daily_reset_log
    WHERE userId = ? AND date(resetAt) = ?
  `).get(userId, today);
  return !!row;
}

// ✅ userId 값을 studentId로도 포함해서 반환 (블루프린트 호환)
function userWithStudentId(user) {
  return { ...user, studentId: user.userId };
}

// ================================================================
// 학교 웹훅
// ================================================================

router.post("/school-webhook", (req, res) => {
  const { userId, attendanceCount, assignmentCount } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });
  try {
    const result = applySchoolReward(userId, attendanceCount, assignmentCount);
    res.json({
      success: true,
      user: userWithStudentId(result.user),
      delta: result.delta,
      hasChange: result.hasChange
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 로그인
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
      // ✅ studentId 포함 (블루프린트 호환)
      user: userWithStudentId(user),
      Data: {
        studentId:        user.userId,
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
    const result = spendCurrency(userId, currencyType, amount);
    if (result.current) result.current = userWithStudentId(result.current);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/currency/gain", (req, res) => {
  const { userId, currencyType, amount } = req.body;
  if (!userId || !currencyType || amount == null)
    return res.status(400).json({ success: false, error: "userId, currencyType, amount required" });
  try {
    const result = userService.gainCurrency(userId, currencyType, amount);
    if (result.current) result.current = userWithStudentId(result.current);
    res.json(result);
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
    const u = userWithStudentId(user);
    res.json({
      success: true,
      user: u,
      Data: u,
      resetDoneToday: isResetDoneToday(req.params.userId),
      secondsUntilReset: getSecondsUntilReset()
    });
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
    const user = userWithStudentId(getOrCreateUser(userId));
    let playStats = { totalExp: 0, totalAcademicCurrency: 0, totalExtraCurrency: 0, totalIdleCurrency: 0, playTime: 0 };
    try {
      playStats = db.prepare(`
        SELECT
          COALESCE(SUM(exp_gained), 0)                AS totalExp,
          COALESCE(SUM(academic_currency_gained), 0)  AS totalAcademicCurrency,
          COALESCE(SUM(extra_currency_gained), 0)     AS totalExtraCurrency,
          COALESCE(SUM(idle_currency_gained), 0)      AS totalIdleCurrency,
          COALESCE(SUM(play_minutes), 0)              AS playTime
        FROM daily_play_log WHERE userId = ? AND date = ?
      `).get(userId, getServerToday());
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
      const user = userWithStudentId(getOrCreateUser(userId));
      return res.json({ success: false, message: "Already reset today", user, Data: user,
        resetDoneToday: true, secondsUntilReset: getSecondsUntilReset() });
    }

    let attendanceCount = 0;
    let assignmentCount = 0;

    // 학교서버 호출 (실패 시 기존 스냅샷 데이터로 진행)
    try {
      const attendanceRes = await axios.get(`http://localhost:4000/attendance?userId=${userId}`);
      const assignmentRes = await axios.get(`http://localhost:4000/assignment?userId=${userId}`);
      const attendanceList = attendanceRes.data.attendance;
      const assignmentList = assignmentRes.data.assignment;

      syncAttendanceRecords(userId, attendanceList);
      syncAssignmentRecords(userId, assignmentList);

      attendanceCount = attendanceList.filter(a => a.status === "출석").length;
      assignmentCount = assignmentList.filter(a => a.status === "제출").length;
    } catch (schoolErr) {
      console.warn(`[DailyReset] 학교서버 호출 실패 - 기존 데이터로 진행: ${schoolErr.message}`);
      // 기존 스냅샷에서 카운트 가져오기
      const snapshot = db.prepare("SELECT * FROM school_snapshots WHERE userId = ?").get(userId);
      if (snapshot) {
        attendanceCount = snapshot.attendanceCount;
        assignmentCount = snapshot.assignmentCount;
      }
    }

    const result = applySchoolReward(userId, attendanceCount, assignmentCount);

    db.prepare("INSERT INTO daily_reset_log (userId, resetAt) VALUES (?, ?)").run(userId, getServerTime().toISOString());

    // ✅ 꿈상점 생성
    const dreamShop = generateDreamShop(userId);

    const user = userWithStudentId(result.user);
    res.json({
      success: true, user, Data: user,
      delta: result.delta, Delta: result.delta, hasChange: result.hasChange,
      resetDoneToday: true, secondsUntilReset: getSecondsUntilReset(),
      readyForDreamShop: true,
      dreamShop
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
  const now = getServerTime();
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
  const { userId, itemCode, inventoryId } = req.body;
  if (!userId || (!itemCode && !inventoryId))
    return res.status(400).json({ error: "userId and (itemCode or inventoryId) required" });
  try {
    res.json(equipItem(userId, itemCode, inventoryId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Consumable 전용 장착 (최대 3개, 초과 시 가장 왼쪽 해제)
router.post("/inventory/equip-consumable", (req, res) => {
  const { userId, itemCode, inventoryId } = req.body;
  if (!userId || (!itemCode && !inventoryId))
    return res.status(400).json({ error: "userId and (itemCode or inventoryId) required" });
  try {
    res.json(equipConsumable(userId, itemCode, inventoryId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/inventory/unequip", (req, res) => {
  const { userId, itemCode, inventoryId } = req.body;
  if (!userId || (!itemCode && !inventoryId))
    return res.status(400).json({ error: "userId and (itemCode or inventoryId) required" });
  try {
    res.json(unequipItem(userId, itemCode, inventoryId));
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
// 꿈상점
// ================================================================

// 오늘 꿈상점 조회
router.get("/dream-shop/:userId", (req, res) => {
  try {
    res.json(getDreamShop(req.params.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 꿈상점 아이템 구매 (itemIndex: 0부터 시작)
router.post("/dream-shop/buy", (req, res) => {
  const { userId, itemIndex } = req.body;
  if (!userId || itemIndex == null)
    return res.status(400).json({ error: "userId, itemIndex required" });
  try {
    res.json(buyDreamShopItem(userId, itemIndex));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 제작
// ================================================================

router.post("/craft", (req, res) => {
  const { userId, craftId } = req.body;
  if (!userId || !craftId)
    return res.status(400).json({ error: "userId, craftId required" });
  try {
    const result = craftItem(userId, craftId);
    if (result.current) result.current = userWithStudentId(result.current);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 재화 조합으로 레시피 찾기
// academic, extra, idle 중 사용하지 않는 재화는 0으로 보내면 됨
router.post("/craft/find", (req, res) => {
  const { academic = 0, extra = 0, idle = 0 } = req.body;
  if (academic === 0 && extra === 0 && idle === 0)
    return res.status(400).json({ error: "최소 하나의 재화를 입력해야 합니다." });
  try {
    res.json(findRecipe(academic, extra, idle));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 어드민 - 레시피 등록
router.post("/admin/craft-definition", (req, res) => {
  const { craftId, itemCode, currencyType1, cost1, currencyType2, cost2, currencyType3, cost3 } = req.body;
  const validCurrencies = ["academicCurrency", "extraCurrency", "idleCurrency"];

  if (!craftId || !itemCode || !validCurrencies.includes(currencyType1) || cost1 == null)
    return res.status(400).json({ error: "craftId, itemCode, currencyType1, cost1 required" });
  if (currencyType2 && !validCurrencies.includes(currencyType2))
    return res.status(400).json({ error: `currencyType2 must be one of: ${validCurrencies.join(", ")}` });
  if (currencyType3 && !validCurrencies.includes(currencyType3))
    return res.status(400).json({ error: `currencyType3 must be one of: ${validCurrencies.join(", ")}` });

  try {
    const itemDef = db.prepare("SELECT * FROM item_definitions WHERE itemCode = ?").get(itemCode);
    if (!itemDef) return res.status(404).json({ error: "Item not found" });

    // ✅ Consumable 타입만 등록 가능
    if (itemDef.itemType !== "Consumable")
      return res.status(400).json({ error: "소모성(Consumable) 아이템만 레시피 등록 가능합니다." });

    db.prepare(`
      INSERT INTO craft_definitions (craftId, itemCode, currencyType1, cost1, currencyType2, cost2, currencyType3, cost3)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(craftId) DO UPDATE SET
        itemCode      = excluded.itemCode,
        currencyType1 = excluded.currencyType1,
        cost1         = excluded.cost1,
        currencyType2 = excluded.currencyType2,
        cost2         = excluded.cost2,
        currencyType3 = excluded.currencyType3,
        cost3         = excluded.cost3
    `).run(craftId, itemCode, currencyType1, cost1,
           currencyType2 || null, cost2 || 0,
           currencyType3 || null, cost3 || 0);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 어드민 - 레시피 삭제
router.delete("/admin/craft-definition/:craftId", (req, res) => {
  try {
    db.prepare("DELETE FROM craft_definitions WHERE craftId = ?").run(req.params.craftId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 상점
// ================================================================

// ?type=Hat|Bag|... (없으면 전체)
router.get("/shop", (req, res) => {
  const { type } = req.query;
  if (type && !VALID_ITEM_TYPES.includes(type))
    return res.status(400).json({ error: `type must be one of: ${VALID_ITEM_TYPES.join(", ")}` });
  try {
    res.json({ success: true, items: getShop(type || null) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/shop/buy", (req, res) => {
  const { userId, shopId } = req.body;
  if (!userId || !shopId)
    return res.status(400).json({ error: "userId, shopId required" });
  try {
    const result = buyItem(userId, shopId);
    if (result.current) result.current = userWithStudentId(result.current);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 어드민 - 상점 아이템 등록
router.post("/admin/shop-definition", (req, res) => {
  const { shopId, itemCode, currencyType, price } = req.body;
  const validCurrencies = ["academicCurrency", "extraCurrency", "idleCurrency", "exp"];
  if (!shopId || !itemCode || !validCurrencies.includes(currencyType) || price == null)
    return res.status(400).json({ error: "shopId, itemCode, currencyType, price required" });

  try {
    const itemDef = db.prepare("SELECT * FROM item_definitions WHERE itemCode = ?").get(itemCode);
    if (!itemDef) return res.status(404).json({ error: "Item not found" });

    // ✅ Consumable 타입만 등록 가능
    if (itemDef.itemType !== "Consumable")
      return res.status(400).json({ error: "소모성(Consumable) 아이템만 상점 등록 가능합니다." });

    db.prepare(`
      INSERT INTO shop_definitions (shopId, itemCode, currencyType, price)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(shopId) DO UPDATE SET
        itemCode = excluded.itemCode,
        currencyType = excluded.currencyType,
        price = excluded.price
    `).run(shopId, itemCode, currencyType, price);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 어드민 - 상점 아이템 삭제
router.delete("/admin/shop-definition/:shopId", (req, res) => {
  try {
    db.prepare("DELETE FROM shop_definitions WHERE shopId = ?").run(req.params.shopId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 도감
// ================================================================

// ✅ 도감 전체 조회
// item_definitions 전체 기준, user_inventory 보유 여부로 isUnlocked 판정
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

// ✅ 해금된 itemCode 목록만 반환 (언리얼 아이템 테이블 비교용)
// = 유저가 가방에 보유한 아이템 코드 목록
router.get("/collection/:userId/unlocked", (req, res) => {
  const { type } = req.query;
  if (type && !VALID_ITEM_TYPES.includes(type))
    return res.status(400).json({ error: `type must be one of: ${VALID_ITEM_TYPES.join(", ")}` });
  try {
    const itemCodes = getUnlockedItemCodes(req.params.userId, type || null);
    res.json({ success: true, itemCodes });
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
    const users = db.prepare("SELECT * FROM users ORDER BY updatedAt DESC").all();
    res.json({ success: true, users: users.map(userWithStudentId) });
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
      const user = userWithStudentId(db.prepare("SELECT * FROM users WHERE userId = ?").get(userId));
      res.json({ success: true, user });
    } else {
      res.status(404).json({ success: false, error: "User not found" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;