// Links and install commands. Commands match docs/install.md.
export const GITHUB = "https://github.com/baobab-tech/pMCPg";
export const RELEASE = `${GITHUB}/releases/latest`;
export const DOCS = `${GITHUB}/tree/main/docs`;
export const ROADMAP = `${GITHUB}/blob/main/docs/roadmap.md`;
export const SECURITY = `${GITHUB}/blob/main/docs/security.md`;
export const PRIVACY = `${GITHUB}/blob/main/docs/privacy.md`;
export const ISSUES = `${GITHUB}/issues`;
export const LICENSE = `${GITHUB}/blob/main/LICENSE`;
export const FORK = `${GITHUB}/fork`;
export const VERIFY = `${GITHUB}/blob/main/docs/install.md#other-channels`;
export const BAOBAB = "https://baobabtech.ai";

export const INSTALL = {
  unix: "curl -fsSL https://github.com/baobab-tech/pMCPg/releases/latest/download/install.sh | sh",
  windows: "irm https://github.com/baobab-tech/pMCPg/releases/latest/download/install.ps1 | iex",
  npm: "npx private-mcp-gateway",
  brew: "brew install baobab-tech/tap/pmcpg",
  docker: "docker pull ghcr.io/baobab-tech/pmcpg:slim",
} as const;
