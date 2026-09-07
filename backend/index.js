const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    mensaje: "Backend de VetTrack funcionando correctamente",
  });
});

app.listen(PORT, () => {
  console.log(`VetTrack Backend ejecutándose en http://localhost:${PORT}`);
});