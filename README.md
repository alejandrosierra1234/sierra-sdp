# sierra-sdp

Aplicación de Solicitudes de Pago (SDP) y servicio automático de reportes de combustible desde monday.com.

La interfaz estática original sigue disponible en `/`. El backend recibe un webhook seguro, consulta el item y sus subitems, descarga los respaldos, genera un PDF corporativo y lo adjunta a `Reporte PDF`.

## Inicio rápido

Requisitos: Node.js 20 o posterior y una URL HTTPS pública.

```bash
npm install
cp .env.example .env
# Complete los secretos en .env; la tarifa está fijada en USD 0.25/km
npm test
npm run sample
npm start
```

El endpoint de salud es `GET /healthz` y el webhook es `POST /api/monday/webhook`.

## Despliegue directo

El repositorio incluye `render.yaml` para crear un Web Service de Render con `npm ci`, `npm start`, health check y todas las variables no secretas. Durante la creación, Render solicitará `MONDAY_API_TOKEN` y `MONDAY_WEBHOOK_SECRET`; nunca los guarde en Git.

[Desplegar el servicio en Render](https://render.com/deploy?repo=https://github.com/alejandrosierra1234/sierra-sdp)

Después del despliegue, defina localmente `PUBLIC_WEBHOOK_URL=https://SU-SERVICIO.onrender.com/api/monday/webhook`, ejecute `npm run verify:deployment` y finalmente `npm run register:webhook`.

La guía completa de configuración, despliegue, trigger, seguridad y columnas detectadas está en [docs/monday-combustible.md](docs/monday-combustible.md).

## Comandos

- `npm test`: pruebas de transformación, cálculo, PDF, paginación, respaldos, webhook e idempotencia.
- `npm run sample`: genera `output/pdf/reporte-combustible-muestra.pdf` con datos ficticios.
- `npm run inspect:monday`: consulta el esquema vivo del tablero usando `MONDAY_API_TOKEN`.
- `npm run verify:deployment`: comprueba HTTPS, health check, challenge, esquema y etiqueta del trigger.
- `npm run register:webhook`: registra una sola vez el webhook del estado de aprobación.
- `npm start`: inicia el servicio y sirve también la aplicación SDP original.

Los secretos se leen únicamente desde variables de entorno. `.env` está excluido de Git.
