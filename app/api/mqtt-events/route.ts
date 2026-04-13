/**
 * MQTT指令记录API
 * GET: 获取记录列表
 * DELETE: 清空记录
 */

import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// 优先使用 DATA_DIR（打包后指向 AppData），fallback 到项目 data/
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const EVENTS_FILE = join(DATA_DIR, 'mqttevent.json');

// 确保文件存在
function ensureFile() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!existsSync(EVENTS_FILE)) {
    writeFileSync(EVENTS_FILE, '[]', 'utf-8');
  }
}

// GET: 获取记录列表（分页）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '15', 10);
    const date = searchParams.get('date'); // 格式: YYYY-MM-DD

    ensureFile();
    const content = readFileSync(EVENTS_FILE, 'utf-8');
    let events = JSON.parse(content || '[]');

    // 日期过滤
    if (date) {
      events = events.filter((event: any) => {
        // event.time 格式: "2026/4/3 14:30:00" 或 "2026-04-03 14:30:00"
        if (!event.time) return false;
        // 解析日期部分并标准化为 YYYY-MM-DD 格式
        const datePart = event.time.split(' ')[0];
        const parts = datePart.split('/');
        if (parts.length === 3) {
          // 格式: 2026/4/1 -> 2026-04-01
          const year = parts[0];
          const month = parts[1].padStart(2, '0');
          const day = parts[2].padStart(2, '0');
          return `${year}-${month}-${day}` === date;
        } else {
          // 已经是 - 分隔格式
          const dashParts = datePart.split('-');
          if (dashParts.length === 3) {
            const year = dashParts[0];
            const month = dashParts[1].padStart(2, '0');
            const day = dashParts[2].padStart(2, '0');
            return `${year}-${month}-${day}` === date;
          }
        }
        return false;
      });
    }

    const total = events.length;
    const totalPages = Math.ceil(total / pageSize);

    // 分页
    const offset = (page - 1) * pageSize;
    const paginatedEvents = events.slice(offset, offset + pageSize);

    return NextResponse.json({
      success: true,
      events: paginatedEvents,
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (error) {
    console.error('读取MQTT指令记录失败:', error);
    return NextResponse.json({
      success: true,
      events: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
  }
}

// DELETE: 清空记录
export async function DELETE() {
  try {
    ensureFile();
    writeFileSync(EVENTS_FILE, '[]', 'utf-8');

    return NextResponse.json({
      success: true,
      message: '已清空记录',
    });
  } catch (error) {
    console.error('清空MQTT指令记录失败:', error);
    return NextResponse.json({
      success: false,
      error: '清空失败',
    }, { status: 500 });
  }
}

// POST: 添加记录（供内部调用）
export async function POST(request: NextRequest) {
  try {
    ensureFile();

    const body = await request.json();
    const content = readFileSync(EVENTS_FILE, 'utf-8');
    const events = JSON.parse(content || '[]');

    // 添加新记录
    const newEvent = {
      id: `evt-${Date.now()}`,
      time: new Date().toLocaleString('zh-CN'),
      ...body,
    };

    // 保留最近200条记录
    events.unshift(newEvent);
    if (events.length > 200) {
      events.pop();
    }

    writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      event: newEvent,
    });
  } catch (error) {
    console.error('添加MQTT指令记录失败:', error);
    return NextResponse.json({
      success: false,
      error: '添加失败',
    }, { status: 500 });
  }
}