const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");

const app = express();

const PORT = process.env.PORT || 3000;

// =========================
// PostgreSQL
// =========================
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || "cloudshop",
  user: process.env.DB_USER || "clouduser",
  password: process.env.DB_PASSWORD || "cloudpass",
});

// =========================
// Redis
// =========================
// Phase hiện tại trên AWS chưa có ElastiCache,
// nên chỉ tạo Redis client khi REDIS_HOST được cấu hình.
let redisClient = null;

if (process.env.REDIS_HOST) {
  redisClient = createClient({
    url: `redis://${process.env.REDIS_HOST}:${
      process.env.REDIS_PORT || 6379
    }`,
  });

  redisClient.on("error", (err) => {
    console.error("Redis error:", err.message);
  });
}

// =========================
// Routes
// =========================

app.get("/", (req, res) => {
  res.json({
    service: "cloudshop-api",
    status: "running",
  });
});

// Liveness check
// Dùng cho ALB Health Check
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
  });
});

// PostgreSQL health check
// Dùng để test ECS -> RDS
app.get("/db-health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.status(200).json({
      status: "healthy",
      database: "connected",
      time: result.rows[0].now,
    });
  } catch (error) {
    console.error("Database error:", error.message);

    res.status(503).json({
      status: "unhealthy",
      database: "disconnected",
      error: error.message,
    });
  }
});

// Readiness check
app.get("/ready", async (req, res) => {
  try {
    // Check PostgreSQL
    await pool.query("SELECT 1");

    let redisStatus = "not-configured";

    // Chỉ check Redis nếu AWS/local đã cấu hình REDIS_HOST
    if (redisClient) {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }

      await redisClient.ping();
      redisStatus = "connected";
    }

    res.status(200).json({
      status: "ready",
      database: "connected",
      redis: redisStatus,
    });
  } catch (error) {
    console.error("Readiness check failed:", error.message);

    res.status(503).json({
      status: "not ready",
      error: error.message,
    });
  }
});

app.get("/version", (req, res) => {
  res.json({
    version: "1.0.0",
  });
});

// =========================
// Start server
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`CloudShop API running on port ${PORT}`);
});