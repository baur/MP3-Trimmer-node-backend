const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const NodeID3 = require("node-id3");
const fs = require("fs").promises;
const path = require("path");
const { v4: uuidv4 } = require("uuid"); // Для генерации GUID

const app = express();
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  console.log("Received request:", req.method, req.url);
  next();
});

// Эндпоинт для загрузки MP3 и возврата URL
app.post("/upload", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) throw new Error("Аудиофайл не загружен");
    const guid = uuidv4();
    const newPath = path.join(__dirname, "uploads", `${guid}.mp3`);
    await fs.rename(req.file.path, newPath);
    const url = `http://localhost:5000/audio/${guid}`;
    console.log("url:", url);
    res.json({ url });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).send("Ошибка загрузки: " + error.message);
  }
});

// Обновленный эндпоинт /trim
app.post(
  "/trim",
  upload.single("cover"),
  async (req, res) => {
    try {
      const { guid, start, end, title, artist, album, publisher } = req.body;

      if (!guid) throw new Error("GUID не предоставлен");

      const inputPath = path.join(__dirname, "uploads", `${guid}.mp3`);
      if (!(await fs.access(inputPath).then(() => true).catch(() => false))) {
        throw new Error("Файл не найден");
      }

      const startSec = parseFloat(start);
      const endSec = parseFloat(end);
      if (isNaN(startSec) || isNaN(endSec) || startSec < 0 || endSec <= startSec) {
        throw new Error("Некорректные значения времени");
      }

      const outputPath = path.join(__dirname, "outputs", `trimmed_${Date.now()}.mp3`);

      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .setStartTime(startSec)
          .setDuration(endSec - startSec)
          .output(outputPath)
          .on("end", () => {
            console.log("FFmpeg trim completed");
            resolve();
          })
          .on("error", (err) => {
            console.error("FFmpeg error:", err);
            reject(err);
          })
          .run();
      });

      const tags = { title, artist, album, publisher };
      const cover = req.file;

      if (cover) {
        const coverPath = cover.path;
        const coverMime = cover.mimetype;
        const imageBuffer = await fs.readFile(coverPath);
        tags.image = {
          mime: coverMime,
          type: { id: 3, name: "front cover" },
          description: "Cover",
          imageBuffer,
        };
      }

      const result = await NodeID3.write(tags, outputPath);
      if (!result) console.error("Failed to write ID3 tags");

      res.download(outputPath, "trimmed.mp3", async (err) => {
        if (err) console.error("Download error:", err);
        await fs.unlink(inputPath).catch(console.error);
        if (cover) await fs.unlink(cover.path).catch(console.error);
        await fs.unlink(outputPath).catch(console.error);
      });
    } catch (error) {
      console.error("Processing error:", error);
      res.status(500).send("Ошибка обработки: " + error.message);
    }
  }
);


app.get("/audio/:guid", async (req, res) => {
  try {
    const { guid } = req.params;
    const filePath = path.join(__dirname, "uploads", `${guid}.mp3`);
    if (!(await fs.access(filePath).then(() => true).catch(() => false))) {
      return res.status(404).send("Файл не найден");
    }
    res.sendFile(filePath);
  } catch (error) {
    console.error("Ошибка при получении файла:", error);
    res.status(500).send("Ошибка сервера");
  }
});

fs.mkdir(path.join(__dirname, "uploads"), { recursive: true });
fs.mkdir(path.join(__dirname, "outputs"), { recursive: true });

// Функция для удаления файлов старше 3 часов
const cleanOldFiles = async () => {
  try {
    const uploadsDir = path.join(__dirname, "uploads");
    const files = await fs.readdir(uploadsDir);
    // const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000; // 3 часа в миллисекундах
    const threeHoursAgo = Date.now() -  60 * 1000; // 3 часа в миллисекундах

    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      const stats = await fs.stat(filePath);
      if (stats.mtimeMs < threeHoursAgo) {
        await fs.unlink(filePath);
        console.log(`Удален старый файл: ${file}`);
      }
    }
  } catch (error) {
    console.error("Ошибка при очистке старых файлов:", error);
  }
};

// Запуск очистки каждые 30 минут
// setInterval(cleanOldFiles, 30 * 60 * 1000);
setInterval(cleanOldFiles, 60 * 1000);

app.listen(5000, () => console.log("Сервер запущен на порту 5000"));