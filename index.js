const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const NodeID3 = require("node-id3");
const fs = require("fs").promises;
const path = require("path");

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

app.post(
  "/trim",
  upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "cover", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      console.log("Request Files:", req.files);
      console.log("Processing trim request:", req.body, req.files);

      const { start, end, title, artist, album, publisher } = req.body;

      if (!req.files || !req.files.audio) {
        throw new Error("Аудиофайл не был загружен");
      }

      const startSec = parseFloat(start);
      const endSec = parseFloat(end);
      if (
        isNaN(startSec) ||
        isNaN(endSec) ||
        startSec < 0 ||
        endSec <= startSec
      ) {
        throw new Error("Некорректные значения времени");
      }

      const inputPath = req.files.audio[0].path;
      const outputPath = path.join(
        __dirname,
        "outputs",
        `trimmed_${Date.now()}.mp3`
      );

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
      const cover = req.files?.cover;

      if (cover) {
        const coverFile = req.files.cover[0];
        const coverPath = coverFile.path;
        const coverMime = coverFile.mimetype;

        if (coverMime !== "image/jpeg") {
          console.warn("Cover is not a JPEG image, converting to JPEG if needed.");
        }

        console.log("Cover file:", coverFile);
        console.log("Cover path:", coverPath);

        const imageBuffer = await fs.readFile(coverPath);

        tags.image = {
          mime: coverMime,
          type: {
            id: 3,
            name: "front cover",
          },
          description: "Cover",
          imageBuffer: imageBuffer,
        };
        console.log("Cover file assigned successfully");
      }

      const result = await NodeID3.write(tags, outputPath);
      if (!result) {
        console.error("Failed to write ID3 tags");
      } else {
        console.log("ID3 tags added successfully");
      }

      res.download(outputPath, "trimmed.mp3", async (err) => {
        if (err) console.error("Download error:", err);
        console.log("Cleaning up files");
        await fs.unlink(inputPath).catch(console.error);
        if (cover) await fs.unlink(cover[0].path).catch(console.error);
        await fs.unlink(outputPath).catch(console.error);
      });
    } catch (error) {
      console.error("Processing error:", error);
      res.status(500).send("Error processing audio: " + error.message);
      if (req.files?.audio)
        await fs.unlink(req.files.audio[0].path).catch(console.error);
      if (req.files?.cover)
        await fs.unlink(req.files.cover[0].path).catch(console.error);
    }
  }
);

fs.mkdir(path.join(__dirname, "outputs"), { recursive: true });

app.listen(5000, () => console.log("Server running on port 5000"));