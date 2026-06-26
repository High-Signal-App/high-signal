import { ImageResponse } from 'next/og';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const title = searchParams.get('title') ?? 'High Signal';
  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '60px',
        background: '#0a0a0a',
        color: '#ededed',
        fontFamily: 'system-ui',
      }}
    >
      <div style={{ fontSize: 18, letterSpacing: 4, color: '#7dd3fc', textTransform: 'uppercase' }}>
        high signal · ai-infra
      </div>
      <div style={{ fontSize: 64, fontWeight: 500, lineHeight: 1.05, maxWidth: 980 }}>{title}</div>
      <div style={{ fontSize: 18, letterSpacing: 4, color: '#737373', textTransform: 'uppercase' }}>
        evidence-first / append-only
      </div>
    </div>,
    { width: 1200, height: 630 }
  );
}
