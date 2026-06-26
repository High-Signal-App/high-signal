import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  if (request.nextUrl.hostname !== 'www.highsignal.app') {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.hostname = 'highsignal.app';

  return NextResponse.redirect(url, 308);
}
