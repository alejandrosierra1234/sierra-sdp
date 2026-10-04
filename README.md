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

La función activa `payment-dossier` de Supabase reúne la SDP y los documentos de los items vinculados, conserva la SDP como primera página, genera un único PDF y lo carga en `Expediente para aprobación`. Se activa cuando se carga o cambia la SDP, marca `Preparando expediente` y solo cambia a `Enviar a firma` después de verificar el PDF cargado. Es determinista e idempotente: los mismos documentos producen la misma versión y un reintento no duplica el expediente. No utiliza IA ni créditos de Vibe durante la ejecución.

## Despliegue

La implementación activa está en `supabase/functions/fuel-report/index.ts`. Se despliega en el mismo proyecto Supabase que las automatizaciones existentes de Suppliers:

```bash
supabase functions deploy fuel-report --project-ref vhyddogeemohtqijohry --no-verify-jwt
supabase secrets set FUEL_REPORT_WEBHOOK_SECRET=... --project-ref vhyddogeemohtqijohry
supabase functions deploy payment-dossier --project-ref vhyddogeemohtqijohry --no-verify-jwt
supabase secrets set PAYMENT_DOSSIER_WEBHOOK_SECRET=... --project-ref vhyddogeemohtqijohry
```

`MONDAY_API_TOKEN` ya es un secreto compartido del proyecto. La URL de monday debe usar `?key=FUEL_REPORT_WEBHOOK_SECRET`. `supabase/config.toml` desactiva la verificación JWT únicamente para esta función porque monday autentica con el secreto de webhook.

El servicio Node/Render queda como implementación de compatibilidad, pero está suspendido y `AUTO_REGISTER_WEBHOOK=false`; la única ruta activa de generación es Supabase.

La guía completa de configuración, despliegue, trigger, seguridad y columnas detectadas está en [docs/monday-combustible.md](docs/monday-combustible.md).

## Comandos

- `npm test`: pruebas de transformación, cálculo, PDF, paginación, respaldos, webhook e idempotencia.
- `npm run sample`: genera `output/pdf/reporte-combustible-muestra.pdf` con datos ficticios.
- `npm run inspect:monday`: consulta el esquema vivo del tablero usando `MONDAY_API_TOKEN`.
- `npm run verify:deployment`: comprueba HTTPS, health check, challenge, esquema y etiqueta del trigger.
- `npm run register:webhook`: registra una sola vez el webhook del estado de aprobación.
- `npm start`: inicia el servicio y sirve también la aplicación SDP original.

Los secretos se leen únicamente desde variables de entorno. `.env` está excluido de Git.
