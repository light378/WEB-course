const express = require("express");
const multer = require("multer");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const UPLOAD_DIR = path.join(__dirname, "uploads");

// Переконатись, що папка uploads існує
(async () => {
  try {
    await fs.access(UPLOAD_DIR);
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  }
})();

// Налаштування multer для збереження фото
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  },
});
const upload = multer({ storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

async function readRecords() {
  try {
    const text = await fs.readFile(DATA_FILE, "utf8");
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

app.get("/records", async (req, res) => {
  const records = await readRecords();
  res.json(records);
});

app.post("/submit", upload.single("photo"), async (req, res) => {
  const { date, time, type, address, description, victims } = req.body;
  const photo = req.file ? req.file.filename : "";

  const records = await readRecords();
  const newId = records.length ? Math.max(...records.map((r) => r.id)) + 1 : 1;

  const newRecord = {
    id: newId,
    date: date || "",
    time: time || "",
    type: type || "",
    address: address || "",
    description: description || "",
    victims: victims ? Number(victims) : 0,
    photo,
    createdAt: new Date().toISOString(),
  };

  records.push(newRecord);
  await fs.writeFile(DATA_FILE, JSON.stringify(records, null, 2), "utf8");
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log(`Сервер запущено: http://localhost:${PORT}`);
});