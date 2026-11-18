export type Priority = 'high' | 'normal' | 'low'
export type Status = 'open' | 'answered' | 'dropped'

export type Question = {
  id: number
  text: string
  why?: string
  priority: Priority
  isBlocking: boolean
  status: Status
  createdAt: number
  order: number
  resolvedAt?: number
  answer?: string
}

declare module 'claude-code' {
  interface PluginState {
    'user-questions': {
      questions: Shaped<Question[]>
      focus: number
    }
  }
}
