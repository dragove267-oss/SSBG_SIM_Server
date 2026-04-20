const axios = require("axios");

const SCHOOL_API  = "http://localhost:4000";
const GAME_SERVER = "http://localhost:3000";

async function getAttendance(userId) {
  const res = await axios.get(
    `${SCHOOL_API}/attendance?userId=${userId}`
  );
  return res.data.attendance;
}

async function getAssignment(userId) {
  const res = await axios.get(
    `${SCHOOL_API}/assignment?userId=${userId}`
  );
  return res.data.assignment;
}

function calculateReward(attendance, assignment) {
  const attendanceCount = attendance.filter(a => a.status === "출석").length;
  const assignmentCount = assignment.filter(a => a.status === "제출").length;
  return { attendanceCount, assignmentCount };
}

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

module.exports = { getAttendance, getAssignment, calculateReward, pushToGameServer };