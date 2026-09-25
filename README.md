# Trilha + InnerTube

Esta versão adiciona uma ponte local para o InnerTube. O navegador chama o servidor local, e o servidor usa `youtubei.js` para pesquisa e leitura de playlists públicas.

## Instalação

Requer Node.js:

```powershell
cd .\trilha-innertube
npm install
npm start
```

Servidor: `http://localhost:8787`

Depois abra `trilha-innertube.html`.

## Uso

Em **Aulas**:

- O perfil normal usa esta aba apenas para assistir às aulas e acompanhar o progresso.

No perfil **Admin**, a aba **Gerenciar aulas** permite:

- **Pesquisa**: procurar vídeos diretamente no YouTube.
- **Playlist**: colar uma URL/ID de playlist pública.
- **Adicionar**: adicionar um vídeo à matéria atual.
- **Adicionar todos**: adicionar todos os vídeos carregados da playlist.
- Apagar aulas já cadastradas.

Em **Ajustes**, o endpoint padrão é `http://localhost:8787`.

## API local

- `GET /api/health`
- `GET /api/youtube/search?q=...`
- `GET /api/youtube/playlist?url=...`

## Nota técnica

O InnerTube é uma API interna do YouTube e pode mudar sem aviso. O adaptador fica isolado em `server.mjs` para facilitar manutenção. A integração não reproduz código proprietário do NewPipe/Metrolist; ela usa a biblioteca open-source `youtubei.js` para falar com a mesma família de API interna.


## Gemini no servidor (recomendado)

A versão atual integra o Gemini pelo backend local. Isso evita colocar a chave da API no HTML/localStorage. O servidor usa a Gemini Interactions API, que é a interface recomendada atualmente pelo Google.

No PowerShell, antes de iniciar o servidor:

```powershell
$env:GEMINI_API_KEY="SUA_CHAVE_AQUI"
$env:GEMINI_MODEL="gemini-3.8-flash"
& "C:\Program Files\nodejs\node.exe" server.mjs
```

Ou crie um arquivo `.env` e carregue as variáveis com seu método de ambiente preferido. Nunca publique a chave em GitHub ou dentro do HTML.

A interface também mantém uma opção de chave local como fallback, mas o modo servidor é preferível.

## Melhorias desta versão

- Player de aula em popup com botão de tela cheia e tecla Esc para fechar.
- Botão para apagar aulas, removendo também marcação e anotações associadas.
- Servidor local pode entregar o próprio HTML em `http://localhost:8787/trilha-innertube.html`.
- Gemini integrado no backend via Interactions API.
- Endpoint `/api/gemini/health` para verificar configuração.
- Endpoint `/api/gemini/generate` para geração de texto.
- Mantido o InnerTube para pesquisa e playlists do YouTube.


## Inicialização no Windows

Como alguns PowerShells podem ter conflitos de PATH com `npm.cmd`, você pode iniciar diretamente pelo arquivo `iniciar-trilha.cmd`. Ele chama o `node.exe` pelo caminho padrão do Windows.

## Novidades: gamificação e estudo inteligente

**Gamificação**
- Sistema de XP e níveis: assistir aulas (+8 XP), responder questões (+10/+2 XP) e manter o streak (+5 XP/dia) fazem você subir de nível, com títulos de "Iniciante" a "Lenda dos Estudos".
- Meta diária configurável em Ajustes (padrão: 3 ações/dia), com barra de progresso no Painel.
- Calendário de constância (heatmap estilo GitHub) mostrando os últimos ~14 dias de atividade.
- 12 conquistas desbloqueáveis (primeira aula, primeira questão, streaks de 3/7/30 dias, 50/100 questões, gabarito 100%, matéria dominada, níveis 5/10, revisor dedicado), com notificação e registro na atividade recente.

**Estudo mais inteligente**
- **Revisão espaçada (SRS)**: toda questão respondida entra num sistema de repetição espaçada (Leitner, 5 caixas, intervalos de 1 a 35 dias). A aba Questões mostra quantas revisões estão prontas agora e permite iniciar uma sessão só com elas, misturando matérias.
- **Resumos/explicações com transcrição real**: ao clicar em "Explicar aula" ou "Criar questões" dentro de uma aula, o servidor tenta buscar a transcrição real do vídeo (via `youtubei.js`) e envia esse conteúdo ao Gemini, em vez de basear-se só no título. Quando a transcrição não está disponível (nem toda aula tem legendas), o sistema avisa e usa o modo anterior (baseado no título) com o mesmo cuidado para não inventar conteúdo.
- **Busca global**: campo de busca na barra superior que encontra aulas, questões e trilhas por texto, e leva você direto para o conteúdo (trocando de trilha/matéria automaticamente se necessário).

Essas mudanças são compatíveis com backups/exportações antigos — ao carregar um `trilha-backup.json` de uma versão anterior, os novos campos (XP, conquistas, calendário de atividade, revisão espaçada, meta diária) são preenchidos automaticamente com valores padrão.

## Interface de sala de aula

A aba **Aulas** agora usa uma interface de sala de aula:
- player grande à esquerda;
- playlist da matéria à direita;
- seleção de aula sem recarregar a página;
- tela cheia do player;
- anterior/próxima;
- marcar como assistida;
- anotações por aula;
- apagar aula individualmente;
- ações contextuais do Gemini para explicar a aula ou gerar questões.

