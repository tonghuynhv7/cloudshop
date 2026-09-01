import express from "express";
import pg from "pg";
import { createCluster } from "redis";

const { Pool } = pg;

const app = express();
app.use(express.json());

// =====================================================
// 1. ENVIRONMENT VARIABLES
// =====================================================

const PORT = Number(process.env.PORT || 3000);

// PostgreSQL
const DB_HOST = process.env.DB_HOST;
const DB_PORT = Number(process.env.DB_PORT || 5432);
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;

// Valkey
const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

// =====================================================
// 2. POSTGRESQL CONNECTION POOL
// =====================================================

const pool = new Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err);
});

// =====================================================
// 3. VALKEY / REDIS CLUSTER
//
// AWS ElastiCache:
// Cluster mode: Enabled
// Transit encryption: Required
//
// => createCluster()
// => rediss://
// =====================================================

const redisClient = createCluster({
  rootNodes: [
    {
      url: `rediss://${REDIS_HOST}:${REDIS_PORT}`,
    },
  ],

  defaults: {
    socket: {
      connectTimeout: 5000,

      reconnectStrategy: (retries) => {
        if (retries > 10) {
          return new Error("Valkey reconnect limit reached");
        }

        return Math.min(retries * 500, 3000);
      },
    },
  },
});

redisClient.on("error", (err) => {
  console.error("Valkey cluster error:", err.message);
});

redisClient.on("ready", () => {
  console.log("Valkey cluster ready");
});

// =====================================================
// 4. ROOT
// =====================================================

app.get("/", (req, res) => {
  res.status(200).json({
    service: "cloudshop-api",
    message: "CloudShop API is running",
    time: new Date().toISOString(),
  });
});

// =====================================================
// 5. LIVENESS
//
// Chỉ kiểm tra Node.js process.
// Không phụ thuộc RDS / Valkey.
// =====================================================

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    service: "cloudshop-api",
    uptime: Math.floor(process.uptime()),
    time: new Date().toISOString(),
  });
});

// =====================================================
// 6. READINESS
//
// Application chỉ READY khi:
// PostgreSQL OK
// Valkey OK
// =====================================================

app.get("/ready", async (req, res) => {
  const checks = {
    database: "disconnected",
    redis: "disconnected",
  };

  try {
    // PostgreSQL
    await pool.query("SELECT 1");
    checks.database = "connected";

    // Valkey
    const pong = await redisClient.ping();

    if (pong !== "PONG") {
      throw new Error("Valkey PING failed");
    }

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

// =====================================================
// 7. POSTGRESQL TEST
// =====================================================

app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        NOW() AS database_time,
        current_database() AS database_name
    `);

    return res.status(200).json({
      status: "success",
      database: "connected",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Database test failed:", error.message);

    return res.status(500).json({
      status: "error",
      database: "disconnected",
      error: error.message,
    });
  }
});

// =====================================================
// 8. VALKEY TEST
//
// PING
// SET
// GET
// TTL
// =====================================================

app.get("/redis-test", async (req, res) => {
  try {
    const pong = await redisClient.ping();

    const key = "cloudshop:test";
    const value = `hello-valkey-${Date.now()}`;

    await redisClient.set(key, value, {
      EX: 60,
    });

    const result = await redisClient.get(key);
    const ttl = await redisClient.ttl(key);

    return res.status(200).json({
      status: "success",
      redis: "connected",
      ping: pong,
      key,
      value: result,
      ttl,
    });
  } catch (error) {
    console.error("Valkey test failed:", error.message);

    return res.status(500).json({
      status: "error",
      redis: "disconnected",
      error: error.message,
    });
  }
});

// =====================================================
// 9. CACHE DEMO
//
// Request
//    |
//    v
// Redis
//   |
//   +-- HIT --> response
//   |
//   +-- MISS
//        |
//        v
//       RDS
//        |
//        v
//    cache result
//        |
//        v
//     response
//
// =====================================================

app.get("/cache-demo", async (req, res) => {
  const cacheKey = "cloudshop:database-info";

  try {
    // -------------------------------------------------
    // Step 1: Try cache
    // -------------------------------------------------

    const cachedData = await redisClient.get(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        status: "success",
        cache: "HIT",
        source: "valkey",
        data: JSON.parse(cachedData),
      });
    }

    // -------------------------------------------------
    // Step 2: Cache MISS -> query RDS
    // -------------------------------------------------

    const dbResult = await pool.query(`
      SELECT
        NOW() AS database_time,
        current_database() AS database_name
    `);

    const data = dbResult.rows[0];

    // -------------------------------------------------
    // Step 3: Store result in Valkey
    //
    // Cache 30 seconds
    // -------------------------------------------------

    await redisClient.set(
      cacheKey,
      JSON.stringify(data),
      {
        EX: 30,
      }
    );

    return res.status(200).json({
      status: "success",
      cache: "MISS",
      source: "postgresql",
      data,
    });
  } catch (error) {
    console.error("Cache demo failed:", error.message);

    return res.status(500).json({
      status: "error",
      error: error.message,
    });
  }
});

// =====================================================
// 10. CACHE DELETE TEST
// =====================================================

app.delete("/cache-demo", async (req, res) => {
  try {
    const cacheKey = "cloudshop:database-info";

    const deleted = await redisClient.del(cacheKey);

    return res.status(200).json({
      status: "success",
      deleted,
    });
  } catch (error) {
    console.error("Cache delete failed:", error.message);

    return res.status(500).json({
      status: "error",
      error: error.message,
    });
  }
});

// =====================================================
// 11. 404
// =====================================================

app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Route not found",
  });
});

// =====================================================
// 12. START APPLICATION
// =====================================================

let server;

async function startServer() {
  try {
    console.log("====================================");
    console.log("Starting CloudShop API");
    console.log("====================================");

    // -------------------------------------------------
    // Validate ENV
    // -------------------------------------------------

    const requiredEnv = [
      "DB_HOST",
      "DB_NAME",
      "DB_USER",
      "DB_PASSWORD",
      "REDIS_HOST",
    ];

    for (const envName of requiredEnv) {
      if (!process.env[envName]) {
        throw new Error(
          `Missing required environment variable: ${envName}`
        );
      }
    }

    // -------------------------------------------------
    // PostgreSQL connection test
    // -------------------------------------------------

    console.log("Testing PostgreSQL connection...");

    await pool.query("SELECT 1");

    console.log("PostgreSQL connected");

    // -------------------------------------------------
    // Valkey cluster connection
    // -------------------------------------------------

    console.log(
      `Connecting to Valkey cluster ${REDIS_HOST}:${REDIS_PORT}...`
    );

    await redisClient.connect();

    const pong = await redisClient.ping();

    console.log(`Valkey response: ${pong}`);

    // -------------------------------------------------
    // Start Express
    // -------------------------------------------------

    server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`CloudShop API listening on port ${PORT}`);
      console.log("====================================");
    });
  } catch (error) {
    console.error("Application startup failed:", error);

    try {
      if (redisClient.isOpen) {
        await redisClient.close();
      }

      await pool.end();
    } catch (cleanupError) {
      console.error("Cleanup error:", cleanupError);
    }

    process.exit(1);
  }
}

startServer();

// =====================================================
// 13. GRACEFUL SHUTDOWN
//
// ECS stops task
//      |
//      v
//   SIGTERM
//      |
//      +--> stop HTTP
//      |
//      +--> close Valkey
//      |
//      +--> close PostgreSQL
//      |
//      v
//     exit
// =====================================================

async function shutdown(signal) {
  console.log(`${signal} received. Starting graceful shutdown...`);

  try {
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });

      console.log("HTTP server closed");
    }

    if (redisClient.isOpen) {
      await redisClient.close();

      console.log("Valkey connection closed");
    }

    await pool.end();

    console.log("PostgreSQL pool closed");

    process.exit(0);
  } catch (error) {
    console.error("Graceful shutdown failed:", error);

    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));