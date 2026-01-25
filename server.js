import express from "express";

const app = express();

// Optional: allow cross-origin requests (needed if your client is separate)
import cors from "cors";
app.use(cors());

// Optional: logging middleware for debugging
app.use((req, res, next) => {
  console.log(req.method, req.url);
  next();
});

// Health-check endpoint
app.get("/health", (req, res) => res.send("ok"));

// Example Puppeteer-ready endpoint (not running by default)
app.get("/api/wind", async (req, res) => {
  try {
    res.status(200).json({ message: "Puppeteer endpoint ready" });
  } catch (err) {
    console.error("Error in /api/wind:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("V8 Listening on", PORT);
});
