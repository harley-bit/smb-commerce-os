import { createConfig } from "@smb-os/eslint-config";

// packages/db is the one place allowed to talk to the SQL dialect directly —
// it owns tenant scoping on every query it builds, so the raw-SQL ban is off here.
export default createConfig({ allowRawSql: true });
