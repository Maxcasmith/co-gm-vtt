import type { Request } from 'express';

export function parsePageParams(req: Request, defaultPageSize: number): { page: number; pageSize: number } {
  const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1);
  const pageSize = Math.max(1, parseInt(String(req.query['pageSize'] ?? String(defaultPageSize)), 10) || defaultPageSize);
  return { page, pageSize };
}
