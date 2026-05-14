const axios = require("axios");
const schoolDb = require("../database/school-db");

const GAME_SERVER = "http://localhost:3000";

// 학번(userId) 존재 여부 확인
function verifyStudent(userId) {
  const row = schoolDb.prepare(
    "SELECT userId FROM attendance WHERE userId = ? LIMIT 1"
  ).get(userId);
  return !!row;
}

// 출석 데이터 조회
function getAttendance(userId) {
  return schoolDb.prepare(
    "SELECT week, status FROM attendance WHERE userId = ? ORDER BY week ASC"
  ).all(userId);
}

// 과제 데이터 조회
function getAssignment(userId) {
  return schoolDb.prepare(
    "SELECT name, status FROM assignment WHERE userId = ? ORDER BY name ASC"
  ).all(userId);
}

// 출석/과제 카운트 계산
function calculateReward(attendance, assignment) {
  const attendanceCount = attendance.filter(a => a.status === "출석").length;
  const assignmentCount = assignment.filter(a => a.status === "제출").length;
  return { attendanceCount, assignmentCount };
}

// 게임서버로 푸시
async function pushToGameServer(userId, attendanceCount, assignmentCount) {
  try {
    const res = await axios.post(
      `${GAME_SERVER}/api/school-webhook`,
      { userId, attendanceCount, assignmentCount }
    );
    console.log(`[Webhook] 게임서버 전송 성공:`, res.data);
    return res.data;
  } catch (err) {
    console.error(`[Webhook] 게임서버 전송 실패:`, err.message);
    throw err;
  }
}

module.exports = { verifyStudent, getAttendance, getAssignment, calculateReward, pushToGameServer };