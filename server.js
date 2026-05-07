require("dotenv").config({ path: ".env.local" });
const http = require("http");
const path = require("path");
const fs = require("fs");
const { WebSocketServer } = require("ws");
const { fetch, parseBody } = require("undici");

const PORT = Number(process.env.PORT || 3001);
const ROOT = __dirname;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
};

const rooms = new Map();

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/facecap_emotions.html" : requestUrl.pathname;
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end();
    return;
  }

  // Proxy /api/chat to OpenAI (with streaming)
  if (requestUrl.pathname === "/api/chat") {
    if (!OPENAI_API_KEY) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "OPENAI_API_KEY not configured" }));
      return;
    }

    let body = "";
    request.on("data", chunk => body += chunk);
    request.on("end", async () => {
      try {
        const { messages, stream } = JSON.parse(body);

        const openaiResponse = await fetch(OPENAI_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages,
            max_tokens: 300,
            temperature: 0.8,
            stream: stream || false
          })
        });

        if (stream) {
          response.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          });

          for await (const chunk of openaiResponse.body) {
            response.write(chunk);
          }
          response.end();
        } else {
          const data = await openaiResponse.body.json();
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify(data));
        }
      } catch (err) {
        console.error("API error:", err);
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  socket.on("message", (rawMessage) => {
    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      send(socket, { type: "error", message: "Invalid signaling message." });
      return;
    }

    if (message.type === "join") {
      joinRoom(socket, message.roomId);
      return;
    }

    if (!socket.roomId) {
      send(socket, { type: "error", message: "Join a room before signaling." });
      return;
    }

    if (["offer", "answer", "ice", "leave"].includes(message.type)) {
      broadcastToRoom(socket.roomId, socket, message);
    }
  });

  socket.on("close", () => {
    leaveRoom(socket);
  });
});

function joinRoom(socket, rawRoomId) {
  const roomId = String(rawRoomId || "").trim();
  if (!roomId) {
    send(socket, { type: "error", message: "Room id is required." });
    return;
  }

  leaveRoom(socket);

  const peers = rooms.get(roomId) || new Set();
  if (peers.size >= 2) {
    send(socket, { type: "error", message: "Room is full." });
    return;
  }

  socket.roomId = roomId;
  peers.add(socket);
  rooms.set(roomId, peers);

  send(socket, {
    type: "joined",
    roomId,
    shouldCreateOffer: peers.size === 2,
  });

  broadcastToRoom(roomId, socket, { type: "peer-joined" });
}

function leaveRoom(socket) {
  if (!socket.roomId) return;

  const peers = rooms.get(socket.roomId);
  if (peers) {
    peers.delete(socket);
    broadcastToRoom(socket.roomId, socket, { type: "peer-left" });
    if (!peers.size) rooms.delete(socket.roomId);
  }

  socket.roomId = null;
}

function broadcastToRoom(roomId, sender, message) {
  const peers = rooms.get(roomId);
  if (!peers) return;

  for (const peer of peers) {
    if (peer !== sender && peer.readyState === peer.OPEN) {
      send(peer, message);
    }
  }
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

server.listen(PORT, () => {
  console.log(`HoloLab dev server running at http://localhost:${PORT}`);
});
