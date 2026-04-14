const db = require("../database/db");

// 재화 지급 설정 
const REWARD_CONFIG = {
  attendance: {
    extraCurrency: 100,
    exp: 30,
  },
  assignment: {
    exp: 50,
  }
};

// 유저 가져오기 
function getOrCreateUser(userId) {
  let user = db.prepare(
    "SELECT * FROM users WHERE userId = ?"
  ).get(userId);

  if (!user) {
    db.prepare(
      `INSERT INTO users (userId, academicCurrency, extraCurrency, idleCurrency, exp)
       VALUES (?, 0, 0, 0, 0)`
    ).run(userId);
    user = db.prepare(
      "SELECT * FROM users WHERE userId = ?"
    ).get(userId);
  }
  return user;
}

// 학교 데이터 기반 재화 갱신 
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

  const updated = db.prepare("SELECT * FROM users WHERE userId = ?").get(userId);

  // 변동분 함께 반환
  const hasChange = Object.values(delta).some(v => v > 0);
  return { user: updated, delta, hasChange };
}

// 재화 차감 (범용)
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

//아이템 구매
function purchaseItem(userId, itemId) {
  const user = getOrCreateUser(userId);

  // 아이템 정보 조회
  const item = db.prepare(
    "SELECT * FROM items WHERE itemId = ?"
  ).get(itemId);

  if (!item) {
    return { success: false, message: "Item not found" };
  }

  // 잔액 확인
  if (user[item.currencyType] < item.price) {
    return { success: false, message: "Not enough currency", current: user };
  }

  // 재화 차감
  db.prepare(`
    UPDATE users
    SET ${item.currencyType} = ${item.currencyType} - ?,
        updatedAt = datetime('now')
    WHERE userId = ?
  `).run(item.price, userId);

  // 아이템 지급
  db.prepare(`
    INSERT INTO user_items (userId, itemId, quantity)
    VALUES (?, ?, 1)
    ON CONFLICT DO NOTHING
  `).run(userId, itemId);

  // 소모 이력 기록
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

// 유저 보유 아이템 조회
function getUserItems(userId) {
  return db.prepare(`
    SELECT ui.*, i.name, i.description
    FROM user_items ui
    JOIN items i ON ui.itemId = i.itemId
    WHERE ui.userId = ?
    ORDER BY ui.obtainedAt DESC
  `).all(userId);
}

// 소모 이력 조회
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
  spendCurrency,
  purchaseItem,
  getUserItems,
  getSpendLog
};

module.exports = { getOrCreateUser, applySchoolReward, spendCurrency };