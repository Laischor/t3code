import { createSqlEnvironmentAtoms } from "@t3tools/client-runtime/state/sql";

import { connectionAtomRuntime } from "../connection/runtime";

export const sqlEnvironment = createSqlEnvironmentAtoms(connectionAtomRuntime);
