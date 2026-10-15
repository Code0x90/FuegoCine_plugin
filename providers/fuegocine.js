/**
 * FuegoCine para Nuvio — versión preliminar
 * Mantiene el scraper original y adapta su entrada al contrato getStreams.
 * Acepta IMDb IDs (tt...) o IDs internos fc:movie:POST_ID / fc:series:POST_ID:T:E.
 */
import { getStreams as scrapeStreams, getMeta as scrapeMeta, fetchPosts } from '../src/scraper.js';

const manifest = {
  id: 'community.fuegocine.nuvio',
  name: 'FuegoCine',
  version: '0.1.0',
  description: 'Fuentes de películas y series desde FuegoCine',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'fc:']
};

function normalizeType(type) {
  return String(type || '').toLowerCase() === 'series' || String(type || '').toLowerCase() === 'tv'
    ? 'series'
    : 'movie';
}

function asImdbId(value) {
  if (typeof value === 'string' && /^tt\d+$/.test(value)) return value;
  if (value && typeof value === 'object') {
    const possible = value.imdbId || value.imdb_id || value.imdb || value.id;
    if (typeof possible === 'string' && /^tt\d+$/.test(possible)) return possible;
  }
  return '';
}

/**
 * Contrato de Nuvio usado por los plugins: getStreams(tmdbId, mediaType, season, episode).
 * Como el scraper original resuelve IDs IMDb mediante Cinemeta, los valores TMDB
 * numéricos no se fuerzan a IMDb: se informa que aún no se pueden resolver sin un IMDb ID.
 */
export async function getStreams(tmdbId, mediaType, season, episode) {
  const type = normalizeType(mediaType);

  // También permite que Nuvio o una prueba directa envíen un IMDb ID.
  const imdbId = asImdbId(tmdbId);
  if (imdbId) {
    const id = type === 'series' && Number.isFinite(Number(season)) && Number.isFinite(Number(episode))
      ? `${imdbId}:${Number(season)}:${Number(episode)}`
      : imdbId;
    return await scrapeStreams(type, id);
  }

  // Soporte de prueba y de llamadas que ya tengan el ID de publicación FuegoCine.
  if (typeof tmdbId === 'string' && /^(fc:movie:\d+|fc:series:\d+:\d+:\d+|fc:ep:\d+)$/.test(tmdbId)) {
    return await scrapeStreams(type, tmdbId);
  }

  // Nuvio suele entregar TMDB ID numérico. No se debe tratar como IMDb ID;
  // se devuelve lista vacía de forma segura hasta implementar resolución TMDB->IMDb.
  console.warn(`[FuegoCine] No se pudo resolver el identificador recibido: ${String(tmdbId)} (${type})`);
  return [];
}

// Exportaciones auxiliares para pruebas del plugin y futuras mejoras.
export async function getMeta(type, id) {
  return scrapeMeta(normalizeType(type), String(id || ''));
}

export async function search(title, type = 'movie') {
  return fetchPosts({ type: normalizeType(type), search: String(title || ''), limit: 10 });
}

export { manifest };
export default { manifest, getStreams, getMeta, search };
