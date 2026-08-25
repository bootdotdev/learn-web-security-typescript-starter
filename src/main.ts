import { createApp } from "./app.ts";
import { applySchema } from "./db/schema.ts";
import { initDependencies } from "./dependencies.ts";

const deps = initDependencies();
let server;

try {
  applySchema(deps.db);
  const app = createApp(deps);
  server = app.listen(deps.port, () => {
    console.log(`Bearly Secure is running at http://localhost:${deps.port}`);
  });
  server.once("error", (error) => {
    deps.db.close();
    throw error;
  });
} catch (error) {
  server?.close();
  deps.db.close();
  throw error;
}
