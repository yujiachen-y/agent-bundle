import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);
const LIB_DIR = path.dirname(THIS_FILE);
const SRC_DIR = path.resolve(LIB_DIR, "..");

export const SPIKE_DIR = path.resolve(SRC_DIR, "..");
export const ENV_PATH = path.resolve(SPIKE_DIR, ".env");
export const RESULTS_DIR = path.resolve(SPIKE_DIR, "results");
