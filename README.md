# FuegoCine para Nuvio 0.4.0

Estructura ajustada al formato de plugins de Nuvio: `manifest.json` raíz con `name`, `version` y `scrapers[]`; el scraper apunta a `providers/fuegocine.js`.

Contrato del proveedor: `module.exports = { getStreams(tmdbId, mediaType, season, episode) }`. El adaptador acepta TMDB numérico, IMDb `tt...` y referencias internas `fc:...`.

## Instalación
Coloca la carpeta del plugin en la ubicación de plugins de Nuvio o publica `manifest.json` y `providers/fuegocine.js` en un hosting estático compatible y añade la URL del manifiesto en Nuvio.

## Nota
Versión preliminar: la búsqueda por título usa consultas alternativas básicas; se debe probar dentro de Nuvio con películas y episodios reales. No se desactiva la validación TLS.


### 0.4.0
- Convierte enlaces de Google Drive `/file/d/.../view`, `/open?id=...` y `/uc?id=...` al endpoint de descarga directa de Google Drive.
- Añade User-Agent para fuentes de Google Drive.
