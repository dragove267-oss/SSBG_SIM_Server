const db = require("../database/db");

const REWARD_CONFIG = {
  attendance: { extraCurrency: 100, exp: 30 },
  attendance_late: { exp: 15 },
  assignment: { exp: 50 }
};

const INVENTORY_SLOT_COUNT = 80;

// 유효한 itemType 목록
const VALID_ITEM_TYPES = ['Hat', 'Bag', 'Clothes', 'Theme', 'Friend', 'Consumable'];

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
// 옵션 효과 계산
// ================================================================

function getUserOptionValue(userId, optionCode) {
  const options = db.prepare(`
    SELECT ido.value, io.valueType
    FROM user_inventory ui
    JOIN item_definition_options ido ON ui.itemCode = ido.itemCode
    JOIN item_options io ON ido.optionCode = io.optionCode
    WHERE ui.userId = ? AND ido.optionCode = ?
  `).all(userId, optionCode);

  if (options.length === 0) return null;

  const valueType = options[0].valueType;
  if (valueType === "multiplier") {
    return options.reduce((acc, o) => acc * o.value, 1.0);
  } else {
    return options.reduce((acc, o) => acc + o.value, 0);
  }
}

function applyOptionToAmount(userId, currencyType, baseAmount) {
  const optionMap = {
    extraCurrency:    "CURRENCY_EXTRA_RATE",
    exp:              "CURRENCY_EXP_RATE",
    academicCurrency: "CURRENCY_ACADEMIC_RATE",
    idleCurrency:     null
  };

  const optionCode = optionMap[currencyType];
  if (!optionCode) return baseAmount;

  const multiplier = getUserOptionValue(userId, optionCode);
  if (!multiplier) return baseAmount;

  return Math.floor(baseAmount * multiplier);
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

  const baseExtra = deltaAttendance * REWARD_CONFIG.attendance.extraCurrency;
  const baseExp   = deltaAttendance * REWARD_CONFIG.attendance.exp
                  + deltaAssignment * REWARD_CONFIG.assignment.exp;

  const finalExtra = applyOptionToAmount(userId, "extraCurrency", baseExtra);
  const finalExp   = applyOptionToAmount(userId, "exp", baseExp);

  const delta = {
    academicCurrency: 0,
    extraCurrency:    finalExtra,
    idleCurrency:     0,
    exp:              finalExp,
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
    const detail = baseExtra !== finalExtra
      ? `출석 ${deltaAttendance}회 → Extra +${finalExtra} (기본 ${baseExtra} x배율) / EXP +${finalExp} 획득!`
      : `출석 ${deltaAttendance}회 → Extra +${finalExtra} / EXP +${finalExp} 획득!`;
    saveAcademicLog(userId, "attendance", detail, finalExtra, finalExp);
  }
  if (deltaAssignment > 0) {
    const baseAssignExp  = deltaAssignment * REWARD_CONFIG.assignment.exp;
    const finalAssignExp = applyOptionToAmount(userId, "exp", baseAssignExp);
    const detail = `과제 ${deltaAssignment}회 제출 → EXP +${finalAssignExp} 획득!`;
    saveAcademicLog(userId, "assignment", detail, 0, finalAssignExp);
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
        status = excluded.status, recordedAt = datetime('now')
    `).run(userId, item.week, item.status);
  }
}

function syncAssignmentRecords(userId, assignmentList) {
  for (const item of assignmentList) {
    db.prepare(`
      INSERT INTO academic_assignment (userId, name, status)
      VALUES (?, ?, ?)
      ON CONFLICT(userId, name) DO UPDATE SET
        status = excluded.status, recordedAt = datetime('now')
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
    UPDATE academic_change_log SET isRead = 1
    WHERE userId = ? AND isRead = 0
  `).run(userId);

  return logs;
}

// ================================================================
// 재화
// ================================================================

function spendCurrency(userId, currencyType, amount) {
  const validTypes = ["academicCurrency", "extraCurrency", "idleCurrency", "exp"];
  if (!validTypes.includes(currencyType))
    return { success: false, message: "Invalid currency type" };

  const user = getOrCreateUser(userId);
  if (user[currencyType] < amount)
    return { success: false, message: "Not enough currency", current: user };

  db.prepare(`
    UPDATE users SET ${currencyType} = ${currencyType} - ?, updatedAt = datetime('now')
    WHERE userId = ?
  `).run(amount, userId);

  return { success: true, current: db.prepare("SELECT * FROM users WHERE userId = ?").get(userId) };
}

function gainCurrency(userId, currencyType, amount) {
  const validTypes = ["academicCurrency", "extraCurrency", "idleCurrency", "exp"];
  if (!validTypes.includes(currencyType))
    return { success: false, message: "Invalid currency type" };

  getOrCreateUser(userId);
  const finalAmount = applyOptionToAmount(userId, currencyType, amount);

  db.prepare(`
    UPDATE users SET ${currencyType} = ${currencyType} + ?, updatedAt = datetime('now')
    WHERE userId = ?
  `).run(finalAmount, userId);

  return {
    success: true,
    baseAmount: amount,
    finalAmount: finalAmount,
    current: db.prepare("SELECT * FROM users WHERE userId = ?").get(userId)
  };
}

// ================================================================
// 인벤토리
// ================================================================

function addItemToInventory(userId, itemCode) {
  getOrCreateUser(userId);

  const itemDef = db.prepare("SELECT * FROM item_definitions WHERE itemCode = ?").get(itemCode);
  if (!itemDef) return { success: false, message: "Item not found" };

  const already = db.prepare(
    "SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?"
  ).get(userId, itemCode);
  if (already) return { success: false, message: "Item already owned" };

  // 전체 슬롯에서 빈 자리 순서대로 배치
  const usedSlots = db.prepare(
    "SELECT slotIndex FROM user_inventory WHERE userId = ?"
  ).all(userId).map(r => r.slotIndex);

  let emptySlot = null;
  for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
    if (!usedSlots.includes(i)) { emptySlot = i; break; }
  }
  if (emptySlot === null) return { success: false, message: "Inventory full" };

  db.prepare(`
    INSERT INTO user_inventory (userId, itemCode, slotIndex, isEquipped)
    VALUES (?, ?, ?, 0)
  `).run(userId, itemCode, emptySlot);

  unlockCollection(userId, itemCode);

  return { success: true, slotIndex: emptySlot, item: itemDef };
}

// 장착 (같은 itemType은 1개만 장착)
function equipItem(userId, itemCode) {
  const invItem = db.prepare(
    "SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?"
  ).get(userId, itemCode);
  if (!invItem) return { success: false, message: "Item not in inventory" };

  const itemDef = db.prepare("SELECT * FROM item_definitions WHERE itemCode = ?").get(itemCode);

  // Consumable은 장착 불가
  if (itemDef.itemType === "Consumable")
    return { success: false, message: "Consumable items cannot be equipped" };

  // 같은 itemType 기존 장착 해제
  db.prepare(`
    UPDATE user_inventory SET isEquipped = 0
    WHERE userId = ? AND isEquipped = 1
      AND itemCode IN (
        SELECT itemCode FROM item_definitions WHERE itemType = ?
      )
  `).run(userId, itemDef.itemType);

  db.prepare(`
    UPDATE user_inventory SET isEquipped = 1
    WHERE userId = ? AND itemCode = ?
  `).run(userId, itemCode);

  return { success: true, equipped: itemCode, itemType: itemDef.itemType };
}

function unequipItem(userId, itemCode) {
  const invItem = db.prepare(
    "SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?"
  ).get(userId, itemCode);
  if (!invItem) return { success: false, message: "Item not in inventory" };

  db.prepare(`
    UPDATE user_inventory SET isEquipped = 0
    WHERE userId = ? AND itemCode = ?
  `).run(userId, itemCode);

  return { success: true, unequipped: itemCode };
}

// 가방 전체 조회
function getInventory(userId) {
  return db.prepare(`
    SELECT
      ui.slotIndex, ui.isEquipped, ui.obtainedAt,
      id.itemCode, id.name, id.description, id.itemType
    FROM user_inventory ui
    JOIN item_definitions id ON ui.itemCode = id.itemCode
    WHERE ui.userId = ?
    ORDER BY ui.slotIndex ASC
  `).all(userId);
}

// 탭별 조회 (itemType 기준 - 슬롯 구조와 독립)
// itemType: null = 전체 / 'Hat' / 'Bag' / 'Clothes' / 'Theme' / 'Friend' / 'Consumable'
function getInventoryByType(userId, itemType) {
  if (!itemType) return getInventory(userId);

  return db.prepare(`
    SELECT
      ui.slotIndex, ui.isEquipped, ui.obtainedAt,
      id.itemCode, id.name, id.description, id.itemType
    FROM user_inventory ui
    JOIN item_definitions id ON ui.itemCode = id.itemCode
    WHERE ui.userId = ? AND id.itemType = ?
    ORDER BY ui.slotIndex ASC
  `).all(userId, itemType);
}

// 장착 중인 아이템만 조회
function getEquippedItems(userId) {
  return db.prepare(`
    SELECT ui.slotIndex, id.itemCode, id.name, id.itemType
    FROM user_inventory ui
    JOIN item_definitions id ON ui.itemCode = id.itemCode
    WHERE ui.userId = ? AND ui.isEquipped = 1
    ORDER BY id.itemType ASC
  `).all(userId);
}

// 아이템 옵션 조회
function getItemOptions(itemCode) {
  return db.prepare(`
    SELECT ido.optionCode, ido.value, io.name, io.description, io.valueType
    FROM item_definition_options ido
    JOIN item_options io ON ido.optionCode = io.optionCode
    WHERE ido.itemCode = ?
  `).all(itemCode);
}

// 유저 보유 전체 옵션 조회
function getUserAllOptions(userId) {
  return db.prepare(`
    SELECT
      ido.optionCode, io.name, io.valueType, ido.value,
      id.itemCode, id.name AS itemName
    FROM user_inventory ui
    JOIN item_definition_options ido ON ui.itemCode = ido.itemCode
    JOIN item_options io ON ido.optionCode = io.optionCode
    JOIN item_definitions id ON ui.itemCode = id.itemCode
    WHERE ui.userId = ?
    ORDER BY ido.optionCode ASC
  `).all(userId);
}

// ================================================================
// 도감
// ================================================================

function unlockCollection(userId, itemCode) {
  const itemDef = db.prepare("SELECT * FROM item_definitions WHERE itemCode = ?").get(itemCode);
  if (!itemDef) return;

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

// collectionType: null = 전체 / 'Hat' / 'Bag' / 'Clothes' / 'Theme' / 'Friend' / 'Consumable'
function getCollection(userId, collectionType) {
  const query = collectionType
    ? `SELECT cd.collectionCode, cd.name, cd.description, cd.collectionType,
              COALESCE(uc.isUnlocked, 0) AS isUnlocked, uc.unlockedAt
       FROM collection_definitions cd
       LEFT JOIN user_collection uc ON cd.collectionCode = uc.collectionCode AND uc.userId = ?
       WHERE cd.collectionType = ?
       ORDER BY cd.collectionCode ASC`
    : `SELECT cd.collectionCode, cd.name, cd.description, cd.collectionType,
              COALESCE(uc.isUnlocked, 0) AS isUnlocked, uc.unlockedAt
       FROM collection_definitions cd
       LEFT JOIN user_collection uc ON cd.collectionCode = uc.collectionCode AND uc.userId = ?
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
  if (user[item.currencyType] < item.price)
    return { success: false, message: "Not enough currency", current: user };

  db.prepare(`
    UPDATE users SET ${item.currencyType} = ${item.currencyType} - ?, updatedAt = datetime('now')
    WHERE userId = ?
  `).run(item.price, userId);

  db.prepare(`INSERT INTO user_items (userId, itemId, quantity) VALUES (?, ?, 1) ON CONFLICT DO NOTHING`)
    .run(userId, itemId);

  db.prepare(`INSERT INTO spend_log (userId, currencyType, amount, reason) VALUES (?, ?, ?, ?)`)
    .run(userId, item.currencyType, item.price, `purchase:${itemId}`);

  return { success: true, item, current: db.prepare("SELECT * FROM users WHERE userId = ?").get(userId) };
}

function getUserItems(userId) {
  return db.prepare(`
    SELECT ui.*, i.name, i.description
    FROM user_items ui JOIN items i ON ui.itemId = i.itemId
    WHERE ui.userId = ? ORDER BY ui.obtainedAt DESC
  `).all(userId);
}

function getSpendLog(userId) {
  return db.prepare(`
    SELECT * FROM spend_log WHERE userId = ? ORDER BY spentAt DESC LIMIT 50
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
  getInventoryByType,
  getEquippedItems,
  getItemOptions,
  getUserAllOptions,
  getUserOptionValue,
  applyOptionToAmount,
  unlockCollection,
  getCollection,
  purchaseItem,
  getUserItems,
  getSpendLog,
  VALID_ITEM_TYPES
};