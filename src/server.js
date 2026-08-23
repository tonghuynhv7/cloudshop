const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");

const app = express();

const PORT = process.env.PORT || 3000;

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || "cloudshop",
  user: process.env.DB_USER || "clouduser",
  password: process.env.DB_PASSWORD || "cloudpass",
});

const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST || "localhost"}:${
    process.env.REDIS_PORT || 6379
  }`,
});

redisClient.on("error", (err) => {
  console.error("Redis error:", err.message);
});

app.get("/", (req, res) => {
  res.json({
    service: "cloudshop-api",
    status: "running",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
  });
});

app.get("/ready", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    if (!redisClient.isOpen) {
      await redisClient.connect();
    }

    await redisClient.ping();

    res.status(200).json({
      status: "ready",
      database: "connected",
      redis: "connected",
    });
  } catch (error) {
    res.status(503).json({
      status: "not ready",
      error: error.message,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CloudShop API running on port ${PORT}`);
});
app.get("/version", (req, res) => {
  res.json({
    version: "1.0.0",
  });
});