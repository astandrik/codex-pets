import type { ProviderFailure } from "@/lib/pets/generation/provider-failure";

export type PublicGenerationError = {
  code: string;
  message: string;
  hint: string;
  automaticRetry: false;
  limitScope?: "ip" | "global";
};

const NEW_TASK = "If you choose to try again, start a new task; it counts toward your daily limit. No further automatic retry will be started.";
const CONTACT_SUPPORT = "Contact the service administrator before starting another generation.";
const VALIDATION_ERRORS = new Set(["invalid_generated_package", "invalid_generated_image", "invalid_grid_dimensions", "missing_transparency", "missing_animation_frame", "clipped_animation_frame", "image_size_limit", "invalid_sprite_extraction", "invalid_provider_result"]);
const CONFIGURATION_ERRORS = new Set(["provider_not_configured", "proxy_not_configured", "generation_not_configured", "client_ip_unavailable"]);
const PROVIDER_ACCESS_ERRORS = new Set(["invalid_api_key", "model_not_found", "model_not_available", "permission_denied", "permission_error", "access_denied", "account_deactivated", "organization_deactivated", "organization_restricted", "unsupported_country_region_territory", "insufficient_quota", "billing_hard_limit_reached", "credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded"]);
const PROVIDER_PARAMETER_ERRORS = new Set(["invalid_request_error", "invalid_value", "invalid_parameter", "unsupported_parameter", "missing_required_parameter", "unsupported_model", "invalid_model", "invalid_size"]);

// Only application-owned text is public. Never include provider messages, request IDs or credentials.
export function publicGenerationError(code: string, providerFailure?: ProviderFailure, limitScope?: "ip" | "global"): PublicGenerationError {
  const result = (message: string, hint: string): PublicGenerationError => ({ code, message, hint, automaticRetry: false });
  if (["provider_rejected", "provider_rate_limited"].includes(code)) {
    if (["moderation_blocked", "content_policy_violation", "safety_system_blocked"].includes(providerFailure?.code ?? "")) {
      let message = "OpenAI blocked this generation during safety checks.";
      if (providerFailure?.moderationStage === "output") message = "OpenAI blocked the generated image during safety checks. No image was returned.";
      if (providerFailure?.moderationStage === "input") message = "OpenAI blocked the generation request during safety checks.";
      return result(message, "Change the character description before starting a new task. " + NEW_TASK);
    }
    if (PROVIDER_ACCESS_ERRORS.has(providerFailure?.code ?? "")) {
      return result("The image service cannot accept requests with the current service configuration or limits.", CONTACT_SUPPORT);
    }
    if (PROVIDER_PARAMETER_ERRORS.has(providerFailure?.code ?? "")) {
      return result("The image service rejected the generation request parameters.", CONTACT_SUPPORT);
    }
    if (code === "provider_rate_limited") {
      return result("The image service reached a request or usage limit. This generation has stopped.", "Try later or contact the service administrator. " + NEW_TASK);
    }
    return result("The image provider rejected this generation. The saved details do not identify the reason.", CONTACT_SUPPORT);
  }
  if (VALIDATION_ERRORS.has(code)) return result("The generated images could not be assembled into a valid pet package.", NEW_TASK);
  if (CONFIGURATION_ERRORS.has(code)) return result("The generation service is not configured correctly.", CONTACT_SUPPORT);
  switch (code) {
      case "base_retry_disabled":
        return result("Повтор создания персонажа временно недоступен.", "Уже принятый запрос можно проверить по сохранённой ссылке.");
      case "base_retry_unavailable":
        return result("Нельзя безопасно повторить создание этого персонажа.", "Проверьте текущий результат. При неопределённом исходе обратитесь к администратору.");
      case "base_retry_input_missing":
        return result("Сохранённые исходные данные недоступны или повреждены.", "Новая задача не создана. Не заменяйте утраченное описание пустым вводом.");
      case "base_retry_source_conflict":
        return result("Состояние исходной задачи изменилось.", "Обновите сохранённые данные перед повторной отправкой.");
    case "continuation_disabled":
      return result("Продолжение генерации пока недоступно.", "Уже принятые операции сохраняются. Попробуйте позже.");
    case "continuation_busy":
      return result("Для этого задания уже начато продолжение.", "Проверьте принятую операцию или обновите страницу.");
    case "continuation_source_conflict":
    case "continuation_selection_conflict":
      return result("Состояние сохранённых изображений изменилось.", "Обновите список полос. Новая попытка не списана.");
    case "continuation_limit":
      return result("Три повторные сборки этого задания уже использованы.", "Можно перегенерировать проблемные полосы новой попыткой.");
    case "continuation_cooldown":
      return result("Повторную сборку можно запускать раз в 30 секунд.", "Подождите и обновите состояние.");
    case "animation_revisions_disabled":
      return result("Редактирование анимаций пока недоступно.", "Уже принятые версии сохраняются. Попробуйте позже.");
    case "animation_revision_not_accepted":
      return result("Эта версия ещё не принята.", "Сравните результат и нажмите «Принять новую версию».");
    case "animation_corrections_limit":
      return result("Накопленные правки превышают 8000 символов на состояние.", "Начните от более ранней доступной версии; прежние инструкции не удалены.");
    case "base_not_ready":
      return result("This character is not awaiting confirmation.", "Refresh the existing task to see its current state.");
    case "animation_hints_disabled":
      return result("Animation guidance is not enabled for new confirmations.", "Clear the movement instructions to use standard animations, or try again later. Accepted settings are preserved.");
    case "generation_review_disabled":
      return result("Character review is not enabled for new tasks.", "Reload the generation form. Existing tasks remain available.");
    case "invalid_reference_image":
      return result("The reference image could not be accepted.", "Use one readable, static PNG, JPEG or WebP image with at most 25 million pixels.");
    case "reference_image_too_large":
      return result("The reference image is too large.", "Choose an image of 5 MiB or less.");
    case "outcome_unknown":
      return result("The image request was interrupted and its outcome could not be confirmed.", "Do not start another task: it could repeat a paid request. Contact the service administrator to check the saved state.");
    case "generation_paused":
      return result("Generation is paused while an earlier request is checked.", "Wait for the service administrator to resolve the request. Do not start another task automatically.");
    case "queue_timeout":
      return result("This task was stopped under an earlier queue waiting limit.", NEW_TASK);
    case "generation_disabled":
      return result("Pet generation is currently disabled.", "Check back after generation is enabled. Do not start another task automatically.");
    case "rate_limited":
      if (limitScope === "ip" || limitScope === "global") return { ...result(
        limitScope === "ip" ? "Today's generation limit for your IP address has been reached." : "Today's generation limit for the whole service has been reached.",
        "Try again after midnight Moscow time. Accepted tasks count even if generation fails."), limitScope };
      return result("The daily generation limit has been reached.", "Limits reset at midnight Moscow time. Accepted tasks still count if generation fails.");
    case "budget_exhausted":
      return result("The service has reached its recorded generation spending limit.", "Wait for budget to become available. Do not create repeated tasks.");
    case "queue_full":
      return result("The generation queue is full.", "Wait for a free slot. Do not create repeated tasks.");
    case "request_id_conflict":
      return result("This requestId was already used with a different description, name or image.", "Use the original input to read the existing task. A new task requires a new requestId and explicit user intent.");
    case "metadata_conflict":
      return result("These details changed in another tab.", "Reload the saved details before editing again. No generation was started.");
    case "metadata_locked":
      return result("This pet has already been submitted for review.", "Its submitted description and tags can no longer be edited here.");
    case "generation_expired":
      return result("This generation and its temporary files have expired.", "A previously downloaded ZIP can still be used. " + NEW_TASK);
    case "not_found":
      return result("Generation not found.", "Check the private preview link or generationId.");
    case "invalid_argument":
      return result("The generation request contains invalid or missing fields.", "Check the description, requestId or generationId before sending the request again.");
    case "invalid_origin":
      return result("This request must come from the Pets website.", "Open the public generation form on the Pets website.");
    case "body_too_large":
      return result("The request is too large.", "Shorten the request and keep only the supported fields.");
    case "generation_not_completed":
      return result("This generation is not complete yet.", "Wait for a completed result before downloading or submitting it.");
    case "saved_stage_unavailable":
    case "source_unavailable":
      return result("A saved generation image is unavailable or failed verification.", CONTACT_SUPPORT);
    default:
      return { code: "generation_unavailable", message: "Generation could not be completed or confirmed.", hint: "Check the existing task before sending another request. " + CONTACT_SUPPORT, automaticRetry: false };
  }
}
