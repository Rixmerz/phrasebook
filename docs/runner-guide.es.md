# Guía para correr el set con otros modelos (OpenAI, Google, pesos abiertos)

*English version: [runner-guide.md](runner-guide.md). Si las dos difieren, vale la inglesa.*

*¿Prefieres que tu propio agente de IA haga la instalación y las pruebas? Mira [agent-runbook.md](agent-runbook.md): tiene el texto que le pegas.*

Gracias por ayudar. Vas a correr 24 tareas de GitHub con tu modelo, de cuatro formas distintas
de darle acceso a GitHub, y nos devuelves un archivo con los resultados. No hace falta que
entiendas cómo funciona cada forma; el runner se encarga.

Tiempo: 1 a 2 horas de máquina por modelo y por idioma, según la velocidad del proveedor (más con
suscripción, por los límites de uso). Una corrida completa son 24 tareas × 4 formas ×
3 repeticiones = 288 runs por idioma (216 con suscripción, que no tiene la forma `code`).

## 0. ¿API key o suscripción?

Hay dos caminos. Elige uno según lo que tengas; los dos sirven para el paper.

| Tienes | Camino | Runner | Tokens |
|---|---|---|---|
| Una API key (OpenAI, Google AI Studio, OpenRouter, DeepSeek...) o un modelo local (Ollama, vLLM) | **A. API** (secciones 2A a 4A) | `src/openai_bench.ts` | los cuenta el runner, desde lo que devuelve la API |
| Solo una suscripción de chat: ChatGPT (Plus/Pro/Team) o Google AI (o una cuenta de Google gratis) | **B. Suscripción** (sección 4B) | `src/cli_bench.ts` | los reporta la CLI oficial del proveedor (Codex CLI o Gemini CLI); el runner los guarda |
| Solo una suscripción de Claude | no hace falta | — | las corridas de Claude las hacemos nosotros |

En ninguno de los dos caminos calculas tokens tú: el runner los guarda en cada línea del log
(`input_tokens`, `output_tokens`, `cached_tokens`). No necesitas precios.

- **Costo, camino A**: lo paga tu cuenta. El arm `native` envía unos 27 mil tokens de entrada por
  turno; con un modelo de precio medio calcula entre 10 y 40 USD por idioma. Una API key gratis
  de Google AI Studio también sirve (es más lenta por los límites del plan gratis).
- **Costo, camino B**: no pagas aparte, pero gasta mucha cuota: la ronda completa equivale a unas
  200 veces el smoke test. Mira tu cuota antes y después del smoke test (Codex: `/status`) y
  multiplica. En ChatGPT Plus, con un modelo grande y razonamiento medio, un runner midió cerca de
  1,5% de la ventana de 5 horas y 0,5% de la semanal por corrida: la ronda toma varias semanas de
  un plan Plus. Un modelo más chico o menos razonamiento gasta menos. Si llegas al límite, el
  runner se detiene solo y continúas cuando se renueve la cuota, con el mismo comando.

## Reglas

1. **El set es privado.** Lo recibes aparte en `beacon-bundle.zip`. No lo subas a ningún
   repositorio, chat público ni servicio que entrene con tus datos, y no lo compartas.
2. **No cambies nada del código ni del set.** Si algo falla, avísanos; no lo arregles tú. El set
   y el runner están congelados por hash (`results/crossvendor-freeze.sha256`) y cualquier
   cambio invalida la corrida.
3. **Anota exactamente qué corriste:** proveedor, id exacto del modelo, cuantización si es un
   modelo local, y cualquier `--extra` que uses.
4. **Corre solo con los runners de esta guía** (`openai_bench.ts` o `cli_bench.ts`). Corridas
   hechas en otras herramientas (la app web, Cursor, Cline, otra CLI) o tokens anotados a mano no
   se pueden usar: no se pueden verificar ni comparar con el resto. Si tu herramienta no está
   aquí, avísanos y vemos si se puede agregar.
5. **No mires las tareas para "ayudar" al modelo** ni ajustes prompts o configuración según los
   resultados. Elige la configuración antes de la primera corrida y no la cambies después.

## 1. Preparar el entorno

Necesitas **Linux x86_64**. En macOS o Windows usa Docker (ver abajo). Instala
[Deno 2.5.x](https://deno.com), `git` y `curl`.

Usa esta rama y este commit exactos:

- Rama: `ccr-2b013821-lycp47`
- Commit: `b591386b3040472fea2a1811a6bec0c0187158e3`

```sh
git clone --branch ccr-2b013821-lycp47 https://github.com/Rixmerz/phrasebook.git
cd phrasebook
git checkout b591386b3040472fea2a1811a6bec0c0187158e3   # git avisará "detached HEAD": es normal
./scripts/setup.sh         # descarga el servidor MCP de GitHub y verifica su checksum
```

Si `git checkout` dice que no encuentra el commit (por ejemplo, porque la rama ya se mergeó),
usa `main` y sigue: lo que cuenta es que la verificación del paso siguiente diga `OK` en
todos los archivos.

Copia el set en su lugar y verifica que llegó intacto:

```sh
mkdir -p private
unzip beacon-bundle.zip -d private/      # queda private/beacon/...
(cd private/beacon && sha256sum -c SHA256SUMS)   # todas las líneas deben decir OK
sha256sum -c results/crossvendor-freeze.sha256 results/crossvendor-freeze-amendment1.sha256   # código y set congelados: todo OK
deno test -A private/beacon/tasks_test.ts   # 4 tests "ok", sin usar ningún modelo
```

`private/` está en `.gitignore`, así que git no lo sube por accidente. Aun así, no hagas
`git add -f`.

**Con Docker (macOS/Windows):** desde la carpeta `phrasebook`:

```sh
docker run --rm -it --platform linux/amd64 -v "$PWD":/w -w /w denoland/deno:2.5.6 bash
apt-get update && apt-get install -y curl git   # dentro del contenedor
./scripts/setup.sh
```

Si tu modelo corre en tu máquina (Ollama, LM Studio), desde el contenedor usa
`--base-url=http://host.docker.internal:11434/v1`.

## 2A. Prueba rápida, camino API (2 minutos, unos centavos)

Antes de la corrida real, prueba la conexión con un set público que ya corrimos con Claude:

```sh
export OPENAI_API_KEY=...    # o la variable de tu proveedor, ver sección 3
deno run -A src/openai_bench.ts --model=<MODELO> --suite=github-blind4 \
  --tasks=b4-count-offline-p1 --arms=native,glossary4 --reps=1 \
  --out=results/runs/smoke.jsonl
```

Debe imprimir dos líneas `PASS` o `FAIL` con `turns=` mayor que 1. Si ves `GAP`, `error:` o
`turns=1` en todo, revisa la sección 5 antes de seguir. El resultado (PASS o FAIL) no importa
aquí; solo que el modelo llegue a usar las herramientas.

## 3A. Elegir proveedor (camino API)

El runner habla con cualquier API compatible con OpenAI Chat Completions. Dos flags la eligen:
`--base-url` y `--key-env` (el nombre de la variable de entorno que tiene la clave).

| Proveedor | Flags |
|---|---|
| OpenAI | (por defecto) `--key-env=OPENAI_API_KEY` |
| Google Gemini | `--base-url=https://generativelanguage.googleapis.com/v1beta/openai --key-env=GEMINI_API_KEY --schemas=gemini` |
| OpenRouter (cualquier modelo) | `--base-url=https://openrouter.ai/api/v1 --key-env=OPENROUTER_API_KEY` |
| Together, Groq, Fireworks, DeepInfra | la URL `/v1` compatible con OpenAI de cada uno y su clave |
| DeepSeek | `--base-url=https://api.deepseek.com/v1 --key-env=DEEPSEEK_API_KEY --drop-fields=reasoning_content` |
| Ollama (local) | `--base-url=http://localhost:11434/v1 --key-env=` |
| vLLM / LM Studio / llama.cpp server | `--base-url=http://localhost:8000/v1 --key-env=` (ajusta el puerto) |

Notas por proveedor:

- **Modelos de razonamiento** (OpenAI o-series y GPT-5, Gemini 2.5+, etc.): si quieres fijar el
  esfuerzo, pásalo con `--extra='{"reasoning_effort":"low"}'`, o el campo que use tu proveedor.
  Decídelo antes de empezar y anótalo.
- **Modelos locales**: el modelo tiene que soportar *tool calling* en tu servidor.
  - En **Ollama**, sube el contexto antes de arrancarlo: `OLLAMA_CONTEXT_LENGTH=65536 ollama serve`.
    Con el contexto por defecto, el arm `native` (≈27k tokens solo de definiciones) se trunca en
    silencio y falla todo.
  - En **vLLM**, arranca con `--enable-auto-tool-choice --tool-call-parser <el de tu modelo>
    --max-model-len 65536`.
  - Usa `--concurrency=1` o `2` si tu GPU no da para más.
- **Precios**: si quieres que el log calcule USD, pasa `--price-in` y `--price-out` en USD por
  millón de tokens. Es opcional; lo que usamos son los tokens.

## 4A. La corrida (camino API)

Una corrida por idioma. Español (`github-beacon`) e inglés (`github-beacon-en`):

```sh
deno run -A src/openai_bench.ts --model=<MODELO> <flags del proveedor> \
  --suite=github-beacon --arms=native,glossary4s,glossary4,code --reps=3 --concurrency=4 \
  --runner=<tu-usuario> --out=results/runs/xv-<tu-usuario>-<modelo>-es.jsonl

deno run -A src/openai_bench.ts --model=<MODELO> <flags del proveedor> \
  --suite=github-beacon-en --arms=native,glossary4s,glossary4,code --reps=3 --concurrency=4 \
  --runner=<tu-usuario> --out=results/runs/xv-<tu-usuario>-<modelo>-en.jsonl
```

- **`--runner` es obligatorio en la práctica**: pon siempre el mismo identificador corto (tu
  usuario de GitHub, o nombre-apellido sin espacios). Queda grabado en cada línea del log y
  es lo que usamos para saber de quién es cada aporte. Si dos personas corren el mismo modelo,
  así no se mezclan. Úsalo también en el nombre del archivo, como en el ejemplo.
- Cada run imprime una línea. Al final verás un resumen por arm.
- **Si se corta** (red, límite de cuota, Ctrl-C), vuelve a correr **el mismo comando**. Se salta
  lo que ya está en el archivo y reintenta los runs que terminaron en error de API.
- Si te sobra presupuesto, agrega el arm opcional `native-trimmed-compact` en una corrida
  aparte con el mismo `--out`.
- No cambies `--max-turns` (20) ni los demás valores por defecto.

Qué es cada arm (no hace falta para correr):

- `native`: las 40+ herramientas del servidor oficial de GitHub, tal cual.
- `glossary4` / `glossary4s`: una sola herramienta con un lenguaje de comandos corto. La `s`
  añade recetas pensadas para modelos chicos.
- `code`: el modelo escribe JavaScript contra una API generada desde las herramientas.

## 4B. Camino suscripción: Codex CLI o Gemini CLI

Usas la CLI oficial de tu proveedor con tu login de siempre. El runner la lanza sin interfaz, en
una carpeta vacía y con sus herramientas propias apagadas (sin shell, archivos ni web), así que
el modelo solo puede usar GitHub. Necesitas además [Node.js](https://nodejs.org) 20 o más.

**1. Instala la versión exacta de la CLI y entra con tu cuenta** (una vez):

| Suscripción | Instalar | Entrar |
|---|---|---|
| ChatGPT | `npm install -g @openai/codex@0.165.0` | `codex login` (elige "Sign in with ChatGPT") |
| Google AI o cuenta de Google | `npm install -g @google/gemini-cli@0.66.0` | `gemini`, elige "Login with Google", y cierra con `/quit` |

Dentro de Docker, el login abre un enlace: cópialo en el navegador de tu máquina. La imagen de
Deno no trae Node; para este camino usa mejor la de Node e instala Deno con npm:

```sh
docker run --rm -it --platform linux/amd64 -v "$PWD":/w -w /w node:22 bash
npm install -g deno@2.5.6 && ./scripts/setup.sh
```

**2. Prueba rápida** (consume unas pocas peticiones de tu cuota):

```sh
deno run -A src/cli_bench.ts --cli=codex --model=<MODELO> --runner=<tu-usuario> \
  --suite=github-blind4 --tasks=b4-count-offline-p1 --arms=native,glossary4 --reps=1 \
  --out=results/runs/smoke-cli.jsonl
```

(Con Gemini, `--cli=gemini`.) Debe imprimir dos líneas `PASS` o `FAIL` con `calls=` mayor que 0.

- **`ERR`**: lee el mensaje. Suele ser el login, o que el modelo no existe en tu plan.
- **`FRGN`**: la CLI usó una herramienta que debía estar apagada. No sigas y avísanos.

`--model` es obligatorio. Usa el id exacto que acepta tu CLI, por ejemplo uno de los que lista
`/model` dentro de la CLI. Anótalo en la ficha.

**3. La corrida**, una por idioma:

```sh
deno run -A src/cli_bench.ts --cli=codex --model=<MODELO> --runner=<tu-usuario> \
  --suite=github-beacon --arms=native,glossary4s,glossary4 --reps=3 --concurrency=2 \
  --out=results/runs/xv-<tu-usuario>-codex-<modelo>-es.jsonl

deno run -A src/cli_bench.ts --cli=codex --model=<MODELO> --runner=<tu-usuario> \
  --suite=github-beacon-en --arms=native,glossary4s,glossary4 --reps=3 --concurrency=2 \
  --out=results/runs/xv-<tu-usuario>-codex-<modelo>-en.jsonl
```

- **Límite de uso.** Si llegas al límite de tu plan, verás varios `ERR` seguidos y el runner se
  detiene solo. Cuando se renueve tu cuota, corre el mismo comando y sigue donde quedó. Los runs
  cortados no cuentan.
- **Tokens.** Los reporta la propia CLI e incluyen su prompt interno, que es igual en todas las
  formas. No tienes que calcular nada.
- **No hay forma `code`.** No existe en este camino, y es lo esperado.
- **Esfuerzo de razonamiento.** Si quieres fijarlo, decídelo antes de empezar, anótalo y
  pásalo igual en las dos corridas:
  - Codex: `--cli-args='["-c","model_reasoning_effort=\"low\""]'`.
  - Gemini: no tiene opción equivalente; usa el modelo tal cual.

## 5. Problemas comunes

| Síntoma | Causa probable |
|---|---|
| `HTTP 401` / `HTTP 403` | clave mal puesta, o `--key-env` apunta a otra variable |
| `HTTP 400 ... tools` o `... schema` en Gemini | falta `--schemas=gemini` |
| `HTTP 400 ... reasoning_content` | agrega `--drop-fields=reasoning_content` |
| Todo `FAIL` con `turns=1` | el modelo no está llamando herramientas: revisa que soporte tool calling en tu servidor (en vLLM, el parser) |
| Todo `FAIL` en `native` con modelo local, pero no en los otros arms | contexto corto: sube `OLLAMA_CONTEXT_LENGTH` o `--max-model-len` |
| `HTTP 429` muchas veces | baja `--concurrency`; el runner ya reintenta con espera |
| Líneas `GAP` | el GitHub simulado no conoce una llamada. No es culpa del modelo: esos runs se excluyen. Mándanos el log igual |
| `github-mcp-server: not found` | no corriste `./scripts/setup.sh`, o no estás en Linux x86_64 |
| (B) `cannot run codex` / `cannot run gemini` | la CLI no está instalada o no está en el `PATH`; o pasa su ruta con `--bin=` |
| (B) `ERR` con "login", "auth" o "401" | vuelve a entrar con `codex login` o `gemini` |
| (B) `warning: codex X; this runner was tested with ...` | instala la versión de la tabla de 4B |
| (B) líneas `FRGN` | la CLI usó una herramienta que debía estar apagada: para y avísanos |
| (B) ChatGPT dice que el login por código de dispositivo está deshabilitado | activa la autorización por código de dispositivo para Codex en la configuración de ChatGPT (Seguridad) y repite `codex login` |
| `git status` muestra `deno.lock` modificado | Deno resolvió una dependencia; es inofensivo y no forma parte del congelamiento. `git checkout deno.lock` lo restaura |
| `git status` muestra `vendor/` o `.cli-runs/` | los escriben `setup.sh` y `cli_bench.ts`; es esperado |

## 6. Qué nos devuelves

Por privado, igual que recibiste el set:

1. Los archivos `results/runs/xv-<tu-usuario>-...-es.jsonl` y `-en.jsonl` (los que pusiste en
   `--out`), y los `.errors.jsonl` si quedaron. Contienen las
   conversaciones completas: no los publiques.
2. Esta ficha, completa (copia y pega en el mensaje, o como `ficha-<tu-usuario>.md`):

```text
## Aporte cross-vendor — orchard/beacon

Quién
- Nombre para los agradecimientos: (o "anónimo" si prefieres no aparecer)
- Afiliación (opcional):
- Usuario de GitHub o enlace (opcional):
- Identificador usado en --runner:
- Contacto (para dudas sobre la corrida):

Qué corriste
- Camino (A: API / B: suscripción con codex o gemini) y versión de la CLI si es B:
- Proveedor y endpoint (--base-url, solo camino A):
- Id exacto del modelo (--model):
- Si es local: cantidad de parámetros, cuantización, servidor (Ollama/vLLM/...) y versión, GPU, contexto máximo:
- Flags extra (--extra, --schemas, --drop-fields, --concurrency):
- Comando exacto (los dos, ES y EN):
- Commit de phrasebook (git rev-parse HEAD):
- Salida de sha256sum -c results/crossvendor-freeze.sha256 (¿todo OK?):
- Fecha(s) de la corrida:

Incidencias
- ¿Cambiaste algo del código o del set? (debería ser "no"):
- Errores, GAPs o comportamientos raros:
- Costo aproximado (opcional):
```

Cada aporte se registra con ese identificador: el nombre que pongas en la ficha es el que
aparece en los agradecimientos, junto al modelo que corriste.

Si quieres ver tus números antes de mandarlos:

```sh
deno run -A src/client_stats.ts results/runs/xv-<tu-usuario>-<modelo>-es.jsonl --a=glossary4 --b=native
```
