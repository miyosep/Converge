import type { NextConfig } from "next";

const config: NextConfig = {
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
