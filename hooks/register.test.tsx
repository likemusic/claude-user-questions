import { expect, test } from 'claude-code/testing'

test('a question is queued, listed and taken one by one', async ($, on) => {
  const files = new Map<string, string>()
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: '/home/u/proj' }))
  on('env.get', () => ({ value: '/home/u' }))
  on('fs.exists', (_, e) => ({ value: files.has((e as { path: string }).path) }))
  on('fs.read', (_, e) => ({ value: files.get((e as { path: string }).path) ?? '' }))
  on('fs.write', (_, e) => {
    const w = e as { path: string; text: string }
    files.set(w.path, w.text)
    return { value: undefined }
  })
  on('clock.every', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }) as never)
  on('command.register', (_, e) => ({ value: { command: (e as { name: string }).name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/home/u/proj', surface: 'terminal', isInteractive: true })

  const add = (args: Record<string, unknown>) =>
    $.tool.call({ tool: 'mcp__user-questions__add_question', ...args } as never)

  expect((await add({ text: 'Low one', priority: 'low' })).result).toContain('#1')
  expect((await add({ text: 'Urgent one', priority: 'high', blocking: true })).result).toContain('#2')
  expect(files.get('/home/u/.claude/user-questions/sess-1.json')).toContain('Urgent one')

  const list = await $.command.run({ command: 'questions', args: '' } as never)
  expect(list.text).toContain('Вопросов в этой сессии: 2')

  const first = await $.command.run({ command: 'next-question', args: '' } as never)
  expect(first.text).toContain('Urgent one')

  const skipped = await $.command.run({ command: 'next-question', args: 'skip' } as never)
  expect(skipped.text).toContain('Low one')

  await $.tool.call({ tool: 'mcp__user-questions__resolve_question', id: 1, status: 'answered' } as never)
  const after = await $.command.run({ command: 'next-question', args: '' } as never)
  expect(after.text).toContain('Urgent one')
  expect(after.text).toContain('из 1')

  const closed = await $.command.run({ command: 'questions', args: 'close 2' } as never)
  expect(closed.text).toBe('Вопрос #2 закрыт без ответа.')
  expect(closed.context?.[0]).toContain('рекомендованному варианту')
  const empty = await $.command.run({ command: 'questions', args: '' } as never)
  expect(empty.text).toContain('открытых вопросов к тебе нет')
})
