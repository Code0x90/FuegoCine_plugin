# FuegoCine para Nuvio — preliminar 0.1.0

Paquete inicial para validar la estructura de plugin y el scraper de FuegoCine.

## Contenido
- `manifest.json`: manifiesto básico del plugin.
- `providers/fuegocine.js`: exporta `getStreams(tmdbId, mediaType, season, episode)` y helpers de prueba.
- `src/scraper.js`: motor de extracción tomado del proyecto FuegoCine original.

## Estado de esta versión
- Reutiliza extracción de `_SV_LINKS` y decodificación de URLs del scraper original.
- Permite pruebas con IDs IMDb (`tt...`) y IDs internos `fc:movie:POST_ID`, `fc:ep:POST_ID` o `fc:series:POST_ID:TEMPORADA:EPISODIO`.
- **Limitación conocida:** el contrato habitual de Nuvio entrega un TMDB ID numérico. Esta versión todavía no convierte ese ID a IMDb, por lo que en ese caso devuelve `[]`. La siguiente fase debe implementar esa resolución o aprovechar el IMDb ID que entregue Nuvio.
- La búsqueda exacta por título también requiere una fase de matching/fallback; la prueba con Chainsaw Man mostró que el título original de Cinemeta no coincide literalmente con el título localizado de Blogger.

## Prueba rápida en Node.js
Requiere Node.js 18+ con `fetch` nativo.

```js
import { getStreams, search } from './providers/fuegocine.js';
console.log(await search('Chainsaw Man', 'movie'));
console.log(await getStreams('tt0468569', 'movie'));
console.log(await getStreams('fc:movie:716276847319913489', 'movie'));
```

Esta es una base preliminar para pruebas, no una versión final validada dentro de Nuvio.
