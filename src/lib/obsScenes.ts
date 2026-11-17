/** Normal OBS links follow the console. Demo/performance options belong only to previews. */
export const OBS_SCENES = [
  { id: 'starting', title: 'Скоро начнём', group: 'До матча', description: 'Отсчёт до начала, расписание и партнёры. Таймер задаётся в разделе «Перерыв».' },
  { id: 'intro', title: 'Заставка эфира', group: 'До матча', description: 'Однократное появление логотипа и названия турнира. Повторный запуск — с пульта.' },
  { id: 'versus', title: 'Анонс матча', group: 'До матча', description: 'Команды, составы и формат выбранного матча.' },
  { id: 'bracket', title: 'Турнирная сетка', group: 'До матча', description: 'Таблицы групп или сетка плей-офф выбранного турнира на весь экран.' },
  { id: 'schedule', title: 'Расписание', group: 'До матча', description: 'Ближайшие матчи выбранного турнира.' },
  { id: 'hud', title: 'Счёт поверх игры', group: 'В эфире', description: 'Прозрачный фон, команды, счёт серии и карты. Данные меняются с пульта.' },
  { id: 'veto', title: 'Выбор карт CS2', group: 'В эфире', description: 'Пул карт, баны, пики и решающая карта. Управление — «Вето карт».' },
  { id: 'draft', title: 'Драфт Dota 2', group: 'В эфире', description: 'Пики и баны героев с прозрачным центром под игру.' },
  { id: 'picks', title: 'Пики и баны', group: 'В эфире', description: 'Автоматически выбирает драфт или вето по дисциплине матча.' },
  { id: 'casters', title: 'Студия комментаторов', group: 'В эфире', description: 'Подписи и окна под камеры. Имена задаются в «Студии», камеры добавляются в OBS.' },
  { id: 'lower', title: 'Плашка с именем', group: 'В эфире', description: 'Имя, роль и контакт. Показ и скрытие — в разделе «Студия».' },
  { id: 'ticker', title: 'Бегущая строка', group: 'В эфире', description: 'Новости внизу экрана. Текст и видимость — в разделе «Студия».' },
  { id: 'brb', title: 'Технический перерыв', group: 'В эфире', description: 'Таймер и сообщение из раздела «Перерыв».' },
  { id: 'mapresult', title: 'Итог карты', group: 'После матча', description: 'Победитель карты, счёт серии и следующая карта.' },
  { id: 'result', title: 'Итог матча', group: 'После матча', description: 'Крупный счёт и команда-победитель.' },
  { id: 'ending', title: 'Конец трансляции', group: 'После матча', description: 'Финальный экран с расписанием и ссылками лиги.' },
  { id: 'stinger', title: 'Переход между сценами', group: 'После матча', description: 'Предпросмотр перехода. В OBS используйте видео с прозрачностью ниже.' },
] as const
export function obsSceneTitle(id: string) { return OBS_SCENES.find(s => s.id === id)?.title ?? id }
export function obsScenePath(id: string, key: string, options: { demo?: boolean; perf?: boolean } = {}) {
  const params = new URLSearchParams({ obskey: key })
  if (options.demo) params.set('demo', '1')
  if (options.perf) params.set('perf', '1')
  if (id === 'stinger') params.set('loop', '1')
  return `#/obs/${id}?${params.toString()}`
}
