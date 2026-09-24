import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const LOCAL_PATHS_FILE = path.join(process.cwd(), 'local-paths.json');

export async function GET() {
  try {
    const data = await fs.readFile(LOCAL_PATHS_FILE, 'utf-8');
    return NextResponse.json(JSON.parse(data));
  } catch (error) {
    console.error('Error getting local paths:', error);
    return NextResponse.json({});
  }
}

export async function POST(request: Request) {
  try {
    const paths = await request.json();
    await fs.writeFile(LOCAL_PATHS_FILE, JSON.stringify(paths, null, 2));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving local paths:', error);
    return NextResponse.json({ success: false, error: 'Failed to save' }, { status: 500 });
  }
}