const db = require("../database/db");

// 재화 지급 설정
const REWARD_CONFIG = {
  attendance: {
    extraCurrency: 100,
    exp: 30,
  },
  attendance_late: {
    exp: 15,
  },
  assignment: {
    exp: 50,
  }
};

// ================================================================
// 유저
// ================================================================

function getOrCreateUser(userId) {
  let user = db.prepare("SELECT * FROM users WHERE userId = ?").get(userId);
  if (!user) {
    db.prepare(
      `INSERT INTO users (userId, academicCurrency, extraCurrency, idleCurrency, exp)
       VALUES (?, 0, 0, 0, 0)`
    ).run(userId);
    user = db.prepare("SELECT * FROM users WHERE userId = ?").get(userId);
  }
  return user;
}

// ================================================================
// 학사
// ================================================================

function saveAcademicLog(userId, changeType, detail, deltaExtra, deltaExp) {
  db.prepare(`
    INSERT INTO academic_change_log (userId, changeType, detail, deltaExtra, deltaExp, isRead)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(userId, changeType, detail, deltaExtra || 0, deltaExp || 0);
}

function applySchoolReward(userId, newAttendance, newAssignment) {
  getOrCreateUser(userId);

  const snapshot = db.prepare(
    "SELECT * FROM school_snapshots WHERE userId = ?"
  ).get(userId) || { attendanceCount: 0, assignmentCount: 0 };

  const deltaAttendance = Math.max(0, newAttendance - snapshot.attendanceCount);
  const deltaAssignment = Math.max(0, newAssignment - snapshot.assignmentCount);

  const delta = {
    academicCurrency: 0,
    extraCurrency:    deltaAttendance * (REWARD_CONFIG.attendance.extraCurrency || 0),
    idleCurrency:     0,
    exp:              deltaAttendance * (REWARD_CONFIG.attendance.exp || 0)
                    + deltaAssignment * (REWARD_CONFIG.assignment.exp || 0),
  };

  db.prepare(`
    UPDATE users
    SET academicCurrency = academicCurrency + ?,
        extraCurrency    = extraCurrency    + ?,
        idleCurrency     = idleCurrency     + ?,
        exp              = exp              + ?,
        updatedAt        = datetime('now')
    WHERE userId = ?
  `).run(delta.academicCurrency, delta.extraCurrency, delta.idleCurrency, delta.exp, userId);

  db.prepare(`
    INSERT INTO school_snapshots (userId, attendanceCount, assignmentCount, updatedAt)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(userId) DO UPDATE SET
      attendanceCount = excluded.attendanceCount,
      assignmentCount = excluded.assignmentCount,
      updatedAt       = excluded.updatedAt
  `).run(userId, newAttendance, newAssignment);

  if (deltaAttendance > 0) {
    const detail = `출석 ${deltaAttendance}회 → Extra +${delta.extraCurrency} / EXP +${deltaAttendance * REWARD_CONFIG.attendance.exp} 획득!`;
    saveAcademicLog(userId, "attendance", detail, delta.extraCurrency, deltaAttendance * REWARD_CONFIG.attendance.exp);
  }
  if (deltaAssignment > 0) {
    const expGained = deltaAssignment * REWARD_CONFIG.assignment.exp;
    const detail = `과제 ${deltaAssignment}회 제출 → EXP +${expGained} 획득!`;
    saveAcademicLog(userId, "assignment", detail, 0, expGained);
  }

  const updated = db.prepare("SELECT * FROM users WHERE userId = ?").get(userId);
  const hasChange = Object.values(delta).some(v => v > 0);
  return { user: updated, delta, hasChange };
}

function syncAttendanceRecords(userId, attendanceList) {
  for (const item of attendanceList) {
    db.prepare(`
      INSERT INTO academic_attendance (userId, week, status)
      VALUES (?, ?, ?)
      ON CONFLICT(userId, week) DO UPDATE SET
        status     = excluded.status,
        recordedAt = datetime('now')
    `).run(userId, item.week, item.status);
  }
}

function syncAssignmentRecords(userId, assignmentList) {
  for (const item of assignmentList) {
    db.prepare(`
      INSERT INTO academic_assignment (userId, name, status)
      VALUES (?, ?, ?)
      ON CONFLICT(userId, name) DO UPDATE SET
        status     = excluded.status,
        recordedAt = datetime('now')
    `).run(userId, item.name, item.status);
  }
}

function getAcademicLog(userId) {
  const logs = db.prepare(`
    SELECT * FROM academic_change_log
    WHERE userId = ?
    ORDER BY createdAt DESC
  `).all(userId);

  db.prepare(`
    UPDATE academic_change_log
    SET isRead = 1
    WHERE userId = ? AND isRead = 0
  `).run(userId);

  return logs;
}

// ================================================================
// 재화
// ================================================================

function spendCurrency(userId, currencyType, amount) {
  const validTypes = ["academicCurrency", "extraCurrency", "idleCurrency", "exp"];
  if (!validTypes.includes(currencyType)) {
    return { success: false, message: "Invalid currency type" };
  }

  const user = getOrCreateUser(userId);
  if (user[currencyType] < amount) {
    return { success: false, message: "Not enough currency", current: user };
  }

  db.prepare(`
    UPDATE users
    SET ${currencyType} = ${currencyType} - ?,
        updatedAt = datetime('now')
    WHERE userId = ?
  `).run(amount, userId);

  return {
    success: true,
    current: db.prepare("SELECT * FROM users WHERE userId = ?").get(userId)
  };
}

function gainCurrency(userId, currencyType, amount) {
  const validTypes = ["academicCurrency", "extraCurrency", "idleCurrency", "exp"];
  if (!validTypes.includes(currencyType)) {
    return { success: false, message: "Invalid currency type" };
  }

  getOrCreateUser(userId);
  db.prepare(`
    UPDATE users
    SET ${currencyType} = ${currencyType} + ?,
        updatedAt = datetime('now')
    WHERE userId = ?
  `).run(amount, userId);

  return {
    success: true,
    current: db.prepare("SELECT * FROM users WHERE userId = ?").get(userId)
  };
}

// ================================================================
// 인벤토리 - 아이템 추가
// 아이템 획득 시 빈 슬롯에 자동 배치 + 도감 자동 해금
// ================================================================

function addItemToInventory(userId, itemCode) {
  getOrCreateUser(userId);

  // 아이템 정보 확인
  const itemDef = db.prepare(
    "SELECT * FROM item_definitions WHERE itemCode = ?"
  ).get(itemCode);
  if (!itemDef) {
    return { success: false, message: "Item not found" };
  }

  // 이미 보유 중인지 확인
  const already = db.prepare(
    "SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?"
  ).get(userId, itemCode);
  if (already) {
    return { success: false, message: "Item already owned" };
  }

  // itemType별 슬롯 범위 결정
  const slotRanges = {
    cosmetic:   { min: 0,  max: 9  },
    relic:      { min: 10, max: 19 },
    consumable: { min: 20, max: 29 }
  };
  const range = slotRanges[itemDef.itemType];

  // 빈 슬롯 찾기
  const usedSlots = db.prepare(
    "SELECT slotIndex FROM user_inventory WHERE userId = ? AND slotIndex >= ? AND slotIndex <= ?"
  ).all(userId, range.min, range.max).map(r => r.slotIndex);

  let emptySlot = null;
  for (let i = range.min; i <= range.max; i++) {
    if (!usedSlots.includes(i)) { emptySlot = i; break; }
  }

  if (emptySlot === null) {
    return { success: false, message: "Inventory full" };
  }

  // 인벤토리에 추가
  db.prepare(`
    INSERT INTO user_inventory (userId, itemCode, slotIndex, isEquipped)
    VALUES (?, ?, ?, 0)
  `).run(userId, itemCode, emptySlot);

  // ✅ 도감 자동 해금
  unlockCollection(userId, itemCode);

  return {
    success: true,
    slotIndex: emptySlot,
    item: itemDef
  };
}

// ================================================================
// 인벤토리 - 치장 아이템 장착 / 해제
// 같은 cosmeticSlot은 1개만 장착 가능 (기존 장착 자동 해제)
// ================================================================

function equipItem(userId, itemCode) {
  const invItem = db.prepare(
    "SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?"
  ).get(userId, itemCode);
  if (!invItem) {
    return { success: false, message: "Item not in inventory" };
  }

  const itemDef = db.prepare(
    "SELECT * FROM item_definitions WHERE itemCode = ?"
  ).get(itemCode);

  // 치장 아이템만 장착 가능
  if (itemDef.itemType !== "cosmetic") {
    return { success: false, message: "Only cosmetic items can be equipped" };
  }

  // 같은 슬롯 기존 장착 해제
  db.prepare(`
    UPDATE user_inventory
    SET isEquipped = 0
    WHERE userId = ?
      AND isEquipped = 1
      AND itemCode IN (
        SELECT itemCode FROM item_definitions
        WHERE cosmeticSlot = ?
      )
  `).run(userId, itemDef.cosmeticSlot);

  // 장착
  db.prepare(`
    UPDATE user_inventory
    SET isEquipped = 1
    WHERE userId = ? AND itemCode = ?
  `).run(userId, itemCode);

  return {
    success: true,
    equipped: itemCode,
    slot: itemDef.cosmeticSlot
  };
}

function unequipItem(userId, itemCode) {
  const invItem = db.prepare(
    "SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?"
  ).get(userId, itemCode);
  if (!invItem) {
    return { success: false, message: "Item not in inventory" };
  }

  db.prepare(`
    UPDATE user_inventory SET isEquipped = 0
    WHERE userId = ? AND itemCode = ?
  `).run(userId, itemCode);

  return { success: true, unequipped: itemCode };
}

// ================================================================
// 인벤토리 조회
// ================================================================

function getInventory(userId) {
  return db.prepare(`
    SELECT
      ui.slotIndex,
      ui.isEquipped,
      ui.obtainedAt,
      id.itemCode,
      id.name,
      id.description,
      id.itemType,
      id.cosmeticSlot
    FROM user_inventory ui
    JOIN item_definitions id ON ui.itemCode = id.itemCode
    WHERE ui.userId = ?
    ORDER BY ui.slotIndex ASC
  `).all(userId);
}

// 장착 중인 치장 아이템만 조회
function getEquippedItems(userId) {
  return db.prepare(`
    SELECT
      ui.slotIndex,
      id.itemCode,
      id.name,
      id.cosmeticSlot
    FROM user_inventory ui
    JOIN item_definitions id ON ui.itemCode = id.itemCode
    WHERE ui.userId = ? AND ui.isEquipped = 1
    ORDER BY id.cosmeticSlot ASC
  `).all(userId);
}

// ================================================================
// 도감 해금
// 아이템 획득 시 자동 호출 (collectionType은 itemType 기준)
// ================================================================

function unlockCollection(userId, itemCode) {
  const itemDef = db.prepare(
    "SELECT * FROM item_definitions WHERE itemCode = ?"
  ).get(itemCode);
  if (!itemDef) return;

  // 소모성 아이템은 도감 없음
  if (itemDef.itemType === "consumable") return;

  const collectionEntry = db.prepare(
    "SELECT * FROM collection_definitions WHERE itemCode = ?"
  ).get(itemCode);
  if (!collectionEntry) return;

  db.prepare(`
    INSERT INTO user_collection (userId, collectionCode, isUnlocked, unlockedAt)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(userId, collectionCode) DO UPDATE SET
      isUnlocked = 1,
      unlockedAt = CASE WHEN isUnlocked = 0 THEN datetime('now') ELSE unlockedAt END
  `).run(userId, collectionEntry.collectionCode);
}

// 도감 전체 조회 (해금/미해금 모두)
function getCollection(userId, collectionType) {
  const query = collectionType
    ? `SELECT
        cd.collectionCode,
        cd.name,
        cd.description,
        cd.collectionType,
        COALESCE(uc.isUnlocked, 0) AS isUnlocked,
        uc.unlockedAt
       FROM collection_definitions cd
       LEFT JOIN user_collection uc
         ON cd.collectionCode = uc.collectionCode AND uc.userId = ?
       WHERE cd.collectionType = ?
       ORDER BY cd.collectionCode ASC`
    : `SELECT
        cd.collectionCode,
        cd.name,
        cd.description,
        cd.collectionType,
        COALESCE(uc.isUnlocked, 0) AS isUnlocked,
        uc.unlockedAt
       FROM collection_definitions cd
       LEFT JOIN user_collection uc
         ON cd.collectionCode = uc.collectionCode AND uc.userId = ?
       ORDER BY cd.collectionType ASC, cd.collectionCode ASC`;

  return collectionType
    ? db.prepare(query).all(userId, collectionType)
    : db.prepare(query).all(userId);
}

// ================================================================
// 기존 함수들
// ================================================================

function purchaseItem(userId, itemId) {
  const user = getOrCreateUser(userId);
  const item = db.prepare("SELECT * FROM items WHERE itemId = ?").get(itemId);
  if (!item) return { success: false, message: "Item not found" };
  if (user[item.currencyType] < item.price) {
    return { success: false, message: "Not enough currency", current: user };
  }

  db.prepare(`
    UPDATE users
    SET ${item.currencyType} = ${item.currencyType} - ?,
        updatedAt = datetime('now')
    WHERE userId = ?
  `).run(item.price, userId);

  db.prepare(`
    INSERT INTO user_items (userId, itemId, quantity)
    VALUES (?, ?, 1)
    ON CONFLICT DO NOTHING
  `).run(userId, itemId);

  db.prepare(`
    INSERT INTO spend_log (userId, currencyType, amount, reason)
    VALUES (?, ?, ?, ?)
  `).run(userId, item.currencyType, item.price, `purchase:${itemId}`);

  return {
    success: true,
    item,
    current: db.prepare("SELECT * FROM users WHERE userId = ?").get(userId)
  };
}

function getUserItems(userId) {
  return db.prepare(`
    SELECT ui.*, i.name, i.description
    FROM user_items ui
    JOIN items i ON ui.itemId = i.itemId
    WHERE ui.userId = ?
    ORDER BY ui.obtainedAt DESC
  `).all(userId);
}

function getSpendLog(userId) {
  return db.prepare(`
    SELECT * FROM spend_log
    WHERE userId = ?
    ORDER BY spentAt DESC
    LIMIT 50
  `).all(userId);
}

module.exports = {
  getOrCreateUser,
  applySchoolReward,
  syncAttendanceRecords,
  syncAssignmentRecords,
  getAcademicLog,
  saveAcademicLog,
  spendCurrency,
  gainCurrency,
  addItemToInventory,
  equipItem,
  unequipItem,
  getInventory,
  getEquippedItems,
  unlockCollection,
  getCollection,
  purchaseItem,
  getUserItems,
  getSpendLog
};