export interface PublicStaticRoute {
  path: string;
  title: string;
  description: string;
  changeFrequency: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  priority: number;
}

export interface PublicDynamicRouteTemplate {
  id: string;
  html: string;
  markdown: string;
  description: string;
  pattern: RegExp;
}

export const PUBLIC_STATIC_ROUTES: PublicStaticRoute[];
export const PUBLIC_DYNAMIC_ROUTE_TEMPLATES: PublicDynamicRouteTemplate[];
export function normalizePublicPath(pathname: string): string;
export function publicRouteDescriptor(
  pathname: string
):
  | { type: 'static'; route: PublicStaticRoute }
  | { type: 'dynamic'; route: PublicDynamicRouteTemplate }
  | null;
export function isPublicHtmlPath(pathname: string): boolean;
