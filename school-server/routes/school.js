const express = require("express");
const router = express.Router();
const {
  verifyStudent,
  getAttendance,
  getAssignment,
  calculateReward,
  pushToGameServer
} = require("../services/schoolService");

// 학번 검증
router.post("/verify-student", (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const exists = verifyStudent(userId);
  if (!exists) {
    return res.status(404).json({ success: false, message: "등록되지 않은 학번입니다." });
  }

  res.json({ success: true, userId });
});

// 출석 조회
router.get("/attendance", (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const attendance = getAttendance(userId);
  if (!attendance || attendance.length === 0) {
    return res.status(404).json({ error: "학번을 찾을 수 없습니다." });
  }

  res.json({ userId, attendance });
});

// 과제 조회
router.get("/assignment", (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const assignment = getAssignment(userId);
  if (!assignment || assignment.length === 0) {
    return res.status(404).json({ error: "학번을 찾을 수 없습니다." });
  }

  res.json({ userId, assignment });
});

// 학교 데이터 변동 시 게임서버로 푸시
router.post("/notify-update", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  if (!verifyStudent(userId)) {
    return res.status(404).json({ error: "등록되지 않은 학번입니다." });
  }

  try {
    const attendance = getAttendance(userId);
    const assignment = getAssignment(userId);
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