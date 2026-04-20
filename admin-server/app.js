const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- API 엔드포인트 ---

// 1. 유저 리스트 조회 (게임 서버 API 호출)
app.get("/api/admin/users", async (req, res) => {
  try {
    const response = await axios.get("http://localhost:3000/api/admin/users");
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.response?.data || err.message });
  }
});

// 2. 유저 데이터 수정 (기존 게임 서버 API 호출)
app.post("/api/admin/user/modify", async (req, res) => {
  const { userId, currencyType, amount, action } = req.body;
  const endpoint = action === "gain" ? "/api/currency/gain" : "/api/spend-currency";
  
  try {
    const response = await axios.post(`http://localhost:3000${endpoint}`, {
      userId,
      currencyType,
      amount: parseInt(amount)
    });
    res.json({ success: true, data: response.data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.response?.data || err.message });
  }
});

// 3. 학교 서버 웹훅 트리거
app.post("/api/admin/school/trigger-update", async (req, res) => {
  const { userId } = req.body;
  try {
    const response = await axios.post("http://localhost:4000/notify-update", { userId });
    res.json({ success: true, data: response.data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.response?.data || err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Admin Dashboard API running on http://0.0.0.0:${PORT}`);
});
