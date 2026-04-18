import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    // 开发模式：electron/package.json
    // 打包后：process.cwd() = resources/app，根 package.json 会被复制到这里
    const candidates = [
      join(process.cwd(), 'electron', 'package.json'),
      join(process.cwd(), 'package.json'),
    ];
    for (const pkgPath of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.version) {
          return NextResponse.json({ success: true, version: pkg.version });
        }
      } catch { /* try next candidate */ }
    }
    return NextResponse.json({ success: true, version: '0.0.0' });
  } catch {
    return NextResponse.json({ success: true, version: '0.0.0' });
  }
}
