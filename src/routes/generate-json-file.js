import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const router = express.Router();

router.post("/", async (req, res) => {
  let filePath = null;

  try {
    const { scenes } = req.body;

    // 1. Validazione Input Strict
    if (!scenes || !Array.isArray(scenes)) {
      return res.status(400).json({
        success: false,
        error: "Invalid input: 'scenes' must be an array.",
      });
    }

    if (scenes.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid input: 'scenes' array cannot be empty.",
      });
    }

    // 2. Generazione nome file univoco (Prevenzione Race Conditions)
    const uniqueId = crypto.randomUUID();
    const fileName = `zen_scenes_${uniqueId}.json`;
    const tempDir = os.tmpdir();
    filePath = path.join(tempDir, fileName);

    // 3. Creazione contenuto JSON formattato
    const fileContent = JSON.stringify({ scenes }, null, 2);

    // 4. Scrittura su disco (Async)
    await fs.promises.writeFile(filePath, fileContent, "utf8");

    // 5. Invio File e Cleanup automatico
    // res.download imposta automaticamente Content-Disposition: attachment
    res.download(filePath, "scenes_export.json", (err) => {
      if (err) {
        console.error("❌ Error sending file:", err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: "Download failed." });
        }
      }

      // 6. Eliminazione file temporaneo (Cleanup)
      if (filePath) {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) console.error("⚠️ Failed to delete temp file:", unlinkErr);
        });
      }
    });

  } catch (error) {
    console.error("🔥 Error generating JSON file:", error);

    // Cleanup in caso di errore
    if (filePath) {
      fs.unlink(filePath, () => {});
    }

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "Internal Server Error during file generation.",
      });
    }
  }
});

export default router;
