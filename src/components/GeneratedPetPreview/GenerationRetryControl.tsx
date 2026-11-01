"use client";
import {useId} from "react";
import {parseMaxRetriesInput} from "./continuation-request";

type Props = {
  value: string; max: number; disabled: boolean; legacy: boolean; allowLegacy: boolean;
  onChange: (value: string) => void; onLegacy: (value: boolean) => void;
};
export function GenerationRetryControl({value, max, disabled, legacy, allowLegacy, onChange, onLegacy}: Props) {
  const id = useId(), count = parseMaxRetriesInput(value, max);
  const invalid = !legacy && count === null;
  let description: string;
  if (legacy) description = "Используется прежняя политика сервиса.";
  else if (count === null) description = disabled ? "Число повторов прошлого запроса неизвестно." : `Введите целое число от 0 до ${max}.`;
  else if (count === 0) description = "Одна попытка, без автоповторов.";
  else {
    const attempts = count + 1, noun = attempts % 10 === 1 && attempts % 100 !== 11 ? "попытки" : "попыток";
    description = `До ${attempts} ${noun} на каждую выбранную анимацию или группу взгляда. Удачные результаты сохраняются.`;
  }
  return <div className="generation-recovery__retries">
    <label htmlFor={id}>Автоповторы при ошибке</label>
    <div className="generation-recovery__retry-controls">
      <button type="button" aria-label="Уменьшить число автоповторов" disabled={disabled || legacy || count === null || count === 0} onClick={() => count !== null && onChange(String(count - 1))}>−</button>
      <input id={id} aria-label="Автоповторы при ошибке" type="number" inputMode="numeric" min={0} max={max} step={1}
        value={value} disabled={disabled || legacy} aria-invalid={invalid && !disabled || undefined} aria-describedby={id + "-help"} onChange={event => onChange(event.target.value)}/>
      <button type="button" aria-label="Увеличить число автоповторов" disabled={disabled || legacy || count === null || count === max} onClick={() => count !== null && onChange(String(count + 1))}>+</button>
    </div>
    <small id={id + "-help"} role={invalid && !disabled ? "status" : undefined}>{description}</small>
    {allowLegacy && <label className="generation-recovery__legacy-retries"><input type="checkbox" aria-label="В запросе не было настройки автоповторов" checked={legacy} disabled={disabled} onChange={event => onLegacy(event.target.checked)}/>В запросе не было настройки автоповторов</label>}
  </div>;
}
