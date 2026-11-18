import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Priority, Question, Status } from '../types'

const PLUGIN = 'user-questions'
const PANE = 'user-questions'

const questions = atom({ plugin: 'user-questions', key: 'questions' } as const, [], { shape: 'q-1' })
const focus = atom({ plugin: 'user-questions', key: 'focus' } as const, 0)

const PRIO_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 }
const PRIO_MARK: Record<Priority, string> = { high: '!!', normal: '! ', low: '· ' }

const GUIDE = `# Очередь вопросов к пользователю (мод user-questions)

Пользователь ведёт много параллельных сессий и разбирает вопросы каждой сессии к себе по очереди, командами /questions и /next-question. Поэтому каждый вопрос, на который нужен ответ пользователя (решение, недостающий факт, подтверждение необратимого действия), в том числе вопрос соседней сессии, который адресован пользователю и пришёл через тебя, регистрируй инструментом mcp__user-questions__add_question. В тексте ответа его тоже можно задать, как обычно.

- Один вызов — один вопрос. Формулировка самодостаточная: её прочитают позже, без прокрутки истории. Укажи, о каком проекте, файле или задаче речь, какие есть варианты и какой ты рекомендуешь.
- priority: high — без ответа стоит важная работа или есть риск; normal — обычный; low — можно ответить когда угодно. blocking: true, если без ответа ты дальше не двигаешься.
- Не регистрируй риторические вопросы и вопросы вида «продолжать ли».
- Перед добавлением посмотри, нет ли такого же вопроса (mcp__user-questions__list_questions). Если формулировка устарела, закрой старый вопрос со status dropped и заведи новый.
- Как только пользователь ответил (в любой форме, даже мимоходом) или вопрос потерял смысл, вызови mcp__user-questions__resolve_question с id и кратким ответом. Открытым в очереди должно оставаться только то, что действительно ждёт пользователя.`

type QFile = { sessionId: string; cwd: string; updatedAt: number; questions: Question[] }

const sortOpen = (list: readonly Question[]): Question[] =>
  list
    .filter(q => q.status === 'open')
    .sort(
      (a, b) =>
        Number(b.isBlocking) - Number(a.isBlocking) ||
        PRIO_RANK[a.priority] - PRIO_RANK[b.priority] ||
        a.order - b.order,
    )

const age = (now: number, t: number): string => {
  const m = Math.max(0, Math.round((now - t) / 60000))
  if (m < 60) return `${m} мин`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} ч` : `${Math.round(h / 24)} дн`
}

const line = (q: Question, now: number): string =>
  `#${q.id} ${PRIO_MARK[q.priority]}${q.isBlocking ? '[блокирует] ' : ''}${q.text}  (${age(now, q.createdAt)})`

let ownFile = ''
let sessionId = ''
let cwd = ''
let paneOpened = false

const persist = async ($: EngineInterface) => {
  const list = await read($, questions)
  const data: QFile = { sessionId, cwd, updatedAt: Date.now(), questions: list }
  await $.fs.write(ownFile, JSON.stringify(data, null, 2))
  await refreshStatus($)
}

const refreshStatus = async ($: EngineInterface) => {
  const mine = sortOpen(await read($, questions)).length
  $.ui.status(mine === 0 ? undefined : `вопросов ко мне: ${mine} · /next-question`)
}

const openPane = async ($: EngineInterface) => {
  paneOpened = true
  await $.ui.open({ id: PANE, title: 'Вопросы ко мне' })
}

const resolve = async ($: EngineInterface, id: number, status: Status, answer?: string): Promise<boolean> => {
  let hit = false
  await update($, questions, list =>
    list.map(q => {
      if (q.id !== id || q.status !== 'open') return q
      hit = true
      return { ...q, status, answer, resolvedAt: Date.now() }
    }),
  )
  if (hit) await persist($)
  return hit
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    sessionId = await $.session.id()
    cwd = await $.session.cwd()
    const home = (await $.env.get('HOME')) ?? '/tmp'
    ownFile = `${home}/.claude/user-questions/${sessionId}.json`

    // A resumed session gets its own queue back.
    if ((await read($, questions)).length === 0 && (await $.fs.exists(ownFile))) {
      try {
        const data = JSON.parse(await $.fs.read(ownFile)) as QFile
        await update($, questions, () => data.questions ?? [])
      } catch {
        // unreadable file: start empty
      }
    }

    await $.tool.register({
      name: 'add_question',
      description:
        'Добавить вопрос к пользователю в очередь этой сессии. Формулировка самодостаточная: проект/задача, варианты, твоя рекомендация. Возвращает id вопроса.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Сам вопрос, понятный без истории диалога' },
          why: { type: 'string', description: 'Зачем нужен ответ, что от него зависит (коротко)' },
          priority: { type: 'string', enum: ['high', 'normal', 'low'] },
          blocking: { type: 'boolean', description: 'true, если без ответа работа стоит' },
        },
        required: ['text'],
      },
    })
    await $.tool.register({
      name: 'resolve_question',
      description:
        'Закрыть вопрос из очереди: answered — пользователь ответил, dropped — вопрос больше не актуален.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          status: { type: 'string', enum: ['answered', 'dropped'] },
          answer: { type: 'string', description: 'Краткий ответ или причина закрытия' },
        },
        required: ['id', 'status'],
      },
    })
    await $.tool.register({
      name: 'list_questions',
      description: 'Показать открытые вопросы к пользователю этой сессии (по порядку важности).',
      inputSchema: { type: 'object', properties: {} },
    })

    await $.command.register({
      name: 'questions',
      description: 'Вопросы этой сессии ко мне. pane — открыть панель, close N — закрыть вопрос N вручную',
      argumentHint: '[pane | close N]',
      immediate: true,
    })
    await $.command.register({
      name: 'next-question',
      description: 'Показать самый важный открытый вопрос ко мне; skip — отложить текущий в конец',
      argumentHint: '[skip]',
    })

    if (sortOpen(await read($, questions)).length > 0) void openPane($)
    await refreshStatus($)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { sections: [...r.sections, { id: 'user-questions-guide', text: GUIDE, scope: 'session' as const }] }
  })

  on('tool.run', { tool: 'mcp__user-questions__add_question' }, async ($, e) => {
    const a = e as unknown as { text?: string; why?: string; priority?: Priority; blocking?: boolean }
    const text = (a.text ?? '').trim()
    if (text === '') return { deny: 'text пустой' }
    const now = Date.now()
    let id = 0
    await update($, questions, list => {
      id = list.reduce((m, q) => Math.max(m, q.id), 0) + 1
      const q: Question = {
        id,
        text,
        why: a.why,
        priority: a.priority ?? 'normal',
        isBlocking: a.blocking === true,
        status: 'open',
        createdAt: now,
        order: now,
      }
      return [...list, q]
    })
    await persist($)
    if (!paneOpened) void openPane($)
    const open = sortOpen(await read($, questions)).length
    return { result: `Вопрос #${id} добавлен. Открытых вопросов: ${open}.` }
  })

  on('tool.run', { tool: 'mcp__user-questions__resolve_question' }, async ($, e) => {
    const a = e as unknown as { id?: number; status?: Status; answer?: string }
    const ok = await resolve($, Number(a.id), a.status === 'dropped' ? 'dropped' : 'answered', a.answer)
    const open = sortOpen(await read($, questions)).length
    return { result: ok ? `Вопрос #${a.id} закрыт. Осталось открытых: ${open}.` : `Открытого вопроса #${a.id} нет.` }
  })

  on('tool.run', { tool: 'mcp__user-questions__list_questions' }, async $ => {
    const now = Date.now()
    const open = sortOpen(await read($, questions))
    return { result: open.length === 0 ? 'Открытых вопросов нет.' : open.map(q => line(q, now)).join('\n') }
  })

  on('command.run', { command: 'questions' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().split(/\s+/)
    const now = Date.now()

    if (verb === 'pane') {
      await openPane($)
      return { text: 'Панель вопросов открыта.', isTextDisplayOnly: true as const }
    }
    if (verb === 'close') {
      const ok = await resolve($, Number(arg), 'dropped', 'закрыт пользователем вручную')
      return {
        text: ok ? `Вопрос #${arg} закрыт.` : `Открытого вопроса #${arg} нет.`,
        isTextDisplayOnly: true as const,
        context: ok ? [`Пользователь вручную закрыл вопрос #${arg} из очереди: ответ на него больше не нужен или получен вне этой сессии. Не задавай его снова.`] : [],
      }
    }

    const open = sortOpen(await read($, questions))
    const out: string[] = [
      open.length === 0 ? 'В этой сессии открытых вопросов к тебе нет.' : `Вопросов в этой сессии: ${open.length}`,
      ...open.map(q => '  ' + line(q, now)),
    ]
    if (open.length > 0) out.push('', 'Разбирать по одному: /next-question')
    return { text: out.join('\n'), isTextDisplayOnly: true as const }
  })

  on('command.run', { command: 'next-question' }, async ($, e) => {
    let open = sortOpen(await read($, questions))
    if (open.length === 0) {
      return { text: 'Открытых вопросов в этой сессии нет.', isTextDisplayOnly: true as const }
    }
    const cur = await read($, focus)
    const shown = open.find(q => q.id === cur) ?? open[0]
    if (e.args.trim() === 'skip' && shown !== undefined && open.length > 1) {
      const last = Math.max(...open.map(q => q.order)) + 1
      await update($, questions, list => list.map(q => (q.id === shown.id ? { ...q, order: last } : q)))
      await persist($)
      const sorted = sortOpen(await read($, questions))
      open = [...sorted.filter(q => q.id !== shown.id), ...sorted.filter(q => q.id === shown.id)]
    } else if (shown !== undefined) {
      open = [shown, ...open.filter(q => q.id !== shown.id)]
    }
    const q = open[0]
    if (q === undefined) return { text: 'Открытых вопросов в этой сессии нет.', isTextDisplayOnly: true as const }
    await update($, focus, () => q.id)
    const now = Date.now()
    const text = [
      `Вопрос #${q.id} из ${open.length}${q.isBlocking ? ' — блокирует работу' : ''} (приоритет ${q.priority}, ${age(now, q.createdAt)} назад)`,
      '',
      q.text,
      ...(q.why ? ['', `Зачем: ${q.why}`] : []),
      '',
      'Ответь сообщением. Дальше: /next-question; отложить: /next-question skip; закрыть без ответа: /questions close ' + q.id,
    ].join('\n')
    return {
      text,
      isTextDisplayOnly: true as const,
      context: [
        `Пользователь разбирает очередь вопросов и сейчас смотрит вопрос #${q.id}: «${q.text}». Его следующее сообщение, скорее всего, ответ на этот вопрос. Когда вопрос решён, закрой его через mcp__user-questions__resolve_question с кратким ответом, выполни то, что из ответа следует, и одной строкой напомни, что следующий вопрос — /next-question (останется ${open.length - 1}).`,
      ],
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = Date.now()
    const open = sortOpen(await read($, questions))
    const cur = await read($, focus)
    return (
      <Box flexDirection="column">
        <Text bold>{open.length === 0 ? 'Открытых вопросов нет' : `Открытых вопросов: ${open.length}`}</Text>
        {open.map(q => (
          <Box flexDirection="column" marginTop={1}>
            <Text bold={q.id === cur} color={q.priority === 'high' || q.isBlocking ? 'red' : undefined}>
              {`${q.id === cur ? '► ' : ''}#${q.id} ${PRIO_MARK[q.priority]}${q.isBlocking ? '[блокирует]' : ''}`}
            </Text>
            <Text>{q.text}</Text>
            <Text dimColor>{age(now, q.createdAt)} назад</Text>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text dimColor>/next-question — разбирать по одному</Text>
        </Box>
      </Box>
    )
  })
}
