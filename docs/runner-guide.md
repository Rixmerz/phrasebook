# Guía para correr el set con otros modelos (OpenAI, Google, pesos abiertos)

Gracias por ayudar. Vas a correr 24 tareas de GitHub con tu modelo, de cuatro formas distintas
de darle acceso a GitHub, y nos devuelves un archivo con los resultados. No hace falta que
entiendas cómo funciona cada forma; el runner se encarga.

Tiempo: 1 a 2 horas de máquina por modelo y por idioma, según la velocidad del proveedor.
Costo: lo paga tu cuenta. Una corrida completa son 24 tareas × 4 formas × 3 repeticiones =
288 runs por idioma. El arm `native` envía unos 27 mil tokens de entrada por turno, así que con
un modelo de precio medio calcula entre 10 y 40 USD por idioma.

## Reglas

1. **El set es privado.** Lo recibes aparte en `beacon-bundle.zip`. No lo subas a ningún
   repositorio, chat público ni servicio que entrene con tus datos, y no lo compartas.
2. **No cambies nada del código ni del set.** Si algo falla, avísanos; no lo arregles tú. El set
   y el runner están congelados por hash (`results/crossvendor-freeze.sha256`) y cualquier
   cambio invalida la corrida.
3. **Anota exactamente qué corriste:** proveedor, id exacto del modelo, cuantización si es un
   modelo local, y cualquier `--extra` que uses.
4. **No mires las tareas para "ayudar" al modelo** ni ajustes prompts o configuración según los
   resultados. Elige la configuración antes de la primera corrida y no la cambies después.

## 1. Preparar el entorno

Necesitas **Linux x86_64**. En macOS o Windows usa Docker (ver abajo). Instala
[Deno 2.5.x](https://deno.com), `git` y `curl`.

Usa esta rama y este commit exactos:

- Rama: `ccr-2b013821-lycp47`
- Commit: `c63c6f13f0c15f5f055a0640b67a11598c033c1e`

```sh
git clone --branch ccr-2b013821-lycp47 https://github.com/Rixmerz/phrasebook.git
cd phrasebook
git checkout c63c6f13f0c15f5f055a0640b67a11598c033c1e   # git avisará "detached HEAD": es normal
./scripts/setup.sh         # descarga el servidor MCP de GitHub y verifica su checksum
```

Si `git checkout` dice que no encuentra el commit (por ejemplo, porque la rama ya se mergeó),
usa `main` y sigue: lo que cuenta es que la verificación del paso siguiente diga `OK` en
todos los archivos.

Copia el set en su lugar y verifica que llegó intacto:

```sh
mkdir -p private
unzip beacon-bundle.zip -d private/      # queda private/beacon/...
sha256sum -c private/beacon/SHA256SUMS   # todas las líneas deben decir OK
sha256sum -c results/crossvendor-freeze.sha256   # código y set congelados: todo OK
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

## 2. Prueba rápida (2 minutos, unos centavos)

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

## 3. Elegir proveedor

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

## 4. La corrida

Una corrida por idioma. Español (`github-beacon`) e inglés (`github-beacon-en`):

```sh
deno run -A src/openai_bench.ts --model=<MODELO> <flags del proveedor> \
  --suite=github-beacon --arms=native,glossary4s,glossary4,code --reps=3 --concurrency=4 \
  --runner=<tu-nombre> --out=results/runs/xv-<modelo>-es.jsonl

deno run -A src/openai_bench.ts --model=<MODELO> <flags del proveedor> \
  --suite=github-beacon-en --arms=native,glossary4s,glossary4,code --reps=3 --concurrency=4 \
  --runner=<tu-nombre> --out=results/runs/xv-<modelo>-en.jsonl
```

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

## 6. Qué nos devuelves

Por privado, igual que recibiste el set:

1. Los archivos `results/runs/xv-<modelo>-es.jsonl` y `-en.jsonl`. Contienen las
   conversaciones completas: no los publiques.
2. Un texto corto con:
   - proveedor;
   - id exacto del modelo;
   - cuantización y hardware, si es local;
   - el comando exacto que usaste;
   - el commit de phrasebook (`git rev-parse HEAD`);
   - la salida de `sha256sum -c results/crossvendor-freeze.sha256`;
   - si cambiaste algo o hubo errores raros.
3. Cómo quieres aparecer en los agradecimientos del paper, o si prefieres no aparecer.

Si quieres ver tus números antes de mandarlos:

```sh
deno run -A src/client_stats.ts results/runs/xv-<modelo>-es.jsonl --a=glossary4 --b=native
```
