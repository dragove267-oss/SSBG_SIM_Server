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
    let attendanceList = [];
    let assignmentList = [];
    try {
      const attendanceRes = await axios.get(`http://localhost:4000/attendance?userId=${userId}`);
      attendanceList = attendanceRes.data.attendance || [];
    } catch (e) {
      console.warn(`[Admin-Sync] 출석 데이터 없음: ${userId}`);
    }
    try {
      const assignmentRes = await axios.get(`http://localhost:4000/assignment?userId=${userId}`);
      assignmentList = assignmentRes.data.assignment || [];
    } catch (e) {
      console.warn(`[Admin-Sync] 과제 데이터 없음: ${userId}`);
    }

    // 로컬 DB 동기화
    syncAttendanceRecords(userId, attendanceList);
    syncAssignmentRecords(userId, assignmentList);

    // 2. 로컬 DB의 실제 유효한 개수 파악
    const currentAttendance = attendanceList.filter(a => a.status === "출석").length;
    const currentAssignment = assignmentList.filter(a => a.status === "제출").length;

    // 3. 해당 타입 스냅샷을 현재보다 1 작게 강제 조정 (보상 1회 트리거 보장)
    db.prepare(
      "INSERT OR IGNORE INTO school_snapshots (userId, attendanceCount, assignmentCount) VALUES (?, 0, 0)"
    ).run(userId);

    if (type === "attendance") {
      db.prepare("UPDATE school_snapshots SET attendanceCount = ? WHERE userId = ?")
        .run(Math.max(0, currentAttendance - 1), userId);
    } else if (type === "assignment") {
      db.prepare("UPDATE school_snapshots SET assignmentCount = ? WHERE userId = ?")
        .run(Math.max(0, currentAssignment - 1), userId);
    }

    // 4. 보상 로직 호출 (applySchoolReward 내부에서 스냅샷과 비교하여 로그를 남김)
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