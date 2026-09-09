import { createConfig } from "@smb-os/eslint-config";

export default [{ ignores: [".expo/**", "dist/**"] }, ...createConfig()];
