const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const axios = require("axios");
const db = require("./database/db");
const { applySchoolReward, syncAttendanceRecords, syncAssignmentRecords } = require("./services/userService");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const gameRouter = require("./routes/game");
app.use("/api", gameRouter);

// ================================================================
// 어드민 연동 보상 재계산 API (userId 기준으로 통일)
// ================================================================

app.post("/api/admin/apply-reward", async (req, res) => {
  const { userId, type } = req.body;
  console.log(`[Admin-Sync] 보상 동기화 요청: ${userId} (${type})`);

  try {
    // 1. 학교서버에서 userId로 최신 데이터 가져와서 로컬 DB 동기화
    try {
      const attendanceRes = await axios.get(`http://localhost:4000/attendance?userId=${userId}`);
      const assignmentRes = await axios.get(`http://localhost:4000/assignment?userId=${userId}`);
      syncAttendanceRecords(userId, attendanceRes.data.attendance);
      syncAssignmentRecords(userId, assignmentRes.data.assignment);
    } catch (syncErr) {
      console.warn(`[Admin-Sync] 학교서버 동기화 스킵 (미등록 or 오류):`, syncErr.message);
    }

    // 2. 로컬 DB의 실제 유효한 개수 파악
    const currentAttendance = db.prepare(
      "SELECT COUNT(*) as count FROM academic_attendance WHERE userId = ? AND status = '출석'"
    ).get(userId).count;
    const currentAssignment = db.prepare(
      "SELECT COUNT(*) as count FROM academic_assignment WHERE userId = ? AND status = '제출'"
    ).get(userId).count;

    // 3. 해당 타입 스냅샷을 현재보다 1 작게 강제 조정 (보상 1회 트리거)
    if (type === "attendance") {
      db.prepare(
        "INSERT OR IGNORE INTO school_snapshots (userId, attendanceCount, assignmentCount) VALUES (?, 0, 0)"
      ).run(userId);
      db.prepare("UPDATE school_snapshots SET attendanceCount = ? WHERE userId = ?")
        .run(Math.max(0, currentAttendance - 1), userId);
    } else if (type === "assignment") {
      db.prepare(
        "INSERT OR IGNORE INTO school_snapshots (userId, attendanceCount, assignmentCount) VALUES (?, 0, 0)"
      ).run(userId);
      db.prepare("UPDATE school_snapshots SET assignmentCount = ? WHERE userId = ?")
        .run(Math.max(0, currentAssignment - 1), userId);
    }

    // 4. 보상 로직 호출
    const result = applySchoolReward(userId, currentAttendance, currentAssignment);
    console.log(`[Admin-Sync] 완료: ${userId}, 보상지급: ${result.hasChange}`);

    res.json({ success: true, hasChange: result.hasChange, delta: result.delta });
  } catch (err) {
    console.error("[Admin-Sync] 실패:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 매일 06:00 UTC 자동 정산 (userId 기준)
// ================================================================

cron.schedule("0 6 * * *", async () => {
  console.log("[Cron] 일일 정산 시작:", new Date().toISOString());

  try {
    const allUsers = db.prepare("SELECT userId FROM users").all();

    for (const { userId } of allUsers) {
      try {
        const alreadyReset = db.prepare(`
          SELECT * FROM daily_reset_log
          WHERE userId = ? AND date(resetAt) = date('now')
        `).get(userId);

        if (alreadyReset) continue;

        // userId로 학교서버 조회
        const attendanceRes = await axios.get(`http://localhost:4000/attendance?userId=${userId}`);
        const assignmentRes = await axios.get(`http://localhost:4000/assignment?userId=${userId}`);

        const attendanceCount = attendanceRes.data.attendance.filter(a => a.status === "출석").length;
        const assignmentCount = assignmentRes.data.assignment.filter(a => a.status === "제출").length;

        applySchoolReward(userId, attendanceCount, assignmentCount);

        db.prepare("INSERT INTO daily_reset_log (userId, resetAt) VALUES (?, datetime('now'))").run(userId);
        console.log(`[Cron] ${userId} - 정산 완료`);

      } catch (err) {
        // 학교서버에 해당 userId 없으면 스킵
        console.warn(`[Cron] ${userId} - 스킵:`, err.message);
      }
    }

    console.log("[Cron] 일일 정산 완료");
  } catch (err) {
    console.error("[Cron] 전체 정산 오류:", err.message);
  }

}, { timezone: "UTC" });

app.listen(PORT, () => {
  console.log(`Game API running on http://localhost:${PORT}`);
});