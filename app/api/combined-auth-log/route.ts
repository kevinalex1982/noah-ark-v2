import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { join } from "path";

function getLogFileName(): string {
  const today = new Date();
  // 使用北京时间 (UTC+8)
  const dateStr = new Date(today.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return `combined-auth-${dateStr}.log`;
}

const LOG_DIR = join(
  process.env.DATA_DIR || process.cwd(),
  "logs"
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    // 清理 3 天前的旧日志
    const nowTs = Date.now();
    const maxAgeMs = 3 * 24 * 60 * 60 * 1000;
    try {
      for (const file of fs.readdirSync(LOG_DIR)) {
        if (!file.startsWith("combined-auth-") || !file.endsWith(".log")) continue;
        const filePath = join(LOG_DIR, file);
        const stat = fs.statSync(filePath);
        if (nowTs - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
        }
      }
    } catch { /* ignore cleanup errors */ }

    const now = new Date();
    const timestamp = now
      .toLocaleString("sv-SE")
      .replace("T", " ")
      .split(".")[0];

    const logLine = `[${timestamp}] action: ${body.action || "unknown"}, step: ${body.step || "n/a"}, completedSteps: ${JSON.stringify(body.completedSteps || [])}, currentIndex: ${body.currentIndex ?? -1}, totalSteps: ${body.totalSteps ?? 0}, scanStatus: ${body.scanStatus || "n/a"}, nextAction: ${body.nextAction || "n/a"}\n`;

    const logFile = join(LOG_DIR, getLogFileName());
    fs.appendFileSync(logFile, logLine, "utf8");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("combined-auth-log error:", error);
    return NextResponse.json(
      { error: "Failed to write log" },
      { status: 500 }
    );
  }
}
