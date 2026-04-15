const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

const schoolRouter = require("./routes/school");
app.use("/", schoolRouter);

app.listen(PORT, () => {
  console.log(`School API running on http://134.185.100.53:${PORT}`);
});