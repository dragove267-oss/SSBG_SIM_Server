const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const gameRouter = require("./routes/game");
app.use("/api", gameRouter);

app.listen(PORT, () => {
  console.log(`Game API running on http://localhost:${PORT}`);
});