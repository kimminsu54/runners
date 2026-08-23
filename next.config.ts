import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server only trusts `localhost` by default, so opening the app by IP
  // makes it reject its own chunk requests with 403 and the page never hydrates.
  allowedDevOrigins: ["127.0.0.1", "0.0.0.0", "172.30.0.2", "*.local", "*.cursor.sh"],
  async headers() {
    return [
      {
        source: "/mediapipe/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
