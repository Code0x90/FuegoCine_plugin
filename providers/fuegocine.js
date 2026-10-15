/**
 * FuegoCine Scraper Engine
 * Extrae catálogos, metadatos y servidores de reproducción desde FuegoCine.com
 */

const BASE_URL = 'https://www.fuegocine.com';
const CINEMETA_URL = 'https://v3-cinemeta.strem.io/meta';

// Caché en memoria para optimizar velocidad y evitar sobrecarga
const cache = new Map();

function getCached(key) {
  const item = cache.get(key);
  if (item && item.expiry > Date.now()) {
    return item.data;
  }
  return null;
}

function setCache(key, data, ttlSeconds = 300) {
  cache.set(key, { data, expiry: Date.now() + ttlSeconds * 1000 });
}

function extractPostId(rawId) {
  if (!rawId) return '';
  const match = rawId.match(/post-(\d+)/);
  return match ? match[1] : rawId.replace(/[^0-9]/g, '');
}

function cleanTitle(title) {
  return (title || '')
    .replace(/\(\s*(19\d\d|20\d\d)\s*\)/g, '')
    .replace(/\b(19\d\d|20\d\d)\b/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractYear(entry) {
  const titleYear = entry.title?.$t?.match(/\b(19\d\d|20\d\d)\b/);
  if (titleYear) return titleYear[1];

  const catYears = entry.category
    ?.map(c => c.term)
    .filter(term => /^(19\d\d|20\d\d)$/.test(term));
  if (catYears && catYears.length > 0) return catYears[0];

  const yearMatch = entry.content?.$t?.match(/data-year="(\d{4})"/);
  if (yearMatch) return yearMatch[1];

  return '';
}

function decodeStreamUrl(url) {
  if (!url) return '';
  if (url.includes('?r=')) {
    const b64 = url.split('?r=')[1]?.split('&')[0];
    if (b64) {
      try {
        return Buffer.from(b64, 'base64').toString('utf8');
      } catch {
        return url;
      }
    }
  }
  return url;
}

function extractHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '');
  } catch {
    return 'Servidor';
  }
}

function formatLang(langCode) {
  const code = (langCode || '').toLowerCase().trim();
  if (code.includes('lat')) return { label: 'Español Latino', tag: 'LAT' };
  if (code.includes('es') || code.includes('cast')) return { label: 'Español Castellano', tag: 'ESP' };
  if (code.includes('sub')) return { label: 'Subtitulado', tag: 'SUB' };
  if (code.includes('en')) return { label: 'Inglés', tag: 'ENG' };
  return { label: langCode.toUpperCase() || 'LAT', tag: langCode.toUpperCase() || 'LAT' };
}

function parseBloggerEntry(entry, forceType) {
  const rawId = entry.id?.$t || '';
  const postId = extractPostId(rawId);
  const rawTitle = entry.title?.$t || 'Sin título';
  const name = cleanTitle(rawTitle);
  const content = entry.content?.$t || '';

  const categories = (entry.category || []).map(c => c.term);
  const isSeries =
    forceType === 'series' ||
    categories.includes('Serie') ||
    content.includes('data-post-type="serie"') ||
    content.includes('data-seasons-count');

  const type = isSeries ? 'series' : 'movie';
  const prefix = isSeries ? 'fc:series:' : 'fc:movie:';
  const id = `${prefix}${postId}`;

  let poster = '';
  const imgMatch = content.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  if (imgMatch) {
    poster = imgMatch[1];
  } else if (entry.media$thumbnail?.url) {
    poster = entry.media$thumbnail.url.replace('/s72-c/', '/w600/');
  }

  let background = '';
  const bgMatch = content.match(/data-(?:player-)?backdrop=["'](https?:\/\/[^"']+)["']/i);
  if (bgMatch) {
    background = bgMatch[1];
  } else {
    background = poster;
  }

  let description = '';
  const synMatch = content.match(/<p id="tmdb-synopsis">([\s\S]*?)<\/p>/i);
  if (synMatch && synMatch[1]) {
    description = synMatch[1].trim();
  }

  const ignoredCategories = new Set([
    'Movie', 'Serie', 'Episode', 'Estreno', 'Película de TV',
    'Netflix', 'Disney', 'Warner', 'Universal', 'Sony', 'Paramount',
    'Amazon', 'Fox', 'MGM', 'DreamWorks'
  ]);
  const genres = categories.filter(cat => {
    return !ignoredCategories.has(cat) && !/^\d{4}$/.test(cat) && !cat.startsWith('id-');
  });

  let imdbRating = '';
  const imdbMatch = content.match(/data-imdb=["']([\d.]+)["']/i);
  if (imdbMatch) {
    imdbRating = imdbMatch[1];
  }

  const year = extractYear(entry);

  return {
    id,
    type,
    name,
    poster,
    background,
    description,
    releaseInfo: year,
    genres,
    imdbRating
  };
}

async function fetchPosts(options = {}) {
  const { type = 'movie', genre, search, skip = 0, limit = 20 } = options;
  const cacheKey = `posts:${type}:${genre || ''}:${search || ''}:${skip}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let url = `${BASE_URL}/feeds/posts/default`;

  if (search && search.trim()) {
    url += `?alt=json&q=${encodeURIComponent(search.trim())}&start-index=${skip + 1}&max-results=${limit}`;
  } else {
    const labels = [];
    if (type === 'movie') {
      labels.push('Movie');
    } else {
      labels.push('Serie');
    }

    if (genre && genre !== 'Todos' && genre !== 'todos') {
      labels.push(genre);
    }

    url += `/-/${labels.map(encodeURIComponent).join('/')}?alt=json&start-index=${skip + 1}&max-results=${limit}`;
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 FuegoCine-Nuvio/1.0',
        'Accept': 'application/json'
      }
    });

    if (!res.ok) return [];

    const data = await res.json();
    const entries = data.feed?.entry || [];
    const metas = entries.map(e => parseBloggerEntry(e, type));

    setCache(cacheKey, metas, 300);
    return metas;
  } catch (err) {
    console.error('Error al obtener posts de FuegoCine:', err.message);
    return [];
  }
}

async function fetchPostById(postId) {
  const cacheKey = `post:byid:${postId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/feeds/posts/default/${postId}?alt=json`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 FuegoCine-Nuvio/1.0' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const entry = data.entry;
    if (entry) {
      setCache(cacheKey, entry, 600);
      return entry;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchSeriesEpisodes(seriesPostId) {
  const cacheKey = `episodes:${seriesPostId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/feeds/posts/default/-/id-${seriesPostId}?alt=json&max-results=150`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 FuegoCine-Nuvio/1.0' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const entries = data.feed?.entry || [];

    const videos = [];

    for (const entry of entries) {
      const content = entry.content?.$t || '';
      const title = entry.title?.$t || '';

      let season = 1;
      let episode = 1;

      const sMatch = content.match(/data-season-number=["'](\d+)["']/i);
      const eMatch = content.match(/data-episode-count=["'](\d+)["']/i);

      if (sMatch && eMatch) {
        season = parseInt(sMatch[1], 10);
        episode = parseInt(eMatch[1], 10);
      } else {
        const titleMatch = title.match(/(\d+)\s*[xX]\s*(\d+)/);
        if (titleMatch) {
          season = parseInt(titleMatch[1], 10);
          episode = parseInt(titleMatch[2], 10);
        }
      }

      let thumbnail = '';
      const imgMatch = content.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
      if (imgMatch) thumbnail = imgMatch[1];

      videos.push({
        id: `fc:series:${seriesPostId}:${season}:${episode}`,
        title: title || `Temporada ${season} - Episodio ${episode}`,
        season,
        episode,
        released: entry.published?.$t?.slice(0, 10),
        thumbnail
      });
    }

    videos.sort((a, b) => {
      if (a.season === b.season) return a.episode - b.episode;
      return a.season - b.season;
    });

    setCache(cacheKey, videos, 600);
    return videos;
  } catch (err) {
    console.error('Error al obtener episodios:', err.message);
    return [];
  }
}

function extractStreamsFromContent(content) {
  if (!content) return [];
  const match = content.match(/_SV_LINKS\s*=\s*(\[[^;]+\])/);
  if (!match) return [];

  const streams = [];
  try {
    // eslint-disable-next-line no-eval
    const rawLinks = eval(match[1]);
    if (!Array.isArray(rawLinks)) return [];

    for (const item of rawLinks) {
      if (!item.url) continue;
      const resolvedUrl = decodeStreamUrl(item.url);
      const host = extractHost(resolvedUrl);
      const langInfo = formatLang(item.lang);
      const quality = item.quality || 'HD (1080p)';
      const serverName = (item.name || 'Servidor').replace(/✅|AD/g, '').trim();

      const title = `${serverName} • ${quality} • ${host}\nAudio: ${langInfo.label}`;

      streams.push({
        name: `FuegoCine [${langInfo.tag}]`,
        title,
        url: resolvedUrl,
        externalUrl: resolvedUrl,
        behaviorHints: {
          notWebReady: false,
          bingeGroup: `fuegocine-${item.lang || 'lat'}`
        }
      });
    }
  } catch (err) {
    console.error('Error parseando _SV_LINKS:', err.message);
  }

  return streams;
}

async function resolveCinemetaTitle(type, id) {
  const cacheKey = `cinemeta:${type}:${id}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`${CINEMETA_URL}/${type}/${id}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data.meta;
    if (meta && meta.name) {
      const result = { title: meta.name, year: meta.year ? String(meta.year) : '' };
      setCache(cacheKey, result, 3600);
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

async function getMeta(type, id) {
  const normType = type === 'series' ? 'series' : 'movie';

  if (id.startsWith('fc:movie:') || id.startsWith('fc:series:')) {
    const parts = id.split(':');
    const postId = parts[2];
    const entry = await fetchPostById(postId);
    if (!entry) return null;

    const meta = parseBloggerEntry(entry, normType);

    if (normType === 'series') {
      meta.videos = await fetchSeriesEpisodes(postId);
    }
    return meta;
  }

  if (id.startsWith('tt') || id.startsWith('tmdb:')) {
    const info = await resolveCinemetaTitle(normType, id);
    if (!info) return null;

    const searchResults = await fetchPosts({
      type: normType,
      search: info.title,
      limit: 5
    });

    if (searchResults.length > 0) {
      const best = searchResults[0];
      best.id = id;
      if (normType === 'series') {
        const originalPostId = extractPostId(searchResults[0].id);
        best.videos = await fetchSeriesEpisodes(originalPostId);
        best.videos = best.videos.map(v => ({
          ...v,
          id: `${id}:${v.season}:${v.episode}`
        }));
      }
      return best;
    }
  }

  return null;
}

async function getStreams(type, id) {
  if (id.startsWith('fc:movie:')) {
    const postId = id.replace('fc:movie:', '');
    const entry = await fetchPostById(postId);
    if (!entry) return [];
    return extractStreamsFromContent(entry.content?.$t || '');
  }

  if (id.startsWith('fc:series:')) {
    const parts = id.split(':');
    const seriesPostId = parts[2];
    const targetSeason = parseInt(parts[3] || '1', 10);
    const targetEpisode = parseInt(parts[4] || '1', 10);

    const url = `${BASE_URL}/feeds/posts/default/-/id-${seriesPostId}?alt=json&max-results=150`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 FuegoCine-Nuvio/1.0' } });
      if (!res.ok) return [];
      const data = await res.json();
      const entries = data.feed?.entry || [];

      for (const entry of entries) {
        const content = entry.content?.$t || '';
        const title = entry.title?.$t || '';

        let season = 1;
        let episode = 1;
        const sMatch = content.match(/data-season-number=["'](\d+)["']/i);
        const eMatch = content.match(/data-episode-count=["'](\d+)["']/i);
        if (sMatch && eMatch) {
          season = parseInt(sMatch[1], 10);
          episode = parseInt(eMatch[1], 10);
        } else {
          const titleMatch = title.match(/(\d+)\s*[xX]\s*(\d+)/);
          if (titleMatch) {
            season = parseInt(titleMatch[1], 10);
            episode = parseInt(titleMatch[2], 10);
          }
        }

        if (season === targetSeason && episode === targetEpisode) {
          return extractStreamsFromContent(content);
        }
      }
    } catch {
      return [];
    }
  }

  if (id.startsWith('fc:ep:')) {
    const epPostId = id.replace('fc:ep:', '');
    const entry = await fetchPostById(epPostId);
    if (!entry) return [];
    return extractStreamsFromContent(entry.content?.$t || '');
  }

  if (id.startsWith('tt') || id.startsWith('tmdb:')) {
    const parts = id.split(':');
    const baseId = parts[0];
    const season = parts[1] ? parseInt(parts[1], 10) : null;
    const episode = parts[2] ? parseInt(parts[2], 10) : null;

    const normType = season !== null ? 'series' : 'movie';
    const info = await resolveCinemetaTitle(normType, baseId);
    if (!info) return [];

    const searchResults = await fetchPosts({
      type: normType,
      search: info.title,
      limit: 5
    });

    if (searchResults.length === 0) return [];

    const bestPost = searchResults[0];
    const postId = extractPostId(bestPost.id);

    if (season !== null && episode !== null) {
      return getStreams('series', `fc:series:${postId}:${season}:${episode}`);
    } else {
      return getStreams('movie', `fc:movie:${postId}`);
    }
  }

  return [];
}


// Contrato Nuvio: getStreams(tmdbId, mediaType, season, episode)
const TMDB_API_KEY = '56db0ec297530920213e1503706b81ff';
async function resolveNuvioId(tmdbId, mediaType) {
  const type = String(mediaType || '').toLowerCase();
  const tmdbType = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
  const raw = String(tmdbId || '');
  if (/^tt\d+$/.test(raw)) return { imdbId: raw, type: tmdbType };
  if (raw.startsWith('fc:')) return { internalId: raw, type: tmdbType };
  if (!/^\d+$/.test(raw)) return null;

  // Siempre recuperar los títulos de TMDB: si la búsqueda IMDb/Cinemeta no coincide
  // con el título publicado en Blogger, se usan títulos localizados como alternativa.
  const titleInfo = { titles: [], year: '' };
  for (const language of ['es-PE', 'es-ES', 'en-US']) {
    try {
      const url = `https://api.themoviedb.org/3/${tmdbType}/${raw}?api_key=${TMDB_API_KEY}&language=${language}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 FuegoCine-Nuvio/0.3.0' } });
      if (!res.ok) continue;
      const d = await res.json();
      const title = d.title || d.name || '';
      if (title && !titleInfo.titles.includes(title)) titleInfo.titles.push(title);
      if (!titleInfo.year) titleInfo.year = String((d.release_date || d.first_air_date || '').slice(0, 4));
    } catch (_) {}
  }

  let imdbId = '';
  try {
    const url = `https://api.themoviedb.org/3/${tmdbType}/${raw}/external_ids?api_key=${TMDB_API_KEY}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 FuegoCine-Nuvio/0.3.0' } });
    if (res.ok) {
      const data = await res.json();
      imdbId = data && data.imdb_id || '';
    }
  } catch (_) {}

  return { imdbId: imdbId || null, tmdbId: raw, type: tmdbType, titleInfo };
}

async function getStreamsNuvio(tmdbId, mediaType, season, episode) {
  try {
    const type = String(mediaType || '').toLowerCase();
    const streamType = (type === 'tv' || type === 'series') ? 'series' : 'movie';
    const resolved = await resolveNuvioId(tmdbId, type);
    if (!resolved) {
      console.warn('[FuegoCine:Nuvio] No se pudo interpretar el ID recibido');
      return [];
    }
    if (resolved.internalId) {
      return await getStreams(streamType, resolved.internalId);
    }

    // Primero intenta el camino IMDb/Cinemeta original, que es el más preciso.
    if (resolved.imdbId) {
      const contentId = streamType === 'series'
        ? `${resolved.imdbId}:${Number(season || 1)}:${Number(episode || 1)}`
        : resolved.imdbId;
      const streams = await getStreams(streamType, contentId);
      if (streams.length) {
        console.log(`[FuegoCine:Nuvio] Encontradas ${streams.length} fuentes mediante IMDb/Cinemeta`);
        return streams;
      }
      console.warn('[FuegoCine:Nuvio] IMDb/Cinemeta no encontró fuentes; probando títulos alternativos de TMDB');
    }

    // Alternativa: buscar en Blogger por títulos localizados/inglés y elegir el mejor candidato.
    const info = resolved.titleInfo || {};
    const titles = Array.isArray(info.titles) ? info.titles : (info.title ? [info.title] : []);
    const year = info.year || '';
    const norm = value => String(value || '').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
    const queries = [];
    for (const title of titles) {
      if (!title) continue;
      queries.push(title);
      queries.push(title.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim());
      if (year) queries.push(`${title} ${year}`);
    }

    let candidates = [];
    const seen = new Set();
    for (const query of [...new Set(queries.filter(Boolean))]) {
      const posts = await fetchPosts({ type: streamType, search: query, limit: 10 });
      for (const post of posts) {
        const postId = extractPostId(post.id);
        if (!postId || seen.has(postId)) continue;
        seen.add(postId);
        const name = norm(post.name);
        const wanted = norm(titles[0] || '');
        let score = 0;
        for (const title of titles) {
          const n = norm(title);
          if (name && n && name === n) score = Math.max(score, 100);
          else if (name && n && (name.includes(n) || n.includes(name))) score = Math.max(score, 70);
          else if (name && n && name.split(' ').filter(w => w.length > 2 && n.split(' ').includes(w)).length) score = Math.max(score, 30);
        }
        if (year && String(post.releaseInfo || '') === year) score += 15;
        candidates.push({ post, postId, score });
      }
      // No detenerse en la primera consulta: se comparan los títulos alternativos.
    }

    candidates.sort((a, b) => b.score - a.score);
    if (!candidates.length || candidates[0].score < 30) {
      console.warn(`[FuegoCine:Nuvio] Sin coincidencia en Blogger. Títulos probados: ${titles.join(' | ') || '(ninguno)'}`);
      return [];
    }

    const best = candidates[0];
    console.log(`[FuegoCine:Nuvio] Coincidencia Blogger: "${best.post.name}" (score=${best.score}, post=${best.postId})`);
    if (streamType === 'series') {
      return await getStreams('series', `fc:series:${best.postId}:${Number(season || 1)}:${Number(episode || 1)}`);
    }
    return await getStreams('movie', `fc:movie:${best.postId}`);
  } catch (e) {
    console.error('[FuegoCine:Nuvio] ' + (e && e.message || e));
    return [];
  }
}

module.exports = { getStreams: getStreamsNuvio };
