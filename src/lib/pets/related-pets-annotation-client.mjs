import {
  AnnotationRequestError,
  createAnnotationRequester,
} from "./related-pets-annotation-requester.mjs";

const START_INTERVAL_MS = 6_000;

export class RelatedPetAnnotationProviderError extends Error {
  constructor(reason, options) {
    super("Related pet annotation provider request failed.", options);
    this.name = "RelatedPetAnnotationProviderError";
    this.reason = reason;
  }
}

export function createYandexRelatedPetAnnotationClient(options) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let nextStartAt = 0;
  let reservationQueue = Promise.resolve();
  const requestProposal = createAnnotationRequester({
    ...options,
    now,
    sleep,
    reserveStart,
    onDiagnostic: options.onDiagnostic ??
      ((diagnostic) =>
        console.info("[codex-pets][related-pet-annotation-provider]", diagnostic)),
  });

  return {
    createProposal(pet) {
      return requestProposal(pet).catch((error) => {
        if (error instanceof AnnotationRequestError) {
          throw new RelatedPetAnnotationProviderError(error.reason, {
            cause: error,
          });
        }
        throw error;
      });
    },
  };

  function reserveStart() {
    const reservation = reservationQueue.then(async () => {
      const waitMs = Math.max(0, nextStartAt - now());
      if (waitMs > 0) await sleep(waitMs);
      const startedAt = now();
      nextStartAt = Math.max(nextStartAt, startedAt) + START_INTERVAL_MS;
    });
    reservationQueue = reservation.catch(() => undefined);
    return reservation;
  }
}
