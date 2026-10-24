'use strict';

/**
 * PenguinMod Collab PRO MAX
 * - Acesso HTTP normal: mostra apenas a mensagem personalizada.
 * - WebSocket: continua disponível para a extensão de colaboração.
 * - Compatível com Render (usa process.env.PORT).
 *
 * IMPORTANTE:
 * Este servidor é um relay experimental, não um sistema completo de
 * colaboração. O protocolo é compatível com a extensão incluída no pacote.
 */

const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 8787);
const HOST = '0.0.0.0';

const MAX_MESSAGE_BYTES = 2 * 1024 * 1024; // 2 MiB
const MAX_ROOM_NAME_LENGTH = 48;
const MAX_CLIENTS_PER_ROOM = 8;
const MAX_MESSAGES_PER_WINDOW = 300;
const RATE_WINDOW_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_ROOMS = 500;

const PAGE_MESSAGE = 'Desculpe, mas não era pra tu acessar isso!';

const rooms = new Map();
const clients = new Set();

const server = http.createServer((req, res) => {
  // Toda requisição HTTP comum recebe somente a mensagem.
  // WebSocket usa o upgrade HTTP e continua funcionando separadamente.
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(PAGE_MESSAGE);
});

const wss = new WebSocket.Server({
  noServer: true,
  maxPayload: MAX_MESSAGE_BYTES,
  perMessageDeflate: false
});

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (_) {
    // A conexão pode ter fechado entre a checagem e o envio.
  }
}

function cleanRoom(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, MAX_ROOM_NAME_LENGTH);
}

function leaveRoom(ws) {
  if (!ws.room) return;

  const roomName = ws.room;
  const room = rooms.get(roomName);
  ws.room = null;
  ws.role = 'guest';

  if (!room) return;

  room.clients.delete(ws);
  if (room.host === ws) room.host = null;

  if (room.clients.size === 0) {
    rooms.delete(roomName);
    return;
  }

  for (const client of room.clients) {
    safeSend(client, {
      type: 'status',
      text: `Participantes conectados: ${room.clients.size}`
    });
  }
}

function joinRoom(ws, msg) {
  const roomName = cleanRoom(msg.room);

  if (!roomName) {
    safeSend(ws, { type: 'error', message: 'Código de sala inválido' });
    return;
  }

  if (ws.room === roomName) {
    safeSend(ws, { type: 'status', text: `Você já está na sala ${roomName}` });
    return;
  }

  let room = rooms.get(roomName);

  if (!room) {
    if (rooms.size >= MAX_ROOMS) {
      safeSend(ws, {
        type: 'error',
        message: 'Limite de salas atingido. Tente novamente mais tarde.'
      });
      return;
    }

    room = { clients: new Set(), host: null, snapshot: null };
    rooms.set(roomName, room);
  }

  if (room.clients.size >= MAX_CLIENTS_PER_ROOM) {
    safeSend(ws, {
      type: 'error',
      message: `Esta sala atingiu o limite de ${MAX_CLIENTS_PER_ROOM} participantes`
    });
    if (room.clients.size === 0) rooms.delete(roomName);
    return;
  }

  leaveRoom(ws);

  // O primeiro cliente que reivindicar host numa sala vazia será anfitrião.
  // Depois disso, reivindicações de host serão tratadas como convidado.
  ws.role = msg.role === 'host' && !room.host ? 'host' : 'guest';
  ws.room = roomName;
  room.clients.add(ws);

  if (ws.role === 'host') room.host = ws;

  safeSend(ws, {
    type: 'status',
    text: `Conectado à sala ${roomName} como ${ws.role}`
  });

  if (ws.role === 'guest') {
    if (room.snapshot) {
      safeSend(ws, { type: 'snapshot', xml: room.snapshot });
    } else if (room.host) {
      safeSend(room.host, { type: 'requestSnapshot' });
    } else {
      safeSend(ws, {
        type: 'error',
        message: 'A sala ainda não tem anfitrião com projeto carregado'
      });
    }
  }

  for (const client of room.clients) {
    if (client !== ws) {
      safeSend(client, {
        type: 'status',
        text: `Participantes conectados: ${room.clients.size}`
      });
    }
  }
}

function handleMessage(ws, rawData) {
  const now = Date.now();

  if (now - ws.rateWindowStart >= RATE_WINDOW_MS) {
    ws.rateWindowStart = now;
    ws.messagesInWindow = 0;
  }

  ws.messagesInWindow += 1;
  if (ws.messagesInWindow > MAX_MESSAGES_PER_WINDOW) {
    safeSend(ws, {
      type: 'error',
      message: 'Muitas mensagens em pouco tempo. Aguarde e tente novamente.'
    });
    ws.close(1008, 'Rate limit exceeded');
    return;
  }

  let msg;
  try {
    msg = JSON.parse(rawData.toString());
  } catch (_) {
    safeSend(ws, { type: 'error', message: 'Mensagem JSON inválida' });
    return;
  }

  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    safeSend(ws, { type: 'error', message: 'Formato de mensagem inválido' });
    return;
  }

  if (msg.type === 'join') {
    joinRoom(ws, msg);
    return;
  }

  if (!ws.room) {
    safeSend(ws, { type: 'error', message: 'Entre em uma sala primeiro' });
    return;
  }

  const room = rooms.get(ws.room);
  if (!room || !room.clients.has(ws)) {
    safeSend(ws, { type: 'error', message: 'Sala não encontrada; conecte novamente' });
    return;
  }

  if (msg.type === 'snapshot') {
    if (ws !== room.host) {
      safeSend(ws, {
        type: 'error',
        message: 'Só o anfitrião pode enviar o snapshot inicial'
      });
      return;
    }

    if (typeof msg.xml !== 'string' || Buffer.byteLength(msg.xml, 'utf8') > MAX_MESSAGE_BYTES - 4096) {
      safeSend(ws, { type: 'error', message: 'Snapshot muito grande ou inválido' });
      return;
    }

    room.snapshot = msg.xml;

    for (const client of room.clients) {
      if (client !== ws) safeSend(client, { type: 'snapshot', xml: room.snapshot });
    }
    return;
  }

  if (msg.type === 'event') {
    if (!msg.event || typeof msg.event !== 'object' || Array.isArray(msg.event)) {
      safeSend(ws, { type: 'error', message: 'Evento inválido' });
      return;
    }

    const packet = {
      type: 'event',
      clientId: String(msg.clientId || '').slice(0, 128),
      event: msg.event
    };

    for (const client of room.clients) {
      if (client !== ws) safeSend(client, packet);
    }
    return;
  }

  safeSend(ws, { type: 'error', message: 'Tipo de mensagem desconhecido' });
}

server.on('upgrade', (req, socket, head) => {
  // O endpoint WebSocket fica na raiz, por compatibilidade com a extensão.
  // A página HTTP normal continua mostrando somente a mensagem personalizada.
  if (req.url !== '/' && req.url !== '') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  ws.id = crypto.randomUUID();
  ws.room = null;
  ws.role = 'guest';
  ws.isAlive = true;
  ws.rateWindowStart = Date.now();
  ws.messagesInWindow = 0;
  clients.add(ws);

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data) => handleMessage(ws, data));

  ws.on('error', () => {
    // Evita que erros individuais da conexão derrubem o processo.
  });

  ws.on('close', () => {
    clients.delete(ws);
    leaveRoom(ws);
  });
});

const heartbeat = setInterval(() => {
  for (const ws of clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (_) {
      ws.terminate();
    }
  }
}, HEARTBEAT_INTERVAL_MS);

heartbeat.unref();

server.listen(PORT, HOST, () => {
  console.log(`PenguinMod Collab PRO MAX ativo na porta ${PORT}`);
  console.log('HTTP: mostra somente a mensagem personalizada.');
  console.log('WebSocket: ativo na raiz para a extensão.');
});

function shutdown(signal) {
  console.log(`${signal}: encerrando o servidor...`);
  clearInterval(heartbeat);

  for (const ws of clients) {
    try { ws.close(1001, 'Servidor reiniciando'); } catch (_) {}
  }

  wss.close(() => {
    server.close(() => process.exit(0));
  });

  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
