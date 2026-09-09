import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    // Characters and the tracker are big and never change under their names
    // (scripts/setup-assets.mjs); a returning visitor should not fetch them twice.
    return [{ source: "/(models|mediapipe)/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
};

export default nextConfig;
