/** Static export: Bankable needs no application server (spec section 4). All chain access is browser to RPC. */
const nextConfig = {
  output: "export",
  trailingSlash: false,
  reactStrictMode: true,
  transpilePackages: ["@bankable/core"],
  images: { unoptimized: true },
};
export default nextConfig;
