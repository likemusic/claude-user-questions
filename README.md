# user-questions

Мод для Claude Code, который собирает очередь вопросов сессии к вам. Он нужен, когда параллельно работает много сессий: вопросы к человеку накапливаются в каждой из них, и без мода приходится обходить все сессии и спрашивать, есть ли что-то.

*A Claude Code mod that keeps a queue of the session's open questions to you: a side pane, a status line counter, `/questions` and `/next-question`, plus a summary across all your sessions.*

## Что делает

- Модель записывает каждый вопрос к вам в очередь инструментом `add_question`: с проектом, вариантами ответа и своей рекомендацией. Когда вы ответили, она закрывает вопрос через `resolve_question`. Делать это её учит инструкция, которую мод добавляет в системный промпт.
- Строка статуса под полем ввода показывает: `вопросов ко мне: 3 · в других сессиях: 5`.
- Панель «Вопросы ко мне» перечисляет открытые вопросы по важности и показывает, сколько их в других сессиях.
- Очередь каждой сессии лежит в файле `~/.claude/user-questions/<session-id>.json`. Сессии читают файлы друг друга раз в 15 секунд и так собирают общую сводку.

## Команды

| Команда | Что делает |
| --- | --- |
| `/questions` | Список открытых вопросов этой сессии. Работает и пока сессия занята. |
| `/questions all` | Вопросы всех сессий, сгруппированные по проектам. |
| `/questions pane` | Открыть панель. |
| `/questions done N`, `/questions drop N` | Закрыть вопрос N вручную. |
| `/next-question` | Самый важный открытый вопрос: сначала блокирующие, затем по приоритету и возрасту. Ответьте сообщением, и сессия закроет вопрос. |
| `/next-question skip` | Отложить текущий вопрос в конец очереди. |

## Установка

В терминале, в поле ввода Claude Code:

```text
/plugin install user-questions --marketplace likemusic/claude-user-questions
```

Из shell:

```bash
claude plugin install user-questions --marketplace likemusic/claude-user-questions
```

В десктопном приложении, где `/plugin` не работает: нажмите **+** рядом с полем ввода, затем **Plugins → Add marketplace** и введите `likemusic/claude-user-questions`, после этого **Add plugin**.

На вопрос `Add marketplace?` ответьте `y` и выберите область установки `user`: тогда мод будет работать во всех новых сессиях.

## Разработка

```bash
claude plugin validate .
claude plugin test .
```

## Лицензия

MIT
