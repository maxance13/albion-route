import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const app = express();
const PORT = Number(process.env.PORT || 3001);
const maps = JSON.parse(fs.readFileSync(path.join(root, "data", "maps.json"), "utf8"));
const permanentNetwork = JSON.parse(fs.readFileSync(path.join(root, "data", "permanent-connections.json"), "utf8"));
const mapNames = new Set(maps.map((map) => map.mapName));
const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 })
  : null;

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: true, methods: ["GET", "POST", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "X-Owner-Token"] }));
app.use(express.json({ limit: "32kb" }));

const writes = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const clean = (value) => String(value || "").trim().slice(0, 100);

async function ensureSchema() {
  if (!pool) return;
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await pool.query(`CREATE TABLE IF NOT EXISTS avalon_portals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_map text NOT NULL,
    to_map text NOT NULL,
    capacity smallint NOT NULL CHECK (capacity IN (7, 20)),
    closes_at timestamptz NOT NULL,
    owner_token_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (from_map <> to_map)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS avalon_portals_closes_at_idx ON avalon_portals (closes_at)`);
}

let permanentCache = { edges: [], source: "unavailable", updatedAt: 0 };

function collectGraph(config) {
  const nodes = new Map();
  const candidateEdges = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const a = value._attr && typeof value._attr === "object" ? value._attr : value;
    const id = a.id ?? a.nodeId ?? a.clusterId;
    const name = a.displayname ?? a.displayName ?? a.name ?? a.label;
    if (id != null && name && mapNames.has(String(name))) nodes.set(String(id), String(name));
    const from = a.source ?? a.from ?? a.fromId ?? a.origin ?? a.start;
    const to = a.target ?? a.to ?? a.toId ?? a.destination ?? a.end;
    if (from != null && to != null) candidateEdges.push([String(from), String(to)]);
    Object.values(value).forEach(visit);
  };
  visit(config);
  const seen = new Set();
  const edges = [];
  for (const [fromId, toId] of candidateEdges) {
    const from = nodes.get(fromId) ?? (mapNames.has(fromId) ? fromId : null);
    const to = nodes.get(toId) ?? (mapNames.has(toId) ? toId : null);
    if (!from || !to || from === to) continue;
    const key = [from, to].sort().join("|");
    if (!seen.has(key)) {
      seen.add(key);
      edges.push({ from, to, type: "permanent" });
    }
  }
  return edges;
}

async function getPermanentNetwork() {
  if (permanentNetwork?.edges?.length) {
    return { edges: permanentNetwork.edges, source: "static-game-data", updatedAt: Date.now() };
  }
  if (Date.now() - permanentCache.updatedAt < 6 * 60 * 60 * 1000) return permanentCache;
  try {
    const response = await fetch("https://www.albiononline2d.com/en/map", {
      headers: { "User-Agent": "AlbionRoute/1.0 (+https://github.com/maxance13/albion-route)" },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const match = html.match(/var\s+config\s*=\s*(\{[\s\S]*?\});\s*<\/script>/i);
    if (!match) throw new Error("map configuration not found");
    const edges = collectGraph(JSON.parse(match[1]));
    permanentCache = { edges, source: edges.length ? "albiononline2d" : "unavailable", updatedAt: Date.now() };
  } catch (error) {
    console.warn("Permanent network unavailable:", error.message);
    permanentCache = { edges: [], source: "unavailable", updatedAt: Date.now() };
  }
  return permanentCache;
}

app.get("/health", async (_req, res) => {
  try {
    if (pool) await pool.query("SELECT 1");
    res.json({ ok: true, database: Boolean(pool), maps: maps.length, time: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, error: "database_unavailable" });
  }
});

app.get("/api/maps", (_req, res) => res.json({ maps, count: maps.length }));

app.get("/api/permanent-connections", async (_req, res) => {
  const network = await getPermanentNetwork();
  res.json({ ...network, count: network.edges.length });
});

app.get("/api/portals", async (_req, res) => {
  if (!pool) return res.json({ portals: [], persistence: false });
  await pool.query("DELETE FROM avalon_portals WHERE closes_at <= now()");
  const result = await pool.query(`SELECT id, from_map AS "fromMap", to_map AS "toMap",
    capacity, closes_at AS "closesAt", created_at AS "createdAt"
    FROM avalon_portals WHERE closes_at > now() ORDER BY closes_at ASC`);
  res.json({ portals: result.rows, persistence: true });
});

app.post("/api/portals", writes, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "database_unavailable" });
  const fromMap = clean(req.body.fromMap);
  const toMap = clean(req.body.toMap);
  const ownerToken = clean(req.body.ownerToken);
  const capacity = Number(req.body.capacity);
  const closesAt = new Date(req.body.closesAt);
  if (!mapNames.has(fromMap) || !mapNames.has(toMap) || fromMap === toMap) {
    return res.status(400).json({ error: "invalid_maps" });
  }
  if (![7, 20].includes(capacity) || ownerToken.length < 16 || Number.isNaN(closesAt.getTime())) {
    return res.status(400).json({ error: "invalid_portal" });
  }
  const remaining = closesAt.getTime() - Date.now();
  if (remaining < 60_000 || remaining > 24 * 60 * 60 * 1000) {
    return res.status(400).json({ error: "invalid_expiration" });
  }
  const result = await pool.query(`INSERT INTO avalon_portals
    (from_map, to_map, capacity, closes_at, owner_token_hash)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, from_map AS "fromMap", to_map AS "toMap", capacity,
      closes_at AS "closesAt", created_at AS "createdAt"`,
    [fromMap, toMap, capacity, closesAt.toISOString(), sha(ownerToken)]);
  res.status(201).json({ portal: result.rows[0] });
});

app.delete("/api/portals/:id", writes, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "database_unavailable" });
  const token = clean(req.header("X-Owner-Token"));
  if (token.length < 16) return res.status(401).json({ error: "owner_token_required" });
  const result = await pool.query(
    "DELETE FROM avalon_portals WHERE id = $1 AND owner_token_hash = $2 RETURNING id",
    [req.params.id, sha(token)]
  );
  if (!result.rowCount) return res.status(403).json({ error: "not_owner_or_missing" });
  res.status(204).end();
});

app.use(express.static(path.join(root, "public")));
app.get("/{*splat}", (_req, res) => res.sendFile(path.join(root, "public", "index.html")));

ensureSchema()
  .then(() => app.listen(PORT, "0.0.0.0", () => console.log(`Albion Route API listening on ${PORT}`)))
  .catch((error) => {
    console.error("Database initialization failed", error);
    process.exit(1);
  });
