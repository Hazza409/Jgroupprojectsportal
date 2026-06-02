/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Server Actions handle file uploads (estimate/schedule xlsx, photos, quotes).
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
