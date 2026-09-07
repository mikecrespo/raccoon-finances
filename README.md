# Raccoon Finances

App de finanzas personales, instalable (PWA) y con sincronización offline-first.
Antes era un artifact de Claude; ahora es una web normal que se puede instalar como
app en Android, Windows y Mac.

## Cómo está armado

| Archivo | Qué hace |
| --- | --- |
| `index.html` | Estructura de la página + carga de scripts + registro del service worker. |
| `styles.css` | Todo el diseño (idéntico al del artifact) + estilos de la pantalla de acceso y el indicador de sincronización. |
| `app.js` | Toda la lógica de finanzas: cálculos, pestañas, render, altas/bajas. Casi igual que el artifact original. `SEED_STATE` está vacío a propósito: los datos reales viven en Firestore y en cada dispositivo. |
| `store.js` | Capa de datos. Guarda en el dispositivo (localStorage) y, si Firebase está configurado, inicia sesión y sincroniza con Firestore (que además maneja la cola de cambios sin conexión). |
| `firebase-config.js` | Tus claves de Firebase. Con los valores `PON_AQUI...` la app corre en modo "solo este dispositivo". |
| `manifest.webmanifest` | Hace la app instalable (nombre, iconos, pantalla completa). |
| `sw.js` | Service worker: cachea el "shell" para que la app abra sin internet. Sube `CACHE = 'raccoon-vN'` cuando cambies archivos. |
| `firestore.rules` | Reglas de seguridad: cada cuenta solo ve sus propios datos. |
| `icons/` | Iconos generados (mapache sobre crema). |
| `vendor/` | SDK de Firebase (compat) servido localmente para que funcione offline. |

## Modelo de datos

Todo el estado es **un solo objeto JSON** (ingresos, gastos, pendientes, metas,
fondo, inversiones, decisiones, cuentaBancaria, historialMensual,
`ultimaActualizacion`). Se guarda como un único documento en
`users/{uid}/data/state` en Firestore.

**Sincronización:** "gana el más reciente" según `ultimaActualizacion` a nivel de
todo el documento. Para una sola usuaria con dos dispositivos es suficiente. El
único caso perdedor es editar en los dos equipos mientras **ambos** están sin
conexión; ahí se conserva el último que sincroniza. Los botones Exportar/Importar
respaldo quedan como red de seguridad.

## Desarrollo local

```bash
cd "raccoon-finances"
python3 -m http.server 8000
# abre http://localhost:8000
```

El service worker y Firebase Auth necesitan `http(s)://` (no `file://`).

## Publicar

Ver `SETUP.md`. Resumen: configurar Firebase en `firebase-config.js`, pegar
`firestore.rules`, y subir la carpeta a Netlify.
