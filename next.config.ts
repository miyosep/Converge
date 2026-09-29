import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.CONVERGE_BUILD_DIR || ".next",
  agentRules: false,
  webpack(webpackConfig) {
    webpackConfig.resolve ??= {};
    webpackConfig.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return webpackConfig;
  },
};

export default config;
