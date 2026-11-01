"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@gravity-ui/uikit";
import { useRouter } from "next/navigation";
import { withBasePath } from "@/lib/base-path";
import { rememberGeneration, notifyGenerationHistory } from "@/lib/pets/generation/history";
import { publicGenerationError } from "@/lib/pets/generation/public-error";
import { CONTINUATION_STATES, REGENERATION_RETRIES, type ContinuationInput, type ContinuationOptions, type ContinuationState } from "@/lib/pets/generation/continuation-model";
import { readContinuationId, readContinuationInput, rememberContinuation, rememberContinuationInput, parseMaxRetriesInput, clearContinuation, continuationReplySchema, continuationOptionsSchema } from "./continuation-request";
import {GenerationRecoveryView} from "./GenerationRecoveryView";
import "./GenerationContinuation.scss";
const DEFINITE = new Set(["invalid_argument", "invalid_origin", "body_too_large", "base_not_ready", "continuation_disabled", "continuation_busy", "continuation_source_conflict", "continuation_selection_conflict", "continuation_limit", "continuation_cooldown", "generation_paused", "generation_disabled", "queue_full", "rate_limited", "budget_exhausted", "client_ip_unavailable", "saved_stage_unavailable", "generation_expired", "not_found"]);
const subscribe = () => () => { };
type Props = {
    generationId: string;
    enabled: boolean;
    onContinued: () => void;
    onVisibilityChange?: (visible:boolean) => void;
};
export function GenerationContinuation(props: Props) {
    const browser = useSyncExternalStore(subscribe, () => true, () => false);
    return browser ? <ContinuationForm key={props.generationId} {...props}/> : null;
}
function ContinuationForm({ generationId, enabled, onContinued, onVisibilityChange }: Props) {
    const router = useRouter(), pendingRef = useRef(false), controller = useRef<AbortController | null>(null);
    const [initial] = useState(() => {
        try {
            const requestId = readContinuationId(localStorage, generationId);
            return {requestId, input: requestId ? readContinuationInput(localStorage, generationId, requestId) : null};
        } catch { return {requestId: null, input: null}; }
    });
    const [requestId, setRequestId] = useState<string | null>(initial.requestId);
    const [submitted, setSubmitted] = useState<ContinuationInput | null>(initial.input);
    const [maxRetries, setMaxRetries] = useState(initial.requestId ? String(initial.input?.maxRetries ?? "") : String(REGENERATION_RETRIES.default));
    const [legacyRetries, setLegacyRetries] = useState(Boolean(initial.input && initial.input.maxRetries === undefined));
    const retriesEdited = useRef(false);
    const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [receiptExpired, setReceiptExpired] = useState(false);
    const [sourceUnavailable, setSourceUnavailable] = useState(false);
    const [options, setOptions] = useState<ContinuationOptions | null>(null), [mode, setMode] = useState<"rebuild" | "regenerate">(initial.input?.mode ?? "regenerate"), [states, setStates] = useState<ContinuationState[]>(initial.input?.states ?? []);
    const [acceptedUrl, setAcceptedUrl] = useState("");
    const [manualConfirmed,setManualConfirmed]=useState(false),[checkAttempted,setCheckAttempted]=useState(false);
    const visible=Boolean((enabled||requestId||submitted)&&(opened||requestId));
    useEffect(()=>{onVisibilityChange?.(visible);return()=>onVisibilityChange?.(false);},[visible,onVisibilityChange]);
    const endpoint = withBasePath(`/api/pet-generations/${generationId}/continuations`);
    useEffect(() => () => controller.current?.abort(), []);
    function begin() { if (pendingRef.current)
        return null; pendingRef.current = true; setBusy(true); setError(""); const c = new AbortController(); controller.current = c; return c; }
    function end(c: AbortController) { pendingRef.current = false; if (!c.signal.aborted)
        setBusy(false); }
    function forget(id: string) { try {
        clearContinuation(localStorage, generationId, id);
    }
    catch { /* Receipt remains authoritative. */ } setRequestId(null); setSubmitted(null); setLegacyRetries(false); if (!maxRetries) setMaxRetries(String(REGENERATION_RETRIES.default)); }
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
            const parsed = continuationOptionsSchema.safeParse(data && typeof data === "object" && "options" in data ? data.options : null);
            if(!parsed.success)throw Error("Не удалось прочитать сохранённые изображения. Повторите проверку.");
            const o=parsed.data;
            setSourceUnavailable(false);
            setOptions(o);
            if (!requestId && !submitted && !options && !retriesEdited.current && o.regenerationRetries) setMaxRetries(String(o.regenerationRetries.default));
            if(!submitted)setStates(current=>options?CONTINUATION_STATES.filter(state=>o.requiredStates.includes(state)||(current.includes(state)&&o.strips.some(s=>s.state===state))):o.requiredStates);
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
        const parsed=continuationReplySchema.safeParse(data);
        if(!parsed.success)throw Error("Не удалось подтвердить ответ. Сохранённый запрос остаётся доступным.");
        const result=parsed.data;
        if (result.operation.id !== id)
            throw Error("invalid_receipt");
        if (result.operation.state === "rejected") {
            forget(id);
            setError("Запрос отклонён. Обновите список изображений перед новой отправкой.");
            return;
        }
        if (result.operation.state === "preparing") {
            setRequestId(id);
            if (result.input) {
                setSubmitted(result.input);
                setMode(result.input.mode);
                setStates(result.input.states ?? []);
                setMaxRetries(result.input.maxRetries === undefined ? "" : String(result.input.maxRetries));
                setLegacyRetries(result.input.maxRetries === undefined);
            }
            try {
                if (result.input) rememberContinuationInput(localStorage, generationId, result.input);
                else rememberContinuation(localStorage, generationId, id);
            } catch {
                setError("Запрос найден, но параметры не удалось сохранить в браузере. Не закрывайте страницу; проверка этого запроса остаётся доступна.");
                return;
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
        setCheckAttempted(true);
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
        if (receiptExpired || sourceUnavailable || acceptedUrl || (!submitted && !options) || (requestId&&!submitted&&!manualConfirmed))
            return;
        const includeRetries = mode === "regenerate" && (requestId ? !legacyRetries : Boolean(options?.regenerationRetries));
        const count = parseMaxRetriesInput(maxRetries, requestId ? REGENERATION_RETRIES.max : options?.regenerationRetries?.max);
        if (!submitted && includeRetries && count === null) { setError("Введите целое число автоповторов от 0 до 50."); return; }
        const c = begin();
        if (!c)
            return;
        const isNew = !requestId;
        let id = requestId;
        try {
            id ??= crypto.randomUUID();
            const input = submitted ?? { requestId: id, mode, sourceRevision: options!.sourceRevision, ...(mode === "regenerate" ? { states: CONTINUATION_STATES.filter(s => states.includes(s)), ...(includeRetries && count !== null ? {maxRetries: count} : {}) } : {}) };
            try {
                rememberContinuationInput(localStorage, generationId, input);
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
    const displayedMaxRetries = submitted ? String(submitted.maxRetries ?? "") : maxRetries;
    const displayedLegacyRetries = submitted ? submitted.maxRetries === undefined : legacyRetries;
    return <GenerationRecoveryView generationId={generationId} options={options} mode={mode} states={states} busy={busy} error={error} requestId={requestId} submitted={Boolean(submitted)} receiptExpired={receiptExpired} sourceUnavailable={sourceUnavailable} acceptedUrl={acceptedUrl} manualConfirmed={manualConfirmed} checkAttempted={checkAttempted} maxRetries={displayedMaxRetries} legacyRetries={displayedLegacyRetries}
      onMaxRetries={value=>{retriesEdited.current=true;setMaxRetries(value);setManualConfirmed(false);}} onLegacyRetries={value=>{setLegacyRetries(value);setManualConfirmed(false);}}
      onMode={value=>{setMode(value);setManualConfirmed(false);}} onStates={value=>{setStates(value);setManualConfirmed(false);}} onManualConfirmed={setManualConfirmed} onSubmit={()=>void submit()} onCheck={id=>void check(id)} onRefresh={()=>void loadOptions()} onClose={()=>setOpened(false)} />;
}
