# PenguinMod Collab — protótipo

Este pacote contém uma extensão experimental e um servidor WebSocket para testar colaboração no workspace de blocos do PenguinMod.

## Importante: o que esta versão faz (e não faz)

- Cria/entra em uma sala pela internet ou rede local.
- O anfitrião envia um snapshot XML do workspace atualmente aberto quando alguém entra.
- Tenta transmitir eventos Blockly/ScratchBlocks serializados em tempo real.
- **Não é ainda um editor colaborativo confiável para projetos completos.** A extensão só vê o workspace ativo; não sincroniza automaticamente fantasias, sons, variáveis globais, listas, posição de sprites, mudanças de alvo, assets nem todos os estados internos do projeto. A API interna do editor pode mudar, e alguns eventos podem não ser serializáveis.
- Duas pessoas editando exatamente o mesmo bloco ao mesmo tempo podem causar conflitos. Faça cópias de segurança do projeto antes de testar.

## Requisitos

- Node.js 18 ou mais recente.
- PenguinMod Studio em um navegador de desktop.
- A extensão deve ser carregada **sem sandbox**. Só carregue código que você revisou e confia.

## 1. Iniciar o servidor no seu computador (CachyOS/Arch, Fish)

Extraia o ZIP e entre na pasta `PenguinMod-Collab`. No terminal Fish:

```fish
cd ~/Downloads/PenguinMod-Collab
sudo pacman -S --needed nodejs npm
npm install
npm start
```

O servidor ficará ouvindo na porta TCP 8787. Teste localmente em outro terminal:

```fish
curl http://127.0.0.1:8787/health
```

## 2. Fazer o amigo acessar pela internet

`ws://localhost:8787` só funciona no computador que executa o servidor. Para casas diferentes, vocês precisam de um endereço público acessível por WebSocket.

Opção recomendada para teste: hospede o servidor em uma máquina/VM com endereço público ou em um serviço de hospedagem que suporte Node.js e WebSocket. Configure a porta e use TLS (`wss://`) em produção. Não exponha o servidor sem autenticação para projetos privados.

Depois de publicar o servidor, copie o endpoint público, por exemplo `wss://collab.seudominio.example`. Esse endereço é apenas um exemplo; substitua pelo endereço real do seu servidor.

## 3. Carregar a extensão no PenguinMod

1. Abra https://studio.penguinmod.com/.
2. Clique no botão azul de extensões, no canto inferior esquerdo.
3. Em **Ações**, escolha **Carregar extensão personalizada**.
4. Escolha **Arquivo local** e selecione `extension.js`.
5. Marque para carregar **sem sandbox**.
6. Repita os passos no computador do amigo.

Se o navegador impedir o carregamento local, use um servidor HTTPS confiável para hospedar `extension.js` e carregue pela URL. Não use uma URL não confiável sem sandbox.

## 4. Criar a sala e conectar

No computador do anfitrião, adicione um bloco `criar sala [meujogo] servidor [URL]`. No do amigo, adicione `entrar na sala [meujogo] servidor [URL]`.

Os dois blocos devem usar o mesmo código de sala e o endpoint real do servidor. Para teste na mesma máquina, use `ws://localhost:8787`. Para computadores diferentes, não use localhost: use o endpoint público `wss://...`.

O anfitrião deve ter o sprite/alvo desejado selecionado antes de criar a sala. O snapshot é do workspace atualmente visível. Teste primeiro em um projeto descartável.

## 5. Segurança

Este servidor de protótipo não tem contas, senha de sala, autorização por convite, persistência ou criptografia própria. `wss://` protege o transporte quando configurado corretamente, mas não substitui autenticação. Qualquer pessoa que saiba o código e alcance o servidor pode tentar entrar. Use apenas para testes com pessoas de confiança e não coloque projetos privados nele.

## Solução de problemas

- **Conecta, mas os blocos não sincronizam:** abra as ferramentas do desenvolvedor (F12 → Console). A versão do PenguinMod pode expor uma API Blockly diferente; esta extensão é experimental.
- **O amigo não conecta:** confirme que está usando o endpoint público `wss://...`, que a hospedagem permite WebSocket e que o servidor está ativo.
- **`ws://` bloqueado:** páginas HTTPS podem bloquear conexões WebSocket sem TLS. Use `wss://` em hospedagem pública.
- **O projeto ficou estranho:** pare de editar e reabra a cópia de segurança. Não teste em seu projeto principal.

## Arquivos

- `extension.js`: extensão personalizada PenguinMod.
- `server.js`: servidor de retransmissão WebSocket.
- `package.json`: dependência e comando de inicialização.
