/**
 * 服务器日志 API
 * GET /api/logs?lines=100 — 读取最新的 N 行日志
 * GET /api/logs?follow=true — SSE 流式推送新日志（自动刷新）
 *
 * 日志文件路径：
 * - 开发模式：data/nextjs.log（如果存在）
 * - Electron 打包：userData/logs/nextjs.log
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, watch } from 'fs';
import { join } from 'path';

// 获取日志文件路径
function getLogFilePath(): string {
  // 优先检查 Electron 打包路径（AppData）
  const appDataPath = process.env.APPDATA
    ? join(process.env.APPDATA, 'noah-ark-electron', 'logs', 'nextjs.log')
    : '';

  if (appDataPath && existsSync(appDataPath)) {
    return appDataPath;
  }

  // 开发模式：项目 data 目录
  const devPath = join(process.cwd(), 'data', 'nextjs.log');
  if (existsSync(devPath)) {
    return devPath;
  }

  // 备用：Electron userData
  const userDataPath = process.env.USERDATA || process.env.APPDATA || '';
  if (userDataPath) {
    const altPath = join(userDataPath, 'noah-ark-electron', 'logs', 'nextjs.log');
    if (existsSync(altPath)) {
      return altPath;
    }
  }

  return devPath; // 即使不存在也返回，让调用方处理
}

// GET — 读取最新 N 行日志
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const linesParam = searchParams.get('lines');
  const followParam = searchParams.get('follow');

  const logFile = getLogFilePath();
  const maxLines = parseInt(linesParam || '200', 10);

  // SSE 流式模式
  if (followParam === 'true') {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        // 先发送当前最新的 N 行
        try {
          if (existsSync(logFile)) {
            const content = readFileSync(logFile, 'utf-8');
            const recentLines = content.split('\n').filter(l => l.trim()).slice(-maxLines);
            for (const line of recentLines) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line, init: true })}\n\n`));
            }
          }
        } catch {
          // 忽略读取错误
        }

        // 监控文件变化，有新内容时推送
        let lastSize = 0;
        try {
          if (existsSync(logFile)) {
            lastSize = require('fs').statSync(logFile).size;
          }
        } catch {}

        const checkInterval = setInterval(() => {
          try {
            if (!existsSync(logFile)) return;
            const stat = require('fs').statSync(logFile);
            if (stat.size > lastSize) {
              // 读取新增内容
              const fd = require('fs').openSync(logFile, 'r');
              const buffer = Buffer.alloc(stat.size - lastSize);
              require('fs').readSync(fd, buffer, 0, buffer.length, lastSize);
              require('fs').closeSync(fd);

              const newContent = buffer.toString('utf-8');
              const newLines = newContent.split('\n').filter(l => l.trim());
              for (const line of newLines) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line, init: false })}\n\n`));
              }
              lastSize = stat.size;
            }
          } catch {
            // 忽略读取错误
          }
        }, 1000); // 每秒检查一次

        // 客户端断开时清理
        const onClose = () => {
          clearInterval(checkInterval);
        };

        // 设置超时检查
        setTimeout(() => {
          try {
            controller.close();
          } catch {}
        }, 300000); // 5 分钟后自动关闭
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // 普通读取模式
  try {
    if (!existsSync(logFile)) {
      return NextResponse.json({
        success: false,
        error: '日志文件不存在',
        path: logFile,
        lines: [],
      });
    }

    const content = readFileSync(logFile, 'utf-8');
    const allLines = content.split('\n').filter(l => l.trim());
    const recentLines = allLines.slice(-maxLines);

    return NextResponse.json({
      success: true,
      path: logFile,
      totalLines: allLines.length,
      lines: recentLines,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
      path: logFile,
      lines: [],
    }, { status: 500 });
  }
}

// POST — 清空日志文件
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get('clear') === 'true') {
    const logFile = getLogFilePath();
    try {
      if (existsSync(logFile)) {
        require('fs').writeFileSync(logFile, '', 'utf-8');
      }
      return NextResponse.json({ success: true, message: '日志已清空' });
    } catch (error: any) {
      return NextResponse.json({
        success: false,
        error: error.message,
      }, { status: 500 });
    }
  }

  return NextResponse.json({ success: false, error: '无效请求' }, { status: 400 });
}
