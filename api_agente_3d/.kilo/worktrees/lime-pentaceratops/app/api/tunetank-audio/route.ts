import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const audioUrl = searchParams.get('url');

    if (!audioUrl) {
      return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 });
    }

    // Validate that the URL is from Tunetank's CDN
    if (!audioUrl.includes('d1s1y0ui543e5o.cloudfront.net') && !audioUrl.includes('tunetank.com')) {
      return NextResponse.json({ error: 'Invalid URL domain' }, { status: 400 });
    }

    const response = await fetch(audioUrl);

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch audio' }, { status: response.status });
    }

    const arrayBuffer = await response.arrayBuffer();
    
    // Return the audio with proper CORS headers
    return new NextResponse(arrayBuffer, {
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error in Tunetank audio proxy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
