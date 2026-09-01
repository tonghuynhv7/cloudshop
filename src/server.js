import express from "express";
import pg from "pg";
import { createClient } from "redis";

const { Pool } = pg;

const app = express();
app.use(express.json());

// ======================================================
// 1. ENVIRONMENT
// ======================================================

const PORT = Number(process.env.PORT || 3000);

const DB_HOST = process.env.DB_HOST;
const DB_PORT = Number(process.env.DB_PORT || 5432);
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;

const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

// ======================================================
// 2. POSTGRESQL
// ======================================================

const pool = new Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,

  // RDS nằm private VPC nên project lab hiện tại
  // chưa bắt buộc SSL nếu DB config không yêu cầu.
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err);
});

// ======================================================
// 3. REDIS / VALKEY
// ======================================================

const redisClient = createClient({
  socket: {
    host: REDIS_HOST,
    port: REDIS_PORT,

    // Không để app treo vô hạn khi Redis có vấn đề
    connectTimeout: 5000,

    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error("Redis reconnect limit reached");
        return new Error("Redis reconnect limit reached");
      }

      return Math.min(retries * 500, 3000);
    },
  },
});

redisClient.on("connect", () => {
  console.log("Connecting to Redis/Valkey...");
});

redisClient.on("ready", () => {
  console.log("Redis/Valkey connected");
});

redisClient.on("error", (err) => {
  console.error("Redis/Valkey error:", err.message);
});

redisClient.on("reconnecting", () => {
  console.log("Reconnecting to Redis/Valkey...");
});

// ======================================================
// 4. BASIC ROUTE
// ======================================================

app.get("/", (req, res) => {
  res.status(200).json({
    service: "cloudshop-api",
    message: "CloudShop API is running",
  });
});

// ======================================================
// 5. LIVENESS
//
// Chỉ kiểm tra Node.js process còn hoạt động.
// KHÔNG kiểm tra DB / Redis.
// ALB/container có thể dùng endpoint này nếu muốn
// chỉ xác định process còn sống.
// ======================================================

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    service: "cloudshop-api",
    uptime: Math.floor(process.uptime()),
    time: new Date().toISOString(),
  });
});

// ======================================================
// 6. READINESS
//
// Kiểm tra application đã sẵn sàng nhận traffic chưa.
// Phải kết nối được:
// - PostgreSQL
// - Redis / Valkey
// ======================================================

app.get("/ready", async (req, res) => {
  const checks = {
    database: "disconnected",
    redis: "disconnected",
  };

  try {
    // PostgreSQL
    await pool.query("SELECT 1");
    checks.database = "connected";

    // Redis / Valkey
    if (!redisClient.isReady) {
      throw new Error("Redis client is not ready");
    }

    await redisClient.ping();
    checks.redis = "connected";

    return res.status(200).json({
      status: "ready",
      ...checks,
      time: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Readiness check failed:", error.message);

    return res.status(503).json({
      status: "not_ready",
      ...checks,
      error: error.message,
      time: new Date().toISOString(),
    });
  }
});

// ======================================================
// 7. TEST POSTGRESQL
// ======================================================

app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT NOW() AS database_time"
    );

    res.status(200).json({
      status: "success",
      database: "connected",
      databaseTime: result.rows[0].database_time,
    });
  } catch (error) {
    console.error("Database test failed:", error);

    res.status(500).json({
      status: "error",
      database: "disconnected",
      error: error.message,
    });
  }
});

// ======================================================
// 8. TEST REDIS / VALKEY
//
// Test thực tế:
// SET cloudshop:test
// GET cloudshop:test
// ======================================================

app.get("/redis-test", async (req, res) => {
  try {
    if (!redisClient.isReady) {
      return res.status(503).json({
        status: "error",
        redis: "disconnected",
        message: "Redis client is not ready",
      });
    }

    const key = "cloudshop:test";
    const value = `hello-valkey-${Date.now()}`;

    // Lưu 60 giây để không tạo key rác lâu dài
    await redisClient.set(key, value, {
      EX: 60,
    });

    const result = await redisClient.get(key);

    res.status(200).json({
      status: "success",
      redis: "connected",
      key,
      value: result,
    });
  } catch (error) {
    console.error("Redis test failed:", error);

    res.status(500).json({
      status: "error",
      redis: "disconnected",
      error: error.message,
    });
  }
});

// ======================================================
// 9. SIMPLE CACHE DEMO
//
// Minh họa flow:
//
// Client
//   ↓
// API
//   ↓
// Redis check
//   ├─ HIT  → trả cache
//   └─ MISS → query PostgreSQL → cache → response
// ======================================================

app.get("/cache-demo", async (req, res) => {
  const cacheKey = "cloudshop:demo";

  try {
    // ----- Cache HIT -----
    if (redisClient.isReady) {
      const cached = await redisClient.get(cacheKey);

      if (cached) {
        return res.status(200).json({
          source: "redis",
          cache: "HIT",
          data: JSON.parse(cached),
        });
      }
    }

    // ----- Cache MISS -----
    const dbResult = await pool.query(`
      SELECT
        NOW() AS database_time,
        current_database() AS database_name
    `);

    const data = dbResult.rows[0];

    // Cache 30 giây
    if (redisClient.isReady) {
      await redisClient.set(
        cacheKey,
        JSON.stringify(data),
        {
          EX: 30,
        }
      );
    }

    return res.status(200).json({
      source: "postgresql",
      cache: "MISS",
      data,
    });
  } catch (error) {
    console.error("Cache demo failed:", error);

    return res.status(500).json({
      status: "error",
      error: error.message,
    });
  }
});

// ======================================================
// 10. 404
// ======================================================

app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Route not found",
  });
});

// ======================================================
// 11. CONNECT DEPENDENCIES + START SERVER
// ======================================================

async function startServer() {
  try {
    // --------------------------------------------------
    // PostgreSQL test
    // --------------------------------------------------

    console.log("Testing PostgreSQL connection...");

    await pool.query("SELECT 1");

    console.log("PostgreSQL connected");

    // --------------------------------------------------
    // Redis / Valkey
    // --------------------------------------------------

    console.log("Connecting to Redis/Valkey...");

    await redisClient.connect();

    const pong = await redisClient.ping();

    console.log(`Redis/Valkey response: ${pong}`);

    // --------------------------------------------------
    // Express
    // --------------------------------------------------

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`CloudShop API running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Application startup failed:", error);

    process.exit(1);
  }
}

startServer();

// ======================================================
// 12. GRACEFUL SHUTDOWN
//
// Khi ECS stop task:
// SIGTERM
//    ↓
// close Redis
//    ↓
// close PostgreSQL pool
//    ↓
// exit
// ======================================================

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);

  try {
    if (redisClient.isOpen) {
      await redisClient.quit();
      console.log("Redis connection closed");
    }

    await pool.end();
    console.log("PostgreSQL pool closed");

    process.exit(0);
  } catch (error) {
    console.error("Shutdown error:", error);

    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));