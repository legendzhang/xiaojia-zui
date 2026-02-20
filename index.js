const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

const LOG = '/tmp/openclaw-webchat.log';
function write(msg) {
  fs.appendFileSync(LOG, new Date().toISOString() + ' ' + msg + '\n');
}

write('=== SERVER STARTED ===');

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ noServer: true });

let gatewayWs = null;
let messageId = 0;
let handshakeDone = false;
let currentToken = '9df268f81ecf80cb6b96924c3f40d99446c7103729be26c3';
const responseBuffer = {};

function generateId() {
  return `msg-${++messageId}-${Date.now()}`;
}

function connectToGateway() {
  write('Connecting to gateway...');
  gatewayWs = new WebSocket('ws://127.0.0.1:18789?token=9df268f81ecf80cb6b96924c3f40d99446c7103729be26c3');

  gatewayWs.on('open', () => {
    write('Connected to OpenClaw Gateway');
  });

  gatewayWs.on('message', (data) => {
    const str = data.toString();
    write('GW: ' + str.slice(0, 200));
    try {
      const msg = JSON.parse(str);
      handleGatewayMessage(msg);
    } catch (e) {
      write('Parse error: ' + e.message);
    }
  });

  gatewayWs.on('close', (code, reason) => {
    write('Gateway closed: ' + code);
    handshakeDone = false;
    setTimeout(connectToGateway, 3000);
  });

  gatewayWs.on('error', (err) => {
    write('Gateway error: ' + err.message);
  });
}

function sendConnect() {
  if (!gatewayWs || gatewayWs.readyState !== WebSocket.OPEN) {
    write('WS not ready');
    return;
  }
  
  write('Sending connect request with token: ' + currentToken.slice(0, 10) + '...');
  gatewayWs.send(JSON.stringify({
    type: 'req',
    id: generateId(),
    method: 'connect',
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      client: { id: 'webchat', version: '1.0.0', platform: 'web', mode: 'cli' },
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      auth: { token: currentToken },
      locale: 'zh-CN',
      userAgent: 'openclaw-webchat/1.0.0'
    }
  }));
}

const clients = new Set();

function handleGatewayMessage(msg) {
  write('Handle msg: ' + JSON.stringify(msg).slice(0, 100));
  
  if (msg.type === 'event' && msg.event === 'connect.challenge') {
    write('Received challenge');
    sendConnect();
    return;
  }
  
  if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
    write('Handshake OK');
    handshakeDone = true;
    gatewayWs.send(JSON.stringify({
      type: 'req',
      id: generateId(),
      method: 'chat.history',
      params: { sessionKey: 'default' }
    }));
    return;
  }

  if (msg.type === 'res' && msg.payload?.type === 'history-ok') {
    write('History received, forwarding to browser');
    const messages = msg.payload.messages || [];
    clients.forEach(ws => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'history', messages }));
      }
    });
    return;
  }

  if (msg.type === 'event' && msg.event === 'chat') {
    const payload = msg.payload;
    const runId = payload.runId || 'default';
    
    // 只在 final 状态时发送
    if (payload.state === 'final' && payload.message?.content) {
      const newText = payload.message.content.map(c => c.text || c.delta || c || '').join('');
      if (newText) {
        write('Sending final: ' + newText);
        clients.forEach(ws => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ 
              type: 'message', 
              message: { role: 'assistant', text: newText }
            }));
          }
        });
      }
      return;
    }
    
    // 非 final 状态，发送 typing
    if (payload.state !== 'final') {
      clients.forEach(ws => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'typing' }));
        }
      });
    }
    return;
  }

  if (msg.type === 'res' && msg.id) {
    if (msg.payload?.type === 'send-ok') {
      clients.forEach(ws => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'message', message: msg.payload.message }));
        }
      });
    }
  }
}

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  
  if (url.pathname === '/ws') {
    write('WS upgrade accepted');
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  clients.add(ws);
  write('Browser client connected');

  ws.on('message', (data) => {
    const txt = data.toString();
    write('Browser sent: ' + txt);
    
    try {
      const msg = JSON.parse(txt);
      
      if (msg.type === 'send' && msg.text && gatewayWs?.readyState === WebSocket.OPEN && handshakeDone) {
        write('Forwarding to gateway: ' + msg.text);
        const id = generateId();
        gatewayWs.send(JSON.stringify({
          type: 'req',
          id: id,
          method: 'chat.send',
          params: { 
            message: msg.text,
            sessionKey: 'default',
            idempotencyKey: id
          }
        }));
      }
    } catch (e) {
      write('Client parse error: ' + e.message);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    write('Browser client disconnected');
  });
});

app.use(express.json());

app.post('/api/token', (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.json({ ok: false, error: 'Token is required' });
  }
  
  currentToken = token;
  write('Token updated, reconnecting...');
  
  if (gatewayWs) {
    gatewayWs.close();
  }
  
  res.json({ ok: true });
});

app.get('/api/token', (req, res) => {
  res.json({ token: currentToken });
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  write('Server started on port ' + PORT);
  connectToGateway();
});
