"use client";
import {useEffect, useRef, useState} from "react";
import {Button} from "@gravity-ui/uikit";
import {StatePreview} from "@/components/StatePreview/StatePreview";
import {PET_STATES} from "@/lib/pets/types";
import {PREVIEW_FRAME_MS} from "@/lib/pets/preview-timing";
import {withBasePath} from "@/lib/base-path";
import {notifyGenerationHistory} from "@/lib/pets/generation/history";
import type {AnimationState} from "@/lib/pets/generation/animation-revision-input";
import {ANIMATION_LABELS} from "./AnimationRevisionEditor";
import "./AnimationRevision.scss";

type Props = {generationId: string; sourceGenerationId: string; expiresAt: string; petJsonUrl: string; spritesheetUrl: string; beforeSpritesheetUrl: string; selectedStates: AnimationState[]; unavailable?: boolean; onAccepted: () => void};
export function AnimationRevisionComparison(props: Props) {
  const [state, setState] = useState<AnimationState>(props.selectedStates[0]);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [terminalError, setTerminalError] = useState("");
  const unavailable = Boolean(props.unavailable || terminalError);
  const message = terminalError || (props.unavailable ? "Эта версия недоступна или срок её хранения истёк. Принять её больше нельзя." : error);
  const pending = useRef(false), controller = useRef<AbortController | null>(null);
  const frameCount = PET_STATES.find(item => item.key === state)!.frames;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setFrame(value => (value + 1) % frameCount), PREVIEW_FRAME_MS);
    return () => clearInterval(timer);
  }, [frameCount, playing]);
  useEffect(() => () => controller.current?.abort(), []);
  async function accept() {
    if (pending.current || unavailable) return;
    pending.current = true; setBusy(true); setError("");
    const request = new AbortController(); controller.current = request;
    try {
      const response = await fetch(withBasePath(`/api/pet-generations/${props.generationId}/animation-revision/accept`), {method: "POST", cache: "no-store", signal: request.signal});
      if (request.signal.aborted) return;
      if (response.status === 404 || response.status === 410) {
        setTerminalError(response.status === 410 ? "Срок хранения этой версии истёк. Принять её больше нельзя." : "Эта версия больше недоступна. Принять её нельзя.");
        return;
      }
      const result = await response.json();
      if (request.signal.aborted) return;
      if (!response.ok || result.generation?.animationRevision?.acceptedAt === undefined) throw Error("acceptance_unconfirmed");
      notifyGenerationHistory(); props.onAccepted();
    } catch {if (!request.signal.aborted) setError("Не удалось подтвердить принятие. Повторите действие: новая генерация и списание попытки не произойдут.");}
    finally {pending.current = false; if (!request.signal.aborted) setBusy(false);}
  }
  return <section className="animation-revision" lang="ru">
    <h2>Проверьте новую версию</h2>
    <p>Изменены: {props.selectedStates.map(name => ANIMATION_LABELS[name]).join(", ")}. Принимается весь набор; исходная версия сохраняется.</p>
    <label>Анимация для сравнения <select value={state} onChange={event => {const selected = PET_STATES.find(item => item.key === event.target.value); if (selected) {setState(selected.key); setFrame(0);}}}>
      {PET_STATES.map(item => <option key={item.key} value={item.key}>{ANIMATION_LABELS[item.key]}{props.selectedStates.includes(item.key) ? " — изменена" : " — сохранена"}</option>)}
    </select></label>{" "}<Button onClick={() => setPlaying(value => !value)}>{playing ? "Пауза" : "Воспроизвести"}</Button>
    <div className="animation-revision__comparison">
      <section><h3>Было</h3><StatePreview petJsonUrl={props.petJsonUrl} spritesheetUrl={props.beforeSpritesheetUrl} selectedKey={state} frame={frame} hideControls/></section>
      <section><h3>Стало</h3><StatePreview petJsonUrl={props.petJsonUrl} spritesheetUrl={props.spritesheetUrl} selectedKey={state} frame={frame} hideControls/></section>
    </div>
    <p>Доступно до {new Date(props.expiresAt).toLocaleString()}. Принятие бесплатно и не продлевает срок.</p>
    <div className="animation-revision__actions"><Button view="action" loading={busy} disabled={busy || unavailable} onClick={() => void accept()}>Принять новую версию</Button><Button href={withBasePath(`/generated/${props.sourceGenerationId}`)} disabled={busy}>Оставить предыдущую</Button></div>
    <p>Сравнение сохранено в этой версии. Ссылка на предыдущую работает только до её собственного срока.</p>
    {message && <p role="alert">{message}</p>}
  </section>;
}
