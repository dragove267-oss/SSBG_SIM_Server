const db = require("../database/db");

const REWARD_CONFIG = {
  attendance: { extraCurrency: 100, exp: 30 },
  attendance_late: { exp: 15 },
  assignment: { exp: 50 }
};

const INVENTORY_SLOT_COUNT = 80;

// relic 포함
const VALID_ITEM_TYPES = ['Hat', 'Bag', 'Clothes', 'Theme', 'Friend', 'Consumable', 'relic'];

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

    // 기본 아이템 자동 지급 + 장착
    const defaultItems = ["HAT_000", "CLOTHES_000", "BAG_000"];
    for (let i = 0; i < defaultItems.length; i++) {
      const itemCode = defaultItems[i];
      const itemDef = db.prepare("SELECT * FROM item_definitions WHERE itemCode = ?").get(itemCode);
      if (!itemDef) continue;

      db.prepare(`
        INSERT OR IGNORE INTO user_inventory (userId, itemCode, slotIndex, isEquipped)
        VALUES (?, ?, ?, 1)
      `).run(userId, itemCode, i);
    }
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

  return { success: true, slotIndex: emptySlot, item: itemDef };
}

// Consumable 전용 장착 (최대 3개, 초과 시 가장 왼쪽 해제)
function equipConsumable(userId, itemCode) {
  const invItem = db.prepare(
    "SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?"
  ).get(userId, itemCode);
  if (!invItem) return { success: false, message: "Item not in inventory" };

  const itemDef = db.prepare("SELECT * FROM item_definitions WHERE itemCode = ?").get(itemCode);
  if (itemDef.itemType !== "Consumable")
    return { success: false, message: "Consumable 아이템만 이 함수로 장착 가능합니다." };

  // 이미 장착 중인지 확인
  if (invItem.isEquipped)
    return { success: false, message: "이미 장착 중인 아이템입니다." };

  // 현재 장착된 Consumable 목록 (slotIndex 오름차순)
  const equipped = db.prepare(`
    SELECT ui.id, ui.slotIndex, ui.itemCode
    FROM user_inventory ui
    JOIN item_definitions id ON ui.itemCode = id.itemCode
    WHERE ui.userId = ? AND id.itemType = 'Consumable' AND ui.isEquipped = 1
    ORDER BY ui.slotIndex ASC
  `).all(userId);

  // 3개 꽉 찬 경우 가장 왼쪽(slotIndex 가장 작은) 해제
  if (equipped.length >= 3) {
    db.prepare(`
      UPDATE user_inventory SET isEquipped = 0
      WHERE id = ?
    `).run(equipped[0].id);
  }

  // 새 아이템 장착
  db.prepare(`
    UPDATE user_inventory SET isEquipped = 1
    WHERE userId = ? AND itemCode = ?
  `).run(userId, itemCode);

  return { success: true, equipped: itemCode, unequipped: equipped.length >= 3 ? equipped[0].itemCode : null };
}

function equipItem(userId, itemCode) {
  const invItem = db.prepare(
    "SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?"
  ).get(userId, itemCode);
  if (!invItem) return { success: false, message: "Item not in inventory" };

  const itemDef = db.prepare("SELECT * FROM item_definitions WHERE itemCode = ?").get(itemCode);

  if (itemDef.itemType === "Consumable")
    return { success: false, message: "Consumable items cannot be equipped" };

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

function getEquippedItems(userId) {
  return db.prepare(`
    SELECT ui.slotIndex, id.itemCode, id.name, id.itemType
    FROM user_inventory ui
    JOIN item_definitions id ON ui.itemCode = id.itemCode
    WHERE ui.userId = ? AND ui.isEquipped = 1
    ORDER BY id.itemType ASC
  `).all(userId);
}

function getItemOptions(itemCode) {
  return db.prepare(`
    SELECT ido.optionCode, ido.value, io.name, io.description, io.valueType
    FROM item_definition_options ido
    JOIN item_options io ON ido.optionCode = io.optionCode
    WHERE ido.itemCode = ?
  `).all(itemCode);
}

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

//  item_definitions 전체 기준
//    user_inventory에 있으면 isUnlocked = 1 (해금)
//    없으면 isUnlocked = 0 (미해금)
// collectionType: null = 전체 / 'Hat' / 'Bag' / 'Clothes' / 'Theme' / 'Friend' / 'Consumable' / 'relic'
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
       LEFT JOIN user_inventory ui ON id.itemCode = ui.itemCode AND ui.userId = ?
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
       LEFT JOIN user_inventory ui ON id.itemCode = ui.itemCode AND ui.userId = ?
       ORDER BY id.itemType ASC, id.itemCode ASC`;

  return collectionType
    ? db.prepare(query).all(userId, collectionType)
    : db.prepare(query).all(userId);
}

//  해금된 itemCode 목록만 반환
//    = 유저가 가방에 보유한 아이템
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

// 등급 확률 테이블
const GRADE_RATES = [
  { grade: "low",  rate: 0.45 },
  { grade: "mid",  rate: 0.35 },
  { grade: "high", rate: 0.15 },
  { grade: "top",  rate: 0.05 },
];

// 꿈상점 아이템 타입 확률
const DREAM_SHOP_TYPE_RATES = [
  { type: "Hat",      rate: 0.25 },
  { type: "Clothes",  rate: 0.25 },
  { type: "Bag",      rate: 0.25 },
  { type: "Theme",    rate: 0.20 },
  { type: "Friend",   rate: 0.05 },
];

// 확률로 등급 결정
function rollGrade(minGrade = null) {
  const gradeOrder = ["low", "mid", "high", "top"];
  const minIdx = minGrade ? gradeOrder.indexOf(minGrade) : 0;

  // 최소 등급 이상만 필터링 후 재확률 계산
  const filtered = GRADE_RATES.filter((_, i) => i >= minIdx);
  const total = filtered.reduce((acc, g) => acc + g.rate, 0);

  let rand = Math.random() * total;
  for (const g of filtered) {
    rand -= g.rate;
    if (rand <= 0) return g.grade;
  }
  return filtered[filtered.length - 1].grade;
}

// 확률로 아이템 타입 결정
function rollItemType() {
  let rand = Math.random();
  for (const t of DREAM_SHOP_TYPE_RATES) {
    rand -= t.rate;
    if (rand <= 0) return t.type;
  }
  return "Hat";
}

// 해당 타입의 랜덤 아이템 선택 (basic 제외)
function pickRandomItem(itemType) {
  const items = db.prepare(`
    SELECT itemCode FROM item_definitions
    WHERE itemType = ? AND grade != 'basic'
    ORDER BY RANDOM() LIMIT 1
  `).get(itemType);
  return items ? items.itemCode : null;
}

// 장착된 소모품 효과 계산
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

// 꿈상점 생성 (daily-reset 시 호출)
function generateDreamShop(userId) {
  const today = new Date().toISOString().slice(0, 10);

  // 이미 오늘 생성된 꿈상점 있으면 반환
  const existing = db.prepare(
    "SELECT * FROM dream_shop WHERE userId = ? AND date = ?"
  ).get(userId, today);
  if (existing) return { ...existing, items: JSON.parse(existing.items) };

  // 소모품 효과 계산
  const effects = getEquippedConsumableEffects(userId);

  // 등장 아이템 수 결정
  // 기본 1개 + 소모품 효과
  let baseItemCount = 1;
  const addEffect = effects.shop_add_item;
  if (addEffect === 1) baseItemCount += 1;
  else if (addEffect === 2) baseItemCount += Math.random() < 0.5 ? 1 : 2;
  else if (addEffect === 3) baseItemCount += 2;
  else if (addEffect === 4) baseItemCount += Math.random() < 0.5 ? 2 : 3;
  else if (addEffect === 5) baseItemCount += 3;

  // 구매 가능 수 결정
  const maxBuyCount = 1 + effects.shop_add_buy;

  // 아이템 생성
  const items = [];
  const usedCodes = new Set();

  for (let i = 0; i < baseItemCount; i++) {
    const itemType = rollItemType();

    // 등급 결정 (중급/상급 확정 소모품 효과 적용)
    let minGrade = null;
    if (effects.shop_grade_high > 0 && i < effects.shop_grade_high) {
      minGrade = "high";
    } else if (effects.shop_grade_mid > 0 && i < effects.shop_grade_mid) {
      minGrade = "mid";
    }
    const grade = rollGrade(minGrade);

    // 중복 없이 아이템 선택
    let itemCode = null;
    let tries = 0;
    while (tries < 10) {
      itemCode = pickRandomItem(itemType);
      if (itemCode && !usedCodes.has(itemCode)) break;
      tries++;
    }
    if (!itemCode) continue;

    usedCodes.add(itemCode);
    items.push({ itemCode, grade, bought: false });
  }

  // DB 저장
  db.prepare(`
    INSERT OR REPLACE INTO dream_shop (userId, date, items, maxBuyCount, usedBuyCount)
    VALUES (?, ?, ?, ?, 0)
  `).run(userId, today, JSON.stringify(items), maxBuyCount);

  return { userId, date: today, items, maxBuyCount, usedBuyCount: 0 };
}

// 꿈상점 조회
function getDreamShop(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const shop = db.prepare(
    "SELECT * FROM dream_shop WHERE userId = ? AND date = ?"
  ).get(userId, today);

  if (!shop) return { success: false, message: "오늘의 꿈상점이 없습니다. 정산을 먼저 진행해주세요." };

  return { success: true, ...shop, items: JSON.parse(shop.items) };
}

// 꿈상점 구매
function buyDreamShopItem(userId, itemIndex) {
  const today = new Date().toISOString().slice(0, 10);
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

  const { itemCode, grade } = items[itemIndex];

  // 인벤토리에 추가
  const invResult = addItemToInventory(userId, itemCode);
  if (!invResult.success) return { success: false, message: invResult.message };

  // 구매 처리
  items[itemIndex].bought = true;
  db.prepare(`
    UPDATE dream_shop SET items = ?, usedBuyCount = usedBuyCount + 1
    WHERE userId = ? AND date = ?
  `).run(JSON.stringify(items), userId, today);

  return {
    success: true,
    itemCode,
    grade,
    slotIndex: invResult.slotIndex
  };
}

// ================================================================
// 제작
// ================================================================

// 재화 조합으로 레시피 찾기
function findRecipe(academic, extra, idle) {
  // 입력된 재화로 매칭되는 레시피 조회
  // 0인 재화는 null 또는 0으로 저장되어 있으므로 조건 처리
  const recipes = db.prepare(`
    SELECT cd.craftId, cd.itemCode, cd.currencyType1, cd.cost1,
           cd.currencyType2, cd.cost2, cd.currencyType3, cd.cost3,
           id.name, id.itemType
    FROM craft_definitions cd
    JOIN item_definitions id ON cd.itemCode = id.itemCode
  `).all();

  // 입력 재화 맵
  const input = {
    academicCurrency: academic,
    extraCurrency:    extra,
    idleCurrency:     idle
  };

  for (const recipe of recipes) {
    // 레시피 재화 맵 생성
    const required = {};
    if (recipe.currencyType1 && recipe.cost1 > 0)
      required[recipe.currencyType1] = (required[recipe.currencyType1] || 0) + recipe.cost1;
    if (recipe.currencyType2 && recipe.cost2 > 0)
      required[recipe.currencyType2] = (required[recipe.currencyType2] || 0) + recipe.cost2;
    if (recipe.currencyType3 && recipe.cost3 > 0)
      required[recipe.currencyType3] = (required[recipe.currencyType3] || 0) + recipe.cost3;

    // 입력값과 레시피 재화 완전 일치 확인
    const inputKeys   = Object.keys(input).filter(k => input[k] > 0);
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

  //  Consumable 타입만 제작 가능
  if (recipe.itemType !== "Consumable")
    return { success: false, message: "소모성 아이템만 제작 가능합니다." };

  const user = getOrCreateUser(userId);

  // 재화 확인 (1~3종류)
  if (user[recipe.currencyType1] < recipe.cost1)
    return { success: false, message: `${recipe.currencyType1} 재화가 부족합니다.`, current: user };
  if (recipe.currencyType2 && recipe.cost2 > 0 && user[recipe.currencyType2] < recipe.cost2)
    return { success: false, message: `${recipe.currencyType2} 재화가 부족합니다.`, current: user };
  if (recipe.currencyType3 && recipe.cost3 > 0 && user[recipe.currencyType3] < recipe.cost3)
    return { success: false, message: `${recipe.currencyType3} 재화가 부족합니다.`, current: user };

  // 이미 보유 중인지 확인
  const already = db.prepare(
    "SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?"
  ).get(userId, recipe.itemCode);
  if (already) return { success: false, message: "이미 보유한 아이템입니다." };

  // 트랜잭션으로 재화 차감 + 아이템 지급
  const craftTransaction = db.transaction(() => {
    // 재화1 차감
    db.prepare(`
      UPDATE users SET ${recipe.currencyType1} = ${recipe.currencyType1} - ?,
        updatedAt = datetime('now')
      WHERE userId = ?
    `).run(recipe.cost1, userId);
    db.prepare(`
      INSERT INTO spend_log (userId, currencyType, amount, reason) VALUES (?, ?, ?, ?)
    `).run(userId, recipe.currencyType1, recipe.cost1, `craft:${recipe.itemCode}`);

    // 재화2 차감 (있는 경우)
    if (recipe.currencyType2 && recipe.cost2 > 0) {
      db.prepare(`
        UPDATE users SET ${recipe.currencyType2} = ${recipe.currencyType2} - ?,
          updatedAt = datetime('now')
        WHERE userId = ?
      `).run(recipe.cost2, userId);
      db.prepare(`
        INSERT INTO spend_log (userId, currencyType, amount, reason) VALUES (?, ?, ?, ?)
      `).run(userId, recipe.currencyType2, recipe.cost2, `craft:${recipe.itemCode}`);
    }

    // 재화3 차감 (있는 경우)
    if (recipe.currencyType3 && recipe.cost3 > 0) {
      db.prepare(`
        UPDATE users SET ${recipe.currencyType3} = ${recipe.currencyType3} - ?,
          updatedAt = datetime('now')
        WHERE userId = ?
      `).run(recipe.cost3, userId);
      db.prepare(`
        INSERT INTO spend_log (userId, currencyType, amount, reason) VALUES (?, ?, ?, ?)
      `).run(userId, recipe.currencyType3, recipe.cost3, `craft:${recipe.itemCode}`);
    }

    // 인벤토리 추가
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
// 상점
// ================================================================

// 상점 목록 조회 (itemType 필터 가능)
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

// 아이템 구매
function buyItem(userId, shopId) {
  const shopItem = db.prepare(`
    SELECT sd.*, id.name, id.itemType
    FROM shop_definitions sd
    JOIN item_definitions id ON sd.itemCode = id.itemCode
    WHERE sd.shopId = ?
  `).get(shopId);

  if (!shopItem) return { success: false, message: "상점에 없는 아이템입니다." };

  //  Consumable 타입만 구매 가능
  if (shopItem.itemType !== "Consumable")
    return { success: false, message: "소모성 아이템만 구매 가능합니다." };

  const user = getOrCreateUser(userId);

  // 재화 확인
  if (user[shopItem.currencyType] < shopItem.price) {
    return { success: false, message: "재화가 부족합니다.", current: user };
  }

  // 이미 보유 중인지 확인
  const already = db.prepare(
    "SELECT * FROM user_inventory WHERE userId = ? AND itemCode = ?"
  ).get(userId, shopItem.itemCode);
  if (already) return { success: false, message: "이미 보유한 아이템입니다." };

  // 재화 차감
  db.prepare(`
    UPDATE users SET ${shopItem.currencyType} = ${shopItem.currencyType} - ?,
      updatedAt = datetime('now')
    WHERE userId = ?
  `).run(shopItem.price, userId);

  // 소모 로그
  db.prepare(`
    INSERT INTO spend_log (userId, currencyType, amount, reason)
    VALUES (?, ?, ?, ?)
  `).run(userId, shopItem.currencyType, shopItem.price, `shop:${shopItem.itemCode}`);

  // 인벤토리 추가
  const invResult = addItemToInventory(userId, shopItem.itemCode);
  if (!invResult.success) {
    // 인벤토리 추가 실패 시 재화 복구
    db.prepare(`
      UPDATE users SET ${shopItem.currencyType} = ${shopItem.currencyType} + ?,
        updatedAt = datetime('now')
      WHERE userId = ?
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
  getUserAllOptions,
  getUserOptionValue,
  applyOptionToAmount,
  getCollection,
  getUnlockedItemCodes,
  generateDreamShop,
  getDreamShop,
  buyDreamShopItem,
  craftItem,
  findRecipe,
  getShop,
  buyItem,
  purchaseItem,
  getUserItems,
  getSpendLog,
  VALID_ITEM_TYPES
};