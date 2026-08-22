import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
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
