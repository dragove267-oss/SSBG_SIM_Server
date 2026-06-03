const db = require("../database/db");
const { getServerToday } = require("./timeHelper");

const REWARD_CONFIG = {
  attendance: { extraCurrency: 100, exp: 30 },
  attendance_late: { exp: 15 },
  assignment: { exp: 50 }
};

const INVENTORY_SLOT_COUNT = 80;

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

    // 최초 생성 시 당일 정산 완료 처리
    try {
      const { getServerTime } = require("./timeHelper");
      db.prepare(
        "INSERT INTO daily_reset_log (userId, resetAt) VALUES (?, ?)"
      ).run(userId, getServerTime().toISOString());
    } catch (e) {
      console.error("[getOrCreateUser] 최초 생성 유저 daily_reset_log 삽입 실패:", e.message);
    }

    // 기본 아이템 자동 지급 + 장착 + 기본 옵션 복사
    const defaultItems = ["100", "200", "300"];
    for (let i = 0; i < defaultItems.length; i++) {
      const itemCode = defaultItems[i];
      const itemDef = db.prepare("SELECT * FROM item_definitions WHERE itemCode = ?").get(itemCode);
      if (!itemDef) continue;

      const already = db.prepare(
        "SELECT id FROM user_inventory WHERE userId = ? AND itemCode = ?"
      ).get(userId, itemCode);
      if (already) continue;

      const result = db.prepare(`
        INSERT INTO user_inventory (userId, itemCode, slotIndex, isEquipped)
        VALUES (?, ?, ?, 1)
      `).run(userId, itemCode, i);

      const baseOptions = db.prepare(
        "SELECT optionCode, value FROM item_definition_options WHERE itemCode = ?"
      ).all(itemCode);
      for (const opt of baseOptions) {
        db.prepare(
          "INSERT OR IGNORE INTO user_item_options (inventoryId, optionCode, value) VALUES (?, ?, ?)"
        ).run(result.lastInsertRowid, opt.optionCode, opt.value);
      }
    }
  }
  return user;
}

// ================================================================
// 옵션 효과 계산
// ================================================================

function getUserOptionValue(userId, optionCode) {
  const options = db.prepare(`
    SELECT uio.value, io.valueType
    FROM user_inventory ui
    JOIN user_item_options uio ON ui.id = uio.inventoryId
    JOIN item_options io ON uio.optionCode = io.optionCode
    WHERE ui.userId = ? AND uio.optionCode = ? AND ui.isEquipped = 1
  `).all(userId, optionCode);

  if (options.length === 0) return null;

  const valueType = options[0].valueType;
  if (valueType === "multiplier") {
    return options.reduce((acc, o) => acc * o.value, 1.0);
  } else {
    return options.reduce((acc, o) => acc + o.value, 0);
  }
}

function getUserFlatOptionValue(userId, optionCode) {
  const options = db.prepare(`
    SELECT uio.value
    FROM user_inventory ui
    JOIN user_item_options uio ON ui.id = uio.inventoryId
    JOIN item_options io ON uio.optionCode = io.optionCode
    WHERE ui.userId = ? AND uio.optionCode = ? AND ui.isEquipped = 1
  `).all(userId, optionCode);
  return options.reduce((acc, o) => acc + o.value, 0.0);
}

function applyOptionToAmount(userId, currencyType, baseAmount) {
  const optionMap = {
    extraCurrency:    "CURRENCY_EXTRA_RATE",
    exp:              "CURRENCY_EXP_RATE",
    academicCurrency: "CURRENCY_ACADEMIC_RATE",
    idleCurrency:     "CURRENCY_IDLE_RATE"
  };

  const flatMap = {
    exp: "CURRENCY_EXP_FLAT"
  };

  const optionCode = optionMap[currencyType];
  let result = baseAmount;

  // 배율 옵션 적용
  if (optionCode) {
    const multiplier = getUserOptionValue(userId, optionCode);
    if (multiplier) result = Math.floor(result * multiplier);
  }

  // flat 옵션 적용 (baseAmount > 0 일때만)
  if (baseAmount > 0 && flatMap[currencyType]) {
    const flatValue = getUserFlatOptionValue(userId, flatMap[currencyType]);
    if (flatValue > 0) result += flatValue;
  }

  return result;
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

function applySchoolReward(userId, newAttendance, newAssignment, newLate = 0, newAbsent = 0) {
  getOrCreateUser(userId);

  const snapshot = db.prepare(
    "SELECT * FROM school_snapshots WHERE userId = ?"
  ).get(userId) || { attendanceCount: 0, assignmentCount: 0, lateCount: 0, absentCount: 0 };

  const deltaAttendance = Math.max(0, newAttendance - snapshot.attendanceCount);
  const deltaAssignment = Math.max(0, newAssignment - snapshot.assignmentCount);
  const deltaLate       = Math.max(0, newLate - (snapshot.lateCount || 0));
  const deltaAbsent     = Math.max(0, newAbsent - (snapshot.absentCount || 0));

  // 1. Extra 재화 계산 (출석 100, 지각 50, 결석 0)
  const baseExtra = deltaAttendance * 100 + deltaLate * 50;
  const finalExtra = applyOptionToAmount(userId, "extraCurrency", baseExtra)
                   + (deltaAttendance + deltaLate) * getUserFlatOptionValue(userId, "REWARD_ATTENDANCE_BONUS");

  // 2. Academic 재화 계산 (과제 제출 건당 100)
  const finalAcademic = deltaAssignment * 100;

  // 3. EXP 계산 (출석, 지각, 결석, 과제 반영 건당 100)
  const totalReflections = deltaAttendance + deltaLate + deltaAbsent + deltaAssignment;
  const baseExp = totalReflections * 100;
  const finalExp = applyOptionToAmount(userId, "exp", baseExp);

  const delta = {
    academicCurrency: finalAcademic,
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
    INSERT INTO school_snapshots (userId, attendanceCount, assignmentCount, lateCount, absentCount, updatedAt)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(userId) DO UPDATE SET
      attendanceCount = excluded.attendanceCount,
      assignmentCount = excluded.assignmentCount,
      lateCount       = excluded.lateCount,
      absentCount     = excluded.absentCount,
      updatedAt       = excluded.updatedAt
  `).run(userId, newAttendance, newAssignment, newLate, newAbsent);

  if (deltaAttendance > 0) {
    const detail = `출석x${deltaAttendance} ETR+${finalExtra} EXP+${finalExp}`;
    saveAcademicLog(userId, "attendance", detail, finalExtra, finalExp);
  }
  if (deltaLate > 0) {
    const detail = `지각x${deltaLate} ETR+${deltaLate * 50} EXP+${deltaLate * 100}`;
    saveAcademicLog(userId, "attendance", detail, deltaLate * 50, deltaLate * 100);
  }
  if (deltaAbsent > 0) {
    const detail = `결석x${deltaAbsent} EXP+${deltaAbsent * 100}`;
    saveAcademicLog(userId, "attendance", detail, 0, deltaAbsent * 100);
  }
  if (deltaAssignment > 0) {
    const detail = `과제x${deltaAssignment} ACD+${finalAcademic} EXP+${finalExp}`;
    saveAcademicLog(userId, "assignment", detail, 0, finalExp);
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

  // Friend/Theme만 중복 소지 불가
  if (itemDef.itemType === "Friend" || itemDef.itemType === "Theme") {
    const already = db.prepare(
      "SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?"
    ).get(userId, itemCode);
    if (already) return { success: false, message: "Item already owned" };
  }

  const usedSlots = db.prepare(
    "SELECT slotIndex FROM user_inventory WHERE userId = ?"
  ).all(userId).map(r => r.slotIndex);

  let emptySlot = null;
  for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
    if (!usedSlots.includes(i)) { emptySlot = i; break; }
  }
  if (emptySlot === null) return { success: false, message: "Inventory full" };

  const result = db.prepare(`
    INSERT INTO user_inventory (userId, itemCode, slotIndex, isEquipped)
    VALUES (?, ?, ?, 0)
  `).run(userId, itemCode, emptySlot);

  const inventoryId = result.lastInsertRowid;

  const baseOptions = db.prepare(
    "SELECT optionCode, value FROM item_definition_options WHERE itemCode = ?"
  ).all(itemCode);
  for (const opt of baseOptions) {
    db.prepare(
      "INSERT OR IGNORE INTO user_item_options (inventoryId, optionCode, value) VALUES (?, ?, ?)"
    ).run(inventoryId, opt.optionCode, opt.value);
  }

  return { success: true, slotIndex: emptySlot, item: itemDef, inventoryId };
}

// Consumable 전용 장착 (최대 3개, 동일효과 그룹 중복 불가)
function equipConsumable(userId, itemCode, inventoryId) {
  const invItem = inventoryId
    ? db.prepare("SELECT * FROM user_inventory WHERE id = ? AND userId = ?").get(inventoryId, userId)
    : db.prepare("SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ? AND isEquipped = 0 LIMIT 1").get(userId, itemCode)
      || db.prepare("SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?").get(userId, itemCode);
  if (!invItem) return { success: false, message: "Item not in inventory" };

  const itemDef = db.prepare("SELECT * FROM item_definitions WHERE itemCode = ?").get(invItem.itemCode);
  if (itemDef.itemType !== "Consumable")
    return { success: false, message: "Consumable 아이템만 이 함수로 장착 가능합니다." };

  if (invItem.isEquipped)
    return { success: false, message: "이미 장착 중인 아이템입니다." };

  const targetEffect = db.prepare(
    "SELECT effectType FROM consumable_effects WHERE itemCode = ?"
  ).get(invItem.itemCode);
  if (!targetEffect) return { success: false, message: "소모품 특수 효과 정보를 찾을 수 없습니다." };

  // 효과 대분류 그룹화
  const getEffectGroup = (eff) => {
    if (eff === 'shop_grade_mid' || eff === 'shop_grade_high') return 'Pen';
    if (eff === 'shop_add_item') return 'Book';
    if (eff === 'shop_add_buy')  return 'Glasses';
    return eff;
  };

  const targetGroup = getEffectGroup(targetEffect.effectType);

  const equippedList = db.prepare(`
    SELECT ui.id, ui.slotIndex, ui.itemCode, ce.effectType
    FROM user_inventory ui
    JOIN consumable_effects ce ON ui.itemCode = ce.itemCode
    WHERE ui.userId = ? AND ui.isEquipped = 1
    ORDER BY ui.slotIndex ASC
  `).all(userId);

  let unequippedCode = null;

  // 동일 그룹 해제
  const duplicates = equippedList.filter(e => getEffectGroup(e.effectType) === targetGroup);
  if (duplicates.length > 0) {
    for (const dup of duplicates) {
      db.prepare("UPDATE user_inventory SET isEquipped = 0 WHERE id = ?").run(dup.id);
    }
    unequippedCode = duplicates[0].itemCode;
  }

  // 3개 초과 시 가장 왼쪽 해제
  const remainingEquipped = db.prepare(`
    SELECT ui.id, ui.itemCode
    FROM user_inventory ui
    JOIN consumable_effects ce ON ui.itemCode = ce.itemCode
    WHERE ui.userId = ? AND ui.isEquipped = 1
    ORDER BY ui.slotIndex ASC
  `).all(userId);

  if (remainingEquipped.length >= 3) {
    db.prepare("UPDATE user_inventory SET isEquipped = 0 WHERE id = ?").run(remainingEquipped[0].id);
    unequippedCode = remainingEquipped[0].itemCode;
  }

  db.prepare("UPDATE user_inventory SET isEquipped = 1 WHERE id = ?").run(invItem.id);

  return { success: true, equipped: invItem.itemCode, inventoryId: invItem.id, unequipped: unequippedCode };
}

function equipItem(userId, itemCode, inventoryId) {
  const invItem = inventoryId
    ? db.prepare("SELECT * FROM user_inventory WHERE id = ? AND userId = ?").get(inventoryId, userId)
    : db.prepare("SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?").get(userId, itemCode);
  if (!invItem) return { success: false, message: "Item not in inventory" };

  const itemDef = db.prepare("SELECT * FROM item_definitions WHERE itemCode = ?").get(invItem.itemCode);

  if (itemDef.itemType === "Consumable")
    return { success: false, message: "Consumable items cannot be equipped" };

  if (itemDef.itemType !== "Theme") {
    db.prepare(`
      UPDATE user_inventory SET isEquipped = 0
      WHERE userId = ? AND isEquipped = 1
        AND itemCode IN (
          SELECT itemCode FROM item_definitions WHERE itemType = ?
        )
    `).run(userId, itemDef.itemType);
  }

  db.prepare("UPDATE user_inventory SET isEquipped = 1 WHERE id = ?").run(invItem.id);

  return { success: true, equipped: invItem.itemCode, inventoryId: invItem.id, itemType: itemDef.itemType };
}

function unequipItem(userId, itemCode, inventoryId) {
  const invItem = inventoryId
    ? db.prepare("SELECT * FROM user_inventory WHERE id = ? AND userId = ?").get(inventoryId, userId)
    : db.prepare("SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?").get(userId, itemCode);
  if (!invItem) return { success: false, message: "Item not in inventory" };

  db.prepare("UPDATE user_inventory SET isEquipped = 0 WHERE id = ?").run(invItem.id);

  return { success: true, unequipped: invItem.itemCode, inventoryId: invItem.id };
}

function getInventory(userId) {
  const items = db.prepare(`
    SELECT
      ui.id AS inventoryId, ui.slotIndex, ui.isEquipped, ui.obtainedAt,
      id.itemCode, id.name, id.description, id.itemType, id.cosmeticSlot
    FROM user_inventory ui
    JOIN item_definitions id ON ui.itemCode = id.itemCode
    WHERE ui.userId = ?
    ORDER BY ui.slotIndex ASC
  `).all(userId);

  for (const item of items) {
    item.options = getInventoryItemOptions(item.inventoryId);
  }
  return items;
}

function getInventoryByType(userId, itemType) {
  if (!itemType) return getInventory(userId);

  const items = db.prepare(`
    SELECT
      ui.id AS inventoryId, ui.slotIndex, ui.isEquipped, ui.obtainedAt,
      id.itemCode, id.name, id.description, id.itemType, id.cosmeticSlot
    FROM user_inventory ui
    JOIN item_definitions id ON ui.itemCode = id.itemCode
    WHERE ui.userId = ? AND id.itemType = ?
    ORDER BY ui.slotIndex ASC
  `).all(userId, itemType);

  for (const item of items) {
    item.options = getInventoryItemOptions(item.inventoryId);
  }
  return items;
}

function getEquippedItems(userId) {
  const items = db.prepare(`
    SELECT ui.id AS inventoryId, ui.slotIndex, id.itemCode, id.name, id.itemType, id.cosmeticSlot
    FROM user_inventory ui
    JOIN item_definitions id ON ui.itemCode = id.itemCode
    WHERE ui.userId = ? AND ui.isEquipped = 1
    ORDER BY id.itemType ASC
  `).all(userId);

  for (const item of items) {
    item.options = getInventoryItemOptions(item.inventoryId);
  }
  return items;
}

function getItemOptions(itemCode) {
  return db.prepare(`
    SELECT ido.optionCode, ido.value, io.name, io.description, io.valueType
    FROM item_definition_options ido
    JOIN item_options io ON ido.optionCode = io.optionCode
    WHERE ido.itemCode = ?
  `).all(itemCode);
}

function getInventoryItemOptions(inventoryId) {
  return db.prepare(`
    SELECT uio.optionCode, uio.value, io.name, io.description, io.valueType
    FROM user_item_options uio
    JOIN item_options io ON uio.optionCode = io.optionCode
    WHERE uio.inventoryId = ?
  `).all(inventoryId);
}

function getUserAllOptions(userId) {
  return db.prepare(`
    SELECT
      uio.optionCode, io.name, io.valueType, uio.value,
      id.itemCode, id.name AS itemName, ui.id AS inventoryId
    FROM user_inventory ui
    JOIN user_item_options uio ON ui.id = uio.inventoryId
    JOIN item_options io ON uio.optionCode = io.optionCode
    JOIN item_definitions id ON ui.itemCode = id.itemCode
    WHERE ui.userId = ?
    ORDER BY uio.optionCode ASC
  `).all(userId);
}

// ================================================================
// 도감
// ================================================================

function getCollection(userId, collectionType) {
  const query = collectionType
    ? `SELECT
         id.itemCode,
         id.name,
         id.description,
         id.itemType AS collectionType,
         CASE WHEN ui.itemCode IS NOT NULL THEN 1 ELSE 0 END AS isUnlocked,
         ui.obtainedAt AS unlockedAt
       FROM item_definitions id
       LEFT JOIN (
         SELECT itemCode, MIN(obtainedAt) AS obtainedAt
         FROM user_inventory
         WHERE userId = ?
         GROUP BY itemCode
       ) ui ON id.itemCode = ui.itemCode
       WHERE id.itemType = ?
       ORDER BY id.itemCode ASC`
    : `SELECT
         id.itemCode,
         id.name,
         id.description,
         id.itemType AS collectionType,
         CASE WHEN ui.itemCode IS NOT NULL THEN 1 ELSE 0 END AS isUnlocked,
         ui.obtainedAt AS unlockedAt
       FROM item_definitions id
       LEFT JOIN (
         SELECT itemCode, MIN(obtainedAt) AS obtainedAt
         FROM user_inventory
         WHERE userId = ?
         GROUP BY itemCode
       ) ui ON id.itemCode = ui.itemCode
       ORDER BY id.itemType ASC, id.itemCode ASC`;

  return collectionType
    ? db.prepare(query).all(userId, collectionType)
    : db.prepare(query).all(userId);
}

function getUnlockedItemCodes(userId, collectionType) {
  const query = collectionType
    ? `SELECT id.itemCode
       FROM item_definitions id
       JOIN user_inventory ui ON id.itemCode = ui.itemCode AND ui.userId = ?
       WHERE id.itemType = ?
       ORDER BY id.itemCode ASC`
    : `SELECT id.itemCode
       FROM item_definitions id
       JOIN user_inventory ui ON id.itemCode = ui.itemCode AND ui.userId = ?
       ORDER BY id.itemCode ASC`;

  const rows = collectionType
    ? db.prepare(query).all(userId, collectionType)
    : db.prepare(query).all(userId);

  return rows.map(r => r.itemCode);
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

// ================================================================
// 꿈상점
// ================================================================

const GRADE_MULTIPLIER = {
  low:  1.1,
  mid:  1.2,
  high: 1.3,
  top:  1.5,
};

const ITEM_OPTIONS = {
  Hat:     { main: "CURRENCY_ACADEMIC_RATE", sub: "CURRENCY_EXTRA_RATE" },
  Clothes: { main: "CURRENCY_EXTRA_RATE",    sub: "CURRENCY_IDLE_RATE" },
  Bag:     { main: "CURRENCY_IDLE_RATE",     sub: "CURRENCY_ACADEMIC_RATE" },
  Theme:   { main: "CURRENCY_EXP_FLAT",      sub: null },
  Friend:  { main: null,                     sub: null },
};

const SUB_GRADE_RATES = [
  { grade: "low",  rate: 0.45 },
  { grade: "mid",  rate: 0.35 },
  { grade: "high", rate: 0.15 },
  { grade: "top",  rate: 0.05 },
];

function resolveItemOptions(itemType, grade) {
  const multiplier = GRADE_MULTIPLIER[grade] || 1.0;
  const optionDef  = ITEM_OPTIONS[itemType];
  if (!optionDef) return [];

  const options = [];

  if (itemType === "Friend") return options;

  if (itemType === "Theme") {
    options.push({ optionCode: "CURRENCY_EXP_FLAT", value: 50 });
    return options;
  }

  if (optionDef.main) {
    options.push({ optionCode: optionDef.main, value: multiplier });
  }

  if (optionDef.sub) {
    const subGrade      = rollSubGrade();
    const subMultiplier = GRADE_MULTIPLIER[subGrade];
    options.push({ optionCode: optionDef.sub, value: subMultiplier, grade: subGrade });
  }

  return options;
}

function rollSubGrade() {
  let rand = Math.random();
  for (const g of SUB_GRADE_RATES) {
    rand -= g.rate;
    if (rand <= 0) return g.grade;
  }
  return "low";
}

const GRADE_RATES = [
  { grade: "low",  rate: 0.45 },
  { grade: "mid",  rate: 0.35 },
  { grade: "high", rate: 0.15 },
  { grade: "top",  rate: 0.05 },
];

const DREAM_SHOP_TYPE_RATES = [
  { type: "Hat",      rate: 0.25 },
  { type: "Clothes",  rate: 0.25 },
  { type: "Bag",      rate: 0.25 },
  { type: "Theme",    rate: 0.20 },
  { type: "Friend",   rate: 0.05 },
];

function rollGrade(minGrade = null) {
  const gradeOrder = ["low", "mid", "high", "top"];
  const minIdx = minGrade ? gradeOrder.indexOf(minGrade) : 0;

  const filtered = GRADE_RATES.filter((_, i) => i >= minIdx);
  const total = filtered.reduce((acc, g) => acc + g.rate, 0);

  let rand = Math.random() * total;
  for (const g of filtered) {
    rand -= g.rate;
    if (rand <= 0) return g.grade;
  }
  return filtered[filtered.length - 1].grade;
}

function rollItemType() {
  let rand = Math.random();
  for (const t of DREAM_SHOP_TYPE_RATES) {
    rand -= t.rate;
    if (rand <= 0) return t.type;
  }
  return "Hat";
}

// Theme/Friend는 basic 포함, 나머지는 basic 제외
function pickRandomItem(itemType) {
  const query = (itemType === 'Theme' || itemType === 'Friend')
    ? `SELECT itemCode FROM item_definitions WHERE itemType = ? ORDER BY RANDOM() LIMIT 1`
    : `SELECT itemCode FROM item_definitions WHERE itemType = ? AND grade != 'basic' ORDER BY RANDOM() LIMIT 1`;

  const items = db.prepare(query).get(itemType);
  return items ? items.itemCode : null;
}

function getEquippedConsumableEffects(userId) {
  const effects = db.prepare(`
    SELECT ce.effectType, ce.value
    FROM user_inventory ui
    JOIN consumable_effects ce ON ui.itemCode = ce.itemCode
    JOIN item_definitions id ON ui.itemCode = id.itemCode
    WHERE ui.userId = ? AND ui.isEquipped = 1 AND id.itemType = 'Consumable'
  `).all(userId);

  const result = {
    shop_add_item:    0,
    shop_add_buy:     0,
    shop_grade_mid:   0,
    shop_grade_high:  0,
  };

  for (const e of effects) {
    if (result[e.effectType] !== undefined) {
      result[e.effectType] += e.value;
    }
  }
  return result;
}

function generateDreamShop(userId) {
  const today = getServerToday();

  const existing = db.prepare(
    "SELECT * FROM dream_shop WHERE userId = ? AND date = ?"
  ).get(userId, today);
  if (existing) return { ...existing, items: JSON.parse(existing.items) };

  const effects = getEquippedConsumableEffects(userId);

  let baseItemCount = 1;
  const addEffect = effects.shop_add_item;
  if (addEffect === 1) baseItemCount += 1;
  else if (addEffect === 2) baseItemCount += Math.random() < 0.5 ? 1 : 2;
  else if (addEffect === 3) baseItemCount += 2;
  else if (addEffect === 4) baseItemCount += Math.random() < 0.5 ? 2 : 3;
  else if (addEffect === 5) baseItemCount += 3;

  const maxBuyCount = Math.min(4, 1 + effects.shop_add_buy);

  // 꿈상점 생성 (등급 조건 만족할 때까지 전체 리롤)
  const gradeOrder = ["low", "mid", "high", "top"];
  let items = [];
  let shopTries = 0;

  while (shopTries < 20) {
    items = [];
    const usedCodes = new Set();
    let costumeCount = 0;

    for (let i = 0; i < baseItemCount; i++) {
      const itemType = rollItemType();

      let itemCode = null;
      let grade    = null;
      let options  = [];
      let tries    = 0;

      while (tries < 10) {
        const candidateCode = pickRandomItem(itemType);
        if (!candidateCode) break;
        if (usedCodes.has(candidateCode)) { tries++; continue; }

        if (itemType === "Friend" || itemType === "Theme") {
          const owned = db.prepare(
            "SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?"
          ).get(userId, candidateCode);
          if (owned) { tries++; continue; }
        }

        itemCode = candidateCode;
        break;
      }

      if (!itemCode) continue;

      if (itemType === "Friend" || itemType === "Theme") {
        grade   = "basic";
        options = resolveItemOptions(itemType, grade);
      } else {
        grade   = rollGrade(null);
        options = resolveItemOptions(itemType, grade);
        costumeCount++;
      }

      usedCodes.add(itemCode);
      items.push({ itemCode, grade, multiplier: GRADE_MULTIPLIER[grade] || 1.0, options, bought: false });
    }

    // 등급 조건 검사
    const costumes = items.filter(i => !["Friend", "Theme"].includes(
      db.prepare("SELECT itemType FROM item_definitions WHERE itemCode = ?").get(i.itemCode)?.itemType
    ));

    const highCount = costumes.filter(i => gradeOrder.indexOf(i.grade) >= gradeOrder.indexOf("high")).length;
    const midCount  = costumes.filter(i => gradeOrder.indexOf(i.grade) >= gradeOrder.indexOf("mid")).length;

    const highOk = effects.shop_grade_high <= 0 || highCount >= effects.shop_grade_high;
    const midOk  = effects.shop_grade_mid  <= 0 || midCount  >= effects.shop_grade_mid;

    if (highOk && midOk) break;

    shopTries++;
  }

  db.prepare(`
    INSERT OR REPLACE INTO dream_shop (userId, date, items, maxBuyCount, usedBuyCount)
    VALUES (?, ?, ?, ?, 0)
  `).run(userId, today, JSON.stringify(items), maxBuyCount);

  // ✅ 꿈상점 생성 후 장착된 소모품 전체 삭제 (1회 소모)
  db.prepare(`
    DELETE FROM user_inventory
    WHERE userId = ? AND isEquipped = 1
      AND itemCode IN (
        SELECT itemCode FROM item_definitions WHERE itemType = 'Consumable'
      )
  `).run(userId);

  return { userId, date: today, items, maxBuyCount, usedBuyCount: 0 };
}

function getDreamShop(userId) {
  const today = getServerToday();
  const shop = db.prepare(
    "SELECT * FROM dream_shop WHERE userId = ? AND date = ?"
  ).get(userId, today);

  if (!shop) return { success: false, message: "오늘의 꿈상점이 없습니다. 정산을 먼저 진행해주세요." };

  return { success: true, ...shop, items: JSON.parse(shop.items) };
}

function buyDreamShopItem(userId, itemIndex) {
  const today = getServerToday();
  const shop = db.prepare(
    "SELECT * FROM dream_shop WHERE userId = ? AND date = ?"
  ).get(userId, today);

  if (!shop) return { success: false, message: "오늘의 꿈상점이 없습니다." };

  const items = JSON.parse(shop.items);

  if (itemIndex < 0 || itemIndex >= items.length)
    return { success: false, message: "잘못된 아이템 인덱스입니다." };
  if (items[itemIndex].bought)
    return { success: false, message: "이미 구매한 아이템입니다." };
  if (shop.usedBuyCount >= shop.maxBuyCount)
    return { success: false, message: "구매 가능 횟수를 초과했습니다." };

  const { itemCode, grade, options } = items[itemIndex];

  const invResult = addItemToInventory(userId, itemCode);
  if (!invResult.success) return { success: false, message: invResult.message };

  if (options && options.length > 0 && invResult.inventoryId) {
    for (const opt of options) {
      db.prepare(`
        INSERT OR REPLACE INTO user_item_options (inventoryId, optionCode, value)
        VALUES (?, ?, ?)
      `).run(invResult.inventoryId, opt.optionCode, opt.value);
    }
  }

  items[itemIndex].bought = true;
  db.prepare(`
    UPDATE dream_shop SET items = ?, usedBuyCount = usedBuyCount + 1
    WHERE userId = ? AND date = ?
  `).run(JSON.stringify(items), userId, today);

  return {
    success: true,
    itemCode,
    grade,
    options: options || [],
    slotIndex: invResult.slotIndex,
    inventoryId: invResult.inventoryId
  };
}

// ================================================================
// 제작
// ================================================================

function findRecipe(academic, extra, idle) {
  const recipes = db.prepare(`
    SELECT cd.craftId, cd.itemCode, cd.currencyType1, cd.cost1,
           cd.currencyType2, cd.cost2, cd.currencyType3, cd.cost3,
           id.name, id.itemType
    FROM craft_definitions cd
    JOIN item_definitions id ON cd.itemCode = id.itemCode
  `).all();

  const input = {
    academicCurrency: academic,
    extraCurrency:    extra,
    idleCurrency:     idle
  };

  for (const recipe of recipes) {
    const required = {};
    if (recipe.currencyType1 && recipe.cost1 > 0)
      required[recipe.currencyType1] = (required[recipe.currencyType1] || 0) + recipe.cost1;
    if (recipe.currencyType2 && recipe.cost2 > 0)
      required[recipe.currencyType2] = (required[recipe.currencyType2] || 0) + recipe.cost2;
    if (recipe.currencyType3 && recipe.cost3 > 0)
      required[recipe.currencyType3] = (required[recipe.currencyType3] || 0) + recipe.cost3;

    const inputKeys    = Object.keys(input).filter(k => input[k] > 0);
    const requiredKeys = Object.keys(required);

    if (inputKeys.length !== requiredKeys.length) continue;

    const match = requiredKeys.every(k => input[k] === required[k]);
    if (match) return { success: true, craftId: recipe.craftId, name: recipe.name };
  }

  return { success: false, message: "해당 재화 조합으로 만들 수 있는 아이템이 없습니다." };
}

function craftItem(userId, craftId) {
  const recipe = db.prepare(`
    SELECT cd.*, id.name, id.itemType
    FROM craft_definitions cd
    JOIN item_definitions id ON cd.itemCode = id.itemCode
    WHERE cd.craftId = ?
  `).get(craftId);

  if (!recipe) return { success: false, message: "존재하지 않는 레시피입니다." };

  if (recipe.itemType !== "Consumable")
    return { success: false, message: "소모성 아이템만 제작 가능합니다." };

  const user = getOrCreateUser(userId);

  if (user[recipe.currencyType1] < recipe.cost1)
    return { success: false, message: `${recipe.currencyType1} 재화가 부족합니다.`, current: user };
  if (recipe.currencyType2 && recipe.cost2 > 0 && user[recipe.currencyType2] < recipe.cost2)
    return { success: false, message: `${recipe.currencyType2} 재화가 부족합니다.`, current: user };
  if (recipe.currencyType3 && recipe.cost3 > 0 && user[recipe.currencyType3] < recipe.cost3)
    return { success: false, message: `${recipe.currencyType3} 재화가 부족합니다.`, current: user };

  const already = db.prepare(
    "SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?"
  ).get(userId, recipe.itemCode);
  if (already) return { success: false, message: "이미 보유한 아이템입니다." };

  const craftTransaction = db.transaction(() => {
    db.prepare(`
      UPDATE users SET ${recipe.currencyType1} = ${recipe.currencyType1} - ?,
        updatedAt = datetime('now') WHERE userId = ?
    `).run(recipe.cost1, userId);
    db.prepare(`INSERT INTO spend_log (userId, currencyType, amount, reason) VALUES (?, ?, ?, ?)`)
      .run(userId, recipe.currencyType1, recipe.cost1, `craft:${recipe.itemCode}`);

    if (recipe.currencyType2 && recipe.cost2 > 0) {
      db.prepare(`
        UPDATE users SET ${recipe.currencyType2} = ${recipe.currencyType2} - ?,
          updatedAt = datetime('now') WHERE userId = ?
      `).run(recipe.cost2, userId);
      db.prepare(`INSERT INTO spend_log (userId, currencyType, amount, reason) VALUES (?, ?, ?, ?)`)
        .run(userId, recipe.currencyType2, recipe.cost2, `craft:${recipe.itemCode}`);
    }

    if (recipe.currencyType3 && recipe.cost3 > 0) {
      db.prepare(`
        UPDATE users SET ${recipe.currencyType3} = ${recipe.currencyType3} - ?,
          updatedAt = datetime('now') WHERE userId = ?
      `).run(recipe.cost3, userId);
      db.prepare(`INSERT INTO spend_log (userId, currencyType, amount, reason) VALUES (?, ?, ?, ?)`)
        .run(userId, recipe.currencyType3, recipe.cost3, `craft:${recipe.itemCode}`);
    }

    const usedSlots = db.prepare(
      "SELECT slotIndex FROM user_inventory WHERE userId = ?"
    ).all(userId).map(r => r.slotIndex);

    let emptySlot = null;
    for (let i = 0; i < INVENTORY_SLOT_COUNT; i++) {
      if (!usedSlots.includes(i)) { emptySlot = i; break; }
    }
    if (emptySlot === null) throw new Error("인벤토리가 가득 찼습니다.");

    db.prepare(`
      INSERT INTO user_inventory (userId, itemCode, slotIndex, isEquipped)
      VALUES (?, ?, ?, 0)
    `).run(userId, recipe.itemCode, emptySlot);

    return emptySlot;
  });

  try {
    const slotIndex = craftTransaction();
    const updated = db.prepare("SELECT * FROM users WHERE userId = ?").get(userId);
    return {
      success: true,
      item: { itemCode: recipe.itemCode, name: recipe.name, itemType: recipe.itemType },
      slotIndex,
      current: updated
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ================================================================
// Idle 재화 수령 (매시 정각 100씩)
// ================================================================

function collectIdle(userId) {
  const user = getOrCreateUser(userId);

  const { getServerTime } = require("./timeHelper");
  const now = getServerTime().getTime();

  const lastRaw = db.prepare("SELECT lastIdleCollect FROM users WHERE userId = ?").get(userId);
  const lastMs  = lastRaw?.lastIdleCollect
    ? new Date(lastRaw.lastIdleCollect).getTime()
    : now;

  const lastHourStart = new Date(lastMs);
  lastHourStart.setMinutes(0, 0, 0);

  const nowHourStart = new Date(now);
  nowHourStart.setMinutes(0, 0, 0);

  const elapsedHours = Math.floor((nowHourStart.getTime() - lastHourStart.getTime()) / (1000 * 60 * 60));

  if (elapsedHours <= 0) {
    return {
      success: true,
      gained: 0,
      message: "아직 정각을 지나지 않아 수령할 idle 재화가 없습니다.",
      current: user
    };
  }

  const baseAmount  = elapsedHours * 100;
  const finalAmount = applyOptionToAmount(userId, "idleCurrency", baseAmount);

  // 가구 장착 시 EXP flat 추가 지급
  const expFlat = getUserFlatOptionValue(userId, "CURRENCY_EXP_FLAT");

  db.prepare(`
    UPDATE users
    SET idleCurrency    = idleCurrency + ?,
        exp             = exp + ?,
        lastIdleCollect = ?,
        updatedAt       = datetime('now')
    WHERE userId = ?
  `).run(finalAmount, expFlat, new Date(now).toISOString(), userId);

  const updated = db.prepare("SELECT * FROM users WHERE userId = ?").get(userId);

  return {
    success: true,
    intervals: elapsedHours,
    baseAmount,
    finalAmount,
    expGained: expFlat,
    current: updated
  };
}

// ================================================================
// 상점
// ================================================================

function getShop(itemType) {
  const query = itemType
    ? `SELECT sd.shopId, sd.currencyType, sd.price,
              id.itemCode, id.name, id.description, id.itemType, id.cosmeticSlot
       FROM shop_definitions sd
       JOIN item_definitions id ON sd.itemCode = id.itemCode
       WHERE id.itemType = ?
       ORDER BY sd.createdAt ASC`
    : `SELECT sd.shopId, sd.currencyType, sd.price,
              id.itemCode, id.name, id.description, id.itemType, id.cosmeticSlot
       FROM shop_definitions sd
       JOIN item_definitions id ON sd.itemCode = id.itemCode
       ORDER BY id.itemType ASC, sd.createdAt ASC`;

  return itemType
    ? db.prepare(query).all(itemType)
    : db.prepare(query).all();
}

function buyItem(userId, shopId) {
  const shopItem = db.prepare(`
    SELECT sd.*, id.name, id.itemType
    FROM shop_definitions sd
    JOIN item_definitions id ON sd.itemCode = id.itemCode
    WHERE sd.shopId = ?
  `).get(shopId);

  if (!shopItem) return { success: false, message: "상점에 없는 아이템입니다." };

  if (shopItem.itemType !== "Consumable")
    return { success: false, message: "소모성 아이템만 구매 가능합니다." };

  const user = getOrCreateUser(userId);

  if (user[shopItem.currencyType] < shopItem.price)
    return { success: false, message: "재화가 부족합니다.", current: user };

  const already = db.prepare(
    "SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?"
  ).get(userId, shopItem.itemCode);
  if (already) return { success: false, message: "이미 보유한 아이템입니다." };

  db.prepare(`
    UPDATE users SET ${shopItem.currencyType} = ${shopItem.currencyType} - ?,
      updatedAt = datetime('now') WHERE userId = ?
  `).run(shopItem.price, userId);

  db.prepare(`
    INSERT INTO spend_log (userId, currencyType, amount, reason) VALUES (?, ?, ?, ?)
  `).run(userId, shopItem.currencyType, shopItem.price, `shop:${shopItem.itemCode}`);

  const invResult = addItemToInventory(userId, shopItem.itemCode);
  if (!invResult.success) {
    db.prepare(`
      UPDATE users SET ${shopItem.currencyType} = ${shopItem.currencyType} + ?,
        updatedAt = datetime('now') WHERE userId = ?
    `).run(shopItem.price, userId);
    return { success: false, message: invResult.message };
  }

  const updated = db.prepare("SELECT * FROM users WHERE userId = ?").get(userId);
  return {
    success: true,
    item: shopItem,
    slotIndex: invResult.slotIndex,
    current: updated
  };
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
  equipConsumable,
  unequipItem,
  getInventory,
  getInventoryByType,
  getEquippedItems,
  getItemOptions,
  getInventoryItemOptions,
  getUserAllOptions,
  getUserOptionValue,
  getUserFlatOptionValue,
  applyOptionToAmount,
  getCollection,
  getUnlockedItemCodes,
  generateDreamShop,
  getDreamShop,
  buyDreamShopItem,
  collectIdle,
  craftItem,
  findRecipe,
  getShop,
  buyItem,
  purchaseItem,
  getUserItems,
  getSpendLog,
  VALID_ITEM_TYPES
};