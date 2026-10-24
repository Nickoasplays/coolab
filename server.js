'use strict';

const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_MESSAGE = 2 * 1024 * 1024;
const rooms = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('PenguinMod Collab server is running. Health: /health\n');
});

const wss = new WebSocket.Server({ server, maxPayload: MAX_MESSAGE });

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(room, data, except) {
  const r = rooms.get(room);
  if (!r) return;
  for (const client of r.clients) if (client !== except) send(client, data);
}
function cleanRoom(room) {
  return String(room || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
}

wss.on('connection', (ws) => {
  ws.id = crypto.randomUUID();
  ws.room = '';
  ws.role = 'guest';

  ws.on('message', (buffer) => {
    let msg;
    try { msg = JSON.parse(buffer.toString()); }
    catch (_) { return send(ws, { type: 'error', message: 'Mensagem JSON inválida' }); }

    if (msg.type === 'join') {
      const room = cleanRoom(msg.room);
      if (!room) return send(ws, { type: 'error', message: 'Código de sala inválido' });
      if (ws.room) {
        const old = rooms.get(ws.room);
        if (old) { old.clients.delete(ws); if (!old.clients.size) rooms.delete(ws.room); }
      }
      let r = rooms.get(room);
      if (!r) {
        r = { clients: new Set(), host: null, snapshot: null };
        rooms.set(room, r);
      }
      // Only the first client may claim host. Later "host" claims are guests.
      ws.role = (msg.role === 'host' && !r.host) ? 'host' : 'guest';
      ws.room = room;
      r.clients.add(ws);
      if (ws.role === 'host') r.host = ws;
      send(ws, { type: 'status', text: `Conectado à sala ${room} como ${ws.role}` });
      if (ws.role === 'guest') {
        if (r.snapshot) send(ws, { type: 'snapshot', xml: r.snapshot });
        else if (r.host) send(r.host, { type: 'requestSnapshot' });
        else send(ws, { type: 'error', message: 'A sala ainda não tem anfitrião com projeto carregado' });
      }
      broadcast(room, { type: 'status', text: `Participantes conectados: ${r.clients.size}` }, ws);
      return;
    }

    if (!ws.room) return send(ws, { type: 'error', message: 'Entre em uma sala primeiro' });
    const room = rooms.get(ws.room);
    if (!room) return;
    if (msg.type === 'snapshot') {
      if (ws !== room.host) return send(ws, { type: 'error', message: 'Só o anfitrião pode enviar o snapshot inicial' });
      if (typeof msg.xml !== 'string' || msg.xml.length > MAX_MESSAGE) {
        return send(ws, { type: 'error', message: 'Snapshot muito grande ou inválido' });
      }
      room.snapshot = msg.xml;
      broadcast(ws.room, { type: 'snapshot', xml: msg.xml }, ws);
      return;
    }
    if (msg.type === 'event') {
      // Relay only. The extension ignores events from its own client ID.
      if (!msg.event || typeof msg.event !== 'object') return;
      broadcast(ws.room, {
        type: 'event',
        clientId: String(msg.clientId || ''),
        event: msg.event
      }, ws);
    }
  });

  ws.on('close', () => {
    if (!ws.room) return;
    const r = rooms.get(ws.room);
    if (!r) return;
    r.clients.delete(ws);
    if (r.host === ws) r.host = null;
    if (!r.clients.size) rooms.delete(ws.room);
    else broadcast(ws.room, { type: 'status', text: `Participantes conectados: ${r.clients.size}` });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`PenguinMod Collab listening on http://${HOST}:${PORT}`);
  console.log(`WebSocket endpoint: ws://HOST-OU-DOMINIO:${PORT}`);
});
