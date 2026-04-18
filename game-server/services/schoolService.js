const axios = require("axios");

const SCHOOL_API = "http://localhost:4000";

// 출석 가져오기
async function getAttendance(userId) {
  const res = await axios.get(
    `${SCHOOL_API}/attendance?userId=${userId}`
  );
  return res.data.attendance;
}

// 과제 가져오기
async function getAssignment(userId) {
  const res = await axios.get(
    `${SCHOOL_API}/assignment?userId=${userId}`
  );
  return res.data.assignment;
}

module.exports = {
  getAttendance,
  getAssignment
};