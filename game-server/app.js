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

//매일 06:00 UTC 자동 정산 스케줄러
cron.schedule("0 6 * * *", async () => {
  console.log("[Cron] 일일 정산 시작:", new Date().toISOString());

  try {
    const allUsers = db.prepare("SELECT userId FROM users").all();

    for (const { userId } of allUsers) {
      try {
        // 오늘 이미 리셋했는지 확인
        const alreadyReset = db.prepare(`
          SELECT * FROM daily_reset_log
          WHERE userId = ? AND date(resetAt) = date('now')
        `).get(userId);

        if (alreadyReset) {
          console.log(`[Cron] ${userId} - 이미 정산 완료, 스킵`);
          continue;
        }

        // 학교서버에서 최신 데이터 가져오기
        const attendanceRes = await axios.get(`http://localhost:4000/attendance?userId=${userId}`);
        const assignmentRes = await axios.get(`http://localhost:4000/assignment?userId=${userId}`);

        const attendanceCount = attendanceRes.data.attendance.filter(a => a.status === "출석").length;
        const assignmentCount = assignmentRes.data.assignment.filter(a => a.status === "제출").length;

        applySchoolReward(userId, attendanceCount, assignmentCount);

        db.prepare(
          "INSERT INTO daily_reset_log (userId, resetAt) VALUES (?, datetime('now'))"
        ).run(userId);

        console.log(`[Cron] ${userId} - 정산 완료 (출석: ${attendanceCount}, 과제: ${assignmentCount})`);

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