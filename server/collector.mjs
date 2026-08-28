#!/usr/bin/env node
// collector.mjs — minimal self-hosted analytics collector for Cut the Fuse.
//
// The game POSTs batches of JSON events to /collect (see src/engine/Analytics.js);
// each event is appended as one JSONL line to analytics-events.jsonl at the
// repo root. Run it anywhere and point the game at it:
//
//   node server/collector.mjs [port]          # default 8081
//   open "http://localhost:8080/?analytics=http://localhost:8081/collect"
//
// Endpoints:
//   POST /collect  {events...} or [{event...}, ...]   -> appends, returns {ok}
//   GET  /health                                      -> "ok"
import { createServer } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.argv[2] || 8081);
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "analytics-events.jsonl");

const server = createServer((req, res) => {
    // The game is served from a different origin than this collector.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    if (req.method === "GET" && req.url === "/health") { res.writeHead(200); return res.end("ok"); }
    if (req.method !== "POST" || req.url !== "/collect") { res.writeHead(404); return res.end("not found"); }

    let body = "";
    req.on("data", (c) => {
        body += c;
        if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => {
        try {
            const parsed = JSON.parse(body);
            const events = Array.isArray(parsed) ? parsed : [parsed];
            mkdirSync(path.dirname(OUT), { recursive: true });
            for (const ev of events) {
                appendFileSync(OUT, JSON.stringify({
                    ...ev,
                    _receivedAt: new Date().toISOString(),
                    _ip: req.socket.remoteAddress,
                }) + "\n");
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, count: events.length }));
        } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: e.message }));
        }
    });
});

server.listen(PORT, () => {
    console.log(`analytics collector → http://localhost:${PORT}/collect`);
    console.log(`appending events → ${OUT}`);
});
