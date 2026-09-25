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

async function translateTitle(title) {
  const original = String(title || "").trim();
  if (!original) return original;
  try {
    const params = new URLSearchParams({ q: original.slice(0, 500), langpair: "en|pt-BR" });
    const response = await fetch(`https://api.mymemory.translated.net/get?${params}`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error("Serviço de tradução indisponível");
    const data = await response.json();
    const translated = String(data?.responseData?.translatedText || "").trim();
    if (translated && data?.responseStatus === 200 && !translated.includes("INVALID SOURCE LANGUAGE")) {
      return translated;
    }
  } catch {
    // Try the secondary provider below before preserving the original title.
  }
  try {
    const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: "pt", dt: "t", q: original });
    const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return original;
    const data = await response.json();
    const translated = Array.isArray(data?.[0])
      ? data[0].map(part => part?.[0] || "").join("").trim()
      : "";
    return translated || original;
  } catch {
    return original;
  }
}

async function translateVideoTitles(videos) {
  const translated = [];
  for (let index = 0; index < videos.length; index += 4) {
    const batch = videos.slice(index, index + 4);
    translated.push(...await Promise.all(batch.map(async video => ({
      ...video,
      title: await translateTitle(video.title)
    }))));
  }
  return translated;
}

async function enrichVideoDurations(videos) {
  const yt = await getYouTube();
  const enriched = [];
  for (let index = 0; index < videos.length; index += 6) {
    const batch = videos.slice(index, index + 6);
    enriched.push(...await Promise.all(batch.map(async video => {
      if (video.duration) return video;
      try {
        const info = await Promise.race([
          yt.getInfo(video.id),
          new Promise((_, reject) => setTimeout(() => reject(new Error("duration timeout")), 6000))
        ]);
        return { ...video, duration: Number(info.basic_info?.duration || 0) };
      } catch {
        return video;
      }
    })));
  }
  return enriched;
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

    const items = await translateVideoTitles((result.videos || []).map(normalizeVideo));
    res.json({
      query: q,
      items,
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

    const normalizedItems = (playlist.videos || []).map(normalizeVideo).filter(v => v.id);
    const items = await translateVideoTitles(await enrichVideoDurations(normalizedItems));
    res.json({
      playlist: {
        id: playlistId,
        title: cleanText(playlist.title || playlist.info?.title),
        description: cleanText(playlist.description || playlist.info?.description)
      },
      items
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error?.message || "Falha ao carregar playlist." });
  }
});

app.get("/api/youtube/transcript", async (req, res) => {
  try {
    const id = String(req.query.id || "").trim();
    if (!/^[\w-]{11}$/.test(id)) return res.status(400).json({ error: "ID de vídeo inválido." });

    const yt = await getYouTube();
    const info = await yt.getInfo(id);
    let text = "";
    try {
      const transcriptInfo = await info.getTranscript();
      const segments = transcriptInfo?.transcript?.content?.body?.initial_segments || [];
      text = segments.map(seg => cleanText(seg?.snippet)).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    } catch {
      text = "";
    }
    if (!text) return res.status(404).json({ error: "Transcrição não disponível para este vídeo." });
    if (text.length > 12000) text = text.slice(0, 12000) + "…";
    res.json({ id, text, length: text.length });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error?.message || "Falha ao obter transcrição." });
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


