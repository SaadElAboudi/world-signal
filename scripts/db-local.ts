import "./env";
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const dir = ".data/postgres";
mkdirSync(".data", { recursive: true, mode: 0o700 });
const credentialsFile = ".data/postgres-credentials.json";
const credentials = existsSync(credentialsFile)
  ? JSON.parse(readFileSync(credentialsFile, "utf8"))
  : { password: randomBytes(24).toString("hex") };
if (!existsSync(credentialsFile))
  writeFileSync(credentialsFile, JSON.stringify(credentials), { mode: 0o600 });
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "world_signal",
  password: credentials.password,
  port: 55432,
  persistent: true,
  authMethod: "scram-sha-256",
  initdbFlags: ["--locale=C", "--encoding=UTF8"],
  postgresFlags: [
    "-h",
    "127.0.0.1",
    "-c",
    "max_connections=30",
    "-c",
    "shared_buffers=64MB",
  ],
  onLog: (message) =>
    console.log(String(message).replaceAll(credentials.password, "[redacted]")),
  onError: (message) =>
    console.error(
      String(message).replaceAll(credentials.password, "[redacted]"),
    ),
});
async function main() {
  if (!existsSync(`${dir}/PG_VERSION`)) await pg.initialise();
  await pg.start();
  const client = pg.getPgClient("postgres");
  await client.connect();
  for (const name of ["world_signal", "world_signal_test"]) {
    const result = await client.query(
      "SELECT 1 FROM pg_database WHERE datname=$1",
      [name],
    );
    if (!result.rowCount) await pg.createDatabase(name);
  }
  await client.end();
  if (!existsSync(".env.local"))
    writeFileSync(
      ".env.local",
      `WORLD_SIGNAL_MODE=live\nDATABASE_URL=postgresql://world_signal:${credentials.password}@127.0.0.1:55432/world_signal\nFIRMS_TRANSPORT=public\n`,
      { mode: 0o600 },
    );
  console.log(
    "Local PostgreSQL ready on 127.0.0.1:55432. Credentials stay in ignored local files.",
  );
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  setInterval(() => {}, 60000);
}
main().catch((error) => {
  console.error(String(error).replaceAll(credentials.password, "[redacted]"));
  console.error(
    "Local PostgreSQL failed to start. Check whether port 55432 is already in use.",
  );
  process.exit(1);
});
