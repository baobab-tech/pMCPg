# Template. The release workflow renders it with packaging/homebrew/render.sh; do not install this file directly.
class Pmcpg < Formula
  desc "Private MCP Gateway: local-first gateway between AI clients and MCP servers"
  homepage "https://github.com/baobab-tech/pMCPg"
  version "@@VERSION@@"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/baobab-tech/pMCPg/releases/download/v@@VERSION@@/pmcpg-@@VERSION@@-darwin-arm64.tar.gz"
      sha256 "@@SHA256_DARWIN_ARM64@@"
    end
    on_intel do
      url "https://github.com/baobab-tech/pMCPg/releases/download/v@@VERSION@@/pmcpg-@@VERSION@@-darwin-x64.tar.gz"
      sha256 "@@SHA256_DARWIN_X64@@"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/baobab-tech/pMCPg/releases/download/v@@VERSION@@/pmcpg-@@VERSION@@-linux-arm64.tar.gz"
      sha256 "@@SHA256_LINUX_ARM64@@"
    end
    on_intel do
      url "https://github.com/baobab-tech/pMCPg/releases/download/v@@VERSION@@/pmcpg-@@VERSION@@-linux-x64.tar.gz"
      sha256 "@@SHA256_LINUX_X64@@"
    end
  end

  def install
    bin.install "pmcpg"
  end

  service do
    run [opt_bin/"pmcpg", "serve"]
    keep_alive successful_exit: false
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/pmcpg version").strip
  end
end
