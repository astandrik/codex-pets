"use client";
import {useEffect, useRef, useState, useSyncExternalStore} from "react";
import {Button, TextArea} from "@gravity-ui/uikit";
import {useRouter} from "next/navigation";
import {PET_STATES} from "@/lib/pets/types";
import {withBasePath} from "@/lib/base-path";
import {rememberGeneration} from "@/lib/pets/generation/history";
import {publicGenerationError} from "@/lib/pets/generation/public-error";
import {clearAnimationRevision, prepareAnimationRevision, readAnimationRevision, type PendingAnimationRevision} from "./animation-revision-request";
import type {AnimationState} from "@/lib/pets/generation/animation-revision-input";
import "./AnimationRevision.scss";

export const ANIMATION_LABELS: Record<AnimationState, string> = {idle: "Покой", running: "Работа", "running-left": "Движение влево", "running-right": "Движение вправо", waving: "Приветствие", jumping: "Прыжок", waiting: "Ожидание", failed: "Неудача", review: "Размышление"};
type Prepared = Awaited<ReturnType<typeof prepareAnimationRevision>>;
type Props = {generationId: string; metadataRevision: number; canEdit: boolean; blocked: boolean};
const DEFINITE_REFUSALS = new Set(["invalid_argument", "invalid_origin", "body_too_large", "rate_limited", "queue_full", "budget_exhausted", "not_found", "generation_expired", "generation_not_completed", "animation_revision_not_accepted", "metadata_conflict", "generation_paused", "generation_disabled", "animation_revisions_disabled", "animation_corrections_limit", "saved_stage_unavailable", "invalid_generated_package", "invalid_reference_image", "client_ip_unavailable"]);

const subscribeToBrowser = () => () => {};
export function AnimationRevisionEditor(props: Props) {
  const browser = useSyncExternalStore(subscribeToBrowser, () => true, () => false);
  return browser ? <AnimationRevisionForm key={props.generationId} {...props}/> : null;
}
function AnimationRevisionForm({generationId, metadataRevision, canEdit, blocked}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<PendingAnimationRevision | null>(() => {
    try {return readAnimationRevision(sessionStorage, generationId);} catch {return null;}
  });
  const [states, setStates] = useState<AnimationState[]>(saved?.states ?? []);
  const [prompt, setPrompt] = useState("");
  const [submitted, setSubmitted] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [acceptedUrl, setAcceptedUrl] = useState("");
  const pending = useRef(false), controller = useRef<AbortController | null>(null);
  const endpoint = withBasePath(`/api/pet-generations/${generationId}/animation-revisions`);
  useEffect(() => () => controller.current?.abort(), []);

  function acceptReceipt(result: unknown, requestId: string) {
    const generation = result && typeof result === "object" && "generation" in result ? result.generation : null;
    if (!generation || typeof generation !== "object" || !("generationId" in generation) || typeof generation.generationId !== "string" || !/^[a-f0-9]{64}$/.test(generation.generationId) || generation.generationId === generationId || !("expiresAt" in generation) || typeof generation.expiresAt !== "string" || !Number.isFinite(Date.parse(generation.expiresAt))) throw Error("invalid_receipt");
    const url = withBasePath(`/generated/${generation.generationId}`); setAcceptedUrl(url);
    if (!rememberGeneration(generation.generationId, generation.expiresAt)) {setError("Не удалось сохранить историю. Сохраните ссылку на новую версию; данные восстановления оставлены в этой вкладке."); return;}
    try {clearAnimationRevision(sessionStorage, generationId, requestId);} catch { /* Receipt and direct link remain usable. */ }
    router.push(url);
  }
  async function check() {
    const record = saved ?? readAnimationRevision(sessionStorage, generationId);
    if (!record || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    const request = new AbortController(); controller.current = request;
    try {
      const response = await fetch(endpoint + "?requestId=" + record.requestId, {cache: "no-store", signal: request.signal});
      const result: unknown = await response.json();
      if (request.signal.aborted) return;
      if (!response.ok) {setError("Результат пока не найден или недоступен. Это не подтверждает отказ. Проверьте позже; для повторной отправки введите тот же текст."); return;}
      acceptReceipt(result, record.requestId);
    } catch {if (!request.signal.aborted) setError("Не удалось проверить запрос. Сохранённый UUID остаётся прежним.");}
    finally {pending.current = false; if (!request.signal.aborted) setBusy(false);}
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current || blocked || acceptedUrl || (!submitted && (!canEdit || !states.length))) return;
    pending.current = true; setBusy(true); setError("");
    const request = new AbortController(); controller.current = request;
    try {
      const prepared = submitted ?? await prepareAnimationRevision(sessionStorage, generationId, {states, prompt, sourceMetadataRevision: saved?.sourceMetadataRevision ?? metadataRevision});
      if (request.signal.aborted) {if (prepared.isNew) prepared.clear(); return;}
      setSubmitted({...prepared, isNew: false});
      setSaved(readAnimationRevision(sessionStorage, generationId));
      const response = await fetch(endpoint, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(prepared.input), cache: "no-store", signal: request.signal});
      const result: unknown = await response.json();
      if (request.signal.aborted) return;
      if (!response.ok) {
        const code = result && typeof result === "object" && "code" in result && typeof result.code === "string" ? result.code : "generation_unavailable";
        if (prepared.isNew && response.status >= 400 && DEFINITE_REFUSALS.has(code)) {prepared.clear(); setSubmitted(null); setSaved(null);}
        const detail = publicGenerationError(code); setError(detail.message + " " + detail.hint); return;
      }
      acceptReceipt(result, prepared.input.requestId);
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error && cause.message === "animation_revision_replay_mismatch" ? "Введите тот же текст: настройки уже отправленного запроса менять нельзя." : "Ответ не подтверждён. Повторите тот же запрос или проверьте отправленную версию; UUID сохранён.");
    } finally {pending.current = false; if (!request.signal.aborted) setBusy(false);}
  }

  if (!canEdit && !saved && !submitted) return null;
  if (!editing && !saved) return <section className="animation-revision" lang="ru"><Button disabled={blocked} onClick={() => setEditing(true)}>Редактировать анимации</Button>{blocked && <p>Сначала сохраните изменения карточки.</p>}</section>;
  const locked = busy || Boolean(submitted) || Boolean(acceptedUrl);
  return <section className="animation-revision" lang="ru">
    <h2>Редактирование анимаций</h2>
    <form onSubmit={event => void submit(event)}>
      <fieldset disabled={locked || Boolean(saved)}><legend>Какие анимации изменить?</legend><div className="animation-revision__states">
        {PET_STATES.map(state => <label key={state.key}><input type="checkbox" value={state.key} checked={states.includes(state.key)} onChange={event => setStates(current => event.target.checked ? [...current, state.key] : current.filter(key => key !== state.key))}/>{ANIMATION_LABELS[state.key]}</label>)}
      </div></fieldset>
      <label htmlFor={`animation-edit-${generationId}`}>Что исправить в выбранных анимациях?</label>
      <TextArea id={`animation-edit-${generationId}`} value={submitted?.input.prompt ?? prompt} onUpdate={setPrompt} disabled={locked || !canEdit} minRows={3} controlProps={{maxLength: 2000}} placeholder="При движении вправо поворачивай голову вправо. Не добавляй частей тела, которых нет в базовом образе."/>
      <p>Пустое поле — новая попытка с прежними пожеланиями. Базовый образ, направления взгляда и остальные анимации сохранятся. Изменение размера не поддерживается.</p>
      <p>Выбрано: {states.map(state => ANIMATION_LABELS[state]).join(", ") || "ничего"}. Один запуск — 1 обычная попытка. Новая версия хранится 24 часа.</p>
      {saved && !submitted && <p>Есть неподтверждённый ответ на прежний запрос. Сначала проверьте результат. Текст не хранится в браузере: для повторной отправки введите его заново без изменений.</p>}
      <div className="animation-revision__actions">
        <Button type="submit" view="action" loading={busy} disabled={busy || blocked || Boolean(acceptedUrl) || (!submitted && (!states.length || !canEdit))}>{submitted || saved ? "Повторить тот же запрос" : "Создать новую версию"}</Button>
        {saved && <Button type="button" disabled={busy || Boolean(acceptedUrl)} onClick={() => void check()}>Проверить отправленную версию</Button>}
        {!saved && !submitted && <Button type="button" disabled={busy} onClick={() => setEditing(false)}>Отмена</Button>}
      </div>
    </form>
    {error && <p role="alert">{error}</p>}
    {acceptedUrl && <p><a href={acceptedUrl}>Открыть новую версию</a></p>}
  </section>;
}

export function AnimationRevisionCorrections({corrections}: {corrections: Partial<Record<AnimationState, string[]>>}) {
  if (!Object.keys(corrections).length) return null;
  return <section className="animation-revision" lang="ru"><details><summary>Правки этой версии</summary>
    {PET_STATES.map(state => corrections[state.key]?.length ? <div key={state.key}><h3>{ANIMATION_LABELS[state.key]}</h3>
      {corrections[state.key]!.map((text, index) => <p key={index}>{text}</p>)}
    </div> : null)}
  </details></section>;
}
