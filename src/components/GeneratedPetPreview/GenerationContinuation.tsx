"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@gravity-ui/uikit";
import { useRouter } from "next/navigation";
import { withBasePath } from "@/lib/base-path";
import { rememberGeneration, notifyGenerationHistory } from "@/lib/pets/generation/history";
import { publicGenerationError } from "@/lib/pets/generation/public-error";
import { CONTINUATION_STATES, type ContinuationInput, type ContinuationOptions, type ContinuationState } from "@/lib/pets/generation/continuation-model";
import { readContinuationId, rememberContinuation, clearContinuation, continuationReplySchema, continuationOptionsSchema } from "./continuation-request";
import "./GenerationContinuation.scss";
const LABELS: Record<ContinuationState, string> = { idle: "Покой", running: "Работа", "running-left": "Движение влево", "running-right": "Движение вправо", waving: "Приветствие", jumping: "Прыжок", waiting: "Ожидание", failed: "Неудача", review: "Размышление", "look-0-157": "Взгляд: направления 1–8", "look-180-337": "Взгляд: направления 9–16" };
const DEFINITE = new Set(["invalid_argument", "invalid_origin", "body_too_large", "base_not_ready", "continuation_disabled", "continuation_busy", "continuation_source_conflict", "continuation_selection_conflict", "continuation_limit", "continuation_cooldown", "generation_paused", "generation_disabled", "queue_full", "rate_limited", "budget_exhausted", "client_ip_unavailable", "saved_stage_unavailable", "generation_expired", "not_found"]);
const subscribe = () => () => { };
type Props = {
    generationId: string;
    enabled: boolean;
    onContinued: () => void;
};
export function GenerationContinuation(props: Props) {
    const browser = useSyncExternalStore(subscribe, () => true, () => false);
    return browser ? <ContinuationForm key={props.generationId} {...props}/> : null;
}
function ContinuationForm({ generationId, enabled, onContinued }: Props) {
    const router = useRouter(), pendingRef = useRef(false), controller = useRef<AbortController | null>(null);
    const [requestId, setRequestId] = useState<string | null>(() => {
        try {
            return readContinuationId(localStorage, generationId);
        }
        catch {
            return null;
        }
    });
    const [submitted, setSubmitted] = useState<ContinuationInput | null>(null);
    const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [receiptExpired, setReceiptExpired] = useState(false);
    const [sourceUnavailable, setSourceUnavailable] = useState(false);
    const [options, setOptions] = useState<ContinuationOptions | null>(null), [mode, setMode] = useState<"rebuild" | "regenerate">("regenerate"), [states, setStates] = useState<ContinuationState[]>([]);
    const [acceptedUrl, setAcceptedUrl] = useState("");
    const endpoint = withBasePath(`/api/pet-generations/${generationId}/continuations`);
    useEffect(() => () => controller.current?.abort(), []);
    function begin() { if (pendingRef.current)
        return null; pendingRef.current = true; setBusy(true); setError(""); const c = new AbortController(); controller.current = c; return c; }
    function end(c: AbortController) { pendingRef.current = false; if (!c.signal.aborted)
        setBusy(false); }
    function forget(id: string) { try {
        clearContinuation(localStorage, generationId, id);
    }
    catch { /* Receipt remains authoritative. */ } setRequestId(null); setSubmitted(null); }
    async function loadOptions() {
        const c = begin();
        if (!c)
            return;
        setOpened(true);
        try {
            const response = await fetch(endpoint, { cache: "no-store", signal: c.signal });
            const data: unknown = await response.json();
            if (c.signal.aborted)
                return;
            if (!response.ok) {
                if (response.status === 404 || response.status === 410) {
                    setSourceUnavailable(true);
                    throw Error(requestId
                        ? "Исходное задание недоступно. Проверьте сохранённый запрос: новая версия может быть ещё доступна."
                        : "Исходное задание недоступно. Начните новую генерацию.");
                }
                throw Error("Продолжение недоступно: обновите страницу или начните новое задание.");
            }
            const o = continuationOptionsSchema.parse(data && typeof data === "object" && "options" in data ? data.options : null);
            setSourceUnavailable(false);
            setOptions(o);
            setStates(o.requiredStates);
        }
        catch (e) {
            if (!c.signal.aborted)
                setError(e instanceof Error ? e.message : "Не удалось проверить сохранённые изображения.");
        }
        finally {
            end(c);
        }
    }
    function receipt(data: unknown, id: string) {
        const result = continuationReplySchema.parse(data);
        if (result.operation.id !== id)
            throw Error("invalid_receipt");
        if (result.operation.state === "rejected") {
            forget(id);
            setError("Запрос отклонён. Обновите список изображений перед новой отправкой.");
            return;
        }
        if (result.operation.state === "preparing") {
            rememberContinuation(localStorage, generationId, id);
            setRequestId(id);
            if (result.input) {
                setSubmitted(result.input);
                setMode(result.input.mode);
                setStates(result.input.states ?? []);
            }
            setError("Снимки подготавливаются. Проверьте результат или повторите тот же запрос позже.");
            return;
        }
        const g = result.generation;
        if (!g || g.generationId !== result.operation.generationId)
            throw Error("invalid_receipt");
        const url = withBasePath(`/generated/${g.generationId}`);
        setAcceptedUrl(url);
        if (!rememberGeneration(g.generationId, g.expiresAt)) {
            setError("Результат принят, но история браузера недоступна. Сохраните ссылку ниже.");
            return;
        }
        notifyGenerationHistory();
        forget(id);
        if (g.generationId === generationId) {
            setAcceptedUrl("");
            setOptions(null);
            setMode("regenerate");
            setStates([]);
            setOpened(false);
            onContinued();
        }
        else
            router.push(url);
    }
    async function check(id = requestId) {
        if (!id)
            return;
        const c = begin();
        if (!c)
            return;
        setOpened(true);
        try {
            const r = await fetch(endpoint + "?requestId=" + id, { cache: "no-store", signal: c.signal });
            const data: unknown = await r.json();
            if (c.signal.aborted)
                return;
            if (r.status === 410) {
                setReceiptExpired(true);
                forget(id);
                setError("Результат продолжения истёк.");
                return;
            }
            if (!r.ok)
                throw Error("Ответ пока не подтверждён. UUID сохранён; проверьте позже или повторите прежний набор.");
            receipt(data, id);
        }
        catch (e) {
            if (!c.signal.aborted)
                setError(e instanceof Error ? e.message : "Не удалось проверить запрос.");
        }
        finally {
            end(c);
        }
    }
    async function submit() {
        if (receiptExpired || sourceUnavailable || acceptedUrl || (!submitted && !options))
            return;
        const c = begin();
        if (!c)
            return;
        const isNew = !requestId;
        let id = requestId;
        try {
            id ??= crypto.randomUUID();
            const input = submitted ?? { requestId: id, mode, sourceRevision: options!.sourceRevision, ...(mode === "regenerate" ? { states: CONTINUATION_STATES.filter(s => states.includes(s)) } : {}) };
            try {
                rememberContinuation(localStorage, generationId, id);
            }
            catch {
                setError("Не удалось сохранить UUID. Запрос не отправлен.");
                return;
            }
            setRequestId(id);
            if (c.signal.aborted) {
                if (isNew)
                    forget(id);
                return;
            }
            setSubmitted(input);
            const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store", signal: c.signal });
            const data: unknown = await r.json();
            if (c.signal.aborted)
                return;
            if (!r.ok) {
                const code = data && typeof data === "object" && "code" in data && typeof data.code === "string" ? data.code : "generation_unavailable";
                if (isNew && DEFINITE.has(code))
                    forget(id);
                const detail = publicGenerationError(code);
                setError(detail.message + " " + detail.hint);
                return;
            }
            receipt(data, id);
        }
        catch {
            if (!c.signal.aborted)
                setError("Ответ не подтверждён. Повторяйте тот же запрос: UUID и выбранный набор сохранены до проверки.");
        }
        finally {
            end(c);
        }
    }
    if (!enabled && !requestId && !submitted)
        return null;
    if (!opened && !requestId)
        return <section className="generation-continuation"><Button onClick={() => void loadOptions()}>Продолжить генерацию</Button></section>;
    const locked = busy || Boolean(submitted) || Boolean(acceptedUrl) || receiptExpired || sourceUnavailable;
    return <section className="generation-continuation" lang="ru">
    <h2>Продолжить генерацию</h2>
    {options && <>
      {options.activeRequestId && <p>Продолжение уже начато в другой вкладке. <Button disabled={busy} onClick={() => void check(options.activeRequestId)}>Проверить продолжение</Button></p>}
      <fieldset disabled={locked}><legend>Что сделать?</legend>
        <label><input type="radio" name="continuation-mode" checked={mode === "rebuild"} disabled={!options.canRebuild} onChange={() => setMode("rebuild")}/>Повторить сборку</label>
        <label><input type="radio" name="continuation-mode" checked={mode === "regenerate"} disabled={!options.canRegenerate} onChange={() => setMode("regenerate")}/>Перегенерировать выбранное</label>
      </fieldset>
      {mode === "rebuild" ? <p>Без новой попытки и генерации изображений. Срок хранения прежний. Ещё не начатая карточка может быть подготовлена штатным AI-шагом. Осталось сборок: {options.rebuildsRemaining}.</p> : <>
        <fieldset disabled={locked}><legend>Выберите полосы</legend>
          {options.strips.map(s => <label key={s.state}><input type="checkbox" checked={states.includes(s.state)} disabled={options.requiredStates.includes(s.state)} onChange={e => setStates(v => e.target.checked ? [...v, s.state] : v.filter(n => n !== s.state))}/>{LABELS[s.state]} — {s.status === "saved" ? "сохранено" : s.status === "missing" ? "нужна генерация" : "ошибка сборки"}{s.uncertain ? "; прежний запрос мог быть оплачен" : ""}</label>)}
        </fieldset>
        <p>Весь выбранный набор — 1 обычная попытка. Новая версия хранится 24 часа; прежняя сохраняется. Базовый образ и остальные результаты переиспользуются.</p>
      </>}
      {!!options.issues.length && <ul>{options.issues.map((i, n) => <li key={n}>{LABELS[i.state]}: {i.frame === undefined ? "не удалось разделить позы" : `проблема с кадром ${i.frame + 1}`}{i.actual === undefined ? "" : ` (${i.actual} пикселей)`}.</li>)}</ul>}
    </>}
    {requestId && !submitted && <p>Сохранён UUID прежнего запроса. Сначала проверьте результат; при отсутствии ответа выберите тот же режим и набор.</p>}
    <div className="generation-continuation__actions">
      {(options || submitted) && <Button view="action" loading={busy} disabled={busy || receiptExpired || sourceUnavailable || Boolean(acceptedUrl) || (!submitted && mode === "regenerate" && !states.length)} onClick={() => void submit()}>{submitted ? "Повторить тот же запрос" : "Продолжить"}</Button>}
      {requestId && <Button disabled={busy || receiptExpired} onClick={() => void check()}>Проверить запрос</Button>}
      {!submitted && <Button disabled={busy || receiptExpired} onClick={() => void loadOptions()}>Обновить изображения</Button>}
      {!requestId && !submitted && <Button disabled={busy} onClick={() => setOpened(false)}>Закрыть</Button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {(receiptExpired || sourceUnavailable) && <p><a href={withBasePath("/generate")}>Начать новую генерацию</a></p>}
    {acceptedUrl && <p><a href={acceptedUrl}>Открыть результат</a></p>}
  </section>;
}
