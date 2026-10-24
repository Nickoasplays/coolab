(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) {
    throw new Error('PenguinMod Collab precisa ser carregada sem sandbox.');
  }

  const EXT_ID = 'penguinmodCollab';
  const DEFAULT_PORT = '8787';

  class PenguinModCollab {
    constructor() {
      this.socket = null;
      this.room = '';
      this.role = '';
      this.status = 'Desconectado';
      this.suppressEvents = false;
      this.lastWorkspace = null;
      this.clientId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      this.pendingSnapshot = false;
      this.serverUrl = 'wss://SEU-SERVIDOR-AQUI';
      this.boundWorkspace = null;
      this.workspaceListener = (event) => this.onWorkspaceEvent(event);
      this.reconnectTimer = null;
    }

    getInfo() {
      return {
        id: EXT_ID,
        name: 'Collab',
        color1: '#6f42c1',
        color2: '#59359a',
        color3: '#432874',
        blocks: [
          { opcode: 'createRoom', blockType: Scratch.BlockType.COMMAND, text: 'criar sala [ROOM] servidor [URL]', arguments: {
            ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'meujogo' },
            URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'ws://localhost:8787' }
          }},
          { opcode: 'joinRoom', blockType: Scratch.BlockType.COMMAND, text: 'entrar na sala [ROOM] servidor [URL]', arguments: {
            ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'meujogo' },
            URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'ws://localhost:8787' }
          }},
          { opcode: 'disconnect', blockType: Scratch.BlockType.COMMAND, text: 'desconectar colaboração' },
          { opcode: 'status', blockType: Scratch.BlockType.REPORTER, text: 'status da colaboração' },
          { opcode: 'roomName', blockType: Scratch.BlockType.REPORTER, text: 'sala atual' }
        ]
      };
    }

    workspace() {
      const SB = window.ScratchBlocks || window.Blockly;
      if (!SB) return null;
      try {
        return typeof SB.getMainWorkspace === 'function' ? SB.getMainWorkspace() : null;
      } catch (_) { return null; }
    }

    getBlocksAPI() {
      return window.ScratchBlocks || window.Blockly || null;
    }

    attachWorkspace() {
      const ws = this.workspace();
      if (!ws || ws === this.boundWorkspace) return;
      if (this.boundWorkspace && this.boundWorkspace.removeChangeListener) {
        this.boundWorkspace.removeChangeListener(this.workspaceListener);
      }
      this.boundWorkspace = ws;
      this.boundWorkspace.addChangeListener(this.workspaceListener);
      this.lastWorkspace = ws;
    }

    send(payload) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify(payload));
      }
    }

    open(room, url, role) {
      this.disconnect();
      room = String(room || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
      url = String(url || '').trim();
      if (!room) { this.status = 'Informe um código de sala'; return; }
      if (!/^wss?:\/\//i.test(url)) { this.status = 'URL inválida: use ws:// ou wss://'; return; }
      this.room = room;
      this.role = role;
      this.status = 'Conectando…';
      try {
        this.socket = new WebSocket(url);
      } catch (e) { this.status = 'Erro: ' + e.message; return; }

      this.socket.onopen = () => {
        this.status = 'Conectado; entrando na sala…';
        this.send({ type: 'join', room: this.room, role: this.role, clientId: this.clientId });
        this.attachWorkspace();
      };
      this.socket.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch (_) { return; }
        this.handleMessage(msg);
      };
      this.socket.onerror = () => { this.status = 'Erro de conexão com o servidor'; };
      this.socket.onclose = () => {
        this.status = 'Desconectado';
        if (this.boundWorkspace && this.boundWorkspace.removeChangeListener) {
          this.boundWorkspace.removeChangeListener(this.workspaceListener);
        }
        this.boundWorkspace = null;
      };
    }

    handleMessage(msg) {
      if (msg.type === 'status') {
        this.status = msg.text || 'Conectado';
        return;
      }
      if (msg.type === 'requestSnapshot') {
        if (this.role === 'host') this.sendSnapshot();
        return;
      }
      if (msg.type === 'snapshot') {
        if (this.role === 'guest') this.applySnapshot(msg.xml);
        return;
      }
      if (msg.type === 'event') {
        if (msg.clientId === this.clientId) return;
        this.applyEvent(msg.event);
      }
      if (msg.type === 'error') this.status = 'Erro: ' + (msg.message || 'desconhecido');
    }

    sendSnapshot() {
      const SB = this.getBlocksAPI();
      const ws = this.workspace();
      if (!SB || !ws || !SB.Xml || !SB.Xml.workspaceToDom) {
        this.status = 'Não consegui ler o workspace do editor';
        return;
      }
      try {
        const dom = SB.Xml.workspaceToDom(ws);
        const xml = SB.Xml.domToText(dom);
        this.send({ type: 'snapshot', room: this.room, clientId: this.clientId, xml });
        this.status = 'Projeto inicial enviado (workspace atual)';
      } catch (e) { this.status = 'Falha ao enviar snapshot: ' + e.message; }
    }

    applySnapshot(xml) {
      const SB = this.getBlocksAPI();
      const ws = this.workspace();
      if (!SB || !ws || !SB.Xml || !SB.Xml.textToDom || !SB.Xml.domToWorkspace) {
        this.status = 'Não consegui restaurar o workspace';
        return;
      }
      try {
        this.suppressEvents = true;
        if (ws.clear) ws.clear();
        const dom = SB.Xml.textToDom(xml);
        SB.Xml.domToWorkspace(dom, ws);
        this.status = 'Workspace recebido. Colaboração ativa';
      } catch (e) { this.status = 'Falha ao aplicar snapshot: ' + e.message; }
      finally { this.suppressEvents = false; }
    }

    onWorkspaceEvent(event) {
      if (this.suppressEvents || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      if (!event || event.isUiEvent || event.type === 'ui') return;
      const SB = this.getBlocksAPI();
      if (!SB || !SB.Events || typeof SB.Events.toJson !== 'function') return;
      try {
        const json = SB.Events.toJson(event);
        this.send({ type: 'event', room: this.room, clientId: this.clientId, event: json });
      } catch (_) {
        // Alguns eventos internos do editor não são serializáveis; ignore-os.
      }
    }

    applyEvent(json) {
      const SB = this.getBlocksAPI();
      const ws = this.workspace();
      if (!SB || !ws || !SB.Events || typeof SB.Events.fromJson !== 'function') {
        this.status = 'API de eventos do editor indisponível';
        return;
      }
      try {
        this.suppressEvents = true;
        const event = SB.Events.fromJson(json, ws);
        if (event && typeof event.run === 'function') event.run(true);
      } catch (e) {
        this.status = 'Não foi possível aplicar uma alteração remota';
      } finally {
        this.suppressEvents = false;
      }
    }

    createRoom(args) { this.open(args.ROOM, args.URL, 'host'); }
    joinRoom(args) { this.open(args.ROOM, args.URL, 'guest'); }
    disconnect() {
      if (this.socket) {
        try { this.socket.close(); } catch (_) {}
      }
      this.socket = null;
      if (this.boundWorkspace && this.boundWorkspace.removeChangeListener) {
        this.boundWorkspace.removeChangeListener(this.workspaceListener);
      }
      this.boundWorkspace = null;
      this.room = '';
      this.role = '';
      this.status = 'Desconectado';
    }
    status() { return this.status; }
    roomName() { return this.room; }
  }

  Scratch.extensions.register(new PenguinModCollab());
})(Scratch);
