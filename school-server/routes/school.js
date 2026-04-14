const express = require("express");
const router = express.Router();
const {
  getAttendance,
  getAssignment,
  calculateReward,
  pushToGameServer
} = require("../services/schoolService");
const data = require("../data/mockData.json");

// 출석 조회
router.get("/attendance", (req, res) => {
  const { userId } = req.query;
  res.json({ userId, attendance: data.attendance });
});

// 과제 조회
router.get("/assignment", (req, res) => {
  const { userId } = req.query;
  res.json({ userId, assignment: data.assignment });
});

// 학교 데이터 변동 시 게임서버로 푸시
router.post("/notify-update", async (req, res) => {
  const { userId } = req.body;

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