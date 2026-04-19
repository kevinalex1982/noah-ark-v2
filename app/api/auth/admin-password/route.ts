import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";

/**
 * 验证管理员密码
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body;

    if (!password) {
      return NextResponse.json(
        { success: false, message: "密码不能为空" },
        { status: 400 }
      );
    }

    const settings = getSettings();
    const adminPassword = settings.adminPassword || '12345';

    if (password === adminPassword) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { success: false, message: "密码错误" },
        { status: 401 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, message: "验证失败" },
      { status: 500 }
    );
  }
}
