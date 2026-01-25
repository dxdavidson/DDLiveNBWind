import express from "express";
const app = express();

app.get("/health", (req, res) => {
  res.send("ok");
});

const PORT = process.env.PORT;
app.listen(PORT, "0.0.0.0", () => {
  console.log("V6 Listening on", PORT);
});
