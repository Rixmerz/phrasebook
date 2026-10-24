// Runs inside a Deno subprocess started with no permissions: no network,
// no filesystem, no env. Its only way out is the stdin/stdout bridge, where
// every tools.<name>(args) call is forwarded to the host and answered there.
const CALL = "\u0000CALL ";
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const reader = Deno.stdin.readable.getReader();
let buffer = "";

async function readLine(): Promise<string> {
  while (!buffer.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("host closed the bridge");
    buffer += decoder.decode(value);
  }
  const i = buffer.indexOf("\n");
  const line = buffer.slice(0, i);
  buffer = buffer.slice(i + 1);
  return line;
}

function send(line: string) {
  Deno.stdout.writeSync(encoder.encode(line + "\n"));
}

const tools = new Proxy({}, {
  get: (_t, name: string) => async (args: unknown = {}) => {
    send(CALL + JSON.stringify({ name, args }));
    const reply = JSON.parse(await readLine());
    if (reply.isError) throw new Error(reply.text);
    try {
      return JSON.parse(reply.text);
    } catch {
      return reply.text;
    }
  },
});

const { code } = JSON.parse(await readLine());
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
try {
  await new AsyncFunction("tools", code)(tools);
} catch (e) {
  console.log(`Error: ${(e as Error).message}`);
}
Deno.exit(0);
