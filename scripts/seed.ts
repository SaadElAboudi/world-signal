import "./env";
import { migrate } from "./migrate";
import { getPool, closePool } from "../src/database/client";
// Seed only provider registration metadata, never fictional live observations.
async function main() {
  await migrate();
  await getPool().query(
    `INSERT INTO provider_registry(id,name,signal_type) VALUES('usgs','USGS Earthquake Hazards Program','earthquake'),('firms','NASA FIRMS NOAA-20 VIIRS','wildfire') ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,signal_type=EXCLUDED.signal_type`,
  );
  console.log(
    "Provider registry seeded. No synthetic observations were inserted.",
  );
}
main()
  .catch(() => {
    console.error("Provider registry seed failed.");
    process.exitCode = 1;
  })
  .finally(closePool);
