import {
  RESPONSES_ENDPOINT,
  StructuredResponseRequestError,
  createResponsesStructuredRequest,
  createResponsesStructuredRequester,
} from "./responses-structured-provider.mjs";

export const RESPONSES_VISION_ENDPOINT = RESPONSES_ENDPOINT;

export class VisionCaptionRequestError extends Error {
  constructor(reason, diagnostics = {}) {
    super("Vision caption provider request failed.");
    this.name = "VisionCaptionRequestError";
    this.reason = reason;
    this.diagnostics = diagnostics;
  }
}

export function createResponsesVisionRequest(input) {
  return createResponsesStructuredRequest({
    ...input,
    parseValue: input.parseCaption ?? ((value) => value),
    content: [
      { type: "input_text", text: input.userPrompt },
      ...input.frames.map((frame) => ({
        type: "input_image",
        image_url: frame.dataUrl,
      })),
    ],
  });
}

export function createResponsesVisionCaptionRequester(options) {
  const requester = createResponsesStructuredRequester({
    ...options,
    endpoint: RESPONSES_VISION_ENDPOINT,
    buildContent: (frames) => [
      { type: "input_text", text: options.userPrompt },
      ...frames.map((frame) => ({
        type: "input_image",
        image_url: frame.dataUrl,
      })),
    ],
    validateInput: (frames) => validateFrames(frames, options.expectedFrames),
    parseValue: options.parseCaption,
  });

  return async function requestCaption(frames) {
    try {
      return await requester(frames);
    } catch (error) {
      if (error instanceof StructuredResponseRequestError) {
        throw new VisionCaptionRequestError(error.reason, error.diagnostics);
      }
      throw error;
    }
  };
}

function validateFrames(frames, expectedFrames) {
  if (!Array.isArray(frames) || frames.length !== expectedFrames.length) {
    throw new VisionCaptionRequestError("invalid_request");
  }
  const valid = expectedFrames.every((expected, index) => {
    const actual = frames[index];
    return (
      actual?.state === expected.state &&
      actual.row === expected.row &&
      actual.frame === expected.frame &&
      typeof actual.dataUrl === "string" &&
      actual.dataUrl.startsWith("data:image/png;base64,")
    );
  });
  if (!valid) throw new VisionCaptionRequestError("invalid_request");
}
