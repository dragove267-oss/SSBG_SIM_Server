const axios = require("axios");
const db = require("../database/db");

const GAME_SERVER = "http://localhost:3000";

// 학번(studentId) 기준으로 출석 데이터 조회
async function getAttendance(studentId) {
  try {
    return db.prepare("SELECT week, status FROM attendance WHERE studentId = ? ORDER BY week ASC").all(studentId);
  } catch (err) {
    console.error(`[SchoolService] 출석 조회 실패:`, err.message);
    return [];
  }
}

// 학번(studentId) 기준으로 과제 데이터 조회
async function getAssignment(studentId) {
  try {
    return db.prepare("SELECT name, status FROM assignment WHERE studentId = ? ORDER BY id ASC").all(studentId);
  } catch (err) {
    console.error(`[SchoolService] 과제 조회 실패:`, err.message);
    return [];
  }
}

// 출석/과제 횟수 계산
function calculateReward(attendance, assignment) {
  const attendanceCount = attendance.filter(a => a.status === "출석").length;
  const assignmentCount = assignment.filter(a => a.status === "제출").length;
  return { attendanceCount, assignmentCount };
}

// 게임 서버로 데이터 전송 (연동)
async function pushToGameServer(userId, attendanceCount, assignmentCount) {
  if (!userId) return;
  try {
    const res = await axios.post(
      `${GAME_SERVER}/api/school-webhook`,
      { userId, attendanceCount, assignmentCount }
    );
    return res.data;
  } catch (err) {
    console.error(`[SchoolService] 게임서버 전송 실패:`, err.message);
    throw err;
  }
}

module.exports = { getAttendance, getAssignment, calculateReward, pushToGameServer };
