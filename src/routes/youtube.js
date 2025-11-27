import express from "express";
import { getVideoInfo } from "../services/youtubeService.js";

const router = express.Router();

/**
 * Health-check rapido del modulo YouTube
 */
router.get("/test", (req, res) => {
  res.json({ status: "ok", message: "YouTube endpoint attivo" });
});

/**
 * Recupera info base da un video YouTube
 * Body:
 * { "videoUrl": "https://www.youtube.com/..." }
 */
router.post("/", async (req, res) => {
  try {
    const { videoUrl } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ error: "Missing videoUrl" });
    }

    const data = await getVideoInfo(videoUrl);

    res.json({
      video: data.video,
      channel: data.channel,
    });
  } catch (error) {
    console.error("YouTube Route Error:", error);
    res.status(500).json({ error: "Error retrieving video info" });
  }
});

export default router;
