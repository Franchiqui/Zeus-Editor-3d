import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { query = '', limit = 6, offset = 0 } = body;

    const response = await fetch('https://mcp.tunetank.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search_music',
          arguments: {
            query: query === 'Todas' ? '' : query,
            limit: Math.min(limit, 50),
            offset: offset,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Tunetank API error:', response.status, errorText);
      return NextResponse.json({ error: 'Tunetank API error', details: errorText }, { status: response.status });
    }

    const text = await response.text();
    console.log('Tunetank raw response length:', text.length);
    console.log('Tunetank raw response preview:', text.substring(0, 500));

    // Parse SSE format
    const lines = text.split('\n');
    let jsonData = null;
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.substring(6);
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.result) {
            jsonData = parsed;
            break;
          }
        } catch (e) {
          continue;
        }
      }
    }

    if (!jsonData) {
      // Try parsing the whole response as JSON
      try {
        jsonData = JSON.parse(text);
      } catch (e) {
        console.error('Failed to parse response as JSON');
        return NextResponse.json({ error: 'Could not parse Tunetank response', raw: text.substring(0, 1000) }, { status: 500 });
      }
    }

    console.log('Parsed Tunetank response structure:', Object.keys(jsonData));
    
    // Handle different response structures
    let tracks = [];
    
    if (jsonData.result && jsonData.result.content && Array.isArray(jsonData.result.content)) {
      // Check if content contains nested text responses
      const firstItem = jsonData.result.content[0];
      if (firstItem && firstItem.type === 'text' && firstItem.text) {
        try {
          const parsedText = JSON.parse(firstItem.text);
          if (Array.isArray(parsedText)) {
            tracks = parsedText;
            console.log('Parsed nested JSON from result.content[0].text, tracks:', tracks.length);
          } else {
            tracks = [parsedText];
            console.log('Single track from result.content[0].text');
          }
        } catch (e) {
          console.error('Failed to parse nested JSON from result.content:', e);
          tracks = jsonData.result.content;
        }
      } else {
        tracks = jsonData.result.content;
        console.log('Using result.content directly, tracks:', tracks.length);
      }
    } else if (jsonData.result && Array.isArray(jsonData.result)) {
      // Check if the array contains nested text responses
      const firstItem = jsonData.result[0];
      if (firstItem && firstItem.type === 'text' && firstItem.text) {
        try {
          const parsedText = JSON.parse(firstItem.text);
          if (Array.isArray(parsedText)) {
            tracks = parsedText;
            console.log('Parsed nested JSON from result[0].text, tracks:', tracks.length);
          } else {
            tracks = [parsedText];
            console.log('Single track from result[0].text');
          }
        } catch (e) {
          console.error('Failed to parse nested JSON:', e);
          tracks = jsonData.result;
        }
      } else {
        tracks = jsonData.result;
        console.log('Using direct result array, tracks:', tracks.length);
      }
    } else if (Array.isArray(jsonData)) {
      tracks = jsonData;
      console.log('Using root array, tracks:', tracks.length);
    } else {
      console.error('Unknown response structure:', JSON.stringify(jsonData, null, 2));
      return NextResponse.json({ error: 'Unknown response structure', data: jsonData }, { status: 500 });
    }
    
    console.log('First track sample:', tracks.length > 0 ? JSON.stringify(tracks[0], null, 2) : 'No tracks');
    
    return NextResponse.json({ result: tracks });
  } catch (error) {
    console.error('Error in Tunetank API route:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
