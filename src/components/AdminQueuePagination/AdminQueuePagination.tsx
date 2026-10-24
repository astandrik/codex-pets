import { Flex, Text } from "@/components/GravityUI/GravityUI";
import { withBasePath } from "@/lib/base-path";
import type { AdminQueuePagination as Pagination } from "@/lib/pets/admin-pagination";

export function adminQueueHref(pathname: string, page: number): string {
  return withBasePath(page === 1 ? pathname : `${pathname}?page=${page}`);
}

export function AdminQueuePagination({ pagination, pathname, itemLabel }: {
  pagination: Pagination;
  pathname: string;
  itemLabel: string;
}) {
  const { page, pageSize, totalItems, totalPages } = pagination;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  return (
    <Flex direction="column" gap={2} className="page-section">
      <Text variant="body-2" color="secondary">
        {totalItems ? `Showing ${start}–${end} of ${totalItems} ${itemLabel}` : `0 ${itemLabel}`}
      </Text>
      {totalPages > 1 ? (
        <nav aria-label="Queue pages">
          <Flex alignItems="center" gap={4}>
            {page > 1 ? <a href={adminQueueHref(pathname, page - 1)} rel="prev">Previous</a> : <span>Previous</span>}
            <span>Page {page} of {totalPages}</span>
            {page < totalPages ? <a href={adminQueueHref(pathname, page + 1)} rel="next">Next</a> : <span>Next</span>}
          </Flex>
        </nav>
      ) : null}
    </Flex>
  );
}
