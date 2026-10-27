# GUDTEK

Screener de tokens de Solana con lista compartida. Un robot de GitHub Actions recorre DexScreener cada ~10 minutos, añade los tokens nuevos y actualiza los que ya hay (nunca borra ninguno). La web carga esa lista al instante y después sigue actualizándose en vivo desde el navegador.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | La web |
| `crawler/crawl.mjs` | El robot que recorre DexScreener y guarda `tokens.json` |
| `.github/workflows/update.yml` | Le dice a GitHub que ejecute el robot cada 10 min y publique la web |

## Puesta en marcha (una sola vez, unos 10 minutos)

1. **Crea una cuenta** en <https://github.com> si no tienes.
2. **Crea un repositorio nuevo**: botón **+** (arriba a la derecha) → **New repository**.
   - Nombre: `gudtek`
   - Marca **Public** (GitHub Pages es gratis en repositorios públicos).
   - Pulsa **Create repository**.
3. **Sube los archivos**: en el repositorio vacío, pulsa **uploading an existing file** y arrastra **todo el contenido** de la carpeta descomprimida (`index.html`, `README.md` y las carpetas `crawler` y `.github`). Pulsa **Commit changes**.
   - La carpeta `.github` está oculta en Mac y Windows. Si no la ves:
     - Mac: en Finder pulsa `Cmd + Shift + .`
     - Windows: en el Explorador, **Vista → Mostrar → Elementos ocultos**
   - Si aun así no se sube, créala a mano: **Add file → Create new file**, escribe como nombre `.github/workflows/update.yml`, pega el contenido de ese archivo y pulsa **Commit changes**.
4. **Activa GitHub Pages**: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. **Lanza el robot la primera vez**: pestaña **Actions** → si te lo pide, pulsa **I understand my workflows, go ahead and enable them** → **Update GUDTEK** → **Run workflow**.
6. Cuando termine (unos 5 minutos, aparece en verde), tu web está en:
   **`https://TU-USUARIO.github.io/gudtek/`**

Desde ese momento se ejecuta sola cada ~10 minutos. Comparte esa dirección con quien quieras: todos ven la misma lista.

## Cómo funciona

- Cada ejecución lee la lista publicada en la anterior, recorre DexScreener durante 4 minutos y la vuelve a publicar más completa:
  - perfiles nuevos (DEX pagado), perfiles actualizados, boosts, takeovers y anuncios
  - metas en tendencia con todos sus pares
  - búsquedas rotando por más de 300 términos
  - actualización de todos los tokens ya conocidos, empezando por los nuevos
  - holders y launchpad de Jupiter para los 2.000 tokens con más volumen
- Los tokens **nunca se borran**: solo se añaden y se actualizan.
- Si en alguna ejecución no se puede leer la lista anterior, esa ejecución se para sin publicar nada, para no perder tokens.
- En el navegador, la web pinta la lista compartida al instante y luego sigue en vivo: tokens con DEX recién pagado en ~1 s, la página visible cada 4 s y el resto en segundo plano.

## Avisos

- GitHub puede retrasar las ejecuciones programadas unos minutos cuando está muy cargado.
- En repositorios públicos, GitHub **desactiva las tareas programadas tras 60 días sin actividad** en el repositorio y avisa por email. Para reactivarlas: **Actions → Update GUDTEK → Enable workflow**, o sube cualquier cambio.
- La lista solo incluye lo que da la API pública de DexScreener; no es el listado interno completo de dexscreener.com.
