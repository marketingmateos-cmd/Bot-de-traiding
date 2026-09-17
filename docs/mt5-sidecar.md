# MT5 Sidecar — el puente real a MetaTrader 5

**Alcance de este documento: exclusivamente READ-ONLY.** El sidecar no
tiene ningún endpoint de envío de órdenes — ni siquiera existe la ruta.
Nada de lo descrito aquí permite ejecutar una operación real.

## Qué es

`python/mt5_sidecar.py` es un servidor HTTP local (solo librería estándar
de Python, sin dependencias nuevas) que se ejecuta como proceso aparte,
en la MISMA máquina Windows donde está instalado y abierto un terminal
MT5 real (cuenta DEMO). La app Node/TypeScript (`src/lib/execution/
mt5SidecarClient.ts`) le habla por HTTP en `127.0.0.1` — nunca por LAN,
nunca expuesto fuera de la máquina.

Esto **no se ha podido probar contra un terminal MT5 real** desde este
repositorio — el sandbox de desarrollo es Linux, y el paquete
`MetaTrader5` de Python solo instala/funciona en Windows. Todo lo que
`src/lib/execution/__tests__/mt5Sidecar.test.ts` prueba es la capa HTTP
(arranque, auth, rutas, manejo de errores) contra el proceso real
corriendo aquí, con el paquete MT5 genuinamente ausente — nunca una
conexión MT5 real. **No se afirma en ningún punto que la conexión real
funcione hasta que se pruebe en Windows con los pasos de abajo.**

## Qué expone (y qué NO)

Endpoints (todos bajo `/mt5/*`, requieren el header `X-MT5-Sidecar-Token`;
`/health` es la única excepción, sin auth):

| Ruta | Método | Qué hace |
|---|---|---|
| `/health` | GET | Liveness check, sin auth |
| `/mt5/login` | POST | `{login, password, server}` → `{ok, error}` |
| `/mt5/logout` | POST | Cierra la sesión MT5 |
| `/mt5/status` | GET | `{connected: bool}` |
| `/mt5/account` | GET | `{account: Mt5AccountInfo \| null}` |
| `/mt5/symbols` | GET | `{symbols: string[]}` |
| `/mt5/symbol?symbol=X` | GET | `{spec: Mt5SymbolSpec \| null}` |
| `/mt5/quote?symbol=X` | GET | `{quote: Mt5Quote \| null}` |
| `/mt5/historical?symbol=X&timeframe=H1&start=ISO&end=ISO` | GET | `{bars: Mt5HistoricalBar[]}` |

**No existe ninguna ruta `/mt5/order*`.** No es que esté deshabilitada:
no hay código que la implemente. `orderSend()` en el cliente TypeScript
tampoco hace nunca una petición HTTP — rechaza localmente antes de
intentar contactar al sidecar (ver `mt5SidecarClient.ts`).

## Requisitos previos en Windows

1. Python 3.10+ instalado.
2. El paquete oficial `MetaTrader5` instalado (`pip install MetaTrader5`)
   — solo funciona en Windows.
3. Un terminal MT5 real, con sesión abierta (o accesible), y una cuenta
   **DEMO** (el resto de este conector rechaza cualquier cuenta que no
   sea literalmente DEMO — `mt5.ACCOUNT_TRADE_MODE_DEMO`).
4. `ENABLE_DEMO_EXECUTION` debe permanecer `false` — el sidecar se niega
   a arrancar si detecta `true`.

## Procedimiento de prueba manual (Windows)

1. Elige un token compartido (una cadena aleatoria cualquiera, no es una
   contraseña de MT5, solo un secreto local entre el sidecar y la app):
   ```
   set MT5_SIDECAR_TOKEN=un-token-aleatorio-tuyo
   ```
2. Arranca el sidecar:
   ```
   python python\mt5_sidecar.py --port 47822
   ```
   Debe imprimir:
   ```
   [MT5-Sidecar] Escuchando en http://127.0.0.1:47822 (solo localhost, nunca LAN)
   [MT5-Sidecar] READ-ONLY: no existe ningún endpoint de envío de órdenes en este proceso.
   ```
3. En otra terminal, confirma que responde:
   ```
   curl http://127.0.0.1:47822/health
   ```
   Debe devolver `{"ok": true, "service": "mt5-sidecar"}`.
4. Prueba login (sustituye por tus datos DEMO reales — nunca los pegues
   en un canal que no controles):
   ```
   curl -X POST http://127.0.0.1:47822/mt5/login ^
     -H "X-MT5-Sidecar-Token: un-token-aleatorio-tuyo" ^
     -H "Content-Type: application/json" ^
     -d "{\"login\":\"TU_LOGIN\",\"password\":\"TU_PASSWORD\",\"server\":\"TU_SERVER\"}"
   ```
   Espera `{"ok": true, "error": null}` si las credenciales son correctas
   y el terminal MT5 está accesible.
5. Confirma estado y cuenta:
   ```
   curl -H "X-MT5-Sidecar-Token: un-token-aleatorio-tuyo" http://127.0.0.1:47822/mt5/status
   curl -H "X-MT5-Sidecar-Token: un-token-aleatorio-tuyo" http://127.0.0.1:47822/mt5/account
   ```
   `/mt5/account` debe mostrar `"accountType": "DEMO"` — si muestra
   `"LIVE"`, EL RESTO DE LA APP LO RECHAZARÁ automáticamente (verificación
   independiente en `verifyAccountIsDemo()`, no depende del sidecar).
6. Prueba símbolos/quote/histórico:
   ```
   curl -H "X-MT5-Sidecar-Token: un-token-aleatorio-tuyo" http://127.0.0.1:47822/mt5/symbols
   curl -H "X-MT5-Sidecar-Token: un-token-aleatorio-tuyo" "http://127.0.0.1:47822/mt5/quote?symbol=EURUSD"
   ```
7. Confirma que NO existe endpoint de órdenes:
   ```
   curl -X POST -H "X-MT5-Sidecar-Token: un-token-aleatorio-tuyo" http://127.0.0.1:47822/mt5/order
   ```
   Debe devolver `404`.

## Conectar la app Node a este sidecar

En `.env.local` de la app (nunca en `.env.example`, nunca commiteado):
```
MT5_SIDECAR_URL=http://127.0.0.1:47822
MT5_SIDECAR_TOKEN=un-token-aleatorio-tuyo   # el MISMO valor que MT5_SIDECAR_TOKEN del sidecar
```
Con ambas variables ausentes (el valor por defecto de cualquier entorno
que no haya configurado el sidecar), la app usa `createUnavailableMt5Client()`
exactamente como antes de este puente — ningún comportamiento existente
cambia.

## Qué NO se ha verificado todavía

- Una conexión real contra un terminal MT5 real (requiere Windows).
- El comportamiento exacto de `mt5.symbol_info_tick()` en brokers donde
  el símbolo no está suscrito en Market Watch — documentado como "puede
  devolver null" en el código, nunca probado contra un broker real.
- Latencia/estabilidad del sidecar bajo uso prolongado.

Cualquiera de estos puntos requiere ejecutar los pasos de arriba en una
máquina Windows real con MT5 DEMO — repórtalo y se actualizará este
documento y, si corresponde, el código, con los resultados reales.
