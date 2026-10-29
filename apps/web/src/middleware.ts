import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Reject before streaming the app shell; notFound() alone can return HTTP 200.
  if (
    request.nextUrl.pathname === '/equities/preview' &&
    process.env['NODE_ENV'] !== 'development'
  ) {
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
  }
  // Add CDN cache headers for the homepage
  if (request.nextUrl.pathname === '/') {
    const response = NextResponse.next({
      request: {
        headers: request.headers,
      },
    });
    response.headers.set(
      'Cache-Control',
      'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
    );
    return response;
  }

  if (request.nextUrl.hostname !== 'www.highsignal.app') {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.hostname = 'highsignal.app';

  return NextResponse.redirect(url, 308);
}
