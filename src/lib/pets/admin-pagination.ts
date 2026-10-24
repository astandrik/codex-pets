export const ADMIN_QUEUE_PAGE_SIZE = 50;

export type AdminQueuePagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type AdminQueuePage<T> = {
  items: T[];
  pagination: AdminQueuePagination;
};

export function createAdminQueuePagination(
  totalItems: number,
  requestedPage: number,
): AdminQueuePagination {
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    throw new RangeError("Invalid admin queue page");
  }
  const totalPages = Math.max(1, Math.ceil(totalItems / ADMIN_QUEUE_PAGE_SIZE));
  return {
    page: Math.min(requestedPage, totalPages),
    pageSize: ADMIN_QUEUE_PAGE_SIZE,
    totalItems,
    totalPages,
  };
}
