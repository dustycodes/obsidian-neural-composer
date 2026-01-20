import OpenAI from 'openai'
import { FinalRequestOptions } from 'openai/core'

export class NoStainlessOpenAI extends OpenAI {
  override buildRequest<Req>(
    options: FinalRequestOptions<Req>,
    { retryCount = 0 }: { retryCount?: number } = {},
  ): { req: RequestInit; url: string; timeout: number } {
    const req = super.buildRequest(options, { retryCount })
    const headers = req.req.headers as Record<string, string>
    Object.keys(headers).forEach((k) => {
      if (k.startsWith('x-stainless')) {
        
        delete headers[k]
      }
    })
    return req
  }
}
