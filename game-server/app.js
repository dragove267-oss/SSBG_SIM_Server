const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const axios = require("axios");
const db = require("./database/db");
const { getOrCreateUser, applySchoolReward } = require("./services/userService");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const gameRouter = require("./routes/game");
app.use("/api", gameRouter);

// 어드민 연동 보상 재계산 API
app.post("/api/admin/apply-reward", async (req, res) => {
  const { userId, type } = req.body; 
  console.log(`[Admin-Sync] 보상 동기화 요청 수신: ${userId} (${type})`);
  try {
    const { syncAttendanceRecords, syncAssignmentRecords } = require("./services/userService");
    const user = db.prepare("SELECT studentId FROM users WHERE userId = ?").get(userId);
    
    if (user && user.studentId) {
        // 1. School Server에서 최신 데이터 가져와서 로컬 DB 동기화
        console.log(`[Admin-Sync] School Server 데이터 가져오는 중... (StudentId: ${user.studentId})`);
        const attendanceRes = await axios.get(`http://localhost:4000/attendance?studentId=${user.studentId}`);
        const assignmentRes = await axios.get(`http://localhost:4000/assignment?studentId=${user.studentId}`);
        
        syncAttendanceRecords(userId, attendanceRes.data.attendance);
        syncAssignmentRecords(userId, assignmentRes.data.assignment);
    }

    // 2. 현재 로컬 DB의 실제 유효한(출석/제출) 개수 파악
    const currentAttendance = db.prepare("SELECT COUNT(*) as count FROM academic_attendance WHERE userId = ? AND status = '출석'").get(userId).count;
    const currentAssignment = db.prepare("SELECT COUNT(*) as count FROM academic_assignment WHERE userId = ? AND status = '제출'").get(userId).count;

    // 3. 관리자 조작 시 해당 타입의 스냅샷을 현재 개수보다 무조건 1 작게 강제 조정
    if (type === 'attendance') {
        db.prepare("INSERT OR IGNORE INTO school_snapshots (userId, attendanceCount, assignmentCount) VALUES (?, 0, 0)").run(userId);
        db.prepare("UPDATE school_snapshots SET attendanceCount = ? WHERE userId = ?")
          .run(Math.max(0, currentAttendance - 1), userId);
    } else if (type === 'assignment') {
        db.prepare("INSERT OR IGNORE INTO school_snapshots (userId, attendanceCount, assignmentCount) VALUES (?, 0, 0)").run(userId);
        db.prepare("UPDATE school_snapshots SET assignmentCount = ? WHERE userId = ?")
          .run(Math.max(0, currentAssignment - 1), userId);
    }

    // 4. 보상 로직 호출
    const result = applySchoolReward(userId, currentAttendance, currentAssignment);
    
    console.log(`[Admin-Sync] 동기화 완료: ${userId}, 보상지급: ${result.hasChange}`);
    res.json({ success: true, hasChange: result.hasChange, delta: result.delta });
  } catch (err) {
    console.error("[Admin-Sync] 보상 적용 실패 상세:", err);
    res.status(500).json({ error: err.message });
  }
});

//매일 06:00 UTC 자동 정산 스케줄러
cron.schedule("0 6 * * *", async () => {
  console.log("[Cron] 일일 정산 시작:", new Date().toISOString());

  try {
    // 학번(studentId)이 연결된 유저들만 조회
    const mappedUsers = db.prepare("SELECT userId, studentId FROM users WHERE studentId IS NOT NULL").all();

    for (const { userId, studentId } of mappedUsers) {
      try {
        // 오늘 이미 리셋했는지 확인
        const alreadyReset = db.prepare(`
          SELECT * FROM daily_reset_log
          WHERE userId = ? AND date(resetAt) = date('now')
        `).get(userId);

        if (alreadyReset) continue;

        // 학교서버에서 학번(studentId)으로 최신 데이터 가져오기
        const attendanceRes = await axios.get(`http://localhost:4000/attendance?studentId=${studentId}`);
        const assignmentRes = await axios.get(`http://localhost:4000/assignment?studentId=${studentId}`);

        const attendanceCount = attendanceRes.data.attendance.filter(a => a.status === "출석").length;
        const assignmentCount = assignmentRes.data.assignment.filter(a => a.status === "제출").length;

        applySchoolReward(userId, attendanceCount, assignmentCount);

        db.prepare("INSERT INTO daily_reset_log (userId, resetAt) VALUES (?, datetime('now'))").run(userId);
        console.log(`[Cron] ${userId} (${studentId}) - 정산 완료`);

      } catch (err) {
        console.error(`[Cron] ${userId} - 정산 실패:`, err.message);
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