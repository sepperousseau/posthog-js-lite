import { PostHog } from 'posthog-node'
import OpenAIOrignal from 'openai'

type ChatCompletionCreateParamsBase = OpenAIOrignal.Chat.Completions.ChatCompletionCreateParams

export interface MonitoringParams {
  posthogDistinctId?: string
  posthogTraceId?: string
  posthogProperties?: Record<string, any>
  posthogPrivacyMode?: boolean
  posthogGroups?: Record<string, any>
}

export const getModelParams = (params: ChatCompletionCreateParamsBase & MonitoringParams): Record<string, any> => {
  const modelParams: Record<string, any> = {}
  const paramKeys = [
    'temperature',
    'max_tokens',
    'max_completion_tokens',
    'top_p',
    'frequency_penalty',
    'presence_penalty',
    'n',
    'stop',
    'stream',
    'streaming',
  ] as const

  for (const key of paramKeys) {
    if (key in params && (params as any)[key] !== undefined) {
      modelParams[key] = (params as any)[key]
    }
  }
  return modelParams
}

export const getUsage = (response: any, provider: string): { input_tokens: number; output_tokens: number } => {
  if (!response?.usage) {
    return { input_tokens: 0, output_tokens: 0 }
  }

  if (provider === 'anthropic') {
    return {
      input_tokens: response.usage.input_tokens ?? 0,
      output_tokens: response.usage.output_tokens ?? 0,
    }
  } else if (provider === 'openai') {
    return {
      input_tokens: response.usage.prompt_tokens ?? 0,
      output_tokens: response.usage.completion_tokens ?? 0,
    }
  }

  return { input_tokens: 0, output_tokens: 0 }
}

/**
 * Helper to format responses (non-streaming) for consumption, mirroring Python's openai vs. anthropic approach.
 */
export const formatResponse = (response: any, provider: string): Array<{ role: string; content: string }> => {
  if (!response) {
    return []
  }
  if (provider === 'anthropic') {
    return formatResponseAnthropic(response)
  } else if (provider === 'openai') {
    return formatResponseOpenAI(response)
  }
  return []
}

export const formatResponseAnthropic = (response: any): Array<{ role: string; content: string }> => {
  // Example approach if "response.content" holds array of text segments, etc.
  const output: Array<{ role: string; content: string }> = []
  for (const choice of response.content ?? []) {
    if (choice?.text) {
      output.push({
        role: 'assistant',
        content: choice.text,
      })
    }
  }
  return output
}

export const formatResponseOpenAI = (response: any): Array<{ role: string; content: string }> => {
  const output: Array<{ role: string; content: string }> = []
  for (const choice of response.choices ?? []) {
    if (choice.message?.content) {
      output.push({
        role: choice.message.role,
        content: choice.message.content,
      })
    }
  }
  return output
}

export const mergeSystemPrompt = (params: ChatCompletionCreateParamsBase & MonitoringParams, provider: string): any => {
  if (provider !== 'anthropic') {
    return params.messages
  }
  const messages = params.messages || []
  if (!(params as any).system) {
    return messages
  }
  const systemMessage = (params as any).system
  return [{ role: 'system', content: systemMessage }, ...messages]
}

export const withPrivacyMode = (client: PostHog, privacyMode: boolean, input: any): any => {
  return (client as any).privacy_mode || privacyMode ? null : input
}

export type SendEventToPosthogParams = {
  client: PostHog
  distinctId?: string
  traceId: string
  model: string
  provider: string
  input: any
  output: any
  latency: number
  baseURL: string
  httpStatus: number
  usage?: { input_tokens?: number; output_tokens?: number }
  params: ChatCompletionCreateParamsBase & MonitoringParams
}

export const sendEventToPosthog = ({
  client,
  distinctId,
  traceId,
  model,
  provider,
  input,
  output,
  latency,
  baseURL,
  params,
  httpStatus = 200,
  usage = {},
}: SendEventToPosthogParams): void => {
  if (client.capture) {
    client.capture({
      distinctId: distinctId ?? traceId,
      event: '$ai_generation',
      properties: {
        $ai_provider: provider,
        $ai_model: model,
        $ai_model_parameters: getModelParams(params),
        $ai_input: withPrivacyMode(client, params.posthogPrivacyMode ?? false, input),
        $ai_output_choices: withPrivacyMode(client, params.posthogPrivacyMode ?? false, output),
        $ai_http_status: httpStatus,
        $ai_input_tokens: usage.input_tokens ?? 0,
        $ai_output_tokens: usage.output_tokens ?? 0,
        $ai_latency: latency,
        $ai_trace_id: traceId,
        $ai_base_url: baseURL,
        ...params.posthogProperties,
        ...(distinctId ? {} : { $process_person_profile: false }),
      },
      groups: params.posthogGroups,
    })
  }
}
