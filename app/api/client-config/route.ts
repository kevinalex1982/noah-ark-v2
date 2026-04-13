/**
 * 客户端配置 API
 * 用于配置 Electron 客户端连接的服务器地址
 * 配置存储在 Electron 的用户数据目录
 */

import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Electron 用户数据目录（Windows: C:\Users\用户名\AppData\Roaming\noah-ark-electron）
// 在 Next.js 中无法直接获取，使用固定路径
function getClientConfigPath(): string {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const appDataDir = process.platform === 'win32'
    ? join(homeDir, 'AppData', 'Roaming', 'noah-ark-electron')
    : join(homeDir, '.config', 'noah-ark-electron');

  return join(appDataDir, 'client-config.json');
}

const DEFAULT_CONFIG = {
  serverUrl: 'http://localhost:3001',
};

/**
 * GET /api/client-config
 * 获取客户端配置
 */
export async function GET() {
  try {
    const configPath = getClientConfigPath();

    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      return NextResponse.json({
        success: true,
        config: {
          serverUrl: config.serverUrl || DEFAULT_CONFIG.serverUrl,
        },
      });
    }

    return NextResponse.json({
      success: true,
      config: DEFAULT_CONFIG,
    });
  } catch (error) {
    console.error('[ClientConfig] 读取失败:', error);
    return NextResponse.json({
      success: true,
      config: DEFAULT_CONFIG,
    });
  }
}

/**
 * POST /api/client-config
 * 保存客户端配置
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { serverUrl } = body;

    if (!serverUrl || typeof serverUrl !== 'string') {
      return NextResponse.json({
        success: false,
        error: '服务器地址不能为空',
      }, { status: 400 });
    }

    // 简单验证 URL 格式
    try {
      new URL(serverUrl);
    } catch {
      return NextResponse.json({
        success: false,
        error: '服务器地址格式不正确',
      }, { status: 400 });
    }

    const configPath = getClientConfigPath();
    const configDir = join(configPath, '..');

    // 确保目录存在
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // 写入配置
    const config = { serverUrl };
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    console.log('[ClientConfig] 配置已保存:', config);

    return NextResponse.json({
      success: true,
      message: '配置已保存',
      config,
    });
  } catch (error) {
    console.error('[ClientConfig] 保存失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '保存失败',
    }, { status: 500 });
  }
}