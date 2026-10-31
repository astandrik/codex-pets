import type {AssemblyIssue, ContinuationState} from '@/lib/pets/generation/continuation-model';

export const RECOVERY_LABELS:Record<ContinuationState,string>={idle:'Покой',running:'Работа','running-left':'Движение влево','running-right':'Движение вправо',waving:'Приветствие',jumping:'Прыжок',waiting:'Ожидание',failed:'Неудача',review:'Размышление','look-0-157':'Направления 1–8','look-180-337':'Направления 9–16'};

export function recoveryIssueMessage(issue:AssemblyIssue):string {
 const frame=issue.frame===undefined?'Кадры':`Извлечённый кадр ${issue.frame+1}`;
 if(issue.kind==='components')return 'Не удалось разделить позы';
 if(issue.kind==='invalid'&&issue.actual!==undefined&&issue.expected!==undefined&&issue.actual!==issue.expected){
  return `${frame} значительно ${issue.actual<issue.expected?'меньше':'больше'} остальных`;
 }
 if(issue.kind==='sparse')return `${frame} пуст или содержит слишком мало изображения`;
 if(issue.kind==='chroma')return `${frame} содержит цвет фона`;
 if(issue.kind==='edge')return `${frame} выходит за границы`;
 return `${frame} не прошёл проверку`;
}

export function recoveryIssueMeasurements(issue:AssemblyIssue):string {
 if(issue.actual===undefined)return '';
 if(issue.expected!==undefined){
  return `${issue.actual} пикселей; ${issue.kind==='invalid'?'медиана':'минимум'} ${issue.expected}`;
 }
 return `${issue.actual} пикселей`;
}
