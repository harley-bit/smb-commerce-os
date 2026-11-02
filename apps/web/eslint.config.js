import { createConfig } from "@smb-os/eslint-config";

export default [{ ignores: [".next/**", "next-env.d.ts"] }, ...createConfig()];
