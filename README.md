# sierra-sdp

Aplicación de Solicitudes de Pago (SDP) y generación automática de reportes de combustible desde monday.com mediante una Supabase Edge Function.

La interfaz estática original sigue disponible en `/`. La función `fuel-report` recibe un webhook seguro, consulta el item y sus subitems, descarga los respaldos, genera un PDF corporativo y lo adjunta a `Reporte PDF`.

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

## Despliegue

La implementación activa está en `supabase/functions/fuel-report/index.ts`. Se despliega en el mismo proyecto Supabase que las automatizaciones existentes de Suppliers:

```bash
supabase functions deploy fuel-report --project-ref vhyddogeemohtqijohry --no-verify-jwt
supabase secrets set FUEL_REPORT_WEBHOOK_SECRET=... --project-ref vhyddogeemohtqijohry
```

`MONDAY_API_TOKEN` ya es un secreto compartido del proyecto. La URL de monday debe usar `?key=FUEL_REPORT_WEBHOOK_SECRET`. `supabase/config.toml` desactiva la verificación JWT únicamente para esta función porque monday autentica con el secreto de webhook.

El servicio Node/Render queda como implementación de compatibilidad hasta completar la migración; no es el destino arquitectónico recomendado.

La guía completa de configuración, despliegue, trigger, seguridad y columnas detectadas está en [docs/monday-combustible.md](docs/monday-combustible.md).

## Comandos

- `npm test`: pruebas de transformación, cálculo, PDF, paginación, respaldos, webhook e idempotencia.
- `npm run sample`: genera `output/pdf/reporte-combustible-muestra.pdf` con datos ficticios.
- `npm run inspect:monday`: consulta el esquema vivo del tablero usando `MONDAY_API_TOKEN`.
- `npm run verify:deployment`: comprueba HTTPS, health check, challenge, esquema y etiqueta del trigger.
- `npm run register:webhook`: registra una sola vez el webhook del estado de aprobación.
- `npm start`: inicia el servicio y sirve también la aplicación SDP original.

Los secretos se leen únicamente desde variables de entorno. `.env` está excluido de Git.
