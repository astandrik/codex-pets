# Имена и описания питомцев

Редакторское направление согласовано 9 ноября 2026 года. Примеры ниже показывают
желаемый стиль. Выбор между вариантами каждого имени ещё открыт.

## Имя

Имя должно помогать воспринимать питомца как отдельного персонажа. Обычно
достаточно 2–4 слов. Подходят личное имя с прозвищем, короткий образ или уместная
игра слов. Тон зависит от персонажа: спокойный, серьёзный, озорной или ироничный.

- Подбирать имя по видимому образу, выражению и характерным позам. Ассоциация
  может быть творческой; биография и привычки из неё не следуют.
- Использовать разные конструкции. Не превращать весь каталог в сочетания
  «одежда + существо», «цвет + случайное слово» или «имя + однотипное прозвище».
- Сохранять точно заданное пользователем имя, включая язык. Подтверждённое имя
  известного персонажа также сохранять. Визуального сходства недостаточно для
  определения франшизы или личности.
- У похожих вариантов искать содержательное различие. Не добавлять порядковые
  номера и случайные слова ради уникальности. Совпадение имён само по себе
  не требует переименования.
- Для старой карточки с неясным происхождением имени сохранять возможное
  пользовательское имя и выносить спорный случай на просмотр.

Рабочий ориентир — 2–4 слова, действующий предел поля — 80 символов. Длина
не заменяет проверку того, легко ли имя произнести, запомнить и узнать в списке.

## Описание

Автоматическое описание остаётся на английском. Ориентир — 2–3 содержательных
предложения в пределах действующих 320 символов.

1. Назвать, кто изображён, и уместно указать стиль изображения.
2. Описать отличительные видимые детали: внешность, одежду, аксессуары или предметы.
3. При наличии полезного наблюдения добавить характерные позы или движения,
   которые действительно показаны в кадрах.

Описание должно позволять узнать питомца даже по творческому имени. Оно
дополняет имя конкретными сведениями. Следует убирать повторения вроде
«a catgirl with cat ears», рекламные оценки и перечисление поисковых слов.

Проверять каждое фактическое утверждение по изображению. Если по кадрам трудно
различить вид одежды или предмета, выбирать более общее точное слово либо
опускать деталь. Не придумывать возраст, происхождение, профессию, отношения,
сюжет или способности. Описывать показанные позы, не обещая качества и поведения
непросмотренной анимации.

Четыре стандартных кадра для сверки: `idle`, `running-right`, `waving`, `review`.
Название состояния само по себе не доказывает, что персонаж делает именно это;
нужно смотреть на кадр.

## Шаблон для предпросмотра

Этот запрос предназначен для подбора и сравнения вариантов. Он не меняет
действующий формат ответа API генерации.

```text
Suggest two distinct English names and one English description for this pet,
using the supplied sprite frames as visual evidence.

Names should usually contain 2–4 words and feel like names for an individual
character. Consider a personal name with an epithet, an evocative phrase, or
fitting wordplay. Vary the construction to suit the character. Do not default
to clothing plus species, color plus an arbitrary word, or numbered variants.
Preserve an explicitly supplied user name or confirmed character identity.
Do not infer a franchise from visual resemblance alone.

Write a concrete description in 2–3 sentences, at most 320 characters. Identify
the subject and visual style, describe distinguishing visible features, and
mention a pose or movement only when the frames show it. Use broader wording
for uncertain details. Avoid redundant wording, promotional claims, invented
backstory, and claims about unseen animation quality.

For each name, give a short explanation of the association. Present the options
for review before using this direction for a catalog-wide update.
```

## Проверка перед использованием

- Посмотреть все четыре кадра и проверить имя вместе с описанием.
- Убедиться, что описание отличает питомца от похожих соседей по каталогу.
- Проверить каждую деталь, особенно одежду, предметы, цвет и движение.
- Прочитать имя вслух и проверить переносы на плитке при 360 и 390 CSS px.
- Сохранить удачное или пользовательское имя. Сомнение в его происхождении
  отметить для просмотра.
- Проверить пределы 80/320 и отсутствие технических суффиксов в имени.

## Пять образцов

Для каждой пары имён приведено одно описание. Примеры подготовлены по сохранённым
кадрам. Будущие ответы модели нужно проверять по тем же критериям.


### Утка в капюшоне

- **Pip the Unbothered** — Личное имя и прозвище по невозмутимому выражению.
- **Quack After Dark** — Игровое имя с утиным каламбуром и лёгким оттенком нуара.

> A round white cartoon duck in an oversized charcoal hoodie, with an orange bill and webbed feet. It keeps its wings folded close to its body and switches between a brisk run, a lowered head and an eyes-closed pose with its bill resting on one wing.

### Кошкодевочка с перчатками-лапами

- **Mittens in Motion** — Кличка и ощущение движения; лапы узнаются через Mittens.
- **Miss Pawlette** — Имя с игрой paw и Paulette, без перечисления внешних признаков.

> A black-haired, cat-eared girl with a white-tipped tail and oversized paw gloves. She wears a navy-and-white sailor-style crop top, a short pleated skirt and white shoes. Bold anime outlines and grinning, running and raised-paw poses give her a playful look.

### Отдыхающая лисодевочка

- **Runa at Ease** — Личное имя с прозвищем по расслабленной позе.
- **Maple Takes Five** — Тёплая ассоциация и разговорное Takes Five — сделать перерыв.

> An orange-haired foxgirl with tall ears and a fluffy white-tipped tail, drawn in a warm anime style. She wears a gray blouse with a dark bow, a short skirt and brown thigh-high stockings. She lounges on her elbows with her feet raised, while a running frame shows her hair streaming back.

### Воин со светящимся клинком

- **Rowan Brightblade** — Имя и фэнтезийное прозвище, связанное со светящимся клинком.
- **Aster on Watch** — Личное имя и сдержанный образ героя на страже.

> A blond, braided swordfighter in layered cream robes, a dark brown cloak and knee-high boots. The glowing golden blade stands out against the muted clothing. Painterly frames show a guarded stance, a run with the cloak trailing behind and an eyes-closed pause with the blade held upright.

### Бородатый администратор

- **Gus on Call** — Простое человеческое имя и узнаваемый образ дежурного специалиста.
- **Captain Deadlock** — Ироничное техническое прозвище под суровое лицо и кружку с базой данных.

> A stocky, bearded cartoon administrator with messy brown hair, heavy brows, a dark hoodie, olive cargo trousers and black boots. He carries a white mug marked with a database symbol. The frames show him striding, waving and reading a sheet of paper with a serious expression.

## Как применять дальше

Для новых генераций перенести согласованное направление в новую версию
инструкции. Сохранить прежний текст инструкции и хеш запроса у уже принятых
задач. Проверить повтор по UUID, восстановление из журнала, количество вызовов
и учёт расходов. Вновь созданная задача должна использовать новую версию,
а существующая — свою сохранённую.

Для существующих карточек сначала сохранить исходные тексты и предложить
изменения по кадрам. У готовой неотправленной генерации обновление проходит
через редактор метаданных с проверкой ревизии и срока результата. У опубликованной
карточки подготовить новый asset с согласованными `pet.json` и ZIP, сохранив
slug, ID, изображения и прежние asset URLs.

После изменения имени или описания обновить зависящие от них поисковые данные.
Визуальные описания можно повторно использовать после проверки совпадения
байтов изображений. Для массового обновления собрать итоговый набор related
pets по всему опубликованному каталогу, используя свежие данные изменённых
карточек.

Проверить публичные страницы, manifest, файлы пакетов, имена в плитке и сроки.
Оценивать качество на небольшом согласованном наборе перед массовым применением.
Порядок наблюдения за новыми генерациями описан в [пилоте](pet-naming-pilot.md).

## Реализация

Metadata policy 4 применяет эти правила к новым задачам с автоматическими
метаданными. Схема ответа прежняя: одно имя, описание и теги в одном запросе.
Предыдущие политики 1/2/3 сохраняются для уже принятых задач, включая точные
хеши запросов и восстановление журнала. Перед включением policy 4 оба сервиса
должны поддерживать её чтение; откат после новых заявок требует совместимой сборки.

Конкретный выбор между двумя именами каждого примера ещё не зафиксирован.
Пакетная обработка оставшихся 660 карточек приостановлена на этапе предложений.
Новые правила сами по себе не обновляют ранее созданные или опубликованные карточки.
