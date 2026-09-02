import express from "express";
import pg from "pg";
import { createClient, createCluster } from "redis";

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

// Local:
// DB_SSL=false
//
// AWS ECS:
// DB_SSL=true
const DB_SSL = process.env.DB_SSL === "true";

// Redis / Valkey
const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);

// Local / GitHub Actions:
// REDIS_MODE=standalone
// REDIS_TLS=false
//
// AWS ECS:
// REDIS_MODE=cluster
// REDIS_TLS=true
const REDIS_MODE = process.env.REDIS_MODE || "standalone";
const REDIS_TLS = process.env.REDIS_TLS === "true";

// =====================================================
// 2. POSTGRESQL CONNECTION POOL
// =====================================================

const pool = new Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,

  // Local PostgreSQL:
  // DB_SSL=false
  //
  // AWS RDS:
  // DB_SSL=true
  ssl: DB_SSL
    ? {
        rejectUnauthorized: false,
      }
    : false,

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err);
});

// =====================================================
// 3. REDIS / VALKEY CONNECTION
//
// LOCAL / CI:
// redis://redis:6379
// standalone
// no TLS
//
// AWS ECS:
// rediss://<configuration-endpoint>:6379
// cluster mode
// TLS required
// =====================================================

let redisClient;

if (REDIS_MODE === "cluster") {
  // ---------------------------------------------------
  // AWS ElastiCache Valkey Cluster
  // ---------------------------------------------------

  redisClient = createCluster({
    rootNodes: [
      {
        url: `${REDIS_TLS ? "rediss" : "redis"}://${REDIS_HOST}:${REDIS_PORT}`,
      },
    ],

    defaults: {
      socket: {
        connectTimeout: 5000,

        reconnectStrategy: (retries) => {
          if (retries > 10) {
            return new Error(
              "Valkey reconnect limit reached"
            );
          }

          return Math.min(retries * 500, 3000);
        },
      },
    },
  });

  console.log(
    `Redis mode: CLUSTER (${REDIS_TLS ? "TLS" : "no TLS"})`
  );
} else {
  // ---------------------------------------------------
  // Local Docker Compose Redis
  // ---------------------------------------------------

  redisClient = createClient({
    url: `${REDIS_TLS ? "rediss" : "redis"}://${REDIS_HOST}:${REDIS_PORT}`,

    socket: {
      connectTimeout: 5000,

      reconnectStrategy: (retries) => {
        if (retries > 10) {
          return new Error(
            "Redis reconnect limit reached"
          );
        }

        return Math.min(retries * 500, 3000);
      },
    },
  });

  console.log(
    `Redis mode: STANDALONE (${REDIS_TLS ? "TLS" : "no TLS"})`
  );
}

redisClient.on("error", (err) => {
  console.error(
    "Redis/Valkey error:",
    err.message
  );
});

redisClient.on("ready", () => {
  console.log("Redis/Valkey ready");
});

// =====================================================
// 4. REDIS CLOSE HELPER
// =====================================================

async function closeRedis() {
  try {
    if (REDIS_MODE === "cluster") {
      await redisClient.close();
    } else if (redisClient.isOpen) {
      await redisClient.quit();
    }
  } catch (error) {
    console.error(
      "Redis close error:",
      error.message
    );
  }
}

// =====================================================
// 5. ROOT
// =====================================================

app.get("/", (req, res) => {
  return res.status(200).json({
    service: "cloudshop-api",
    message: "CloudShop API is running",
    environment:
      process.env.NODE_ENV || "development",
    time: new Date().toISOString(),
  });
});

// =====================================================
// 6. LIVENESS
//
// Chỉ kiểm tra Node.js process.
// Không phụ thuộc PostgreSQL / Redis.
// =====================================================

app.get("/health", (req, res) => {
  return res.status(200).json({
    status: "healthy",
    service: "cloudshop-api",
    uptime: Math.floor(process.uptime()),
    time: new Date().toISOString(),
  });
});

// =====================================================
// 7. READINESS
//
// App chỉ READY khi:
// PostgreSQL OK
// Redis / Valkey OK
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

    // Redis / Valkey
    const pong = await redisClient.ping();

    if (pong !== "PONG") {
      throw new Error(
        "Redis/Valkey PING failed"
      );
    }

    checks.redis = "connected";

    return res.status(200).json({
      status: "ready",
      ...checks,
      time: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "Readiness check failed:",
      error.message
    );

    return res.status(503).json({
      status: "not_ready",
      ...checks,
      error: error.message,
      time: new Date().toISOString(),
    });
  }
});

// =====================================================
// 8. POSTGRESQL TEST
// =====================================================

app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        NOW() AS database_time,
        current_database() AS database_name,
        current_user AS database_user
    `);

    return res.status(200).json({
      status: "success",
      database: "connected",
      sslEnabled: DB_SSL,
      data: result.rows[0],
    });
  } catch (error) {
    console.error(
      "Database test failed:",
      error.message
    );

    return res.status(500).json({
      status: "error",
      database: "disconnected",
      error: error.message,
    });
  }
});

// =====================================================
// 9. REDIS / VALKEY TEST
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
    const value =
      `hello-valkey-${Date.now()}`;

    await redisClient.set(
      key,
      value,
      {
        EX: 60,
      }
    );

    const result =
      await redisClient.get(key);

    const ttl =
      await redisClient.ttl(key);

    return res.status(200).json({
      status: "success",
      redis: "connected",
      mode: REDIS_MODE,
      tls: REDIS_TLS,
      ping: pong,
      key,
      value: result,
      ttl,
    });
  } catch (error) {
    console.error(
      "Redis/Valkey test failed:",
      error.message
    );

    return res.status(500).json({
      status: "error",
      redis: "disconnected",
      error: error.message,
    });
  }
});

// =====================================================
// 10. CACHE DEMO
//
// Request
//      |
//      v
// Redis / Valkey
//      |
//      +---- HIT ----> Response
//      |
//      +---- MISS
//             |
//             v
//            RDS
//             |
//             v
//        Save to cache
//             |
//             v
//          Response
// =====================================================

app.get("/cache-demo", async (req, res) => {
  const cacheKey =
    "cloudshop:database-info";

  try {
    // -------------------------------------------------
    // STEP 1: Check cache
    // -------------------------------------------------

    const cachedData =
      await redisClient.get(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        status: "success",
        cache: "HIT",
        source: "valkey",
        data: JSON.parse(cachedData),
      });
    }

    // -------------------------------------------------
    // STEP 2: Cache MISS -> PostgreSQL
    // -------------------------------------------------

    const dbResult =
      await pool.query(`
        SELECT
          NOW() AS database_time,
          current_database() AS database_name
      `);

    const data = dbResult.rows[0];

    // -------------------------------------------------
    // STEP 3: Store in Valkey
    //
    // TTL = 30 seconds
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
    console.error(
      "Cache demo failed:",
      error.message
    );

    return res.status(500).json({
      status: "error",
      error: error.message,
    });
  }
});

// =====================================================
// 11. DELETE CACHE DEMO
// =====================================================

app.delete("/cache-demo", async (req, res) => {
  try {
    const cacheKey =
      "cloudshop:database-info";

    const deleted =
      await redisClient.del(cacheKey);

    return res.status(200).json({
      status: "success",
      deleted,
    });
  } catch (error) {
    console.error(
      "Cache delete failed:",
      error.message
    );

    return res.status(500).json({
      status: "error",
      error: error.message,
    });
  }
});

// =====================================================
// 12. 404
// =====================================================

app.use((req, res) => {
  return res.status(404).json({
    status: "error",
    message: "Route not found",
  });
});

// =====================================================
// 13. START APPLICATION
// =====================================================

let server;

async function startServer() {
  try {
    console.log(
      "===================================="
    );

    console.log(
      "Starting CloudShop API"
    );

    console.log(
      "===================================="
    );

    // -------------------------------------------------
    // Validate environment variables
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
    // Print runtime config
    //
    // Không log password.
    // -------------------------------------------------

    console.log(
      `Database: ${DB_HOST}:${DB_PORT}`
    );

    console.log(
      `Database SSL: ${DB_SSL}`
    );

    console.log(
      `Redis: ${REDIS_HOST}:${REDIS_PORT}`
    );

    console.log(
      `Redis mode: ${REDIS_MODE}`
    );

    console.log(
      `Redis TLS: ${REDIS_TLS}`
    );

    // -------------------------------------------------
    // PostgreSQL connection
    // -------------------------------------------------

    console.log(
      "Testing PostgreSQL connection..."
    );

    await pool.query("SELECT 1");

    console.log(
      "PostgreSQL connected"
    );

    // -------------------------------------------------
    // Redis / Valkey connection
    // -------------------------------------------------

    console.log(
      `Connecting to Redis/Valkey ${REDIS_HOST}:${REDIS_PORT}...`
    );

    await redisClient.connect();

    const pong =
      await redisClient.ping();

    console.log(
      `Redis/Valkey response: ${pong}`
    );

    // -------------------------------------------------
    // Start Express
    // -------------------------------------------------

    server = app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `CloudShop API listening on port ${PORT}`
        );

        console.log(
          "===================================="
        );
      }
    );
  } catch (error) {
    console.error(
      "Application startup failed:",
      error
    );

    try {
      await closeRedis();

      await pool.end();
    } catch (cleanupError) {
      console.error(
        "Cleanup error:",
        cleanupError
      );
    }

    process.exit(1);
  }
}

startServer();

// =====================================================
// 14. GRACEFUL SHUTDOWN
//
// ECS stops Task
//       |
//       v
//    SIGTERM
//       |
//       +---- HTTP server
//       |
//       +---- Redis / Valkey
//       |
//       +---- PostgreSQL
//       |
//       v
//      exit
// =====================================================

async function shutdown(signal) {
  console.log(
    `${signal} received. Starting graceful shutdown...`
  );

  try {
    if (server) {
      await new Promise(
        (resolve) => {
          server.close(resolve);
        }
      );

      console.log(
        "HTTP server closed"
      );
    }

    await closeRedis();

    console.log(
      "Redis/Valkey connection closed"
    );

    await pool.end();

    console.log(
      "PostgreSQL pool closed"
    );

    process.exit(0);
  } catch (error) {
    console.error(
      "Graceful shutdown failed:",
      error
    );

    process.exit(1);
  }
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);