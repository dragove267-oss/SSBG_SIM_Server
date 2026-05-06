const express = require("express");
const router = express.Router();
const db = require("../database/db");
const {
  calculateReward,
  pushToGameServer
} = require("../services/schoolService");

// 출석 조회 (학번 기준)
router.get("/attendance", (req, res) => {
  const { studentId } = req.query;
  if (!studentId) return res.status(400).json({ error: "studentId required" });

  const attendance = db.prepare("SELECT week, status FROM attendance WHERE studentId = ? ORDER BY week ASC").all(studentId);
  res.json({ studentId, attendance });
});

// 과제 조회 (학번 기준)
router.get("/assignment", (req, res) => {
  const { studentId } = req.query;
  if (!studentId) return res.status(400).json({ error: "studentId required" });

  const assignment = db.prepare("SELECT name, status FROM assignment WHERE studentId = ? ORDER BY id ASC").all(studentId);
  res.json({ studentId, assignment });
});

// 학교 데이터 변동 시 게임서버로 푸시
router.post("/notify-update", async (req, res) => {
  const { studentId, userId } = req.body; // 매핑을 위해 둘 다 받음

  if (!userId) {
    return res.status(400).json({ error: "userId required" });
  }

  try {
    const attendance = await getAttendance(userId);
    const assignment = await getAssignment(userId);
    const { attendanceCount, assignmentCount } = calculateReward(attendance, assignment);

    const result = await pushToGameServer(userId, attendanceCount, assignmentCount);

    res.json({
      success: true,
      sent: { attendanceCount, assignmentCount },
      gameServerResponse: result
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;