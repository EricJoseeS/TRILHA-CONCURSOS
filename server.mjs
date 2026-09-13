import express from "express";
import cors from "cors";
import { Innertube } from "youtubei.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = Number(process.env.PORT || 8787);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

let ytPromise;
function getYouTube() {
  if (!ytPromise) ytPromise = Innertube.create();
  return ytPromise;
}

function cleanText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (value.text && typeof value.text === "object") return cleanText(value.text);
    if (typeof value.simpleText === "string") return value.simpleText;
    if (Array.isArray(value.runs)) return value.runs.map(run => cleanText(run)).join("");
  }
  return String(value);
}

function firstThumb(item) {
  const thumbs = item?.thumbnails || item?.thumbnail?.thumbnails || item?.content_image?.primary_thumbnail?.image || [];
  return thumbs.length ? thumbs[thumbs.length - 1].url : "";
}

function playlistId(item) {
  const direct = item?.id || item?.playlist_id;
  if (direct) return String(direct).replace(/^VL/, "");
  const browseId = item?.endpoint?.payload?.browseId;
  if (browseId) return String(browseId).replace(/^VL/, "");
  const url = item?.endpoint?.metadata?.url || item?.endpoint?.payload?.url || "";
  try { return new URL(url, "https://www.youtube.com").searchParams.get("list") || ""; } catch { return ""; }
}

function normalizePlaylist(p) {
  return {
    id: playlistId(p),
    title: cleanText(p.title || p.metadata?.title || p.info?.title),
    author: cleanText(p.author?.name || p.author || p.info?.author?.name),
    thumbnail: firstThumb(p)
  };
}

function normalizeVideo(v) {
  return {
    id: v.id || v.content_id || v.video_id,
    title: cleanText(v.title || v.metadata?.title),
    author: cleanText(v.author?.name || v.author),
    duration: cleanText(v.duration?.text || v.duration?.simple_text || v.duration),
    thumbnail: firstThumb(v)
  };
}

function extractPlaylistId(input) {
  const value = String(input || "").trim();
  if (/^[\w-]+$/.test(value)) return value;
  try {
    const u = new URL(value);
    const id = u.searchParams.get("list");
    if (id) return id;
  } catch {}
  const m = value.match(/[?&]list=([\w-]+)/);
  return m ? m[1] : null;
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "trilha-innertube" }));

app.get("/api/youtube/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Parâmetro q é obrigatório." });

    const yt = await getYouTube();
    const result = await yt.search(q, { type: String(req.query.filter || "video") });

    res.json({
      query: q,
      items: (result.videos || []).map(normalizeVideo),
      playlists: (result.playlists || []).map(normalizePlaylist).filter(p => p.id)
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error?.message || "Falha ao consultar InnerTube." });
  }
});

app.get("/api/youtube/playlist", async (req, res) => {
  try {
    const playlistId = extractPlaylistId(req.query.url || req.query.id);
    if (!playlistId) return res.status(400).json({ error: "URL ou ID de playlist inválido." });

    const yt = await getYouTube();
    const playlist = await yt.getPlaylist(playlistId);

    res.json({
      playlist: {
        id: playlistId,
        title: cleanText(playlist.title || playlist.info?.title),
        description: cleanText(playlist.description || playlist.info?.description)
      },
      items: (playlist.videos || []).map(normalizeVideo).filter(v => v.id)
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error?.message || "Falha ao carregar playlist." });
  }
});

app.listen(PORT, () => console.log(`Trilha InnerTube em http://localhost:${PORT}`));
app.get("/api/gemini/health", (req, res) => {
  res.json({ ok: true, configured: Boolean(GEMINI_API_KEY), model: DEFAULT_GEMINI_MODEL });
});

function extractInteractionText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text;
  const chunks = [];
  for (const step of data?.steps || []) {
    for (const item of step?.content || []) {
      if (item?.type === "text" && typeof item.text === "string") chunks.push(item.text);
    }
  }
  return chunks.join("\n").trim();
}

app.post("/api/gemini/generate", async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ error: "GEMINI_API_KEY não está configurada no servidor." });
  }
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  const model = typeof req.body?.model === "string" && /^[a-zA-Z0-9._-]+$/.test(req.body.model) ? req.body.model : DEFAULT_GEMINI_MODEL;
  if (!prompt) return res.status(400).json({ error: "Prompt vazio." });
  if (prompt.length > 120000) return res.status(413).json({ error: "Prompt muito grande." });

  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({ model, input: prompt, store: false })
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || "Erro na API Gemini.", details: data });
    }
    const text = extractInteractionText(data);
    if (!text) return res.status(502).json({ error: "O Gemini não retornou texto.", details: data });
    return res.json({ text, model: data.model || model, interactionId: data.id || null });
  } catch (error) {
    return res.status(502).json({ error: error?.message || "Falha ao conectar ao Gemini." });
  }
});


