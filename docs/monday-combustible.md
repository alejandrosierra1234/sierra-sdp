# Integración de reporte de combustible con monday.com

## Flujo implementado

```text
Aprobación = "Aprobado para generar"
        -> webhook autenticado en Supabase Edge Functions
        -> validación de board, item y columna
        -> consulta del item y sus subitems
        -> suma y cálculo en el servidor
        -> descarga limitada de respaldos
        -> PDF corporativo
        -> carga a Reporte PDF
        -> verificación del asset
```

El trigger usa la columna existente **Aprobación**. No se crea una columna nueva. Si la etiqueta `Aprobado para generar` todavía no existe, agréguela como etiqueta de esa misma columna; también puede cambiarse con `MONDAY_TRIGGER_LABEL`.

La tarifa es una regla de negocio fija de **USD 0.25 por kilómetro**, definida en el servidor. El valor visible de `Tarifa USD/km` solo se compara para detectar discrepancias; nunca controla el cálculo. No existe variable de entorno ni entrada de formulario que pueda modificarla.

## Esquema real detectado

Board: `MKT Reporte de Combustible` (`18433758498`). Los IDs se obtuvieron de la estructura técnica del tablero y del editor del WorkForm el 2 de octubre de 2026. `npm run inspect:monday` permite revalidar las columnas principales con la API antes de desplegar.

| Alcance | Nombre visible | ID técnico | Tipo observado / uso |
|---|---|---|---|
| Item | Recorrido | `name` | Nombre del item |
| Item | Total kilómetros de trayectos | `lookup_mm7rbkya` | Mirror/lookup; se valida, no se confía como total final |
| Item | Colaborador | `person` | Persona |
| Item | Status | `status` | Estado |
| Item | Date | `date4` | Fecha final del período |
| Item | ¿Qué período estás reportando? | `date_mm7r76eb` | Fecha inicial vinculada al WorkForm |
| WorkForm | ¿Qué período estás reportando? | `date_range8in99p72` | Pregunta compuesta de rango (no se usa como ID GraphQL) |
| Item | ¿Cuántos kilómetros estás reportando? | `numeric_mm7rg95t` | Número declarado; solo validación |
| Item | Respaldo de kilometraje | `file_mm7rqfa2` | Files legado/principal |
| Item | Confirmación del colaborador | `boolean_mm7ry62j` | Checkbox |
| Item | Tarifa USD/km | `numeric_mm7rt81x` | Número; solo validación |
| Item | Tipo de cambio | `numeric_mm7rpc7x` | Número |
| Item | Facturas de combustible | `board_relation_mm7rgfxq` | Relación de tablero |
| Item | Reporte PDF | `file_mm7rp1y1` | Files, destino del PDF |
| Item | Validación documental | `color_mm7rqcst` | Estado |
| Item | Aprobación | `color_mm7r9b1w` | Estado y trigger |
| Item | Reembolso calculado | `formula_mm7rwaj2` | Fórmula; el PDF recalcula en el servidor |
| Subitem | Inicio del recorrido | `name` | Nombre del subitem |
| Subitem | Owner | `person` | Persona, no necesaria en el PDF |
| Subitem | Status | `status` | Estado, no necesario en el PDF |
| Subitem | Fecha del trayecto | `date0` | Fecha |
| Subitem | Fin del recorrido | `text_mm7rn7he` | Texto |
| Subitem | Distancia (km) | `numeric_mm7r864e` | Número |
| Subitem | Foto del kilometraje | `file_mm7r1zdy` | Files |

El tablero no contenía items al momento de la inspección. Por eso no se hizo una carga destructiva o de prueba sobre datos reales. La consulta, el multipart upload y la verificación posterior están cubiertos por pruebas automatizadas y quedan listos para ejecutarse con el primer item válido.

## Secretos de Supabase

La Edge Function utiliza:

- `MONDAY_API_TOKEN`: token con `boards:read`, `boards:write` y `assets:read`.
- `FUEL_REPORT_WEBHOOK_SECRET`: secreto aleatorio usado como `?key=...` por monday.

Los IDs del tablero, columnas y la tarifa fija están en el código para que no puedan desviarse mediante el formulario o variables de despliegue.

No registre ni copie tokens, secretos o URLs temporales de assets en logs.

## Configuración exacta del webhook

### Opción A: board webhook estándar (mínimo cambio)

1. Despliegue `fuel-report` en Supabase con verificación JWT desactivada para esta función.
2. Genere un secreto aleatorio de al menos 32 bytes y guárdelo como `FUEL_REPORT_WEBHOOK_SECRET`.
3. En el tablero abra **Automate** -> **Integrations** -> busque **Webhooks**.
4. Seleccione la receta que envía un webhook cuando cambia una columna/estado.
5. Elija **Aprobación** y use esta URL, sustituyendo los valores:

   `https://vhyddogeemohtqijohry.supabase.co/functions/v1/fuel-report?key=SECRETO`

6. monday enviará un `challenge`; el endpoint lo devuelve automáticamente.
7. Configure/seleccione la etiqueta **Aprobado para generar**. El servidor ignora cualquier otro valor.

También puede crear el webhook por API:

```graphql
mutation {
  create_webhook(
    board_id: 18433758498
    url: "https://SU-DOMINIO/api/monday/webhook?secret=SECRETO"
    event: change_status_column_value
    config: "{\"columnId\":\"color_mm7r9b1w\",\"columnValue\":{\"$any$\":true}}"
  ) {
    id
    board_id
  }
}
```

### Opción B: webhook firmado por una app monday (recomendado)

1. Cree una app privada en monday, agregue una integración y conceda `boards:read`, `boards:write`, `assets:read` y `webhooks:write`.
2. Cree el webhook con el token OAuth de la app y la mutación anterior.
3. Guarde el Signing Secret como `MONDAY_SIGNING_SECRET`.
4. Establezca `MONDAY_REQUIRE_JWT=true` y la URL exacta, sin query string, en `PUBLIC_WEBHOOK_URL`.
5. El servicio verifica firma HS256, expiración y audiencia del JWT antes de procesar.

## Idempotencia y reintentos

La versión se calcula con SHA-256 sobre datos normalizados, trayectos y metadatos estables de assets. El archivo se llama:

`reporte-combustible-ITEM_ID-HASH.pdf`

- Si ese nombre ya existe en `Reporte PDF`, el evento se marca como omitido y no se regenera.
- Dos eventos simultáneos del mismo item se consolidan en un único proceso dentro de la instancia.
- Si cambian datos o respaldos, cambia el hash y se adjunta una nueva versión. Las anteriores se conservan como historial, evitando una operación destructiva de borrado.
- El webhook solo reacciona a `Aprobación`; la carga en `Reporte PDF` no produce ciclos.
- Consultas, descargas y cargas reintentan errores temporales y rate limits con backoff exponencial.

## PDF

El generador conserva tamaño carta, márgenes de 38 pt, Helvetica/Arial, encabezado fuerte, líneas, tablas y espacios de autorización de las SDP existentes. Adapta la paleta verde/teal/lima y agrega:

- el mismo logotipo de Hilos y Algodón definido como `HA_SRC` en la aplicación SDP, sin mantener una copia visual distinta;
- metadatos del reporte y período;
- resumen calculado en servidor;
- tabla multipágina con encabezado repetido;
- anexos por trayecto;
- autorrotación y escala proporcional de imágenes;
- incorporación página por página de respaldos PDF;
- aviso visible para archivos faltantes o inválidos sin abortar los demás;
- numeración de todas las páginas.

## Despliegue

1. Autentique la CLI oficial de Supabase.
2. Ejecute `supabase functions deploy fuel-report --project-ref vhyddogeemohtqijohry --no-verify-jwt`.
3. Guarde `FUEL_REPORT_WEBHOOK_SECRET` en Edge Function Secrets; `MONDAY_API_TOKEN` se comparte con las funciones existentes.
4. Registre el webhook de monday con la URL de Supabase y el parámetro `key`.
5. Envíe un reporte anonimizado, cambie **Aprobación** a **Aprobado para generar** y confirme que el archivo con hash aparece en `Reporte PDF`.

Render puede mantenerse temporalmente durante la migración, pero debe retirarse después de validar Supabase para evitar dos generadores activos.

## Límites y seguridad

- Body del webhook: 256 KB.
- Cantidad, tamaño individual y tamaño total de respaldos configurables.
- Descargas y API con timeout; errores transitorios con backoff.
- Nombres saneados y archivos temporales con permisos restrictivos.
- Directorio temporal eliminado siempre, aun si la carga falla.
- Logs JSON correlacionados por `boardId` e `itemId`, con secretos y URLs redactados.
- El total de kilómetros siempre es la suma de subitems; discrepancias se señalan en el PDF.

## Pasos externos pendientes

Requieren acceso/decisión fuera del repositorio:

1. Crear/obtener el token u OAuth de monday y el secreto de autenticación.
2. Desplegar el servicio en una URL HTTPS pública.
3. Agregar la etiqueta `Aprobado para generar` a la columna existente **Aprobación**, si no existe.
4. Crear el webhook/automatización con esa URL.
5. Ejecutar la prueba final con un item real o anonimizado; el tablero estaba vacío durante la implementación.
