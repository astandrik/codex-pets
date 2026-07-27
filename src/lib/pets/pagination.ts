export const CATALOG_PAGE_SIZE = 24;
export const MAX_PETS_API_PAGE_SIZE = 200;

export type PetsApiPagination = {
  page: number;
  pageSize: number;
  offset: number;
};

export type PetsPaginationMetadata = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
};

export type PetsApiPaginationParseResult =
  | {
      ok: true;
      pagination: PetsApiPagination | null;
    }
  | {
      ok: false;
      field: "page" | "pageSize";
      message: string;
    };

type CatalogSearchParams =
  | Record<string, string | string[] | undefined>
  | URLSearchParams
  | undefined;

export type CatalogPageParseResult =
  | {
      ok: true;
      page: number;
      explicit: boolean;
    }
  | {
      ok: false;
    };

export function parseCatalogPage(
  params: CatalogSearchParams,
): CatalogPageParseResult {
  const explicit =
    params instanceof URLSearchParams
      ? params.has("page")
      : Object.hasOwn(params ?? {}, "page");
  if (!explicit) {
    return { ok: true, page: 1, explicit: false };
  }

  const value =
    params instanceof URLSearchParams
      ? params.get("page")
      : firstValue(params?.page);
  const page = value === null ? null : parsePositiveInteger(value ?? "");
  return page === null
    ? { ok: false }
    : { ok: true, page, explicit: true };
}

export function parsePetsApiPagination(
  params: URLSearchParams,
): PetsApiPaginationParseResult {
  const hasPage = params.has("page");
  const hasPageSize = params.has("pageSize");
  if (!hasPage && !hasPageSize) {
    return { ok: true, pagination: null };
  }

  const page = parsePositiveInteger(params.get("page") ?? "1");
  if (page === null) {
    return {
      ok: false,
      field: "page",
      message: "page must be a positive integer.",
    };
  }

  const pageSize = parsePositiveInteger(
    params.get("pageSize") ?? String(CATALOG_PAGE_SIZE),
  );
  if (pageSize === null || pageSize > MAX_PETS_API_PAGE_SIZE) {
    return {
      ok: false,
      field: "pageSize",
      message: `pageSize must be an integer between 1 and ${MAX_PETS_API_PAGE_SIZE}.`,
    };
  }

  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) {
    return {
      ok: false,
      field: "page",
      message: "page is too large.",
    };
  }

  return {
    ok: true,
    pagination: {
      page,
      pageSize,
      offset,
    },
  };
}

export function createPetsPaginationMetadata(
  pagination: PetsApiPagination,
  totalItems: number,
): PetsPaginationMetadata {
  const totalPages = Math.ceil(totalItems / pagination.pageSize);

  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalItems,
    totalPages,
    hasNextPage: pagination.page < totalPages,
  };
}

function parsePositiveInteger(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
