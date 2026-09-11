import { config } from "dotenv";
import path from "node:path";

// Point every test at the isolated test database, never the dev one.
config({ path: path.resolve(__dirname, "../../../.env.test") });
