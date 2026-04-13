/**
 * Next.js 配置
 */

const nextConfig = {
  // 禁用开发指示器（右下角的黑色三角形/N图标）
  devIndicators: false,

  // 实验性功能
  experimental: {
    // 启用服务器 actions
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  // 环境变量
  env: {
    DATABASE_PATH: process.env.DATABASE_PATH,
    MQTT_BROKER: process.env.MQTT_BROKER,
    MQTT_USERNAME: process.env.MQTT_USERNAME,
    MQTT_PASSWORD: process.env.MQTT_PASSWORD,
  },

  // 安全头
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
