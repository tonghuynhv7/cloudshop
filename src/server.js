const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");

const app = express();

app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;

// =====================================================
// PostgreSQL
// =====================================================

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || "cloudshop",
  user: process.env.DB_USER || "clouduser",
  password: process.env.DB_PASSWORD || "cloudpass",

  // Local PostgreSQL: DB_SSL=false
  // AWS RDS: DB_SSL=true
  ssl:
    process.env.DB_SSL === "true"
      ? {
          rejectUnauthorized: false,
        }
      : false,
});

pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err.message);
});

// =====================================================
// Redis
// =====================================================

// Redis chưa triển khai trên AWS thì không set REDIS_HOST.
// Khi triển khai ElastiCache sau này chỉ cần thêm REDIS_HOST.
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

// =====================================================
// Routes
// =====================================================

// Root endpoint
app.get("/", (req, res) => {
  res.status(200).json({
    service: "cloudshop-api",
    status: "running",
  });
});

// -----------------------------------------------------
// Liveness health check
// -----------------------------------------------------
// ALB dùng endpoint này.
// Không phụ thuộc PostgreSQL/Redis.
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
  });
});

// -----------------------------------------------------
// PostgreSQL health check
// -----------------------------------------------------
// Dùng để chứng minh ECS -> RDS hoạt động.
app.get("/db-health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS current_time");

    res.status(200).json({
      status: "healthy",
      database: "connected",
      time: result.rows[0].current_time,
    });
  } catch (error) {
    console.error("Database health check failed:", error.message);

    res.status(503).json({
      status: "unhealthy",
      database: "disconnected",
      error: error.message,
    });
  }
});

// -----------------------------------------------------
// Readiness check
// -----------------------------------------------------
// PostgreSQL bắt buộc.
// Redis chỉ được kiểm tra nếu REDIS_HOST đã được cấu hình.
app.get("/ready", async (req, res) => {
  try {
    // Check PostgreSQL
    await pool.query("SELECT 1");

    let redisStatus = "not-configured";

    // Check Redis only if configured
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
      status: "not-ready",
      error: error.message,
    });
  }
});

// -----------------------------------------------------
// Version endpoint
// -----------------------------------------------------
app.get("/version", (req, res) => {
  res.status(200).json({
    service: "cloudshop-api",
    version: "1.0.0",
  });
});

// =====================================================
// Start Server
// =====================================================

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`CloudShop API running on port ${PORT}`);
});

// =====================================================
// Graceful Shutdown
// =====================================================

// ECS gửi SIGTERM khi:
// - rolling deployment
// - scale-in
// - task replacement
//
// App sẽ đóng connection sạch sẽ trước khi container dừng.

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);

  server.close(async () => {
    try {
      await pool.end();
      console.log("PostgreSQL pool closed.");

      if (redisClient && redisClient.isOpen) {
        await redisClient.quit();
        console.log("Redis connection closed.");
      }

      console.log("CloudShop API stopped.");
      process.exit(0);
    } catch (error) {
      console.error("Shutdown error:", error.message);
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));