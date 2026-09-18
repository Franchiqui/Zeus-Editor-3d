const pkg = require('./package.json');

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
  env: {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || pkg.name,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'zeus-basedatos.fly.dev',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        chunks: 'all',
        maxInitialRequests: Infinity,
        minSize: 0,
        cacheGroups: {
          default: false,
          vendors: false,
          framework: {
            name: 'framework',
            chunks: 'all',
            test: /next|react|react-dom/,
            priority: 40,
            enforce: true,
          },
          lib: {
            test: /[/]node_modules[/]/,
            name: 'lib',
            priority: 30,
            minChunks: 1,
            reuseExistingChunk: true,
          },
          commons: {
            name: 'commons',
            chunks: 'all',
            priority: 20,
          },
          shared: {
            name(module, chunks) {
              return chunks.map((chunk) => chunk.name).join('-');
            },
            priority: 10,
            minChunks: 2,
            reuseExistingChunk: true,
          },
        },
      };
    }
    return config;
  },
};

module.exports = nextConfig;
