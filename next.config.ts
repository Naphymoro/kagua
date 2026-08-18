import type { NextConfig } from "next";
const nextConfig: NextConfig = { output: "standalone", outputFileTracingIncludes: { "/api/analyze": ["./src/lib/kagua/data/dhet-2025-2026.json.gz"], "/api/health": ["./src/lib/kagua/data/dhet-2025-2026.json.gz"] } };
export default nextConfig;
