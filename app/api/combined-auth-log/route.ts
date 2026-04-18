import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { join } from "path";

const LOG_FILE = join(
  process.env.DATA_DIR || process.cwd(),
  "logs",
  "combined-auth.log"
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const now = new Date();
    const timestamp = now
      .toLocaleString("sv-SE")
      .replace("T", " ")
      .split(".")[0];

    const logLine = `[${timestamp}] action: ${body.action || "unknown"}, step: ${body.step || "n/a"}, completedSteps: ${JSON.stringify(body.completedSteps || [])}, currentIndex: ${body.currentIndex ?? -1}, totalSteps: ${body.totalSteps ?? 0}, scanStatus: ${body.scanStatus || "n/a"}, nextAction: ${body.nextAction || "n/a"}\n`;

    fs.appendFileSync(LOG_FILE, logLine, "utf8");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("combined-auth-log error:", error);
    return NextResponse.json(
      { error: "Failed to write log" },
      { status: 500 }
    );
  }
}
